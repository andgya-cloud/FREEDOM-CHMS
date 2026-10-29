import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { logger } from 'firebase-functions';
import { defineSecret } from 'firebase-functions/params';
import { HttpsError, onCall } from 'firebase-functions/v2/https';
import { onSchedule } from 'firebase-functions/v2/scheduler';
import nodemailer, { type SendMailOptions } from 'nodemailer';
import { db, FieldValue, requireCaller, requireString, writeAudit, type UserProfile } from './common.js';
import { canAccessOrg, INVENTORY_MANAGER_ROLES, isInventoryManager } from './shared/permissions.js';
import { letterheadFor } from './shared/pettyVoucher.js';
import { localDateKey } from './shared/datetime.js';
import { needsReminder, phaseTitle, reminderSubject, reminderText, type InventoryCount } from './shared/inventory.js';

// ADIA's Gmail and its app password, the same ones petty cash and Exam Records emails go from.
const PETTY_EMAIL_APP_PASSWORD = defineSecret('PETTY_EMAIL_APP_PASSWORD');
const appUrl = () => process.env.APP_URL || 'https://freedom-chms.web.app';
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function mailer() {
  const test = process.env.PETTY_MAIL_TEST_DIR;
  const pass = test ? 'test' : PETTY_EMAIL_APP_PASSWORD.value().replace(/\s+/g, '');
  const from = letterheadFor({ type: 'college', name: '' }).email;
  if (!from || !pass) throw new HttpsError('failed-precondition', 'Email is not set up for ADIA.');
  // In local tests the emails are written to files instead of being sent.
  const transport = test ? nodemailer.createTransport({ jsonTransport: true }) : nodemailer.createTransport({ service: 'gmail', auth: { user: from, pass } });
  return {
    from,
    async send(msg: SendMailOptions, label: string) {
      const info = await transport.sendMail({ from: `"ADIA Training Centre" <${from}>`, replyTo: from, ...msg });
      if (test) {
        await mkdir(test, { recursive: true });
        await writeFile(join(test, `${Date.now()}-inventory-${label}.json`), String((info as { message?: unknown }).message ?? ''));
      }
    },
  };
}

/** The active accounts in charge of a department's inventory at an organization. */
async function inCharge(orgId: string, courseId: string) {
  const snap = await db.collection('users').where('inventoryCourseIds', 'array-contains', courseId).get();
  return snap.docs.map((d) => d.data() as UserProfile).filter((u) => u.active && (u.allOrgs || u.orgIds?.includes(orgId)) && EMAIL.test(u.email ?? ''));
}

/**
 * The countdown emails (Andy, 2026-10-29, 7A): once a day for the last five days before a count's deadline, the
 * people in charge of that department's inventory get a reminder from ADIA's Gmail, until they submit.
 */
export async function remindInventory(now = new Date()): Promise<number> {
  const today = localDateKey(now);
  const orgs = await db.collection('organizations').where('type', '==', 'college').get();
  let sent = 0;
  let mail: ReturnType<typeof mailer> | null = null;
  for (const org of orgs.docs) {
    const counts = await db.collection(`organizations/${org.id}/inventoryCounts`).where('status', '==', 'open').get();
    for (const doc of counts.docs) {
      const c = doc.data() as InventoryCount & { deletedAt?: unknown };
      if (c.deletedAt || !needsReminder(c, today)) continue;
      const people = await inCharge(org.id, c.courseId);
      mail ??= mailer();
      for (const p of people) {
        try {
          await mail.send({ to: `"${p.displayName.replace(/"/g, '')}" <${p.email}>`, subject: reminderSubject(c, today), text: reminderText(c, today, p.displayName.split(' ')[0] ?? p.displayName, `${appUrl()}/inventory/${doc.id}`) }, doc.id);
          sent++;
        } catch (err) { logger.warn(`Inventory reminder to ${p.email} failed`, err); }
      }
      await doc.ref.update({ remindedOn: today });
    }
  }
  return sent;
}

export const inventoryReminders = onSchedule(
  // Cloud Scheduler isn't offered in africa-south1, so this job runs from Europe; 8 a.m. in Nairobi.
  { schedule: 'every day 08:00', timeZone: 'Africa/Nairobi', region: process.env.SCHEDULER_REGION || 'europe-west1', timeoutSeconds: 300, secrets: [PETTY_EMAIL_APP_PASSWORD] },
  async () => { await remindInventory(); },
);

/**
 * "Email" on an inventory form (Andy, 2026-10-29, 9A): sends the PDF made on the device to Admin and the
 * Principal, or to an address typed in, from ADIA's Gmail. Only someone who may read the form can send it.
 */
export const inventoryEmail = onCall({ invoker: 'public', secrets: [PETTY_EMAIL_APP_PASSWORD], memory: '512MiB' }, async (request) => {
  const caller = await requireCaller(request);
  const data = (request.data ?? {}) as Record<string, unknown>;
  const orgId = requireString(data.orgId, 'the organization', { max: 80 });
  const countId = requireString(data.countId, 'the inventory', { max: 160 });
  if (!canAccessOrg(caller.profile, orgId)) throw new HttpsError('permission-denied', 'You do not have access to this organization.');
  const ref = db.doc(`organizations/${orgId}/inventoryCounts/${countId}`);
  const c = (await ref.get()).data() as (InventoryCount & { deletedAt?: unknown; emailedAt?: FirebaseFirestore.Timestamp }) | undefined;
  if (!c || c.deletedAt) throw new HttpsError('not-found', 'This inventory form is no longer there.');
  const mine = ((caller.profile as { inventoryCourseIds?: string[] }).inventoryCourseIds ?? []).includes(c.courseId);
  if (!mine && !isInventoryManager(caller.profile)) throw new HttpsError('permission-denied', 'You cannot send this inventory form.');
  const last = c.emailedAt?.toMillis?.() ?? 0;
  if (Date.now() - last < 60_000) throw new HttpsError('already-exists', 'This was emailed a moment ago. Please wait a minute before sending again.');

  const b64 = requireString(data.pdf, 'the PDF', { max: 14_000_000 });
  const bytes = Buffer.from(b64, 'base64');
  if (bytes.subarray(0, 5).toString() !== '%PDF-') throw new HttpsError('invalid-argument', 'That file is not a PDF.');
  const fileName = requireString(data.fileName, 'the file name', { max: 120 }).replace(/[^A-Za-z0-9._-]+/g, '-');

  let to: string[];
  if (data.to === 'managers') {
    const users = await db.collection('users').where('roleId', 'in', [...INVENTORY_MANAGER_ROLES]).get();
    to = users.docs.map((d) => d.data() as UserProfile).filter((u) => u.active && (u.allOrgs || u.orgIds?.includes(orgId)) && EMAIL.test(u.email ?? '')).map((u) => u.email);
    if (!to.length) throw new HttpsError('failed-precondition', 'No Admin or Principal account has an email address yet.');
  } else {
    const typed = requireString(data.to, 'the email address', { max: 200 }).trim().toLowerCase();
    if (!EMAIL.test(typed)) throw new HttpsError('invalid-argument', 'Check the email address.');
    to = [typed];
  }
  const title = `${c.courseName} inventory, ${phaseTitle(c.phase, c.cohort)}`;
  try {
    await mailer().send({
      to: to.join(', '), subject: `${title}${c.status === 'verified' ? ' (verified)' : c.status === 'submitted' ? ' (submitted)' : ''}`,
      text: [`Please find attached the ${title}, sent by ${caller.profile.displayName}.`, '', `${c.items.length} ${c.items.length === 1 ? 'item' : 'items'}.`, '', `Open it in Insight-IQ: ${appUrl()}/inventory/${countId}`, '', 'ADIA Training Centre'].join('\n'),
      attachments: [{ filename: fileName, content: bytes, contentType: 'application/pdf' }],
    }, countId);
  } catch (err) {
    logger.warn(`Inventory email for ${countId} failed`, err);
    const e = err as { code?: string; responseCode?: number; message?: string };
    throw new HttpsError('unavailable', e?.code === 'EAUTH' || e?.responseCode === 535 ? 'Gmail refused the app password for ADIA\'s address.' : `The email could not be sent. Gmail said: ${String(e?.message ?? err).slice(0, 160)}`);
  }
  await ref.update({ emailedAt: FieldValue.serverTimestamp() });
  await writeAudit({ actorUid: caller.uid, actorEmail: caller.email, action: 'inventory_email', path: ref.path, collection: 'inventoryCounts', docId: countId, orgId, note: `to ${to.length} ${to.length === 1 ? 'address' : 'addresses'}` });
  return { sent: to.length };
});
