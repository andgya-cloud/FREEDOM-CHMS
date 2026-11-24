import { logger } from 'firebase-functions';
import { HttpsError, onCall } from 'firebase-functions/v2/https';
import { onSchedule } from 'firebase-functions/v2/scheduler';
import { db, FieldValue, requireCaller } from './common.js';
import { CHURCH_EMAIL_APP_PASSWORD, circleLeadEmails, circleMailer, keepTestMail, appUrl } from './circleKit.js';
import { canAccessOrg } from './shared/permissions.js';
import { cleanCount, isOtherServiceName } from './shared/attendance.js';
import { localDateKey } from './shared/datetime.js';
import { circleReader, youthEditor } from './shared/circles.js';
import { addDays, isSunday, ssDayLabel, type SsDay } from './shared/ssTimetable.js';
import { youthMeeting, youthSummaryLines, type YouthCount } from './shared/youth.js';
import { loadChurch, todaysServices, type Church } from './serviceCounters.js';
import { driveFolderOf, loadDay, youthRemindersFor } from './ssTimetable.js';

/**
 * Freedom Church Youth (Andy, 2026-11-24, 1A-9A). Sheila counts each youth meeting on her phone: + and −, Type the
 * number, Reset (5A). Each meeting keeps its own number in youthCounts/{date}; on a Sunday the same number is the
 * service's Youth, so it adds into the Sunday total. The evening before a meeting she gets the reminder to send
 * on WhatsApp by hand (8A), and on Monday a summary of the week (9A).
 */
const countRef = (orgId: string, date: string) => db.doc(`organizations/${orgId}/youthCounts/${date}`);

export async function meetingToday(church: Church, today: string) {
  return youthMeeting(today, await loadDay('youth', church.id, today), isSunday(today));
}

export async function setYouthCount(church: Church, by: string, change: { add: number } | { set: number }): Promise<{ count: number; name: string }> {
  const today = localDateKey(new Date(), church.tz);
  const meeting = await meetingToday(church, today);
  if (!meeting) throw new HttpsError('failed-precondition', 'There is no youth meeting today. Add it to the youth timetable first, or count on Sunday.');
  // On a Sunday the youth's number is also the service's Youth (5A).
  const service = isSunday(today) ? (await todaysServices(church, today))[0] ?? null : null;
  const count = await db.runTransaction(async (tx) => {
    const ref = countRef(church.id, today);
    const evRef = service ? db.doc(`organizations/${church.id}/events/${service.id}`) : null;
    const [c, ev] = await Promise.all([tx.get(ref), evRef ? tx.get(evRef) : Promise.resolve(null)]);
    const now = Number(c.get('count')) || 0;
    const next = 'set' in change ? cleanCount(change.set) : Math.max(0, now + change.add);
    tx.set(ref, { date: today, name: meeting.name, count: next, by, orgId: church.id, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
    if (service && evRef && ev && !(ev.exists && ev.get('deletedAt') != null)) {
      const stamps = { updatedAt: FieldValue.serverTimestamp(), updatedBy: 'youth' };
      if (!ev.exists) {
        tx.set(evRef, {
          orgId: church.id, date: today, type: 'service', name: service.name.slice(0, 120), activity: null, headcounts: { youth: next }, notes: '',
          serviceKind: isOtherServiceName(church.otherServices, service.name) ? 'other' : null,
          deletedAt: null, deletedBy: null, createdAt: FieldValue.serverTimestamp(), createdBy: 'youth', ...stamps,
        });
      } else tx.update(evRef, { 'headcounts.youth': next, ...stamps });
      tx.set(db.doc(`organizations/${church.id}/serviceCounts/${service.id}`), { eventId: service.id, date: today, name: service.name, by: { youth: { person: by, done: false } } }, { merge: true });
    }
    return next;
  });
  return { count, name: meeting.name };
}

export const youth = onCall({ memory: '512MiB', timeoutSeconds: 60, maxInstances: 10 }, async (request) => {
  const data = (request.data ?? {}) as Record<string, unknown>;
  const church = await loadChurch(typeof data.orgId === 'string' ? data.orgId : '');
  const action = String(data.action ?? '');
  const caller = await requireCaller(request, undefined, { reviewerOk: action === 'info' });
  const me = caller.profile;
  if (!canAccessOrg(me, church.id)) throw new HttpsError('permission-denied', 'You do not have access to this church.');
  const edits = youthEditor(me, church.id);
  const reads = edits || circleReader(me, church.id, 'youth');
  if (!reads) throw new HttpsError('permission-denied', 'The youth page is for Sheila, Andy and Doreen.');
  const today = localDateKey(new Date(), church.tz);
  if (action === 'count') {
    if (!edits) throw new HttpsError('permission-denied', 'Only Sheila, Andy and Doreen count the youth.');
    const add = Math.floor(Number(data.add));
    const change = data.set !== undefined ? { set: cleanCount(data.set) } : add >= -500 && add <= 500 && add !== 0 ? { add } : null;
    if (!change) throw new HttpsError('invalid-argument', 'Please tap + or − or type the number.');
    await setYouthCount(church, me.displayName || me.email, change);
  } else if (action !== 'info') throw new HttpsError('invalid-argument', 'Unknown action.');
  const [meeting, recent, driveFolder] = await Promise.all([
    meetingToday(church, today),
    db.collection(`organizations/${church.id}/youthCounts`).where('date', '>=', addDays(today, -56)).get(),
    driveFolderOf('youth', church.id),
  ]);
  const counts = recent.docs.map((d) => d.data() as YouthCount).sort((a, b) => b.date.localeCompare(a.date));
  return { today, edits, driveFolder, meeting, count: counts.find((c) => c.date === today)?.count ?? 0, recent: counts.slice(0, 8) };
});

const churchesWithYouth = async () => (await db.collection('organizations').where('type', '==', 'church_campus').get()).docs.filter((o) => o.get('deletedAt') == null);

/** 6 PM: a youth meeting tomorrow? Sheila gets the message to send to the youth group (8A). */
export async function sendYouthReminders(today = localDateKey()): Promise<number> {
  const mail = circleMailer('youth');
  if (!mail) { logger.warn('Youth reminders: email is not set up.'); return 0; }
  const tomorrow = addDays(today, 1);
  let sent = 0;
  for (const o of await churchesWithYouth()) {
    const r = await youthRemindersFor(o.id, today, tomorrow);
    if (!r.group) continue;
    const { to } = await circleLeadEmails('youth', o.id);
    if (!to.length) continue;
    const text = [
      'Dear Sheila,', '',
      `The youth meet tomorrow, ${ssDayLabel(r.date)}. Here is the reminder to send on WhatsApp:`, '',
      '----------', r.group, '----------', '',
      `Or open the youth page and press the green WhatsApp button: ${appUrl()}/youth#reminders`, '',
      'Freedom Church', '', 'Powered by Insight-IQ',
    ].join('\n');
    try {
      const info = await mail.transport.sendMail({ from: `"Freedom Church Youth" <${mail.from}>`, to: to.join(', '), subject: `Youth meeting tomorrow: reminder ready to send`, text });
      await keepTestMail(mail.test, info, `youthreminder-${o.id}`);
      sent += 1;
    } catch (err) { logger.warn('Youth reminder failed', err); }
  }
  return sent;
}

/** Monday morning: last week's youth meetings, the reports and the wins (9A). */
export async function sendYouthSummary(today = localDateKey()): Promise<number> {
  const mail = circleMailer('youth');
  if (!mail) { logger.warn('Youth summary: email is not set up.'); return 0; }
  const from = addDays(today, -7);
  let sent = 0;
  for (const o of await churchesWithYouth()) {
    const [c, r] = await Promise.all([
      db.collection(`organizations/${o.id}/youthCounts`).where('date', '>=', from).get(),
      db.collection(`organizations/${o.id}/youthReports`).where('day', '>=', from).get(),
    ]);
    const counts = c.docs.map((d) => d.data() as YouthCount).filter((x) => x.date < today);
    const posts = r.docs.map((d) => d.data()).filter((x) => !x.deleted && String(x.day) < today);
    if (!counts.length && !posts.length) continue;
    const reports = posts.filter((x) => x.kind === 'ssreport' && x.classReport).map((x) => ({ day: String(x.day), ...(x.classReport as { present: number; lesson: string; win: string; need: string }), by: String(x.senderName ?? '') }));
    const lines = youthSummaryLines(counts, reports, posts.filter((x) => x.kind === 'win').length);
    const { to } = await circleLeadEmails('youth', o.id);
    if (!to.length) continue;
    const text = ['Dear Sheila,', '', `Here is the youth's week, ${ssDayLabel(from, false)} to ${ssDayLabel(addDays(today, -1), false)}:`, '', ...lines, '', `Open the youth page: ${appUrl()}/youth`, '', 'Freedom Church', '', 'Powered by Insight-IQ'].join('\n');
    try {
      const info = await mail.transport.sendMail({ from: `"Freedom Church Youth" <${mail.from}>`, to: to.join(', '), subject: `Youth this week: ${counts.reduce((s, x) => s + x.count, 0)} at meetings`, text });
      await keepTestMail(mail.test, info, `youthsummary-${o.id}`);
      sent += 1;
    } catch (err) { logger.warn('Youth summary failed', err); }
  }
  return sent;
}

const at = (schedule: string) => ({ schedule, timeZone: 'Africa/Nairobi', region: process.env.SCHEDULER_REGION || 'europe-west1', timeoutSeconds: 180, secrets: [CHURCH_EMAIL_APP_PASSWORD] });
export const youthReminders = onSchedule(at('0 18 * * *'), async () => { await sendYouthReminders(); });
export const youthSummary = onSchedule(at('0 7 * * 1'), async () => { await sendYouthSummary(); });

export type { SsDay };
