import { describe, expect, it } from 'vitest';
import {
  addDays,
  attendanceTrend,
  biggestChanges,
  followUpsDue,
  funnel,
  lastCompletePeriod,
  lastYearPeriod,
  mondayOf,
  periodFor,
  periodLabel,
  previousPeriod,
  scorecard,
  weeklyAttendance,
  type MEvent,
  type MMark,
  type MetricsInput,
  type MPerson,
  type Scorecard,
} from './metrics';

const DAY = 86_400_000;
const at = (key: string, hour = 12) => Date.parse(`${key}T${String(hour).padStart(2, '0')}:00:00Z`);

function input(patch: Partial<MetricsInput> = {}): MetricsInput {
  return {
    regularWeeks: 3, events: [], marks: [], people: [], stages: [], programs: [], cohorts: [], enrollments: [],
    groups: [], groupMembers: [], teamMembers: [], gifts: [], followUps: [], now: at('2026-10-19', 4), ...patch,
  };
}
const person = (id: string, firstVisitDate: string | null = null): MPerson => ({ id, fullName: `Person ${id}`, status: 'member', firstVisitDate });
const service = (id: string, date: string, headcounts: MEvent['headcounts'] = null): MEvent => ({ id, date, type: 'service', headcounts });
const present = (personId: string, e: MEvent): MMark => ({ personId, eventId: e.id, date: e.date, status: 'present' });

/** Sunday services for each of `weeks` weeks ending on `lastSunday`, with these people present. */
function sundays(lastSunday: string, weeks: number, who: Record<string, number[]>) {
  const events: MEvent[] = [];
  const marks: MMark[] = [];
  for (let i = 0; i < weeks; i++) {
    const e = service(`s${i}`, addDays(lastSunday, -7 * (weeks - 1 - i)));
    events.push(e);
    for (const [id, attendedWeeks] of Object.entries(who)) if (attendedWeeks.includes(i)) marks.push(present(id, e));
  }
  return { events, marks };
}

const WEEK = periodFor('weekly', '2026-10-12'); // Mon 12 Oct to Sun 18 Oct 2026

describe('report periods', () => {
  it('runs weeks Monday to Sunday', () => {
    expect(mondayOf('2026-10-18')).toBe('2026-10-12'); // a Sunday
    expect(mondayOf('2026-10-12')).toBe('2026-10-12');
    expect(periodFor('weekly', '2026-10-15')).toEqual({ from: '2026-10-12', to: '2026-10-18' });
  });

  it('covers whole calendar months, leap years included', () => {
    expect(periodFor('monthly', '2026-10-17')).toEqual({ from: '2026-10-01', to: '2026-10-31' });
    expect(periodFor('monthly', '2028-02-10')).toEqual({ from: '2028-02-01', to: '2028-02-29' });
    expect(periodFor('monthly', '2026-12-05')).toEqual({ from: '2026-12-01', to: '2026-12-31' });
  });

  it('reports on the last complete week on a Monday, and the last month on the 1st', () => {
    expect(lastCompletePeriod('weekly', '2026-10-19')).toEqual(WEEK);
    expect(lastCompletePeriod('monthly', '2026-11-01')).toEqual({ from: '2026-10-01', to: '2026-10-31' });
    expect(lastCompletePeriod('monthly', '2027-01-01')).toEqual({ from: '2026-12-01', to: '2026-12-31' });
  });

  it('compares with last week and the same week a year ago', () => {
    expect(previousPeriod('weekly', WEEK)).toEqual({ from: '2026-10-05', to: '2026-10-11' });
    const lastYear = lastYearPeriod('weekly', WEEK);
    expect(lastYear).toEqual({ from: '2025-10-13', to: '2025-10-19' });
    expect(mondayOf(lastYear.from)).toBe(lastYear.from);
    expect(lastYearPeriod('monthly', { from: '2026-10-01', to: '2026-10-31' })).toEqual({ from: '2025-10-01', to: '2025-10-31' });
    expect(previousPeriod('monthly', { from: '2026-01-01', to: '2026-01-31' })).toEqual({ from: '2025-12-01', to: '2025-12-31' });
  });

  it('labels periods in plain words', () => {
    expect(periodLabel('weekly', WEEK)).toBe('Week of 12/10/2026 to 18/10/2026');
    expect(periodLabel('monthly', { from: '2026-10-01', to: '2026-10-31' })).toBe('October 2026');
  });
});

describe('attendance', () => {
  it('uses the headcount, or the people checked in when nobody counted', () => {
    const counted = service('a', '2026-10-18', { adults: 120, teens: 20, children: 40 });
    const uncounted = service('b', '2026-10-15');
    const marks = [present('p1', uncounted), present('p2', uncounted), { ...present('p3', uncounted), status: 'absent' }];
    const w = weeklyAttendance([counted, uncounted], marks).get('2026-10-12');
    expect(w).toEqual({ week: '2026-10-12', total: 182, adults: 120, teens: 20, children: 40 });
  });

  it('leaves classes and group meetings out of service attendance', () => {
    const cls: MEvent = { id: 'c', date: '2026-10-13', type: 'service', programId: 'gt', headcounts: { adults: 30 } };
    const grp: MEvent = { id: 'g', date: '2026-10-14', type: 'group', groupId: 'g1', headcounts: { adults: 12 } };
    expect(weeklyAttendance([cls, grp], []).size).toBe(0);
  });

  it('gives the week, its average, the 4-week average and the year so far', () => {
    const events = [
      service('a', '2026-09-27', { adults: 100 }),
      service('b', '2026-10-04', { adults: 110 }),
      service('c', '2026-10-11', { adults: 120 }),
      service('d', '2026-10-18', { adults: 130, children: 20 }),
      service('e', '2025-12-28', { adults: 999 }), // last year
    ];
    const s = scorecard(input({ events }), WEEK);
    expect(s.attendance).toMatchObject({ total: 150, adults: 130, children: 20, weeks: 1, weeklyAverage: 150 });
    expect(s.averageAttendance.fourWeeks).toBe(120);
    expect(s.averageAttendance.yearToDate).toBe(120);
    const month = scorecard(input({ events }), periodFor('monthly', '2026-10-01'));
    expect(month.attendance.total).toBe(380);
    expect(month.attendance.weeklyAverage).toBe(126.7);
  });

  it('gives a 12-week trend with empty weeks as zero', () => {
    const trend = attendanceTrend({ events: [service('a', '2026-10-18', { adults: 50 })], marks: [] }, '2026-10-18');
    expect(trend).toHaveLength(12);
    expect(trend[11]).toEqual({ week: '2026-10-12', total: 50 });
    expect(trend[0]).toEqual({ week: '2026-07-27', total: 0 });
  });
});

describe('visitors', () => {
  it('counts first-time visitors in the period', () => {
    const people = [person('a', '2026-10-18'), person('b', '2026-10-12'), person('c', '2026-10-11')];
    expect(scorecard(input({ people }), WEEK).visitors).toEqual({ count: 2, ids: ['a', 'b'] });
  });

  it('works out the return rate within 4 weeks for visitors who have had the full 4 weeks', () => {
    // Cohort: first visits 55 to 28 days before the period end (24 Aug to 20 Sep).
    const v1 = person('v1', '2026-09-06');
    const v2 = person('v2', '2026-09-13');
    const v3 = person('v3', '2026-10-04'); // too recent to judge
    const first = service('s1', '2026-09-06');
    const back = service('s2', '2026-09-27');
    const late = service('s3', '2026-10-18');
    const s = scorecard(input({
      people: [v1, v2, v3],
      events: [first, back, late],
      marks: [present('v1', first), present('v1', back), present('v2', late), present('v3', late)],
    }), WEEK);
    expect(s.returnRate).toMatchObject({ cohort: 2, returned: 1, rate: 50, from: '2026-08-24', to: '2026-09-20' });
  });

  it('measures contact within 48 hours, leaving out visitors still inside the 48 hours', () => {
    const people = [person('fast', '2026-10-12'), person('slow', '2026-10-12'), person('none', '2026-10-13'), person('new', '2026-10-18')];
    const task = (personId: string, createdAt: number, doneAt: number | null) => ({ personId, personName: personId, reason: 'first_visit', status: doneAt ? 'done' : 'open', dueAt: createdAt, createdAt, doneAt, lastMessageAt: null });
    const followUps = [
      task('fast', at('2026-10-12', 10), at('2026-10-12', 18)),
      task('slow', at('2026-10-12', 10), at('2026-10-15', 10)),
      task('none', at('2026-10-13', 10), null),
      task('new', at('2026-10-18', 10), null), // made 18 hours before the report
    ];
    expect(scorecard(input({ people, followUps }), WEEK).followUpSpeed).toEqual({ visitors: 3, within48h: 1, rate: 33.3 });
  });
});

describe('salvations and baptisms', () => {
  it('counts each in the period and the share of the year\'s salvations baptised', () => {
    const people = ['a', 'b', 'c', 'd'].map((id) => person(id));
    const stages = [
      { personId: 'a', stageId: 'salvation', status: 'completed', date: '2026-10-18' },
      { personId: 'b', stageId: 'salvation', status: 'completed', date: '2026-06-01' },
      { personId: 'c', stageId: 'salvation', status: 'completed', date: '2025-01-01' }, // over a year ago
      { personId: 'd', stageId: 'salvation', status: 'in_progress', date: '2026-10-14' },
      { personId: 'b', stageId: 'baptism', status: 'completed', date: '2026-10-13' },
      { personId: 'gone', stageId: 'salvation', status: 'completed', date: '2026-10-14' }, // removed person
    ];
    const s = scorecard(input({ people, stages }), WEEK);
    expect(s.salvations).toEqual({ count: 1, ids: ['a'] });
    expect(s.baptisms).toEqual({ count: 1, ids: ['b'] });
    expect(s.salvationToBaptism).toEqual({ salvations: 2, baptised: 1, rate: 50 });
  });
});

describe('regular attenders, drop-off and growth', () => {
  // Eight Sundays, 30 Aug to 18 Oct 2026 (index 7 is the report week).
  const { events, marks } = sundays('2026-10-18', 8, {
    steady: [0, 1, 2, 3, 4, 5, 6, 7],
    three: [5, 6, 7], // just became regular this week
    twice: [6, 7],
    stopped: [0, 1, 2, 3], // last came 20 Sep, 28 days before the period end
  });
  const people = ['steady', 'three', 'twice', 'stopped'].map((id) => person(id));

  it('counts people at 3 or more of the last 8 weeks', () => {
    // 'stopped' still has 4 of the last 8 weeks, so counts, and also shows in drop-off.
    const s = scorecard(input({ people, events, marks }), WEEK);
    expect(s.regularAttenders).toBe(3);
    expect(scorecard(input({ people, events, marks, regularWeeks: 2 }), WEEK).regularAttenders).toBe(4);
    expect(scorecard(input({ people, events, marks, regularWeeks: 5 }), WEEK).regularAttenders).toBe(1);
  });

  it('flags regulars away for 4 weeks or more', () => {
    const s = scorecard(input({ people, events, marks }), WEEK);
    expect(s.dropOff).toEqual([{ personId: 'stopped', name: 'Person stopped', lastDate: '2026-09-20' }]);
  });

  it('gives net growth in regular attenders over the period', () => {
    // Before the week: steady and stopped. After: steady, stopped and three.
    expect(scorecard(input({ people, events, marks }), WEEK).netGrowth).toEqual({ gained: 1, lost: 0, net: 1 });
    // At 4 weeks out of 8, the next week's window loses 'stopped's 30 Aug visit, leaving 3.
    const next = periodFor('weekly', '2026-10-19');
    expect(scorecard(input({ people, events, marks, regularWeeks: 4 }), next).netGrowth).toEqual({ gained: 0, lost: 1, net: -1 });
  });
});

describe('programmes, groups and serving', () => {
  const { events, marks } = sundays('2026-10-18', 4, { a: [0, 1, 2, 3], b: [0, 1, 2, 3], c: [1, 2, 3], d: [0, 2, 3] });
  const people = ['a', 'b', 'c', 'd', 'e'].map((id) => person(id));

  it('gives enrolled, completed and completion rate per cohort, with Freedom 252 topics', () => {
    const s = scorecard(input({
      people,
      programs: [{ id: 'f252', name: 'Freedom 252', topicCount: 24, topicsNeeded: 20, active: true }, { id: 'old', name: 'Old', topicCount: 0, topicsNeeded: 0, active: false }],
      cohorts: [{ id: 'k1', programId: 'f252', name: 'Jan 2026' }, { id: 'k2', programId: 'f252', name: 'Jul 2026' }],
      enrollments: [
        { programId: 'f252', personId: 'a', cohortId: 'k1', status: 'completed', completedDate: '2026-10-14', topicsCovered: 24 },
        { programId: 'f252', personId: 'b', cohortId: 'k1', status: 'dropped', topicsCovered: 3 },
        { programId: 'f252', personId: 'c', cohortId: 'k2', status: 'enrolled', topicsCovered: 10 },
        { programId: 'f252', personId: 'd', cohortId: 'k2', status: 'completed', completedDate: '2026-08-01', topicsCovered: 20 },
      ],
    }), WEEK);
    expect(s.programs).toHaveLength(1);
    expect(s.programs[0]).toMatchObject({ name: 'Freedom 252', enrolled: 4, completed: 2, completedInPeriod: 1, completionRate: 50, averageTopics: 18, topicCount: 24 });
    expect(s.programs[0]!.cohorts).toEqual([
      { cohortId: 'k1', name: 'Jan 2026', enrolled: 2, completed: 1, completionRate: 50 },
      { cohortId: 'k2', name: 'Jul 2026', enrolled: 2, completed: 1, completionRate: 50 },
    ]);
  });

  it('gives small group participation among regulars and flags groups that missed 2 meetings', () => {
    const meeting: MEvent = { id: 'm1', date: '2026-10-13', type: 'group', groupId: 'g1' };
    const s = scorecard(input({
      people,
      events: [...events, meeting, { id: 'm0', date: '2026-09-22', type: 'group', groupId: 'g2' }],
      marks: [...marks, { personId: 'a', eventId: 'm1', date: '2026-10-13', status: 'present', groupId: 'g1' }, { personId: 'c', eventId: 'm1', date: '2026-10-13', status: 'late', groupId: 'g1' }],
      groups: [
        { id: 'g1', name: 'Kilimani Tuesday', meetingDay: 'tuesday', startDate: '2026-09-01', active: true },
        { id: 'g2', name: 'Westlands Tuesday', meetingDay: 'tuesday', startDate: '2026-09-01', active: true },
      ],
      groupMembers: [
        { groupId: 'g1', personId: 'a', status: 'active' },
        { groupId: 'g1', personId: 'c', status: 'active' },
        { groupId: 'g2', personId: 'e', status: 'active' }, // not a regular attender
        { groupId: 'g2', personId: 'b', status: 'left' },
      ],
    }), WEEK);
    expect(s.regularAttenders).toBe(4);
    expect(s.groups).toMatchObject({ count: 2, averageSize: 1.5, averageMeetingAttendance: 2, participants: 2, participationRate: 50 });
    expect(s.groups.missedTwo).toEqual([{ groupId: 'g2', name: 'Westlands Tuesday', inARow: 3 }]);
  });

  it('gives the serving rate and who is still serving after 90 days', () => {
    const s = scorecard(input({
      people,
      events, marks,
      teamMembers: [
        { personId: 'a', status: 'active', startDate: '2026-01-01' },
        { personId: 'b', status: 'ended', startDate: '2026-01-01', endDate: '2026-02-01' },
        { personId: 'c', status: 'ended', startDate: '2026-01-01', endDate: '2026-06-01' },
        { personId: 'd', status: 'active', startDate: '2026-10-01' }, // too new to count
      ],
    }), WEEK);
    expect(s.serving).toEqual({ members: 2, rate: 50, retention: { eligible: 3, stayed: 2, rate: 66.7 } });
  });
});

describe('giving', () => {
  const gift = (personId: string | null, date: string, amountCents: number, fundId = 'tithe') => ({ personId, date, amountCents, fundId });

  it('totals by fund with givers, first-time givers, lapsed givers and averages', () => {
    const s = scorecard(input({
      events: [service('a', '2026-10-18', { adults: 100 })],
      gifts: [
        gift('a', '2026-10-18', 200_000),
        gift('a', '2026-10-13', 100_000, 'building'),
        gift('b', '2026-10-14', 50_000), // first ever gift
        gift(null, '2026-10-18', 50_000, 'offering'), // anonymous
        gift('a', '2026-03-01', 100_000),
        gift('c', '2026-05-01', 100_000), // last gave over 90 days ago: lapsed
        gift('d', '2025-01-01', 100_000), // over 15 months ago: no longer counted as lapsed
        gift('e', '2026-08-01', 100_000), // gave within 90 days: not lapsed
      ],
    }), WEEK);
    expect(s.giving).toEqual({
      totalCents: 400_000,
      byFund: { tithe: 250_000, building: 100_000, offering: 50_000 },
      gifts: 4,
      givers: 2,
      firstTimeGivers: 1,
      lapsedGivers: 1,
      averageGiftCents: 100_000,
      perAttendeeCents: 4_000,
    });
  });
});

describe('follow-ups', () => {
  const now = at('2026-10-19', 4);
  const f = (personId: string, reason: string, dueAt: number, status = 'open') => ({ personId, personName: personId, reason, status, dueAt, createdAt: null, doneAt: null, lastMessageAt: null });

  it('counts overdue follow-ups and splits salvation ones out as pastoral', () => {
    const followUps = [
      f('a', 'first_visit', now - 3 * DAY),
      f('b', 'salvation', now - DAY),
      f('c', 'care_absent', now + 2 * DAY), // not due yet
      f('d', 'checkin_48h', now - DAY, 'done'),
    ];
    expect(scorecard(input({ followUps, now }), WEEK).overdueFollowUps).toBe(2);
    const due = followUpsDue(followUps, now);
    expect(due.everyday.map((x) => [x.personId, x.overdue, x.overdueDays])).toEqual([['a', true, 3]]);
    expect(due.pastoral.map((x) => x.personId)).toEqual(['b']);
  });
});

describe('the journey funnel', () => {
  it('counts each step and the drop-off from the one before', () => {
    const people = ['a', 'b', 'c', 'd'].map((id) => person(id));
    const done = (personId: string, stageId: string) => ({ personId, stageId, status: 'completed' });
    const steps = funnel({
      people,
      stages: [
        done('a', 'visitor'), done('b', 'visitor'), done('c', 'visitor'), done('d', 'visitor'),
        done('a', 'salvation'), done('b', 'salvation'),
        done('a', 'baptism'),
        done('a', 'growth_track'),
        done('a', 'dream_team'), done('a', 'freedom_groups'), // counted once
        { personId: 'c', stageId: 'salvation', status: 'in_progress' },
      ],
    });
    expect(steps).toEqual([
      { label: 'Visitor', count: 4, dropOff: null },
      { label: 'Salvation', count: 2, dropOff: 50 },
      { label: 'Baptism', count: 1, dropOff: 50 },
      { label: 'Growth Track', count: 1, dropOff: 0 },
      { label: 'Dream Team or Group', count: 1, dropOff: 0 },
    ]);
    // A step with more people than the one before has no drop-off.
    const bigger = funnel({ people, stages: [done('a', 'growth_track'), done('a', 'dream_team'), done('b', 'freedom_groups')] });
    expect(bigger[4]).toEqual({ label: 'Dream Team or Group', count: 2, dropOff: null });
  });
});

describe('the three biggest changes', () => {
  const card = (patch: { avg?: number; visitors?: number; salvations?: number; regular?: number; serving?: number | null }): Scorecard => {
    const s = scorecard(input(), WEEK);
    return {
      ...s,
      attendance: { ...s.attendance, weeklyAverage: patch.avg ?? 100 },
      visitors: { count: patch.visitors ?? 10, ids: [] },
      salvations: { count: patch.salvations ?? 0, ids: [] },
      regularAttenders: patch.regular ?? 80,
      serving: { ...s.serving, rate: patch.serving ?? null },
    };
  };

  it('describes the largest changes first, in plain words', () => {
    const changes = biggestChanges('weekly', card({ avg: 110, visitors: 15, regular: 76, serving: 30 }), card({ serving: 20 }));
    expect(changes).toEqual([
      'First-time visitors are up 50% on last week (15, was 10).',
      'The serving rate is up 10 points on last week (30%, was 20%).',
      'Service attendance is up 10% on last week (110, was 100).',
    ]);
  });

  it('skips small numbers and things that did not change', () => {
    expect(biggestChanges('monthly', card({ salvations: 1 }), card({ salvations: 0 }))).toEqual([]);
    expect(biggestChanges('monthly', card({ salvations: 4 }), card({ salvations: 0 }))).toEqual(['Salvations are up from none last month to 4.']);
  });
});
