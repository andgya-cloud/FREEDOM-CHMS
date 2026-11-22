import { logger } from 'firebase-functions';
import { defineSecret } from 'firebase-functions/params';
import { onSchedule } from 'firebase-functions/v2/scheduler';
import { HttpsError, onCall } from 'firebase-functions/v2/https';
import { getMessaging } from 'firebase-admin/messaging';
import nodemailer, { type Transporter } from 'nodemailer';
import { db, FieldValue, requireCaller, requireString, type UserProfile } from './common.js';
import { canAccessOrg, REVIEWER_ROLE_ID } from './shared/permissions.js';
import { localDateKey } from './shared/datetime.js';
import { letterheadFor } from './shared/pettyVoucher.js';
import { poweredByHtml } from './shared/poweredBy.js';
import {
  addDays, dueReminders, EVENT_TYPE_INFO, reminderLead, reminderUids, whenLabel, spanOf, type CalendarEvent, type DueReminder,
} from './shared/calendar.js';

/**
 * Calendar reminders (Andy, 2026-11-14, 4A 5A): every five minutes the server looks for reminders that have come
 * due and sends each person a pop-up on every phone or computer where they turned reminders on, and an email from
 * the place's own Gmail (Church, ADIA or Hope). Each reminder is written in calendarSent first, so it never goes twice.
 */
const PETTY_EMAIL_APP_PASSWORD = defineSecret('PETTY_EMAIL_APP_PASSWORD');
const CHURCH_EMAIL_APP_PASSWORD = defineSecret('CHURCH_EMAIL_APP_PASSWORD');
const HOPE_EMAIL_APP_PASSWORD = defineSecret('HOPE_EMAIL_APP_PASSWORD');
const SECRETS = [PETTY_EMAIL_APP_PASSWORD, CHURCH_EMAIL_APP_PASSWORD, HOPE_EMAIL_APP_PASSWORD];
const passwordFor = (orgType: string) => {
  if (process.env.PETTY_MAIL_TEST_DIR) return 'test';
  try {
    return (orgType === 'church_campus' ? CHURCH_EMAIL_APP_PASSWORD : orgType === 'ministry' ? HOPE_EMAIL_APP_PASSWORD : PETTY_EMAIL_APP_PASSWORD).value().replace(/\s+/g, '');
  } catch { return ''; }
};
const appUrl = () => process.env.APP_URL || 'https://freedom-chms.web.app';
/** A reminder is sent if it came due in the last 20 minutes (the job runs every 5, so a missed run is caught up). */
const WINDOW_MS = 20 * 60_000;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

interface OrgInfo { id: string; name: string; type: string; timeZone: string }
interface Recipient { uid: string; name: string; email: string; emailOn: boolean; tokens: { id: string; token: string }[] }
interface Message { title: string; body: string; link: string; tag: string; subject: string; html: string; text: string }

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function messageFor(org: OrgInfo, e: CalendarEvent, occDate: string, now: Date): Message {
  const lead = reminderLead(e, occDate, now, org.timeZone);
  const occ = { date: occDate, endDate: addDays(occDate, spanOf(e)) };
  const when = whenLabel(e, occ);
  const info = EVENT_TYPE_INFO[e.type] ?? EVENT_TYPE_INFO.other;
  const link = `${appUrl()}/calendar?org=${encodeURIComponent(org.id)}&event=${encodeURIComponent(e.id)}&day=${occDate}`;
  const body = [lead, e.place].filter(Boolean).join(' · ');
  const rows: [string, string][] = [['When', when], ...(e.place ? [['Where', e.place] as [string, string]] : []), ...(e.inCharge ? [['In charge', e.inCharge] as [string, string]] : [])];
  const html = `<!doctype html><html><body style="margin:0;background:#f4f5f9;font-family:Arial,Helvetica,sans-serif">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f5f9;padding:24px 0"><tr><td align="center">
<table role="presentation" width="560" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border-radius:14px;overflow:hidden">
<tr><td style="background:${info.colour};height:6px"></td></tr>
<tr><td style="padding:24px 28px 8px;color:#6b7280;font-size:13px">${esc(org.name)} · Calendar reminder</td></tr>
<tr><td style="padding:0 28px;color:#0b112c;font-size:22px;font-weight:bold">${info.icon} ${esc(e.title)}</td></tr>
<tr><td style="padding:6px 28px 16px;color:${info.colour};font-size:16px;font-weight:bold">${esc(lead)}</td></tr>
<tr><td style="padding:0 28px 8px"><table role="presentation" cellpadding="0" cellspacing="0" style="font-size:14px;color:#111827">
${rows.map(([k, v]) => `<tr><td style="padding:3px 14px 3px 0;color:#6b7280">${k}</td><td style="padding:3px 0">${esc(v)}</td></tr>`).join('')}
</table></td></tr>
${e.notes ? `<tr><td style="padding:8px 28px;color:#374151;font-size:14px;white-space:pre-wrap">${esc(e.notes)}</td></tr>` : ''}
<tr><td style="padding:16px 28px 22px"><a href="${link}" style="background:#0b112c;color:#ffffff;text-decoration:none;padding:10px 18px;border-radius:8px;font-size:14px;display:inline-block">Open the calendar</a></td></tr>
<tr><td style="padding:14px 28px 22px;color:#6b7280;font-size:12px;border-top:1px solid #f1f1f1">This reminder was sent from Insight-IQ.${poweredByHtml()}</td></tr>
</table></td></tr></table></body></html>`;
  const text = `${e.title}\n${lead}\nWhen: ${when}${e.place ? `\nWhere: ${e.place}` : ''}${e.inCharge ? `\nIn charge: ${e.inCharge}` : ''}${e.notes ? `\n\n${e.notes}` : ''}\n\nOpen the calendar: ${link}\n\nPowered by Insight-IQ`;
  return { title: `${info.icon} ${e.title}`, body, link, tag: `${e.id}_${occDate}`, subject: `Reminder: ${e.title} (${lead})`, html, text };
}

/** Everyone's devices and email choice, read once per run. */
async function loadPeople(): Promise<{ users: Map<string, UserProfile>; tokens: Map<string, { id: string; token: string }[]>; emailOff: Set<string> }> {
  const [u, t, p] = await Promise.all([
    db.collection('users').where('active', '==', true).get(),
    db.collection('pushTokens').get(),
    db.collection('calendarPrefs').where('email', '==', false).get(),
  ]);
  const users = new Map(u.docs.map((d) => [d.id, d.data() as UserProfile]));
  const tokens = new Map<string, { id: string; token: string }[]>();
  for (const d of t.docs) {
    const uid = d.get('uid') as string;
    const token = d.get('token') as string;
    if (!uid || !token) continue;
    tokens.set(uid, [...(tokens.get(uid) ?? []), { id: d.id, token }]);
  }
  return { users, tokens, emailOff: new Set(p.docs.map((d) => d.id)) };
}

function recipientsFor(org: OrgInfo, e: CalendarEvent, people: Awaited<ReturnType<typeof loadPeople>>): Recipient[] {
  const uids = new Set(reminderUids(e));
  if (e.remindAll) for (const [uid, u] of people.users) if (canAccessOrg(u, org.id) && u.roleId !== REVIEWER_ROLE_ID) uids.add(uid);
  const out: Recipient[] = [];
  for (const uid of uids) {
    const u = people.users.get(uid);
    if (!u || !canAccessOrg(u, org.id) || e.responses?.[uid] === 'no') continue;
    out.push({ uid, name: u.displayName || u.email, email: u.email ?? '', emailOn: !people.emailOff.has(uid), tokens: people.tokens.get(uid) ?? [] });
  }
  return out;
}

/** Sends the pop-up to every device; forgets devices that no longer accept them. Returns how many devices got it. */
async function push(recipients: Recipient[], m: Message): Promise<number> {
  const all = recipients.flatMap((r) => r.tokens);
  if (!all.length) return 0;
  let sent = 0;
  for (let i = 0; i < all.length; i += 500) {
    const chunk = all.slice(i, i + 500);
    const res = await getMessaging().sendEachForMulticast({
      tokens: chunk.map((c) => c.token),
      data: { title: m.title, body: m.body, link: m.link, tag: m.tag },
      webpush: { headers: { Urgency: 'high', TTL: '3600' } },
    });
    sent += res.successCount;
    const gone = res.responses.map((r, k) => ({ r, c: chunk[k]! }))
      .filter(({ r }) => !r.success && ['messaging/registration-token-not-registered', 'messaging/invalid-registration-token', 'messaging/invalid-argument'].includes(r.error?.code ?? ''));
    await Promise.all(gone.map(({ c }) => db.doc(`pushTokens/${c.id}`).delete().catch(() => undefined)));
  }
  return sent;
}

const transports = new Map<string, Transporter | null>();
function transportFor(org: OrgInfo): { t: Transporter; from: string; name: string } | null {
  const lh = letterheadFor({ type: org.type, name: org.name });
  const pass = passwordFor(org.type);
  if (!lh.email || !pass) return null;
  if (!transports.has(org.type)) {
    transports.set(org.type, process.env.PETTY_MAIL_TEST_DIR
      ? nodemailer.createTransport({ jsonTransport: true })
      : nodemailer.createTransport({ service: 'gmail', auth: { user: lh.email, pass } }));
  }
  const t = transports.get(org.type);
  return t ? { t, from: lh.email, name: lh.name } : null;
}

async function email(org: OrgInfo, recipients: Recipient[], m: Message): Promise<number> {
  const mail = transportFor(org);
  if (!mail) return 0;
  let sent = 0;
  for (const r of recipients) {
    if (!r.emailOn || !EMAIL.test(r.email)) continue;
    try {
      await mail.t.sendMail({ from: `"${mail.name} Calendar" <${mail.from}>`, to: `"${r.name}" <${r.email}>`, subject: m.subject, text: m.text, html: m.html });
      sent += 1;
    } catch (err) {
      logger.warn(`Calendar email to ${r.uid} failed`, err);
      if ((err as { code?: string })?.code === 'EAUTH') break;
    }
  }
  return sent;
}

export async function sendCalendarReminders(now = new Date()): Promise<number> {
  const orgs = await db.collection('organizations').get();
  const due: { org: OrgInfo; e: CalendarEvent; r: DueReminder }[] = [];
  for (const o of orgs.docs) {
    if (o.get('deletedAt') != null || o.get('active') === false) continue;
    const org: OrgInfo = { id: o.id, name: (o.get('name') as string) ?? '', type: (o.get('type') as string) ?? '', timeZone: (o.get('timeZone') as string) || 'Africa/Nairobi' };
    const since = addDays(localDateKey(now, org.timeZone), -2);
    const snap = await db.collection(`organizations/${o.id}/calendar`).where('endsOn', '>=', since).get();
    for (const d of snap.docs) {
      const e = { id: d.id, ...d.data() } as CalendarEvent;
      if (e.deletedAt) continue;
      for (const r of dueReminders(e, now, WINDOW_MS, org.timeZone)) due.push({ org, e, r });
    }
  }
  if (!due.length) return 0;
  const people = await loadPeople();
  let sent = 0;
  for (const { org, e, r } of due) {
    const ref = db.doc(`organizations/${org.id}/calendarSent/${e.id}_${r.date}_${r.offset}`);
    try {
      await ref.create({ eventId: e.id, date: r.date, offset: r.offset, at: FieldValue.serverTimestamp() });
    } catch { continue; } // already sent
    const recipients = recipientsFor(org, e, people);
    const m = messageFor(org, e, r.date, now);
    const [devices, emails] = await Promise.all([push(recipients, m).catch((err) => { logger.warn('Calendar push failed', err); return 0; }), email(org, recipients, m)]);
    await ref.update({ devices, emails, people: recipients.length });
    sent += 1;
  }
  return sent;
}

export const calendarReminders = onSchedule(
  // Cloud Scheduler isn't offered in africa-south1, so this job runs from Europe.
  { schedule: 'every 5 minutes', timeZone: 'Africa/Nairobi', region: process.env.SCHEDULER_REGION || 'europe-west1', timeoutSeconds: 240, secrets: SECRETS },
  async () => { await sendCalendarReminders(); },
);

/** "Send me a test reminder": a pop-up to the caller's devices and an email, right now, so they can see both work. */
export const calendarTest = onCall({ invoker: 'public', secrets: SECRETS }, async (request) => {
  const caller = await requireCaller(request);
  const orgId = requireString((request.data as Record<string, unknown> | undefined)?.orgId, 'the organization', { max: 80 });
  if (!canAccessOrg(caller.profile, orgId)) throw new HttpsError('permission-denied', 'You do not have access to this organization.');
  const o = (await db.doc(`organizations/${orgId}`).get()).data() ?? {};
  const org: OrgInfo = { id: orgId, name: (o.name as string) ?? '', type: (o.type as string) ?? '', timeZone: (o.timeZone as string) || 'Africa/Nairobi' };
  const now = new Date();
  const today = localDateKey(now, org.timeZone);
  const hhmm = new Intl.DateTimeFormat('en-GB', { timeZone: org.timeZone, hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(now.getTime() + 60 * 60_000));
  const sample: CalendarEvent = {
    id: 'test', orgId, title: 'Test reminder', type: 'other', allDay: false, date: today, endDate: today, start: hhmm, end: null,
    place: 'Your calendar', inCharge: '', notes: 'This is how your calendar reminders will look. Nothing else is needed.', repeat: 'none',
    repeatUntil: null, skipDates: [], seriesId: null, seriesDate: null, reminders: [], remindAll: false, invited: [], invitedNames: {},
    responses: {}, endsOn: today, createdBy: caller.uid, createdByName: caller.profile.displayName,
  };
  const people = await loadPeople();
  const recipients = recipientsFor(org, sample, people);
  const m = messageFor(org, sample, today, now);
  const devices = await push(recipients, m).catch((err) => { logger.warn('Calendar test push failed', err); return -1; });
  const emails = await email(org, recipients, m);
  return { devices, emails, deviceCount: recipients[0]?.tokens.length ?? 0, email: recipients[0]?.email ?? '' };
});

// Shared with the class teachers' 10 AM reminder (Andy, 2026-11-22, 9A).
export { loadPeople, push as pushTo, email as emailTo, SECRETS as REMINDER_SECRETS };
export type { OrgInfo, Recipient, Message as ReminderMessage };
