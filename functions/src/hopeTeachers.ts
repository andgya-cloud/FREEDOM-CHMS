import { logger } from 'firebase-functions';
import { onSchedule } from 'firebase-functions/v2/scheduler';
import { db } from './common.js';
import { canAccessOrg, TEACHER_ROLE_ID } from './shared/permissions.js';
import { localDateKey } from './shared/datetime.js';
import { saturdayOnOrBefore } from './shared/hopeRegister.js';
import { classNamesOf, classProgress } from './shared/hopeClasses.js';
import { isCurrentChild } from './shared/hope.js';
import { poweredByHtml } from './shared/poweredBy.js';
import { emailTo, loadPeople, pushTo, REMINDER_SECRETS, type OrgInfo, type Recipient, type ReminderMessage } from './calendar.js';

const appUrl = () => process.env.APP_URL || 'https://freedom-chms.web.app';
const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** The reminder for one teacher: their class, and how many children are still not marked. */
export function teacherReminder(org: OrgInfo, first: string, classes: string, left: number, total: number): ReminderMessage {
  const link = `${appUrl()}/hope/register?d=today`;
  const line = `${left} of ${total} ${total === 1 ? 'child is' : 'children are'} not marked yet.`;
  const html = `<!doctype html><html><body style="margin:0;background:#f4f5f9;font-family:Arial,Helvetica,sans-serif">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f5f9;padding:24px 0"><tr><td align="center">
<table role="presentation" width="560" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border-radius:14px;overflow:hidden">
<tr><td style="background:#03733a;height:6px"></td></tr>
<tr><td style="padding:24px 28px 8px;color:#6b7280;font-size:13px">${esc(org.name)} · Class register</td></tr>
<tr><td style="padding:0 28px;color:#0b112c;font-size:20px;font-weight:bold">Hello ${esc(first)}, please mark the ${esc(classes)} register</td></tr>
<tr><td style="padding:10px 28px 16px;color:#374151;font-size:15px">${esc(line)} Your marks go straight into the main register.</td></tr>
<tr><td style="padding:0 28px 22px"><a href="${link}" style="background:#03733a;color:#ffffff;text-decoration:none;padding:10px 18px;border-radius:8px;font-size:14px;display:inline-block">Mark the register</a></td></tr>
<tr><td style="padding:14px 28px 22px;color:#6b7280;font-size:12px;border-top:1px solid #f1f1f1">This reminder was sent from Insight-IQ.${poweredByHtml()}</td></tr>
</table></td></tr></table></body></html>`;
  return {
    title: `✅ ${classes} register`, body: line, link, tag: `teacher-register-${localDateKey(new Date(), org.timeZone)}`,
    subject: `Please mark the ${classes} register`, html,
    text: `Hello ${first},\n\nPlease mark the ${classes} register. ${line}\n\nMark the register: ${link}\n\nPowered by Insight-IQ`,
  };
}

/**
 * At 10 AM on a Saturday (Andy, 2026-11-22, 9A): every class teacher whose class is not fully marked gets a pop-up
 * on their phone and an email from the Hope Gmail. Counts only; no child is named.
 */
export async function remindTeachers(now = new Date()): Promise<number> {
  const orgs = await db.collection('organizations').where('type', '==', 'ministry').get();
  let people: Awaited<ReturnType<typeof loadPeople>> | null = null;
  let sent = 0;
  for (const o of orgs.docs) {
    if (o.get('deletedAt') != null || o.get('active') === false) continue;
    const org: OrgInfo = { id: o.id, name: String(o.get('name') ?? 'Freedom Hope Center'), type: 'ministry', timeZone: String(o.get('timeZone') || 'Africa/Nairobi') };
    const today = localDateKey(now, org.timeZone);
    if (saturdayOnOrBefore(today) !== today) continue;
    people ??= await loadPeople();
    const teachers = [...people.users.entries()].filter(([, u]) => u.roleId === TEACHER_ROLE_ID && canAccessOrg(u, org.id) && ((u as { hopeClassIds?: string[] }).hopeClassIds ?? []).length > 0);
    if (!teachers.length) continue;
    const [kids, day] = await Promise.all([
      db.collection(`organizations/${org.id}/children`).get(),
      db.doc(`organizations/${org.id}/hopeDays/${today}`).get(),
    ]);
    const children = kids.docs.map((d) => ({ id: d.id, ...(d.data() as { status?: string; deletedAt?: unknown; dateOfBirth?: string | null; enrolledOn?: string | null }) }))
      .filter((c) => !c.deletedAt && isCurrentChild(c as Parameters<typeof isCurrentChild>[0]) && (!c.enrolledOn || c.enrolledOn <= today));
    const marks = (day.data()?.marks ?? {}) as Record<string, { s?: string }>;
    const progress = classProgress(children, marks, today);
    for (const [uid, u] of teachers) {
      const mine = (u as { hopeClassIds?: string[] }).hopeClassIds ?? [];
      const rows = progress.filter((p) => mine.includes(p.id));
      const total = rows.reduce((n, p) => n + p.total, 0);
      const left = total - rows.reduce((n, p) => n + p.marked, 0);
      if (!total || left <= 0) continue;
      const name = u.displayName || u.email || 'Teacher';
      const r: Recipient = { uid, name, email: u.email ?? '', emailOn: !people.emailOff.has(uid), tokens: people.tokens.get(uid) ?? [] };
      const m = teacherReminder(org, name.split(/\s+/)[0] ?? name, classNamesOf(mine), left, total);
      const [devices, emails] = await Promise.all([pushTo([r], m).catch((err) => { logger.warn('Teacher push failed', err); return 0; }), emailTo(org, [r], m)]);
      if (devices || emails) sent += 1;
    }
  }
  return sent;
}

export const teacherRegisterReminder = onSchedule(
  // Cloud Scheduler isn't offered in africa-south1, so this job runs from Europe.
  { schedule: 'every saturday 10:00', timeZone: 'Africa/Nairobi', region: process.env.SCHEDULER_REGION || 'europe-west1', timeoutSeconds: 240, secrets: REMINDER_SECRETS },
  async () => { await remindTeachers(); },
);
