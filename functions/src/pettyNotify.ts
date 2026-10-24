import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { logger } from 'firebase-functions';
import { defineSecret } from 'firebase-functions/params';
import { onDocumentCreated, onDocumentWritten } from 'firebase-functions/v2/firestore';
import { onSchedule } from 'firebase-functions/v2/scheduler';
import { HttpsError, onCall } from 'firebase-functions/v2/https';
import { jsPDF } from 'jspdf';
import nodemailer from 'nodemailer';
import { db, FieldValue, requireCaller, requireString, writeAudit, type UserProfile } from './common.js';
import { canSign, requireMember } from './pettyPins.js';
import { contactsFor, personKey as plainName, withContacts } from './pettyContacts.js';
import { isSendingHour, sendingReady, withWhatsAppDefaults, type WhatsAppSettings } from './shared/whatsapp.js';
import { PETTY_CASH_STATUS_LABELS, pettyCashBase, type PettyCashSignature } from './shared/pettyCash.js';
import { drawRequisition, letterheadFor, type Letterhead } from './shared/pettyVoucher.js';
import {
  noticeHtml, noticeSubject, noticeText, PETTY_WA_TEMPLATES, REMIND_AFTER_HOURS, waParams,
  type NoticeInput, type NoticeRequest, type PettyNoticeKind,
} from './shared/pettyNotices.js';

/**
 * Petty cash notices (Andy, 2026-10-23). When a request is submitted, every stakeholder who can sign
 * (but not the requester) is asked by email and WhatsApp to approve it; after 24 hours those who have
 * not signed are reminded; once two have approved, every stakeholder and the requester get the signed
 * voucher as a PDF. Emails go from the organization's own Gmail (ADIA's), using an app password kept as
 * the secret PETTY_EMAIL_APP_PASSWORD. WhatsApp messages are queued in pettyWhatsapp and sent by
 * sendPettyWhatsapp, which is deployed once the WhatsApp Business number is set up.
 *
 * Later the same day Andy asked for no automatic messages: the requester presses "Send Email" (below,
 * sendPettyEmail) or "Send WhatsApp" (from their own phone, in the app). AUTO_NOTICES keeps the
 * automatic notices and reminders switched off; they stay here in case he wants them back.
 */
const AUTO_NOTICES = false;
const PETTY_EMAIL_APP_PASSWORD = defineSecret('PETTY_EMAIL_APP_PASSWORD');
const WHATSAPP_TOKEN = defineSecret('WHATSAPP_TOKEN');
const appUrl = () => process.env.APP_URL || 'https://freedom-chms.web.app';
const apiBase = () => process.env.WHATSAPP_API_BASE || 'https://graph.facebook.com/v21.0';

interface Person { uid: string; name: string; email: string; phone: string }
interface OrgInfo { id: string; name: string; type: string; currency: string; timeZone: string; lh: Letterhead }

async function orgInfo(orgId: string): Promise<OrgInfo> {
  const o = (await db.doc(`organizations/${orgId}`).get()).data() ?? {};
  const base = { name: (o.name as string) ?? '', type: (o.type as string) ?? '' };
  return { id: orgId, ...base, currency: (o.currency as string) || 'KES', timeZone: (o.timeZone as string) || 'Africa/Nairobi', lh: letterheadFor(base) };
}

/** Every active stakeholder who can sign petty cash here, reached at their built-in contacts where known. */
async function stakeholders(org: OrgInfo): Promise<Person[]> {
  const users = await db.collection('users').where('active', '==', true).get();
  return withContacts(org.type, users.docs
    .filter((d) => canSign(d.data() as UserProfile, org.id, 'request'))
    .map((d) => { const u = d.data() as UserProfile; return { uid: d.id, name: u.displayName || u.email, email: u.email, phone: u.phone ?? '' }; }));
}

async function person(org: OrgInfo, uid: string): Promise<Person | null> {
  const u = (await db.doc(`users/${uid}`).get()).data() as UserProfile | undefined;
  if (!u?.active) return null;
  const name = u.displayName || u.email;
  const c = contactsFor(org.type).find((x) => plainName(x.name) === plainName(name));
  return { uid, name, email: c?.email || u.email, phone: c?.phone || u.phone || '' };
}

/** Whether this person is the requester or has already signed (matched by account or by name). */
function asksAlreadyAnswered(p: Person, r: FirebaseFirestore.DocumentData) {
  if (p.uid === r.requesterId || plainName(p.name) === plainName(String(r.requesterName ?? ''))) return true;
  const sigs = (r.signatures ?? {}) as Record<string, PettyCashSignature>;
  return p.uid in sigs || Object.values(sigs).some((s) => plainName(s.name ?? '') === plainName(p.name));
}

/** Leaves out the requester when they are already among the stakeholders. */
function requesterIn(all: Person[], r: FirebaseFirestore.DocumentData) {
  return all.some((p) => p.uid === r.requesterId || plainName(p.name) === plainName(String(r.requesterName ?? '')));
}

const sortedSigs = (sigs: Record<string, PettyCashSignature> | undefined) => Object.entries(sigs ?? {})
  .sort(([, a], [, b]) => ((a.at as FirebaseFirestore.Timestamp)?.toMillis?.() ?? 0) - ((b.at as FirebaseFirestore.Timestamp)?.toMillis?.() ?? 0));

function whenIn(org: OrgInfo, t: unknown) {
  const d = (t as FirebaseFirestore.Timestamp)?.toDate?.() ?? new Date();
  return d.toLocaleString('en-KE', { dateStyle: 'medium', timeStyle: 'short', timeZone: org.timeZone });
}

let crest: Promise<string | null> | null = null;
function crestImage() {
  crest ??= readFile(new URL('../assets/adia-crest.png', import.meta.url))
    .then((b) => `data:image/png;base64,${b.toString('base64')}`)
    .catch(() => null);
  return crest;
}

/** The signed voucher PDF for an approved request. */
export async function voucherPdf(org: OrgInfo, r: FirebaseFirestore.DocumentData): Promise<{ name: string; data: Buffer }> {
  const pdf = new jsPDF({ unit: 'mm', format: 'a4' });
  const sigs = sortedSigs(r.signatures);
  const signOffs = sigs.map(([, s]) => ({ role: s.role, name: s.name, when: whenIn(org, s.at) }));
  drawRequisition(pdf, org.lh, org.lh.crest ? await crestImage() : null, org.currency, {
    number: r.number ?? null, requesterName: r.requesterName, category: r.category, categoryNote: r.categoryNote ?? null, items: r.items ?? [],
    totalCents: r.totalCents, status: r.status, statusLabel: PETTY_CASH_STATUS_LABELS[r.status as keyof typeof PETTY_CASH_STATUS_LABELS] ?? r.status,
    date: whenIn(org, r.createdAt),
  }, signOffs, (await db.collection(`organizations/${org.id}/pettyReceipts`).where('reqId', '==', r.id ?? '').get()).docs.filter((d) => !d.get('deletedAt')).length, whenIn(org, null));
  return { name: `${r.number ?? 'Requisition'}-approved.pdf`, data: Buffer.from(pdf.output('arraybuffer')) };
}

/** Why Gmail refused, in plain words, for the person who pressed Send Email. */
function mailProblem(err: unknown): string {
  const e = err as { code?: string; responseCode?: number; message?: string };
  if (e?.code === 'EAUTH' || e?.responseCode === 535) return 'Gmail refused the app password for the sending address. Make a new app password on that Gmail account and save it again.';
  if (e?.code === 'ETIMEDOUT' || e?.code === 'ECONNECTION' || e?.code === 'ESOCKET') return 'Gmail could not be reached. Please try again.';
  if (e?.responseCode === 550 || e?.responseCode === 553) return 'Gmail refused one of the addresses.';
  if (e?.responseCode === 421 || e?.responseCode === 454) return 'Gmail is limiting how many emails go out. Please try again later.';
  return `Gmail said: ${String(e?.message ?? err).slice(0, 160)}`;
}
/** Emails one notice to each person; returns how many went and, when some failed, why. */
async function emailNotice(org: OrgInfo, kind: PettyNoticeKind, req: NoticeRequest, link: string, signers: string[], people: Person[],
  attachment: { name: string; data: Buffer } | null): Promise<{ sent: number; problem: string; names: string[] }> {
  const from = org.lh.email;
  const pass = process.env.PETTY_MAIL_TEST_DIR ? 'test' : PETTY_EMAIL_APP_PASSWORD.value().replace(/\s+/g, '');
  if (!from || !pass) { logger.info(`Petty cash email skipped for ${org.id}: no sending email or app password yet.`); return { sent: 0, problem: 'No Gmail app password is saved yet.', names: [] }; }
  // In local tests the emails are written to files (PETTY_MAIL_TEST_DIR) instead of being sent.
  const transport = process.env.PETTY_MAIL_TEST_DIR
    ? nodemailer.createTransport({ jsonTransport: true })
    : nodemailer.createTransport({ service: 'gmail', auth: { user: from, pass } });
  let sent = 0;
  let problem = '';
  const names: string[] = [];
  for (const p of people) {
    if (!p.email) continue;
    const n: NoticeInput = { kind, lh: org.lh, currency: org.currency, r: req, link, recipientName: p.name, signers };
    try {
      const info = await transport.sendMail({
        from: `"${org.lh.name} Petty Cash" <${from}>`, to: `"${p.name}" <${p.email}>`, replyTo: from,
        subject: noticeSubject(n), text: noticeText(n), html: noticeHtml(n),
        attachments: attachment ? [{ filename: attachment.name, content: attachment.data, contentType: 'application/pdf' }] : [],
      });
      if (process.env.PETTY_MAIL_TEST_DIR) {
        await mkdir(process.env.PETTY_MAIL_TEST_DIR, { recursive: true });
        await writeFile(join(process.env.PETTY_MAIL_TEST_DIR, `${Date.now()}-${kind}-${p.uid}.json`), String((info as { message?: unknown }).message ?? ''));
      }
      sent += 1;
      names.push(p.name);
    } catch (err) {
      logger.warn(`Petty cash email to ${p.uid} failed`, err);
      problem = mailProblem(err);
      // A refused login fails every send the same way; stop rather than try each person.
      if ((err as { code?: string })?.code === 'EAUTH') break;
    }
  }
  return { sent, problem, names };
}

/** Queues one WhatsApp notice per person with a number, when WhatsApp sending is switched on. */
async function queueWhatsapp(org: OrgInfo, reqId: string, kind: PettyNoticeKind, req: NoticeRequest, link: string, signers: string[], people: Person[]): Promise<number> {
  const settings = withWhatsAppDefaults((await db.doc('settings/whatsapp').get()).data() as Partial<WhatsAppSettings> | undefined);
  if (!sendingReady(settings)) return 0;
  const batch = db.batch();
  let queued = 0;
  for (const p of people) {
    if (!p.phone) continue;
    const params = waParams({ kind, lh: org.lh, currency: org.currency, r: req, link, recipientName: p.name, signers });
    batch.set(db.collection(`organizations/${org.id}/pettyWhatsapp`).doc(), {
      orgId: org.id, reqId, kind, toUid: p.uid, toName: p.name, phone: p.phone, params, status: 'queued',
      wamid: null, error: null, createdAt: FieldValue.serverTimestamp(),
    });
    queued += 1;
  }
  if (queued) await batch.commit();
  return queued;
}

function noticeRequest(r: FirebaseFirestore.DocumentData): NoticeRequest {
  return { number: r.number, requesterName: r.requesterName, category: r.category, categoryNote: r.categoryNote ?? null, totalCents: r.totalCents, items: r.items ?? [] };
}

/** Marks a notice as being sent, once; false when another run already took it. */
async function claim(ref: FirebaseFirestore.DocumentReference, field: string, ready: (d: FirebaseFirestore.DocumentData) => boolean) {
  return db.runTransaction(async (tx) => {
    const d = (await tx.get(ref)).data();
    if (!d || !ready(d) || d.notice?.[field]) return false;
    tx.update(ref, { [`notice.${field}`]: FieldValue.serverTimestamp() });
    return true;
  });
}

export const onPettyCashNotify = onDocumentWritten(
  { document: 'organizations/{orgId}/pettyCash/{reqId}', secrets: [PETTY_EMAIL_APP_PASSWORD] },
  async (event) => {
    if (!AUTO_NOTICES) return;
    const { orgId, reqId } = event.params;
    const after = event.data?.after.data();
    if (!after || after.deletedAt || !after.signatures || !after.number) return;
    const ref = db.doc(`organizations/${orgId}/pettyCash/${reqId}`);
    const org = await orgInfo(orgId);
    const link = `${appUrl()}${pettyCashBase(org.type)}/${reqId}`;
    const req = noticeRequest(after);

    if (after.status === 'submitted' && !after.notice?.askedAt) {
      if (!(await claim(ref, 'askedAt', (d) => d.status === 'submitted'))) return;
      const people = (await stakeholders(org)).filter((p) => !asksAlreadyAnswered(p, after));
      const emailed = (await emailNotice(org, 'ask', req, link, [], people, null)).sent;
      const whatsapp = await queueWhatsapp(org, reqId, 'ask', req, link, [], people);
      await ref.update({ 'notice.askEmailed': emailed, 'notice.askWhatsapp': whatsapp });
      return;
    }

    if (after.status === 'approved' && !after.notice?.approvedAt) {
      if (!(await claim(ref, 'approvedAt', (d) => d.status === 'approved'))) return;
      const all = await stakeholders(org);
      const requester = requesterIn(all, after) ? null : await person(org, after.requesterId);
      const people = requester ? [...all, requester] : all;
      const signers = sortedSigs(after.signatures).map(([, s]) => `${s.name} (${s.role})`);
      const pdf = await voucherPdf(org, { ...after, id: reqId });
      const emailed = (await emailNotice(org, 'approved', req, link, signers, people, pdf)).sent;
      const whatsapp = await queueWhatsapp(org, reqId, 'approved', req, link, sortedSigs(after.signatures).map(([, s]) => s.name), people);
      await ref.update({ 'notice.approvedEmailed': emailed, 'notice.approvedWhatsapp': whatsapp });
    }
  },
);

/** Reminds the stakeholders who have not signed a request that has waited more than 24 hours (once a day, 08:00 to 20:00). */
export async function remindPettyCash(now = new Date()): Promise<number> {
  let reminded = 0;
  const cutoff = now.getTime() - REMIND_AFTER_HOURS * 3600_000;
  const orgs = await db.collection('organizations').get();
  for (const o of orgs.docs) {
    const waiting = await db.collection(`organizations/${o.id}/pettyCash`).where('status', '==', 'submitted').get();
    if (waiting.empty) continue;
    const org = await orgInfo(o.id);
    if (!isSendingHour(now, org.timeZone)) continue;
    let people: Person[] | null = null;
    for (const d of waiting.docs) {
      const r = d.data();
      const last = (r.notice?.remindedAt ?? r.notice?.askedAt)?.toMillis?.() as number | undefined;
      if (r.deletedAt || !r.signatures || !r.number || !last || last > cutoff) continue;
      await d.ref.update({ 'notice.remindedAt': FieldValue.serverTimestamp() });
      people ??= await stakeholders(org);
      const signed = sortedSigs(r.signatures);
      const due = people.filter((p) => !asksAlreadyAnswered(p, r));
      const link = `${appUrl()}${pettyCashBase(org.type)}/${d.id}`;
      const req = noticeRequest(r);
      const names = signed.map(([, s]) => `${s.name} (${s.role})`);
      await emailNotice(org, 'reminder', req, link, names, due, null);
      await queueWhatsapp(org, d.id, 'reminder', req, link, names, due);
      reminded += 1;
    }
  }
  return reminded;
}

export const pettyCashReminders = onSchedule(
  // Cloud Scheduler isn't offered in africa-south1, so this job runs from Europe.
  { schedule: 'every 60 minutes', timeZone: 'Africa/Nairobi', region: process.env.SCHEDULER_REGION || 'europe-west1', timeoutSeconds: 300, secrets: [PETTY_EMAIL_APP_PASSWORD] },
  async () => { if (AUTO_NOTICES) await remindPettyCash(); },
);

const RESEND_AFTER_MS = 2 * 60_000;

/**
 * "Send Email" on a requisition: while it waits, asks every stakeholder who has not signed (never the
 * requester) to approve it; once approved, sends the signed voucher PDF to every stakeholder and the requester.
 */
export const sendPettyEmail = onCall({ invoker: 'public', secrets: [PETTY_EMAIL_APP_PASSWORD] }, async (request) => {
  const caller = await requireCaller(request);
  const data = (request.data ?? {}) as Record<string, unknown>;
  const orgId = requireString(data.orgId, 'the organization', { max: 80 });
  const reqId = requireString(data.reqId, 'the requisition', { max: 80 });
  requireMember(caller.profile, orgId);
  const ref = db.doc(`organizations/${orgId}/pettyCash/${reqId}`);
  const r = (await ref.get()).data();
  if (!r || r.deletedAt) throw new HttpsError('not-found', 'This requisition is no longer there.');
  if (r.requesterId !== caller.uid && r.raisedBy !== caller.uid && !canSign(caller.profile, orgId, 'request')) {
    throw new HttpsError('permission-denied', 'Only the requester or a stakeholder can send this.');
  }
  const kind: PettyNoticeKind | null = r.status === 'submitted' ? 'ask' : r.status === 'approved' ? 'approved' : null;
  if (!kind || !r.signatures || !r.number) throw new HttpsError('failed-precondition', 'There is nothing to send for this requisition now.');
  const last = (r.notice?.[`${kind}EmailAt`] as FirebaseFirestore.Timestamp | undefined)?.toMillis?.() ?? 0;
  if (Date.now() - last < RESEND_AFTER_MS) throw new HttpsError('already-exists', 'This was emailed a moment ago. Please wait a couple of minutes before sending again.');

  const org = await orgInfo(orgId);
  if (!org.lh.email) throw new HttpsError('failed-precondition', 'Email is not set up for this organization yet.');
  const link = `${appUrl()}${pettyCashBase(org.type)}/${reqId}`;
  const req = noticeRequest(r);
  const all = await stakeholders(org);
  let people: Person[];
  let signers: string[] = [];
  let pdf: { name: string; data: Buffer } | null = null;
  if (kind === 'ask') {
    people = all.filter((p) => !asksAlreadyAnswered(p, r));
  } else {
    const requester = requesterIn(all, r) ? null : await person(org, r.requesterId);
    people = requester ? [...all, requester] : all;
    signers = sortedSigs(r.signatures).map(([, s]) => `${s.name} (${s.role})`);
    pdf = await voucherPdf(org, { ...r, id: reqId });
  }
  const { sent, problem, names } = await emailNotice(org, kind, req, link, signers, people, pdf);
  if (!sent) throw new HttpsError('unavailable', `The emails could not be sent. ${problem || (people.length ? 'Please try again.' : 'Nobody has an email address to send to.')}`);
  await ref.update({ [`notice.${kind}EmailAt`]: FieldValue.serverTimestamp(), [`notice.${kind}Emailed`]: sent, [`notice.${kind}EmailBy`]: caller.profile.displayName || caller.profile.email });
  await writeAudit({ actorUid: caller.uid, actorEmail: caller.email, action: `petty_email_${kind}`, path: ref.path, collection: 'pettyCash', docId: reqId, orgId, note: `${sent} sent` });
  return { sent, of: people.length, names };
});

/** Names and WhatsApp numbers of this organization's stakeholders, for "Send WhatsApp" (Andy, 2026-10-24). */
export const listPettyContacts = onCall({ invoker: 'public' }, async (request) => {
  const caller = await requireCaller(request);
  const orgId = requireString((request.data as Record<string, unknown> | null)?.orgId, 'the organization', { max: 80 });
  requireMember(caller.profile, orgId);
  const people = await stakeholders(await orgInfo(orgId));
  return { contacts: people.filter((p) => p.phone).map((p) => ({ name: p.name, phone: p.phone })).sort((a, b) => a.name.localeCompare(b.name)) };
});

/** Uploads the voucher to WhatsApp so the approved message can carry it; returns the media id. */
async function uploadPdf(phoneNumberId: string, token: string, pdf: { name: string; data: Buffer }): Promise<string> {
  const form = new FormData();
  form.append('messaging_product', 'whatsapp');
  form.append('type', 'application/pdf');
  form.append('file', new Blob([new Uint8Array(pdf.data)], { type: 'application/pdf' }), pdf.name);
  const res = await fetch(`${apiBase()}/${phoneNumberId}/media`, { method: 'POST', headers: { Authorization: `Bearer ${token}` }, body: form });
  const body = (await res.json().catch(() => ({}))) as { id?: string };
  if (!res.ok || !body.id) throw new Error(`WhatsApp media upload refused (${res.status})`);
  return body.id;
}

/** Sends one queued petty cash WhatsApp notice through the Cloud API. */
export const sendPettyWhatsapp = onDocumentCreated(
  { document: 'organizations/{orgId}/pettyWhatsapp/{id}', secrets: [WHATSAPP_TOKEN] },
  async (event) => {
    const d = event.data?.data();
    if (!d || d.status !== 'queued') return;
    const ref = event.data!.ref;
    const settings = withWhatsAppDefaults((await db.doc('settings/whatsapp').get()).data() as Partial<WhatsAppSettings> | undefined);
    const t = PETTY_WA_TEMPLATES.find((x) => x.kind === d.kind);
    if (!t || !sendingReady(settings)) { await ref.update({ status: 'failed', error: 'WhatsApp sending is switched off in Settings.' }); return; }
    const token = WHATSAPP_TOKEN.value();
    try {
      const components: object[] = [];
      if (t.header === 'DOCUMENT') {
        const r = (await db.doc(`organizations/${d.orgId}/pettyCash/${d.reqId}`).get()).data();
        if (!r) throw new Error('The request is no longer there.');
        const pdf = await voucherPdf(await orgInfo(d.orgId), { ...r, id: d.reqId });
        const id = await uploadPdf(settings.phoneNumberId, token, pdf);
        components.push({ type: 'header', parameters: [{ type: 'document', document: { id, filename: pdf.name } }] });
      }
      components.push({ type: 'body', parameters: (d.params as string[]).map((text) => ({ type: 'text', text })) });
      const res = await fetch(`${apiBase()}/${settings.phoneNumberId}/messages`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messaging_product: 'whatsapp', to: String(d.phone).replace(/\D/g, ''), type: 'template',
          template: { name: settings.metaNames[`petty_${d.kind}`]?.trim() || t.metaName, language: { code: settings.language }, components },
        }),
      });
      const body = (await res.json().catch(() => ({}))) as { messages?: { id: string }[]; error?: { message?: string } };
      if (!res.ok || !body.messages?.[0]?.id) throw new Error(body.error?.message ?? `WhatsApp refused the message (${res.status})`);
      await ref.update({ status: 'sent', wamid: body.messages[0].id, sentAt: FieldValue.serverTimestamp() });
    } catch (err) {
      logger.warn('Petty cash WhatsApp failed', err);
      await ref.update({ status: 'failed', error: String((err as Error).message ?? err).slice(0, 300) });
    }
  },
);
