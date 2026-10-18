/**
 * The weekly and monthly scorecard: every number in section 4 of the brief,
 * worked out from plain records so the same code runs in Cloud Functions
 * (reports) and in tests. Dates are calendar days (YYYY-MM-DD) in the
 * organization's time zone; weeks run Monday to Sunday.
 */
import { attended, headcountTotal, type Headcounts } from './attendance.js';
import { missedMeetings, MISSED_MEETINGS_FLAG, type Weekday } from './programs.js';
import { SENSITIVE_REASONS, type FollowUpReason } from './followups.js';

// ---- Calendar days ---------------------------------------------------------------

const DAY = 86_400_000;

export function dayNumber(key: string): number {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(key);
  return m ? Math.floor(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])) / DAY) : NaN;
}
export function dayKey(day: number): string {
  return new Date(day * DAY).toISOString().slice(0, 10);
}
export function addDays(key: string, days: number): string {
  return dayKey(dayNumber(key) + days);
}
/** Monday of the week containing a day (1970-01-01 was a Thursday). */
export function mondayOf(key: string): string {
  const d = dayNumber(key);
  return dayKey(d - ((d + 3) % 7));
}

export type ReportType = 'weekly' | 'monthly';

export interface DayRange {
  /** First day, inclusive. */
  from: string;
  /** Last day, inclusive. */
  to: string;
}

/** The week (Monday to Sunday) or calendar month that starts on `from`. */
export function periodFor(type: ReportType, from: string): DayRange {
  if (type === 'weekly') {
    const monday = mondayOf(from);
    return { from: monday, to: addDays(monday, 6) };
  }
  const [y, m] = from.split('-').map(Number) as [number, number];
  const start = `${y}-${String(m).padStart(2, '0')}-01`;
  const next = m === 12 ? `${y + 1}-01-01` : `${y}-${String(m + 1).padStart(2, '0')}-01`;
  return { from: start, to: addDays(next, -1) };
}

/** The period before: last week, or last month. */
export function previousPeriod(type: ReportType, p: DayRange): DayRange {
  return periodFor(type, addDays(p.from, -1));
}

/** The same period a year earlier: 52 weeks back (so weekdays line up), or the same month last year. */
export function lastYearPeriod(type: ReportType, p: DayRange): DayRange {
  if (type === 'weekly') return periodFor('weekly', addDays(p.from, -364));
  const [y, m] = p.from.split('-');
  return periodFor('monthly', `${Number(y) - 1}-${m}-01`);
}

/** The last complete period before `today`: last week, or last month. */
export function lastCompletePeriod(type: ReportType, today: string): DayRange {
  return previousPeriod(type, periodFor(type, today));
}

export function periodLabel(type: ReportType, p: DayRange): string {
  const fmt = (k: string) => `${k.slice(8, 10)}/${k.slice(5, 7)}/${k.slice(0, 4)}`;
  if (type === 'weekly') return `Week of ${fmt(p.from)} to ${fmt(p.to)}`;
  const months = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  return `${months[Number(p.from.slice(5, 7)) - 1]} ${p.from.slice(0, 4)}`;
}

const inRange = (key: string | null | undefined, r: DayRange) => !!key && key >= r.from && key <= r.to;

// ---- Records ---------------------------------------------------------------------

export interface MEvent { id: string; date: string; type: string; headcounts?: Headcounts | null; programId?: string | null; groupId?: string | null }
export interface MMark { personId: string; eventId: string; date: string; status: string; programId?: string | null; groupId?: string | null }
export interface MPerson { id: string; fullName: string; status: string; firstVisitDate?: string | null }
export interface MStage { personId: string; stageId: string; status: string; date?: string | null }
export interface MProgram { id: string; name: string; topicCount: number; topicsNeeded: number; active: boolean }
export interface MCohort { id: string; programId: string; name: string }
export interface MEnrollment { programId: string; personId: string; cohortId: string | null; status: string; completedDate?: string | null; topicsCovered: number }
export interface MGroup { id: string; name: string; meetingDay: Weekday; startDate: string; active: boolean }
export interface MGroupMember { groupId: string; personId: string; status: string }
export interface MTeamMember { personId: string; status: string; startDate: string; endDate?: string | null }
export interface MGift { personId: string | null; date: string; amountCents: number; fundId: string | null }
export interface MFollowUp {
  personId: string;
  personName: string;
  reason: FollowUpReason | string;
  status: string;
  dueAt: number | null;
  createdAt: number | null;
  doneAt: number | null;
  lastMessageAt: number | null;
}

export interface MetricsInput {
  /** Weeks out of 8 that make someone a regular attender (3 by default). */
  regularWeeks: number;
  events: MEvent[];
  marks: MMark[];
  people: MPerson[];
  stages: MStage[];
  programs: MProgram[];
  cohorts: MCohort[];
  enrollments: MEnrollment[];
  groups: MGroup[];
  groupMembers: MGroupMember[];
  teamMembers: MTeamMember[];
  gifts: MGift[];
  followUps: MFollowUp[];
  /** When the report is made (milliseconds). */
  now: number;
}

/** Sunday services and other services: not classes or group meetings. */
const isService = (e: { type: string; programId?: string | null; groupId?: string | null }) => e.type === 'service' && !e.programId && !e.groupId;
const isServiceMark = (m: MMark) => !m.programId && !m.groupId;

// ---- Building blocks ----------------------------------------------------------------

export interface WeeklyAttendance { week: string; total: number; adults: number; teens: number; children: number }

/**
 * Service attendance per week (keyed by Monday). Each service counts its
 * headcount (adults + teens + children); a service with no headcount counts
 * the people checked in.
 */
export function weeklyAttendance(events: readonly MEvent[], marks: readonly MMark[]): Map<string, WeeklyAttendance> {
  const checkedIn = new Map<string, number>();
  for (const m of marks) if (attended(m.status)) checkedIn.set(m.eventId, (checkedIn.get(m.eventId) ?? 0) + 1);
  const weeks = new Map<string, WeeklyAttendance>();
  for (const e of events) {
    if (!isService(e)) continue;
    const week = mondayOf(e.date);
    const w = weeks.get(week) ?? { week, total: 0, adults: 0, teens: 0, children: 0 };
    const counted = headcountTotal(e.headcounts, 'service');
    if (counted > 0) {
      w.adults += Number(e.headcounts?.adults) || 0;
      w.teens += Number(e.headcounts?.teens) || 0;
      w.children += Number(e.headcounts?.children) || 0;
      w.total += counted;
    } else {
      w.total += checkedIn.get(e.id) ?? 0;
    }
    weeks.set(week, w);
  }
  return weeks;
}

/** Each person's service attendance days, sorted. */
function serviceDays(marks: readonly MMark[]): Map<string, string[]> {
  const by = new Map<string, Set<string>>();
  for (const m of marks) {
    if (!isServiceMark(m) || !attended(m.status)) continue;
    const s = by.get(m.personId) ?? new Set<string>();
    s.add(m.date);
    by.set(m.personId, s);
  }
  return new Map([...by].map(([k, v]) => [k, [...v].sort()]));
}

/** Weeks attended out of the 8 weeks ending with the week containing `day`. */
function weeksOutOf8(days: readonly string[], day: string): number {
  const lastMonday = mondayOf(day);
  const firstMonday = addDays(lastMonday, -49);
  const end = addDays(lastMonday, 6);
  return new Set(days.filter((d) => d >= firstMonday && d <= end && d <= day).map(mondayOf)).size;
}

/** People who attended a service in at least `minWeeks` of the last 8 weeks, as of `day`. */
export function regularAttenders(days: Map<string, string[]>, day: string, minWeeks: number): Set<string> {
  const out = new Set<string>();
  for (const [personId, list] of days) if (weeksOutOf8(list, day) >= minWeeks) out.add(personId);
  return out;
}

const rate = (part: number, whole: number) => (whole > 0 ? Math.round((part / whole) * 1000) / 10 : null);
const average = (values: readonly number[]) => (values.length ? Math.round((values.reduce((a, b) => a + b, 0) / values.length) * 10) / 10 : null);

// ---- The scorecard -------------------------------------------------------------------

export interface ProgramMetrics {
  programId: string;
  name: string;
  enrolled: number;
  completed: number;
  completedInPeriod: number;
  completionRate: number | null;
  averageTopics: number | null;
  topicCount: number;
  cohorts: { cohortId: string | null; name: string; enrolled: number; completed: number; completionRate: number | null }[];
}

export interface Scorecard {
  period: DayRange;
  attendance: { total: number; adults: number; teens: number; children: number; weeks: number; weeklyAverage: number | null };
  averageAttendance: { fourWeeks: number | null; yearToDate: number | null };
  visitors: { count: number; ids: string[] };
  returnRate: { cohort: number; returned: number; rate: number | null; from: string; to: string };
  followUpSpeed: { visitors: number; within48h: number; rate: number | null };
  salvations: { count: number; ids: string[] };
  baptisms: { count: number; ids: string[] };
  salvationToBaptism: { salvations: number; baptised: number; rate: number | null };
  regularAttenders: number;
  programs: ProgramMetrics[];
  groups: { count: number; averageSize: number | null; averageMeetingAttendance: number | null; participants: number; participationRate: number | null; missedTwo: { groupId: string; name: string; inARow: number }[] };
  serving: { members: number; rate: number | null; retention: { eligible: number; stayed: number; rate: number | null } };
  giving: {
    totalCents: number;
    byFund: Record<string, number>;
    gifts: number;
    givers: number;
    firstTimeGivers: number;
    lapsedGivers: number;
    averageGiftCents: number | null;
    perAttendeeCents: number | null;
  };
  dropOff: { personId: string; name: string; lastDate: string }[];
  netGrowth: { gained: number; lost: number; net: number };
  overdueFollowUps: number;
}

/** Every scorecard number for one period. */
export function scorecard(input: MetricsInput, period: DayRange): Scorecard {
  const people = new Map(input.people.map((p) => [p.id, p]));
  const live = (id: string) => people.has(id);
  const days = serviceDays(input.marks.filter((m) => live(m.personId)));
  const weeks = weeklyAttendance(input.events, input.marks);

  // Attendance
  const periodWeeks = [...weeks.values()].filter((w) => w.week >= mondayOf(period.from) && w.week <= period.to);
  const sum = (k: keyof Omit<WeeklyAttendance, 'week'>) => periodWeeks.reduce((s, w) => s + w[k], 0);
  const attendance = {
    total: sum('total'), adults: sum('adults'), teens: sum('teens'), children: sum('children'),
    weeks: periodWeeks.length,
    weeklyAverage: average(periodWeeks.map((w) => w.total)),
  };
  const lastMonday = mondayOf(period.to);
  const fourWeeks = [0, 1, 2, 3].map((i) => weeks.get(addDays(lastMonday, -7 * i))).filter((w): w is WeeklyAttendance => !!w);
  const yearStart = `${period.to.slice(0, 4)}-01-01`;
  const ytd = [...weeks.values()].filter((w) => w.week <= period.to && addDays(w.week, 6) >= yearStart);
  const averageAttendance = { fourWeeks: average(fourWeeks.map((w) => w.total)), yearToDate: average(ytd.map((w) => w.total)) };

  // Visitors
  const visitors = input.people.filter((p) => inRange(p.firstVisitDate, period));
  const cohortRange = { from: addDays(period.to, -55), to: addDays(period.to, -28) };
  const cohort = input.people.filter((p) => inRange(p.firstVisitDate, cohortRange));
  const returned = cohort.filter((p) => (days.get(p.id) ?? []).some((d) => d > p.firstVisitDate! && d <= addDays(p.firstVisitDate!, 28)));

  // Contacted within 48 hours of their first-visit follow-up being created
  let speedVisitors = 0;
  let within48h = 0;
  for (const v of visitors) {
    const tasks = input.followUps.filter((f) => f.personId === v.id && (f.reason === 'first_visit' || f.reason === 'checkin_48h'));
    const start = tasks.find((t) => t.reason === 'first_visit')?.createdAt ?? Math.min(...tasks.map((t) => t.createdAt ?? Infinity));
    if (!Number.isFinite(start)) { speedVisitors++; continue; }
    const contacts = tasks.flatMap((t) => [t.lastMessageAt, t.doneAt]).filter((x): x is number => x != null);
    const contacted = contacts.some((c) => c - start <= 2 * DAY);
    if (!contacted && input.now - start < 2 * DAY) continue; // still inside the 48 hours
    speedVisitors++;
    if (contacted) within48h++;
  }

  // Salvations and baptisms
  const completedStage = (stageId: string) => input.stages.filter((s) => s.stageId === stageId && s.status === 'completed' && live(s.personId));
  const salvations = completedStage('salvation');
  const baptisms = completedStage('baptism');
  const baptised = new Set(baptisms.map((b) => b.personId));
  const yearOfSalvations = salvations.filter((s) => inRange(s.date, { from: addDays(period.to, -364), to: period.to }));

  // Regular attenders and growth
  const regularEnd = regularAttenders(days, period.to, input.regularWeeks);
  const regularStart = regularAttenders(days, addDays(period.from, -1), input.regularWeeks);
  const gained = [...regularEnd].filter((id) => !regularStart.has(id)).length;
  const lost = [...regularStart].filter((id) => !regularEnd.has(id)).length;

  // Programmes
  const programs: ProgramMetrics[] = input.programs.filter((p) => p.active).map((p) => {
    const list = input.enrollments.filter((e) => e.programId === p.id && live(e.personId));
    const done = list.filter((e) => e.status === 'completed');
    const taking = list.filter((e) => e.status !== 'dropped');
    const cohortIds = [...new Set(list.map((e) => e.cohortId))];
    return {
      programId: p.id,
      name: p.name,
      enrolled: list.length,
      completed: done.length,
      completedInPeriod: done.filter((e) => inRange(e.completedDate, period)).length,
      completionRate: rate(done.length, list.length),
      averageTopics: p.topicCount ? average(taking.map((e) => e.topicsCovered)) : null,
      topicCount: p.topicCount,
      cohorts: cohortIds.map((id) => {
        const inCohort = list.filter((e) => e.cohortId === id);
        const completed = inCohort.filter((e) => e.status === 'completed').length;
        return { cohortId: id, name: input.cohorts.find((c) => c.id === id)?.name ?? 'No class group', enrolled: inCohort.length, completed, completionRate: rate(completed, inCohort.length) };
      }).sort((a, b) => a.name.localeCompare(b.name)),
    };
  });

  // Freedom Groups
  const groups = input.groups.filter((g) => g.active);
  const activeMembers = input.groupMembers.filter((m) => m.status === 'active' && live(m.personId) && groups.some((g) => g.id === m.groupId));
  const inGroup = new Set(activeMembers.map((m) => m.personId));
  const meetings = input.events.filter((e) => e.type === 'group' && e.groupId && inRange(e.date, period));
  const meetingCounts = meetings.map((e) => input.marks.filter((m) => m.eventId === e.id && attended(m.status)).length);
  const afterPeriod = addDays(period.to, 1);
  const missedTwo = groups.map((g) => {
    const dates = input.events.filter((e) => e.type === 'group' && e.groupId === g.id && e.date <= period.to).map((e) => e.date);
    return { groupId: g.id, name: g.name, inARow: missedMeetings(dates, g.meetingDay, g.startDate, afterPeriod).inARow };
  }).filter((g) => g.inARow >= MISSED_MEETINGS_FLAG);

  // Dream Team
  const serving = new Set(input.teamMembers.filter((m) => m.status === 'active' && live(m.personId)).map((m) => m.personId));
  const eligible = input.teamMembers.filter((m) => live(m.personId) && m.startDate && m.startDate <= addDays(period.to, -90));
  const stayed = eligible.filter((m) => m.status === 'active' || (m.endDate && dayNumber(m.endDate) - dayNumber(m.startDate) >= 90));

  // Giving
  const periodGifts = input.gifts.filter((g) => inRange(g.date, period));
  const totalCents = periodGifts.reduce((s, g) => s + g.amountCents, 0);
  const byFund: Record<string, number> = {};
  for (const g of periodGifts) byFund[g.fundId ?? 'none'] = (byFund[g.fundId ?? 'none'] ?? 0) + g.amountCents;
  const givers = new Set(periodGifts.map((g) => g.personId).filter((x): x is string => !!x));
  const firstGift = new Map<string, string>();
  for (const g of input.gifts) if (g.personId && (!firstGift.has(g.personId) || g.date < firstGift.get(g.personId)!)) firstGift.set(g.personId, g.date);
  const recent = { from: addDays(period.to, -89), to: period.to };
  const before = { from: addDays(period.to, -454), to: addDays(period.to, -90) };
  const gaveRecently = new Set(input.gifts.filter((g) => g.personId && inRange(g.date, recent)).map((g) => g.personId));
  const lapsed = new Set(input.gifts.filter((g) => g.personId && inRange(g.date, before) && !gaveRecently.has(g.personId)).map((g) => g.personId));

  // Drop-off: regulars who haven't been for 4 weeks or more (up to six months)
  const dropOff: Scorecard['dropOff'] = [];
  for (const [personId, list] of days) {
    const seen = list.filter((d) => d <= period.to);
    const last = seen[seen.length - 1];
    if (!last) continue;
    const away = dayNumber(period.to) - dayNumber(last);
    if (away < 28 || away > 182) continue;
    if (weeksOutOf8(seen, last) >= input.regularWeeks) dropOff.push({ personId, name: people.get(personId)!.fullName, lastDate: last });
  }
  dropOff.sort((a, b) => b.lastDate.localeCompare(a.lastDate));

  return {
    period,
    attendance,
    averageAttendance,
    visitors: { count: visitors.length, ids: visitors.map((v) => v.id) },
    returnRate: { cohort: cohort.length, returned: returned.length, rate: rate(returned.length, cohort.length), ...cohortRange },
    followUpSpeed: { visitors: speedVisitors, within48h, rate: rate(within48h, speedVisitors) },
    salvations: { count: salvations.filter((s) => inRange(s.date, period)).length, ids: salvations.filter((s) => inRange(s.date, period)).map((s) => s.personId) },
    baptisms: { count: baptisms.filter((s) => inRange(s.date, period)).length, ids: baptisms.filter((s) => inRange(s.date, period)).map((s) => s.personId) },
    salvationToBaptism: { salvations: yearOfSalvations.length, baptised: yearOfSalvations.filter((s) => baptised.has(s.personId)).length, rate: rate(yearOfSalvations.filter((s) => baptised.has(s.personId)).length, yearOfSalvations.length) },
    regularAttenders: regularEnd.size,
    programs,
    groups: {
      count: groups.length,
      averageSize: groups.length ? Math.round((activeMembers.length / groups.length) * 10) / 10 : null,
      averageMeetingAttendance: average(meetingCounts),
      participants: [...regularEnd].filter((id) => inGroup.has(id)).length,
      participationRate: rate([...regularEnd].filter((id) => inGroup.has(id)).length, regularEnd.size),
      missedTwo,
    },
    serving: { members: serving.size, rate: rate(serving.size, regularEnd.size), retention: { eligible: eligible.length, stayed: stayed.length, rate: rate(stayed.length, eligible.length) } },
    giving: {
      totalCents,
      byFund,
      gifts: periodGifts.length,
      givers: givers.size,
      firstTimeGivers: [...givers].filter((id) => inRange(firstGift.get(id), period)).length,
      lapsedGivers: lapsed.size,
      averageGiftCents: periodGifts.length ? Math.round(totalCents / periodGifts.length) : null,
      perAttendeeCents: attendance.weeklyAverage ? Math.round(totalCents / attendance.weeklyAverage) : null,
    },
    dropOff,
    netGrowth: { gained, lost, net: gained - lost },
    overdueFollowUps: input.followUps.filter((f) => f.status === 'open' && f.dueAt != null && f.dueAt < input.now).length,
  };
}

// ---- Funnel, trend and the biggest changes -----------------------------------------------

export interface FunnelStep { label: string; count: number; dropOff: number | null }

/** Visitor → Salvation → Baptism → Growth Track → Dream Team or Group: people who completed each. */
export function funnel(input: Pick<MetricsInput, 'stages' | 'people'>): FunnelStep[] {
  const live = new Set(input.people.map((p) => p.id));
  const done = (ids: string[]) => new Set(input.stages.filter((s) => ids.includes(s.stageId) && s.status === 'completed' && live.has(s.personId)).map((s) => s.personId));
  const steps: [string, Set<string>][] = [
    ['Visitor', done(['visitor'])],
    ['Salvation', done(['salvation'])],
    ['Baptism', done(['baptism'])],
    ['Growth Track', done(['growth_track'])],
    ['Dream Team or Group', done(['dream_team', 'freedom_groups'])],
  ];
  return steps.map(([label, set], i) => {
    const prev = i > 0 ? steps[i - 1]![1].size : 0;
    // People can join at a later step (a member who was never recorded as a visitor), so a step can be bigger than the one before.
    return { label, count: set.size, dropOff: i > 0 && prev > 0 && set.size <= prev ? Math.round((1 - set.size / prev) * 1000) / 10 : null };
  });
}

/** Service attendance for each of the `weeks` weeks ending with the week containing `to`. */
export function attendanceTrend(input: Pick<MetricsInput, 'events' | 'marks'>, to: string, count = 12): { week: string; total: number }[] {
  const weeks = weeklyAttendance(input.events, input.marks);
  const last = mondayOf(to);
  return Array.from({ length: count }, (_, i) => addDays(last, -7 * (count - 1 - i))).map((week) => ({ week, total: weeks.get(week)?.total ?? 0 }));
}

interface Watched { key: string; noun: string; plural: boolean; value: (s: Scorecard) => number | null; min: number }

/** The numbers whose changes are worth a sentence. Giving is left to the pastor's own summary. */
const WATCHED: Watched[] = [
  { key: 'attendance', noun: 'Service attendance', plural: false, value: (s) => s.attendance.weeklyAverage, min: 10 },
  { key: 'visitors', noun: 'First-time visitors', plural: true, value: (s) => s.visitors.count, min: 3 },
  { key: 'salvations', noun: 'Salvations', plural: true, value: (s) => s.salvations.count, min: 2 },
  { key: 'baptisms', noun: 'Baptisms', plural: true, value: (s) => s.baptisms.count, min: 2 },
  { key: 'regular', noun: 'Regular attenders', plural: true, value: (s) => s.regularAttenders, min: 5 },
  { key: 'groups', noun: 'Small group participation', plural: false, value: (s) => s.groups.participationRate, min: 5 },
  { key: 'serving', noun: 'The serving rate', plural: false, value: (s) => s.serving.rate, min: 5 },
];

/**
 * The three biggest changes on the previous period, in plain words, for
 * example "First-time visitors are up 20% on last week (12, was 10)".
 * Small numbers that swing a lot are skipped.
 */
export function biggestChanges(type: ReportType, current: Scorecard, previous: Scorecard, limit = 3): string[] {
  const since = type === 'weekly' ? 'last week' : 'last month';
  const changes = WATCHED.flatMap((w) => {
    const now = w.value(current);
    const before = w.value(previous);
    if (now == null || before == null || Math.max(now, before) < w.min || now === before) return [];
    const pct = before === 0 ? 100 : Math.round(((now - before) / before) * 100);
    if (pct === 0) return [];
    const isRate = w.key === 'groups' || w.key === 'serving';
    const show = (v: number) => (isRate ? `${v}%` : String(v));
    const verb = w.plural ? 'are' : 'is';
    const points = Math.round(Math.abs(now - before) * 10) / 10;
    const text = before === 0
      ? `${w.noun} ${verb} up from none ${since} to ${show(now)}.`
      : isRate
        ? `${w.noun} ${verb} ${pct > 0 ? 'up' : 'down'} ${points} points on ${since} (${show(now)}, was ${show(before)}).`
        : `${w.noun} ${verb} ${pct > 0 ? 'up' : 'down'} ${Math.abs(pct)}% on ${since} (${show(now)}, was ${show(before)}).`;
    return [{ size: Math.abs(pct), text }];
  });
  return changes.sort((a, b) => b.size - a.size).slice(0, limit).map((c) => c.text);
}

/** Follow-ups due or overdue, split so salvation and baptism ones stay pastoral. */
export function followUpsDue(followUps: readonly MFollowUp[], now: number): { everyday: DueFollowUp[]; pastoral: DueFollowUp[] } {
  const due = followUps
    .filter((f) => f.status === 'open' && f.dueAt != null && f.dueAt < now + DAY)
    .sort((a, b) => (a.dueAt ?? 0) - (b.dueAt ?? 0))
    .map((f) => ({ personId: f.personId, name: f.personName, reason: f.reason as string, dueAt: f.dueAt!, overdue: f.dueAt! < now, overdueDays: Math.max(0, Math.floor((now - f.dueAt!) / DAY)) }));
  return {
    everyday: due.filter((f) => !SENSITIVE_REASONS.includes(f.reason as FollowUpReason)),
    pastoral: due.filter((f) => SENSITIVE_REASONS.includes(f.reason as FollowUpReason)),
  };
}

export interface DueFollowUp { personId: string; name: string; reason: string; dueAt: number; overdue: boolean; overdueDays: number }
