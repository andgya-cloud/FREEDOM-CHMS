import { onDocumentCreated } from 'firebase-functions/v2/firestore';
import { onSchedule } from 'firebase-functions/v2/scheduler';
import { logger } from 'firebase-functions/v2';
import { FieldValue, type DocumentData, type QuerySnapshot } from 'firebase-admin/firestore';
import { jsPDF } from 'jspdf';
import { db } from './common.js';
import { DEFAULT_TIME_ZONE, zonedParts } from './shared/datetime.js';
import {
  addDays,
  lastYearPeriod,
  periodFor,
  type DayRange,
  type MetricsInput,
  type ReportType,
} from './shared/metrics.js';
import { isTraining } from './shared/organizations.js';
import { buildReport, reportFileName, reportPdf, reportsDue, type GivingPart, type PastoralPart, type ReportDoc } from './shared/reports.js';
import { POWERED_BY, poweredByHtml, stampPoweredBy } from './shared/poweredBy.js';

const SYSTEM = 'system';
const DAY = 86_400_000;

export interface ReportSettings {
  regularWeeks?: number;
  /** Monthly giving budget per organization, in cents. */
  budgets?: Record<string, number>;
  /** Email reports (needs the Trigger Email extension). */
  emailEnabled?: boolean;
  /** Staff accounts that get the email. Empty means the pastor. */
  recipientUids?: string[];
}

export function todayIn(timeZone: string, now: Date): string {
  const p = zonedParts(now, timeZone);
  return `${p.year}-${String(p.month).padStart(2, '0')}-${String(p.day).padStart(2, '0')}`;
}

const rows = (snap: QuerySnapshot) => snap.docs.map((d) => ({ id: d.id, ...d.data() }) as DocumentData & { id: string }).filter((d) => d.deletedAt == null);
const ms = (v: unknown): number | null => (v && typeof (v as { toMillis?: unknown }).toMillis === 'function' ? (v as { toMillis(): number }).toMillis() : null);

/** Everything one report needs: from 8 weeks before the same period last year, to the end of the period. */
export async function loadMetricsInput(orgId: string, period: DayRange, type: ReportType, regularWeeks: number, now: Date): Promise<MetricsInput> {
  const base = `organizations/${orgId}`;
  const since = addDays(lastYearPeriod(type, period).from, -63);
  const [events, marks, people, stages, programs, cohorts, enrollments, groups, groupMembers, teamMembers, gifts, followUps] = await Promise.all([
    db.collection(`${base}/events`).where('date', '>=', since).get(),
    db.collection(`${base}/attendance`).where('date', '>=', since).get(),
    db.collection(`${base}/people`).where('deletedAt', '==', null).get(),
    db.collection(`${base}/pipeline`).get(),
    db.collection(`${base}/programs`).get(),
    db.collection(`${base}/cohorts`).get(),
    db.collection(`${base}/enrollments`).get(),
    db.collection(`${base}/groups`).get(),
    db.collection(`${base}/groupMembers`).get(),
    db.collection(`${base}/teamMembers`).get(),
    db.collection(`${base}/gifts`).where('status', '==', 'confirmed').select('personId', 'date', 'amountCents', 'fundId', 'deletedAt').get(),
    db.collection(`${base}/followUps`).get(),
  ]);
  const until = (d: DocumentData) => !d.date || (d.date as string) <= period.to;
  return {
    regularWeeks,
    now: now.getTime(),
    events: rows(events).filter(until).map((e) => ({ id: e.id, date: e.date, type: e.type, headcounts: e.headcounts ?? null, programId: e.programId ?? null, groupId: e.groupId ?? null })),
    marks: rows(marks).filter(until).map((m) => ({ personId: m.personId, eventId: m.eventId, date: m.date, status: m.status, programId: m.programId ?? null, groupId: m.groupId ?? null })),
    people: rows(people).map((p) => ({ id: p.id, fullName: p.fullName ?? '', status: p.status, firstVisitDate: p.firstVisitDate ?? null })),
    stages: rows(stages).map((s) => ({ personId: s.personId, stageId: s.stageId, status: s.status, date: s.date ?? null })),
    programs: rows(programs).map((p) => {
      const topics = (p.topics as unknown[] | undefined) ?? [];
      const rule = p.completionRule as { type: string; count?: number } | undefined;
      return { id: p.id, name: p.name, topicCount: topics.length, topicsNeeded: rule?.type === 'topic_count' ? Math.min(rule.count ?? topics.length, topics.length) : topics.length, active: p.active !== false };
    }),
    cohorts: rows(cohorts).map((c) => ({ id: c.id, programId: c.programId, name: c.name })),
    enrollments: rows(enrollments).map((e) => ({ programId: e.programId, personId: e.personId, cohortId: e.cohortId ?? null, status: e.status, completedDate: e.completedDate ?? null, topicsCovered: Array.isArray(e.topicsCovered) ? e.topicsCovered.length : Number(e.topicsCovered) || 0 })),
    groups: rows(groups).map((g) => ({ id: g.id, name: g.name, meetingDay: g.meetingDay, startDate: g.startDate, active: g.active !== false })),
    groupMembers: rows(groupMembers).map((m) => ({ groupId: m.groupId, personId: m.personId, status: m.status })),
    teamMembers: rows(teamMembers).map((m) => ({ personId: m.personId, status: m.status, startDate: m.startDate, endDate: m.endDate ?? null })),
    gifts: rows(gifts).filter(until).map((g) => ({ personId: g.personId ?? null, date: g.date, amountCents: g.amountCents, fundId: g.fundId ?? null })),
    followUps: rows(followUps).map((f) => ({ personId: f.personId, personName: f.personName ?? '', reason: f.reason, status: f.status, dueAt: ms(f.dueAt), createdAt: ms(f.createdAt), doneAt: ms(f.doneAt), lastMessageAt: ms(f.lastMessageAt) })),
  };
}

export const reportId = (type: ReportType, from: string) => `${type}_${from}`;

/** Makes (or remakes) one report and stores it with its pastoral and giving parts. */
export async function generateReport(
  orgId: string,
  type: ReportType,
  periodStart: string,
  opts: { by?: string; now?: Date; email?: boolean } = {},
): Promise<{ id: string; emailed: number }> {
  const now = opts.now ?? new Date();
  const [org, settingsSnap, funds] = await Promise.all([
    db.doc(`organizations/${orgId}`).get(),
    db.doc('settings/reports').get(),
    db.collection(`organizations/${orgId}/funds`).get(),
  ]);
  if (!org.exists) throw new Error(`No organization ${orgId}`);
  const settings = (settingsSnap.data() ?? {}) as ReportSettings;
  const regularWeeks = Math.min(8, Math.max(1, Math.round(settings.regularWeeks ?? 3)));
  const period = periodFor(type, periodStart);
  const input = await loadMetricsInput(orgId, period, type, regularWeeks, now);
  const parts = buildReport(input, type, period, {
    orgId,
    orgName: (org.get('name') as string | undefined) ?? orgId,
    currency: (org.get('currency') as string | undefined) ?? 'KES',
    fundNames: Object.fromEntries(funds.docs.map((f) => [f.id, (f.get('name') as string | undefined) ?? f.id])),
    monthlyBudgetCents: settings.budgets?.[orgId] ?? null,
  });

  const id = reportId(type, period.from);
  const ref = db.doc(`organizations/${orgId}/reports/${id}`);
  const stamp = { generatedAt: FieldValue.serverTimestamp(), generatedBy: opts.by ?? SYSTEM };
  const batch = db.batch();
  batch.set(ref, { ...parts.report, ...stamp });
  batch.set(ref.collection('private').doc('pastoral'), { orgId, ...parts.pastoral, ...stamp });
  batch.set(ref.collection('private').doc('giving'), { orgId, ...parts.giving, ...stamp });
  await batch.commit();

  const emailed = opts.email && settings.emailEnabled ? await emailReport(orgId, parts, settings) : 0;
  if (emailed) await ref.update({ emailedAt: FieldValue.serverTimestamp(), emailedTo: emailed });
  return { id, emailed };
}

// ---- Email --------------------------------------------------------------------------------

interface Recipient { uid: string; email: string; name: string; pastoral: boolean; giving: boolean }

async function recipientsFor(orgId: string, settings: ReportSettings): Promise<Recipient[]> {
  const users = settings.recipientUids?.length
    ? (await db.getAll(...settings.recipientUids.map((uid) => db.doc(`users/${uid}`)))).filter((u) => u.exists)
    : (await db.collection('users').where('permissions', 'array-contains', 'users.manage').get()).docs;
  return users.flatMap((u) => {
    const d = u.data()!;
    const perms = (d.permissions as string[] | undefined) ?? [];
    const inOrg = d.allOrgs === true || ((d.orgIds as string[] | undefined) ?? []).includes(orgId);
    if (d.active !== true || !inOrg || !d.email || !perms.includes('people.read')) return [];
    return [{ uid: u.id, email: d.email as string, name: (d.displayName as string | undefined) ?? '', pastoral: perms.includes('pastoral.read'), giving: perms.includes('finance.reports') }];
  });
}

const escapeHtml = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

export function reportEmail(r: ReportDoc, pastoral: PastoralPart | null, giving: GivingPart | null, appUrl: string) {
  const pdf = reportPdf(jsPDF, r, pastoral, giving);
  stampPoweredBy(pdf);
  const content = Buffer.from(pdf.output('arraybuffer')).toString('base64');
  const kind = r.type === 'weekly' ? 'Weekly' : 'Monthly';
  const h = r.headlines.current;
  const lines = [
    `${kind} report for ${r.orgName}: ${r.label}.`,
    '',
    `Service attendance (weekly average): ${h.attendance ?? '–'}`,
    `First-time visitors: ${h.visitors}`,
    `Salvations: ${h.salvations}. Baptisms: ${h.baptisms}.`,
    `Follow-ups overdue: ${r.scorecard.overdueFollowUps}`,
    '',
    ...(r.changes.length ? ['The biggest changes:', ...r.changes.map((c) => `- ${c}`), ''] : []),
    'The full report is attached as a PDF, and is kept in the app under Reports:',
    `${appUrl}/reports/${r.orgId}/${reportId(r.type, r.from)}`,
  ];
  return {
    subject: `${kind} report: ${r.orgName}, ${r.label}`,
    text: [...lines, '', POWERED_BY].join('\n'),
    html: lines.map((l) => (l ? `<p style="margin:0 0 6px">${escapeHtml(l)}</p>` : '<br>')).join('') + poweredByHtml(),
    attachments: [{ filename: reportFileName(r, 'pdf'), content, encoding: 'base64', contentType: 'application/pdf' }],
  };
}

/**
 * Queues the email for each recipient in /mail, the collection the Firebase
 * "Trigger Email" extension sends from. Each person's copy has only the parts
 * they are allowed to see: the giving summary only goes to finance reports.
 */
async function emailReport(orgId: string, parts: { report: ReportDoc; pastoral: PastoralPart; giving: GivingPart }, settings: ReportSettings): Promise<number> {
  const recipients = await recipientsFor(orgId, settings);
  const appUrl = process.env.APP_URL || 'https://freedom-chms.web.app';
  for (const to of recipients) {
    await db.collection('mail').add({
      to: [to.email],
      message: reportEmail(parts.report, to.pastoral ? parts.pastoral : null, to.giving ? parts.giving : null, appUrl),
      orgId,
      reportId: reportId(parts.report.type, parts.report.from),
      toUid: to.uid,
      createdAt: FieldValue.serverTimestamp(),
    });
  }
  return recipients.length;
}

// ---- Requests from the app --------------------------------------------------------------

/**
 * "Make a report" in the app writes a request; this makes the report and
 * marks the request done (or failed, with a reason).
 */
export const onReportRequested = onDocumentCreated(
  { document: 'organizations/{orgId}/reportRequests/{requestId}', memory: '1GiB', timeoutSeconds: 300 },
  async (event) => {
    const { orgId } = event.params;
    const req = event.data?.data();
    if (!req || !event.data) return;
    const type = req.type as ReportType;
    try {
      if (type !== 'weekly' && type !== 'monthly') throw new Error('Unknown report type');
      const result = await generateReport(orgId, type, req.from as string, { by: req.createdBy as string, email: req.email === true });
      await event.data.ref.update({ status: 'done', reportId: result.id, emailed: result.emailed, doneAt: FieldValue.serverTimestamp() });
    } catch (err) {
      logger.error(`Report request ${event.params.requestId} failed`, err);
      await event.data.ref.update({ status: 'failed', error: 'The report could not be made. Please try again.', doneAt: FieldValue.serverTimestamp() });
    }
  },
);

// ---- On schedule: Mondays and the 1st at 07:00 --------------------------------------------

export async function runScheduledReports(now = new Date()): Promise<string[]> {
  const made: string[] = [];
  const orgs = await db.collection('organizations').where('type', '==', 'church_campus').get();
  for (const org of orgs.docs) {
    if (org.get('deletedAt') != null || org.get('active') === false || isTraining({ id: org.id, training: org.get('training') })) continue;
    const today = todayIn((org.get('timeZone') as string | undefined) ?? DEFAULT_TIME_ZONE, now);
    for (const { type, period } of reportsDue(today)) {
      const id = reportId(type, period.from);
      // A retry of the same morning's job doesn't email twice.
      const existing = await db.doc(`organizations/${org.id}/reports/${id}`).get();
      if (existing.exists && existing.get('generatedBy') === SYSTEM && (ms(existing.get('generatedAt')) ?? 0) > now.getTime() - DAY / 2) continue;
      try {
        const result = await generateReport(org.id, type, period.from, { now, email: true });
        made.push(`${org.id}/${id}`);
        logger.info(`Report ${org.id}/${id} made, emailed to ${result.emailed}`);
      } catch (err) {
        logger.error(`Report ${org.id}/${id} failed`, err);
      }
    }
  }
  return made;
}

export const scheduledReports = onSchedule(
  // Cloud Scheduler isn't offered in africa-south1, so this job runs from Europe.
  { schedule: 'every day 07:00', timeZone: 'Africa/Nairobi', region: process.env.SCHEDULER_REGION || 'europe-west1', memory: '1GiB', timeoutSeconds: 540 },
  async () => { await runScheduledReports(); },
);
