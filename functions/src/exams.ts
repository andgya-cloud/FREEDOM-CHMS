import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { logger } from 'firebase-functions';
import { defineSecret } from 'firebase-functions/params';
import { HttpsError, onCall } from 'firebase-functions/v2/https';
import nodemailer from 'nodemailer';
import { db, FieldValue, requireCaller, requireString, writeAudit, type UserProfile } from './common.js';
import { canAccessOrg, PRINCIPAL_ROLE_ID } from './shared/permissions.js';
import { EXAM_COMPONENTS, type ExamComponent } from './shared/exams.js';
import { examNoticeHtml, examNoticeSubject, examNoticeText, type ExamNotice, type ExamNoticeKind } from './shared/examNotices.js';
import { letterheadFor } from './shared/pettyVoucher.js';

// ADIA's Gmail and its app password, the same ones petty cash emails go from.
const PETTY_EMAIL_APP_PASSWORD = defineSecret('PETTY_EMAIL_APP_PASSWORD');
const appUrl = () => process.env.APP_URL || 'https://freedom-chms.web.app';

const CALLABLE = { invoker: 'public' } as const;
const perms = (u: UserProfile | undefined) => u?.permissions ?? [];

/**
 * The trainers the principal can give a course to (Andy, 2026-10-24): active accounts in this
 * organization that may key in marks. Only the principal (or the pastor) can ask.
 */
export const listExamTrainers = onCall(CALLABLE, async (request) => {
  const caller = await requireCaller(request);
  const orgId = requireString((request.data as Record<string, unknown> | null)?.orgId, 'the organization', { max: 80 });
  const mine = perms(caller.profile);
  if (!canAccessOrg(caller.profile, orgId) || !(mine.includes('exams.manage') || mine.includes('users.manage'))) {
    throw new HttpsError('permission-denied', 'Only the principal sets up courses.');
  }
  const users = await db.collection('users').where('active', '==', true).get();
  const trainers = users.docs
    .filter((d) => { const u = d.data() as UserProfile; const p = perms(u); return canAccessOrg(u, orgId) && (p.includes('exams.mark') || p.includes('exams.manage') || p.includes('users.manage')); })
    .map((d) => { const u = d.data() as UserProfile; return { uid: d.id, name: u.displayName || u.email, phone: u.phone ?? '' }; })
    .sort((a, b) => a.name.localeCompare(b.name));
  return { trainers };
});

interface Principal { uid: string; name: string; email: string; phone: string }

/** The principal accounts of this organization: the Principal role, or else anyone who runs Exam Records but is not the pastor. */
async function principalsOf(orgId: string): Promise<Principal[]> {
  const users = (await db.collection('users').where('active', '==', true).get()).docs
    .map((d) => ({ uid: d.id, u: d.data() as UserProfile }))
    .filter(({ u }) => canAccessOrg(u, orgId));
  const role = users.filter(({ u }) => u.roleId === PRINCIPAL_ROLE_ID);
  const picked = role.length ? role : users.filter(({ u }) => perms(u).includes('exams.manage') && !perms(u).includes('users.manage'));
  return picked.map(({ uid, u }) => ({ uid, name: u.displayName || u.email, email: u.email, phone: u.phone ?? '' }));
}

/**
 * A trainer tells the principal about a marks sheet (Andy, 2026-10-25): "email" sends it from ADIA's
 * Gmail now; "contacts" gives the principal's name and WhatsApp number so the trainer's own WhatsApp
 * opens with the message. Only the sheet's trainer (or the principal) can ask.
 */
export const examNotify = onCall({ ...CALLABLE, secrets: [PETTY_EMAIL_APP_PASSWORD] }, async (request) => {
  const caller = await requireCaller(request);
  const data = (request.data ?? {}) as Record<string, unknown>;
  const orgId = requireString(data.orgId, 'the organization', { max: 80 });
  const sheetId = requireString(data.sheetId, 'the class', { max: 80 });
  const kind = data.kind === 'change' ? 'change' : data.kind === 'sent' ? 'sent' : null;
  const component = EXAM_COMPONENTS.includes(data.component as ExamComponent) ? (data.component as ExamComponent) : null;
  const channel = data.channel === 'email' ? 'email' : 'contacts';
  if (!kind || !component) throw new HttpsError('invalid-argument', 'Say which paper this is about.');
  const ref = db.doc(`organizations/${orgId}/examSheets/${sheetId}`);
  const sheet = (await ref.get()).data();
  if (!sheet || sheet.deletedAt) throw new HttpsError('not-found', 'This class is no longer there.');
  const mine = perms(caller.profile);
  if (!canAccessOrg(caller.profile, orgId) || !(sheet.ownerUid === caller.uid || mine.includes('exams.manage') || mine.includes('users.manage'))) {
    throw new HttpsError('permission-denied', 'Only the trainer of this class can send this.');
  }
  const principals = await principalsOf(orgId);
  if (!principals.length) throw new HttpsError('failed-precondition', 'There is no principal account yet. Ask the pastor to create one.');
  const base: ExamNotice = {
    kind: kind as ExamNoticeKind, component, courseName: String(sheet.courseName ?? ''), cohort: String(sheet.cohort ?? ''),
    teacherName: String(sheet.teacherName || caller.profile.displayName || ''), reason: String(sheet.changeRequest?.reason ?? ''),
    link: `${appUrl()}/school/exams/sheet/${sheetId}`,
  };
  if (channel === 'contacts') return { notice: base, principals: principals.map((p) => ({ name: p.name, phone: p.phone })) };

  const org = (await db.doc(`organizations/${orgId}`).get()).data() ?? {};
  const from = letterheadFor({ type: org.type as string, name: (org.name as string) ?? '' }).email;
  const test = process.env.PETTY_MAIL_TEST_DIR;
  const pass = test ? 'test' : PETTY_EMAIL_APP_PASSWORD.value().replace(/\s+/g, '');
  if (!from || !pass) throw new HttpsError('failed-precondition', 'Email is not set up for ADIA yet.');
  const last = (sheet.notified?.[`${kind}_${component}`] as FirebaseFirestore.Timestamp | undefined)?.toMillis?.() ?? 0;
  if (Date.now() - last < 2 * 60_000) throw new HttpsError('already-exists', 'This was emailed a moment ago. Please wait a couple of minutes before sending again.');
  // In local tests the emails are written to files instead of being sent.
  const transport = test ? nodemailer.createTransport({ jsonTransport: true }) : nodemailer.createTransport({ service: 'gmail', auth: { user: from, pass } });
  const names: string[] = [];
  let problem = '';
  for (const p of principals) {
    if (!p.email) continue;
    const n = { ...base, recipientName: p.name };
    try {
      const info = await transport.sendMail({
        from: `"ADIA Exam Records" <${from}>`, to: `"${p.name}" <${p.email}>`, replyTo: from,
        subject: examNoticeSubject(n), text: examNoticeText(n), html: examNoticeHtml(n),
      });
      if (test) {
        await mkdir(test, { recursive: true });
        await writeFile(join(test, `${Date.now()}-exam-${kind}-${p.uid}.json`), String((info as { message?: unknown }).message ?? ''));
      }
      names.push(p.name);
    } catch (err) {
      logger.warn(`Exam email to ${p.uid} failed`, err);
      const e = err as { code?: string; responseCode?: number; message?: string };
      problem = e?.code === 'EAUTH' || e?.responseCode === 535 ? 'Gmail refused the app password for ADIA\'s address.' : `Gmail said: ${String(e?.message ?? err).slice(0, 160)}`;
    }
  }
  if (!names.length) throw new HttpsError('unavailable', `The email could not be sent. ${problem || 'The principal has no email address.'}`);
  await ref.update({ [`notified.${kind}_${component}`]: FieldValue.serverTimestamp() });
  await writeAudit({ actorUid: caller.uid, actorEmail: caller.email, action: `exam_email_${kind}`, path: ref.path, collection: 'examSheets', docId: sheetId, orgId, note: `${component} to ${names.join(', ')}` });
  return { names };
});
