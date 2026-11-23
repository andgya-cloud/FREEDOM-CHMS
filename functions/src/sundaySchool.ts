import { logger } from 'firebase-functions';
import { onSchedule } from 'firebase-functions/v2/scheduler';
import { db } from './common.js';
import { CHURCH_EMAIL_APP_PASSWORD, circleLeadEmails, circleMailer, keepTestMail, appUrl } from './circleKit.js';
import { localDateKey } from './shared/datetime.js';
import { ssSummaryLines, type ClassCounts, type ClassReport } from './shared/sundaySchool.js';
import { loadSsClasses } from './serviceCounters.js';

/**
 * The Sunday school leader's one summary (Andy, 2026-11-23, 8A): at 3 PM each Sunday, Dorothy gets one email with each
 * class's children, lesson, win and need, and the classes that have not sent a report. Only churches with classes.
 */
export async function sendSundaySchoolSummary(today = localDateKey()): Promise<number> {
  const mail = circleMailer('sunday_school');
  if (!mail) { logger.warn('Sunday school summary: email is not set up.'); return 0; }
  const churches = await db.collection('organizations').where('type', '==', 'church_campus').get();
  let sent = 0;
  for (const o of churches.docs) {
    if (o.get('deletedAt') != null) continue;
    const classes = await loadSsClasses(o.id);
    if (!classes.length) continue;
    const reps = (await db.collection(`organizations/${o.id}/ssReports`).where('day', '==', today).get()).docs
      .map((d) => d.data()).filter((r) => r.kind === 'ssreport' && !r.deleted && r.classReport)
      .map((r) => ({ classId: String(r.classReport.classId), report: r.classReport as ClassReport, by: String(r.senderName ?? '') }));
    const counts = (await db.collection(`organizations/${o.id}/serviceCounts`).where('date', '==', today).get()).docs
      .reduce<ClassCounts>((acc, d) => ({ ...acc, ...((d.get('classes') ?? {}) as ClassCounts) }), {});
    if (!reps.length && !Object.keys(counts).length) continue;
    const { to } = await circleLeadEmails('sunday_school', o.id);
    if (!to.length) continue;
    const lines = ssSummaryLines(classes, counts, reps);
    const subject = `Sunday school today: ${lines.at(-1)?.replace('Total children: ', '')} children`;
    const text = ['Dear Dorothy,', '', 'Here is Sunday school today:', '', ...lines, '', `Open the Sunday school room: ${appUrl()}/sunday-school`, '', 'Freedom Church', '', 'Powered by Insight-IQ'].join('\n');
    try {
      const info = await mail.transport.sendMail({ from: `"Freedom Church Sunday School" <${mail.from}>`, to: to.join(', '), subject, text });
      await keepTestMail(mail.test, info, `sundayschool-${o.id}`);
      sent += 1;
    } catch (err) { logger.warn('Sunday school summary failed', err); }
  }
  return sent;
}

export const sundaySchoolSummary = onSchedule(
  { schedule: '0 15 * * 0', timeZone: 'Africa/Nairobi', region: process.env.SCHEDULER_REGION || 'europe-west1', timeoutSeconds: 180, secrets: [CHURCH_EMAIL_APP_PASSWORD] },
  async () => { await sendSundaySchoolSummary(); },
);
