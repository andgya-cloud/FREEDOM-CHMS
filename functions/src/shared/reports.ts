/**
 * Weekly and monthly reports: what goes in them, who may read each part, and
 * the CSV and PDF versions. The numbers come from metrics.ts. A report is
 * stored in three parts so the server rules can protect each one:
 *
 * - the report itself (anyone who can see people): attendance, visitors,
 *   programmes, groups, serving, follow-ups and the funnel, with counts only
 *   for salvations and baptisms;
 * - a pastoral part (pastoral access): who was saved or baptised, and the
 *   salvation and baptism follow-ups;
 * - a giving part (finance reports): the giving summary, for the pastor's copy.
 */
import type { jsPDF as JsPdf } from 'jspdf';
import {
  attendanceTrend,
  biggestChanges,
  followUpsDue,
  funnel,
  lastCompletePeriod,
  lastYearPeriod,
  periodLabel,
  previousPeriod,
  scorecard,
  type DayRange,
  type DueFollowUp,
  type FunnelStep,
  type MetricsInput,
  type ReportType,
  type Scorecard,
} from './metrics.js';
import { formatMoney } from './giving.js';
import { FOLLOW_UP_REASON_LABELS, type FollowUpReason } from './followups.js';

export interface Headlines {
  attendance: number | null;
  visitors: number;
  salvations: number;
  baptisms: number;
  groupParticipation: number | null;
  servingRate: number | null;
  regularAttenders: number;
  returnRate: number | null;
  followUpSpeed: number | null;
  netGrowth: number;
}

export type PublicScorecard = Omit<Scorecard, 'giving' | 'salvations' | 'baptisms'> & {
  salvations: { count: number };
  baptisms: { count: number };
};

export interface NamedDay { personId: string; name: string; date: string }

export interface ReportDoc {
  orgId: string;
  orgName: string;
  type: ReportType;
  from: string;
  to: string;
  label: string;
  regularWeeks: number;
  headlines: { current: Headlines; previous: Headlines; lastYear: Headlines };
  scorecard: PublicScorecard;
  visitors: NamedDay[];
  changes: string[];
  funnel: FunnelStep[];
  trend: { week: string; total: number }[];
  followUpsDue: DueFollowUp[];
}

export interface PastoralPart {
  salvations: NamedDay[];
  baptisms: NamedDay[];
  followUpsDue: DueFollowUp[];
}

export type Giving = Scorecard['giving'];

export interface GivingPart {
  currency: string;
  current: Giving;
  previous: Giving;
  lastYear: Giving;
  fundNames: Record<string, string>;
  /** The budget for this period, worked out from the monthly budget, when one is entered. */
  budgetCents: number | null;
}

export interface ReportParts { report: ReportDoc; pastoral: PastoralPart; giving: GivingPart }

export function headlines(s: Scorecard): Headlines {
  return {
    attendance: s.attendance.weeklyAverage,
    visitors: s.visitors.count,
    salvations: s.salvations.count,
    baptisms: s.baptisms.count,
    groupParticipation: s.groups.participationRate,
    servingRate: s.serving.rate,
    regularAttenders: s.regularAttenders,
    returnRate: s.returnRate.rate,
    followUpSpeed: s.followUpSpeed.rate,
    netGrowth: s.netGrowth.net,
  };
}

/** A monthly budget spread over a week (52 weeks a year) or a whole month. */
export function budgetFor(type: ReportType, monthlyBudgetCents: number | null | undefined): number | null {
  if (!monthlyBudgetCents || monthlyBudgetCents <= 0) return null;
  return type === 'monthly' ? monthlyBudgetCents : Math.round((monthlyBudgetCents * 12) / 52);
}

export interface ReportContext {
  orgId: string;
  orgName: string;
  currency: string;
  fundNames: Record<string, string>;
  monthlyBudgetCents?: number | null;
}

/** Works out every part of one report. */
export function buildReport(input: MetricsInput, type: ReportType, period: DayRange, ctx: ReportContext): ReportParts {
  const current = scorecard(input, period);
  const previous = scorecard(input, previousPeriod(type, period));
  const lastYear = scorecard(input, lastYearPeriod(type, period));
  const names = new Map(input.people.map((p) => [p.id, p.fullName]));
  const named = (stageId: string): NamedDay[] => input.stages
    .filter((s) => s.stageId === stageId && s.status === 'completed' && !!s.date && s.date >= period.from && s.date <= period.to && names.has(s.personId))
    .map((s) => ({ personId: s.personId, name: names.get(s.personId)!, date: s.date! }))
    .sort((a, b) => a.date.localeCompare(b.date) || a.name.localeCompare(b.name));
  const due = followUpsDue(input.followUps, input.now);
  const { giving, salvations, baptisms, ...rest } = current;

  return {
    report: {
      orgId: ctx.orgId,
      orgName: ctx.orgName,
      type,
      from: period.from,
      to: period.to,
      label: periodLabel(type, period),
      regularWeeks: input.regularWeeks,
      headlines: { current: headlines(current), previous: headlines(previous), lastYear: headlines(lastYear) },
      scorecard: { ...rest, salvations: { count: salvations.count }, baptisms: { count: baptisms.count } },
      visitors: input.people
        .filter((p) => current.visitors.ids.includes(p.id))
        .map((p) => ({ personId: p.id, name: p.fullName, date: p.firstVisitDate! }))
        .sort((a, b) => a.date.localeCompare(b.date) || a.name.localeCompare(b.name)),
      changes: biggestChanges(type, current, previous),
      funnel: funnel(input),
      trend: attendanceTrend(input, period.to, type === 'weekly' ? 12 : 26),
      followUpsDue: due.everyday,
    },
    pastoral: { salvations: named('salvation'), baptisms: named('baptism'), followUpsDue: due.pastoral },
    giving: {
      currency: ctx.currency,
      current: giving,
      previous: previous.giving,
      lastYear: lastYear.giving,
      fundNames: ctx.fundNames,
      budgetCents: budgetFor(type, ctx.monthlyBudgetCents),
    },
  };
}

/** Which reports are due today for an organization: last week on a Monday, last month on the 1st. */
export function reportsDue(today: string): { type: ReportType; period: DayRange }[] {
  const due: { type: ReportType; period: DayRange }[] = [];
  const weekday = new Date(`${today}T12:00:00Z`).getUTCDay();
  if (weekday === 1) due.push({ type: 'weekly', period: lastCompletePeriod('weekly', today) });
  if (today.endsWith('-01')) due.push({ type: 'monthly', period: lastCompletePeriod('monthly', today) });
  return due;
}

// ---- Trends ---------------------------------------------------------------------------

export type Trend = 'up' | 'down' | 'same' | 'none';

export function trendOf(now: number | null | undefined, before: number | null | undefined): Trend {
  if (now == null || before == null) return 'none';
  return now > before ? 'up' : now < before ? 'down' : 'same';
}

export function changeText(now: number | null | undefined, before: number | null | undefined, since: string, unit = ''): string {
  if (now == null || before == null) return `No figure for ${since}`;
  if (now === before) return `Same as ${since}`;
  if (before === 0) return `Up from none ${since}`;
  const pct = Math.round(((now - before) / before) * 100);
  const diff = Math.round((now - before) * 10) / 10;
  if (unit === '%') return `${diff > 0 ? '+' : ''}${diff} points on ${since}`;
  return `${pct > 0 ? 'Up' : 'Down'} ${Math.abs(pct)}% on ${since}`;
}

// ---- Words used on screen, in the PDF and in the CSV ---------------------------------------

const pct = (v: number | null | undefined) => (v == null ? '–' : `${v}%`);
const num = (v: number | null | undefined) => (v == null ? '–' : String(v));
const fmtDay = (k: string) => `${k.slice(8, 10)}/${k.slice(5, 7)}/${k.slice(0, 4)}`;
/** "3 days" overdue, "Overdue" since earlier today, or "Due today". */
export const dueText = (f: Pick<DueFollowUp, 'overdue' | 'overdueDays'>) => (f.overdueDays ? `${f.overdueDays} days` : f.overdue ? 'Overdue' : 'Due today');
export const reasonLabel = (r: string) => FOLLOW_UP_REASON_LABELS[r as FollowUpReason] ?? r;

export interface Row { section: string; measure: string; current: string; previous: string; lastYear: string }

/** The scorecard as rows: what was measured, this period, the one before, and a year ago. */
export function scorecardRows(r: ReportDoc, giving?: GivingPart | null): Row[] {
  const { current: c, previous: p, lastYear: y } = r.headlines;
  const s = r.scorecard;
  const row = (section: string, measure: string, f: (h: Headlines) => string): Row => ({ section, measure, current: f(c), previous: f(p), lastYear: f(y) });
  const only = (section: string, measure: string, value: string): Row => ({ section, measure, current: value, previous: '', lastYear: '' });
  const rows: Row[] = [
    row('Attendance', 'Service attendance (weekly average)', (h) => num(h.attendance)),
    only('Attendance', 'Total attendance', String(s.attendance.total)),
    only('Attendance', 'Adults / teens / children', `${s.attendance.adults} / ${s.attendance.teens} / ${s.attendance.children}`),
    only('Attendance', '4-week average', num(s.averageAttendance.fourWeeks)),
    only('Attendance', 'Year-to-date average', num(s.averageAttendance.yearToDate)),
    row('Attendance', `Regular attenders (${r.regularWeeks}+ of the last 8 weeks)`, (h) => String(h.regularAttenders)),
    row('Attendance', 'Net growth in regular attenders', (h) => String(h.netGrowth)),
    row('Visitors', 'First-time visitors', (h) => String(h.visitors)),
    row('Visitors', 'Came back within 4 weeks', (h) => pct(h.returnRate)),
    row('Visitors', 'Contacted within 48 hours', (h) => pct(h.followUpSpeed)),
    row('Salvations and baptisms', 'Salvations', (h) => String(h.salvations)),
    row('Salvations and baptisms', 'Baptisms', (h) => String(h.baptisms)),
    only('Salvations and baptisms', 'Saved in the last year and baptised', pct(s.salvationToBaptism.rate)),
    row('Groups and serving', 'Regular attenders in a Freedom Group', (h) => pct(h.groupParticipation)),
    only('Groups and serving', 'Freedom Groups / average size', `${s.groups.count} / ${num(s.groups.averageSize)}`),
    only('Groups and serving', 'Average group meeting attendance', num(s.groups.averageMeetingAttendance)),
    row('Groups and serving', 'Regular attenders serving on the Dream Team', (h) => pct(h.servingRate)),
    only('Groups and serving', 'Still serving after 90 days', pct(s.serving.retention.rate)),
    only('Follow-ups', 'Overdue follow-ups when the report was made', String(s.overdueFollowUps)),
  ];
  for (const prog of s.programs) {
    rows.push(only('Programmes', `${prog.name}: enrolled / completed`, `${prog.enrolled} / ${prog.completed} (${pct(prog.completionRate)})`));
    if (prog.topicCount > 0 && prog.averageTopics != null) rows.push(only('Programmes', `${prog.name}: average topics covered`, `${prog.averageTopics} of ${prog.topicCount}`));
  }
  if (giving) {
    const money = (g: Giving) => formatMoney(g.totalCents, giving.currency);
    rows.push({ section: 'Giving', measure: 'Total giving', current: money(giving.current), previous: money(giving.previous), lastYear: money(giving.lastYear) });
    for (const [fund, cents] of Object.entries(giving.current.byFund)) rows.push(only('Giving', `  ${giving.fundNames[fund] ?? fund}`, formatMoney(cents, giving.currency)));
    rows.push({ section: 'Giving', measure: 'Givers', current: String(giving.current.givers), previous: String(giving.previous.givers), lastYear: String(giving.lastYear.givers) });
    rows.push(only('Giving', 'First-time givers', String(giving.current.firstTimeGivers)));
    rows.push(only('Giving', 'Lapsed givers (nothing in 90 days)', String(giving.current.lapsedGivers)));
    rows.push(only('Giving', 'Average gift', giving.current.averageGiftCents == null ? '–' : formatMoney(giving.current.averageGiftCents, giving.currency)));
    rows.push(only('Giving', 'Giving per attendee', giving.current.perAttendeeCents == null ? '–' : formatMoney(giving.current.perAttendeeCents, giving.currency)));
    if (giving.budgetCents) rows.push(only('Giving', 'Against budget', `${Math.round((giving.current.totalCents / giving.budgetCents) * 100)}% of ${formatMoney(giving.budgetCents, giving.currency)}`));
  }
  return rows;
}

function csvCell(v: string | number): string {
  const s = String(v);
  // A leading = + - @ would be read as a formula by Excel.
  const safe = /^[=+\-@]/.test(s) && !/^-?\d/.test(s) ? `'${s}` : s;
  return /[",\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

/** The whole report as a CSV file that opens in Excel. */
export function reportCsv(r: ReportDoc, pastoral?: PastoralPart | null, giving?: GivingPart | null): string {
  const lines: (string | number)[][] = [
    [r.orgName], [r.label], [],
    ['Section', 'Measure', 'This period', r.type === 'weekly' ? 'Last week' : 'Last month', 'A year ago'],
    ...scorecardRows(r, giving).map((x) => [x.section, x.measure.trim(), x.current, x.previous, x.lastYear]),
    [], ['Biggest changes'], ...r.changes.map((c) => [c]),
    [], ['Journey', 'People', 'Did not go on'], ...r.funnel.map((f) => [f.label, f.count, f.dropOff == null ? '' : `${f.dropOff}%`]),
    [], ['Week starting', 'Service attendance'], ...r.trend.map((t) => [fmtDay(t.week), t.total]),
    [], ['First-time visitors', 'First visit'], ...r.visitors.map((v) => [v.name, fmtDay(v.date)]),
    [], ['Regulars away 4 weeks or more', 'Last at church'], ...r.scorecard.dropOff.map((d) => [d.name, fmtDay(d.lastDate)]),
    [], ['Follow-ups due', 'Why', 'Overdue'], ...r.followUpsDue.map((f) => [f.name, reasonLabel(f.reason), dueText(f)]),
  ];
  if (r.scorecard.groups.missedTwo.length) lines.push([], ['Groups that missed 2 or more meetings', 'In a row'], ...r.scorecard.groups.missedTwo.map((g) => [g.name, g.inARow]));
  if (pastoral) {
    lines.push([], ['Salvations', 'Date'], ...pastoral.salvations.map((x) => [x.name, fmtDay(x.date)]));
    lines.push([], ['Baptisms', 'Date'], ...pastoral.baptisms.map((x) => [x.name, fmtDay(x.date)]));
    lines.push([], ['Pastoral follow-ups due', 'Why', 'Overdue'], ...pastoral.followUpsDue.map((f) => [f.name, reasonLabel(f.reason), dueText(f)]));
  }
  return lines.map((l) => l.map(csvCell).join(',')).join('\r\n') + '\r\n';
}

// ---- PDF ---------------------------------------------------------------------------------

const GOLD: [number, number, number] = [176, 137, 52];
const INK: [number, number, number] = [30, 30, 30];
const GREY: [number, number, number] = [110, 110, 110];

/**
 * The report as an A4 PDF. The caller passes jsPDF in, so the same layout is
 * used in Cloud Functions (for the email) and on a phone (for a download).
 */
export function reportPdf(JsPDF: typeof JsPdf, r: ReportDoc, pastoral?: PastoralPart | null, giving?: GivingPart | null): JsPdf {
  const pdf = new JsPDF({ unit: 'mm', format: 'a4' });
  const w = pdf.internal.pageSize.getWidth();
  const h = pdf.internal.pageSize.getHeight();
  let y = 0;

  const newPage = () => { pdf.addPage(); y = 18; };
  const need = (mm: number) => { if (y + mm > h - 16) newPage(); };
  const heading = (text: string) => {
    need(16);
    y += 4;
    pdf.setFont('helvetica', 'bold'); pdf.setFontSize(12); pdf.setTextColor(...INK);
    pdf.text(text, 14, y);
    y += 2;
    pdf.setDrawColor(...GOLD); pdf.line(14, y, w - 14, y);
    y += 6;
  };
  const para = (text: string, size = 10, color = INK) => {
    pdf.setFont('helvetica', 'normal'); pdf.setFontSize(size); pdf.setTextColor(...color);
    const lines = pdf.splitTextToSize(text, w - 28) as string[];
    need(lines.length * 5);
    pdf.text(lines, 14, y);
    y += lines.length * 5;
  };
  const table = (head: string[], body: string[][], widths: number[]) => {
    const xs = widths.reduce<number[]>((acc, _w, i) => [...acc, i === 0 ? 14 : acc[i - 1]! + widths[i - 1]!], []);
    const draw = (cells: string[], bold: boolean) => {
      pdf.setFont('helvetica', bold ? 'bold' : 'normal'); pdf.setFontSize(9); pdf.setTextColor(...(bold ? GREY : INK));
      const wrapped = cells.map((c, i) => pdf.splitTextToSize(c, widths[i]! - 2) as string[]);
      const rows = Math.max(...wrapped.map((x) => x.length));
      need(rows * 4.5 + 1);
      wrapped.forEach((lines, i) => pdf.text(lines, xs[i]!, y));
      y += rows * 4.5 + 1;
    };
    draw(head, true);
    if (body.length === 0) { para('None.', 9, GREY); return; }
    body.forEach((row) => draw(row, false));
  };

  // Title
  pdf.setFillColor(...GOLD); pdf.rect(0, 0, w, 4, 'F');
  pdf.setTextColor(...INK); pdf.setFont('helvetica', 'bold'); pdf.setFontSize(16);
  pdf.text(r.orgName, 14, 18);
  pdf.setFont('helvetica', 'normal'); pdf.setFontSize(11); pdf.setTextColor(...GREY);
  pdf.text(`${r.type === 'weekly' ? 'Weekly' : 'Monthly'} report: ${r.label}${giving ? ' (pastor\'s copy)' : ''}`, 14, 25);
  y = 34;

  heading('The biggest changes');
  if (r.changes.length === 0) para('No big changes this time.', 10, GREY);
  r.changes.forEach((c) => para(`• ${c}`));

  heading('Scorecard');
  const before = r.type === 'weekly' ? 'Last week' : 'Last month';
  let section = '';
  const rows = scorecardRows(r, giving).map((x) => {
    const label = x.section !== section ? x.section : '';
    section = x.section;
    return [label, x.measure, x.current, x.previous, x.lastYear];
  });
  table(['', 'Measure', 'This period', before, 'A year ago'], rows, [34, 76, 26, 24, 22]);

  heading('Journey: people who completed each step');
  table(['Step', 'People', 'Did not go on'], r.funnel.map((f) => [f.label, String(f.count), f.dropOff == null ? '' : `${f.dropOff}%`]), [70, 30, 40]);

  heading('Service attendance by week');
  const max = Math.max(1, ...r.trend.map((t) => t.total));
  need(42);
  const barW = (w - 28) / r.trend.length;
  r.trend.forEach((t, i) => {
    const bh = (t.total / max) * 28;
    pdf.setFillColor(...GOLD);
    pdf.rect(14 + i * barW + 0.5, y + 28 - bh, barW - 1, bh, 'F');
  });
  pdf.setFontSize(7); pdf.setTextColor(...GREY);
  pdf.text(fmtDay(r.trend[0]!.week).slice(0, 5), 14, y + 32);
  pdf.text(`${fmtDay(r.trend[r.trend.length - 1]!.week).slice(0, 5)}: ${r.trend[r.trend.length - 1]!.total}`, w - 14, y + 32, { align: 'right' });
  y += 38;

  heading('Programme progress');
  const progs = r.scorecard.programs.flatMap((p) => [
    [p.name, String(p.enrolled), String(p.completed), pct(p.completionRate), p.topicCount ? `${num(p.averageTopics)} of ${p.topicCount}` : ''],
    ...p.cohorts.map((c) => [`   ${c.name}`, String(c.enrolled), String(c.completed), pct(c.completionRate), '']),
  ]);
  table(['Programme', 'Enrolled', 'Completed', 'Rate', 'Average topics'], progs, [70, 24, 26, 22, 40]);

  heading('People needing follow-up');
  table(['Name', 'Why', 'Overdue'], r.followUpsDue.map((f) => [f.name, reasonLabel(f.reason), dueText(f)]), [70, 80, 30]);
  if (pastoral?.followUpsDue.length) {
    y += 2;
    table(['Pastoral', 'Why', 'Overdue'], pastoral.followUpsDue.map((f) => [f.name, reasonLabel(f.reason), dueText(f)]), [70, 80, 30]);
  }
  y += 2;
  table(['Regulars away 4 weeks or more', 'Last at church'], r.scorecard.dropOff.map((d) => [d.name, fmtDay(d.lastDate)]), [100, 60]);
  if (r.scorecard.groups.missedTwo.length) {
    y += 2;
    table(['Groups that missed 2 or more meetings', 'In a row'], r.scorecard.groups.missedTwo.map((g) => [g.name, String(g.inARow)]), [100, 60]);
  }

  heading('First-time visitors');
  table(['Name', 'First visit'], r.visitors.map((v) => [v.name, fmtDay(v.date)]), [100, 60]);

  if (pastoral) {
    heading('Salvations and baptisms');
    table(['Saved', 'Date'], pastoral.salvations.map((x) => [x.name, fmtDay(x.date)]), [100, 60]);
    y += 2;
    table(['Baptised', 'Date'], pastoral.baptisms.map((x) => [x.name, fmtDay(x.date)]), [100, 60]);
  }

  // Footer on every page
  const pages = pdf.getNumberOfPages();
  for (let i = 1; i <= pages; i++) {
    pdf.setPage(i);
    pdf.setFontSize(8); pdf.setTextColor(...GREY); pdf.setFont('helvetica', 'normal');
    pdf.text(`${r.orgName} · ${r.label} · Private: for church leadership only`, 14, h - 8);
    pdf.text(`${i} / ${pages}`, w - 14, h - 8, { align: 'right' });
  }
  return pdf;
}

export function reportFileName(r: Pick<ReportDoc, 'orgName' | 'type' | 'from'>, ext: 'pdf' | 'csv'): string {
  const name = r.orgName.replace(/[^A-Za-z0-9]+/g, '-').replace(/^-|-$/g, '');
  return `${name}-${r.type}-report-${r.type === 'weekly' ? r.from : r.from.slice(0, 7)}.${ext}`;
}
