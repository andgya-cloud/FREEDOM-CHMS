import { describe, expect, it } from 'vitest';
import {
  absencesDue, absenceTaskId, programmeOfTask, CAME_BACK, ageOn, buildHopeReport, childCode, consentMissing, hopeMetrics, missedInARow, monthsBefore, normalizeCode, programmeOf,
  NO_CONSENT, type Child, type HopeInput, type SessionEvent, type SessionRecord,
} from './hope.js';

const PROGRAMMES = ['Saturday meals', 'Football academy', 'Chess club', 'Music academy'];
const yes = { given: true, date: '2026-01-05' };

const child = (id: string, over: Partial<Child> = {}): Child => ({
  id, code: childCode(Number(id.replace(/\D/g, '')) || 1), status: 'active', enrolledOn: '2026-01-01', schoolStatus: 'unknown',
  programmes: [{ name: 'Football academy', group: 'U12', level: '' }], photoConsent: yes, guardianConsent: yes, ...over,
});
const ev = (id: string, date: string, name = 'Football academy training', extra: Partial<SessionEvent> = {}): SessionEvent => ({ id, date, name, type: 'session', ...extra });
const rec = (personId: string, eventId: string, status = 'present'): SessionRecord => ({ personId, eventId, status });

describe('codes', () => {
  it('pads the number', () => expect(childCode(42)).toBe('HC-0042'));
  it('reads typed or scanned codes in any form', () => {
    expect(normalizeCode('hc 42')).toBe('HC-0042');
    expect(normalizeCode(' HC-0042 ')).toBe('HC-0042');
    expect(normalizeCode('hc7')).toBe('HC-0007');
    expect(normalizeCode('Mary')).toBeNull();
  });
});

describe('consent', () => {
  it('flags an active child with either consent missing', () => {
    expect(consentMissing(child('c1', { photoConsent: NO_CONSENT }))).toBe(true);
    expect(consentMissing(child('c1', { guardianConsent: NO_CONSENT }))).toBe(true);
    expect(consentMissing(child('c1'))).toBe(false);
  });
  it('a recorded "no" counts as on file', () => expect(consentMissing(child('c1', { photoConsent: { given: false, date: '2026-02-01' } }))).toBe(false));
  it('ignores exited and removed children', () => {
    expect(consentMissing(child('c1', { status: 'exited', photoConsent: NO_CONSENT }))).toBe(false);
    expect(consentMissing(child('c1', { deletedAt: 1, photoConsent: NO_CONSENT }))).toBe(false);
  });
});

describe('programmeOf', () => {
  it('matches by name or prefix, longest first', () => {
    expect(programmeOf({ name: 'Football academy match' }, PROGRAMMES)).toBe('Football academy');
    expect(programmeOf({ name: 'Anything', activity: 'Chess club' }, PROGRAMMES)).toBe('Chess club');
    expect(programmeOf({ name: 'Sunday service' }, PROGRAMMES)).toBeNull();
    expect(programmeOf({ name: 'Football academy x' }, ['Football', 'Football academy'])).toBe('Football academy');
  });
});

const week = ['2026-03-07', '2026-03-14', '2026-03-21', '2026-03-28'];
const events = week.map((d, i) => ev(`e${i}`, d));

describe('missedInARow', () => {
  it('counts the run of latest sessions missed and when it began', () => {
    const records = [rec('c1', 'e0'), rec('c2', 'e0'), rec('c2', 'e1'), rec('c2', 'e2'), rec('c2', 'e3'), rec('c3', 'e1'), rec('c3', 'e2'), rec('c3', 'e3')];
    expect(missedInARow('c1', 'Football academy', PROGRAMMES, events, records, '2026-01-01', '2026-04-01')).toEqual({ missed: 3, since: '2026-03-14' });
  });
  it('stops at the last time the child came', () => {
    const records = [rec('c1', 'e2'), rec('c2', 'e0'), rec('c2', 'e3')];
    expect(missedInARow('c1', 'Football academy', PROGRAMMES, events, records, '2026-01-01', '2026-04-01').missed).toBe(1);
  });
  it('ignores sessions nobody marked and sessions before enrolment', () => {
    const records = [rec('c2', 'e0'), rec('c2', 'e1')];
    expect(missedInARow('c1', 'Football academy', PROGRAMMES, events, records, '2026-03-10', '2026-04-01')).toEqual({ missed: 1, since: '2026-03-14' });
  });
  it('treats excused as missed', () => {
    const records = [rec('c1', 'e1', 'excused'), rec('c1', 'e2', 'absent'), rec('c1', 'e3', 'absent'), rec('c2', 'e0')];
    expect(missedInARow('c1', 'Football academy', PROGRAMMES, events, records, '2026-01-01', '2026-04-01').missed).toBe(4);
  });
});

describe('absencesDue', () => {
  const records = [rec('c2', 'e0'), rec('c2', 'e1'), rec('c2', 'e2'), rec('c2', 'e3')];
  it('lists children who missed three in a row, with a stable task id', () => {
    const due = absencesDue([child('c1'), child('c2')], PROGRAMMES, events, records, '2026-04-01');
    expect(due).toHaveLength(1);
    expect(due[0]).toMatchObject({ childId: 'c1', programme: 'Football academy', since: '2026-03-07', missed: 4 });
    expect(due[0]!.taskId).toBe(absenceTaskId('c1', 'Football academy', '2026-03-07'));
    expect(due[0]!.taskId).toBe('c1_absent_football_academy_2026-03-07');
  });
  it('never chases a missed Saturday meal, an exited child or one with only two misses', () => {
    const meals = child('c1', { programmes: [{ name: 'Saturday meals', group: '', level: '' }] });
    expect(absencesDue([meals, child('c3', { status: 'exited' })], PROGRAMMES, events, records, '2026-04-01')).toEqual([]);
    expect(absencesDue([child('c1')], PROGRAMMES, events.slice(2), [rec('c2', 'e2'), rec('c2', 'e3')], '2026-04-01')).toEqual([]);
  });
});

describe('absence task ids', () => {
  it('give back the programme', () => expect(programmeOfTask('c1_absent_chess_club_2026-03-07', 'c1', PROGRAMMES)).toBe('Chess club'));
  it('say nothing for other tasks', () => expect(programmeOfTask('c1_48h', 'c1', PROGRAMMES)).toBeNull());
  it('a task closed because the child came back is not a guardian contact', () => {
    const m = hopeMetrics({ children: [], programmes: PROGRAMMES, events: [], records: [], today: '2026-04-01', absenceTasks: [{ status: 'done', outcome: 'Reached' }, { status: 'done', outcome: CAME_BACK }] }, { from: '2026-03-01', to: '2026-03-31' });
    expect(m.guardianContactRate).toBe(100);
  });
});

describe('ageOn', () => {
  it('counts whole years', () => {
    expect(ageOn('2015-06-15', '2026-06-14')).toBe(10);
    expect(ageOn('2015-06-15', '2026-06-15')).toBe(11);
    expect(ageOn(null, '2026-06-15')).toBeNull();
  });
});

describe('monthsBefore', () => {
  it('steps back and clamps the day', () => {
    expect(monthsBefore('2026-08-31', 6)).toBe('2026-02-28');
    expect(monthsBefore('2026-03-15', 6)).toBe('2025-09-15');
  });
});

describe('hopeMetrics', () => {
  const kids = [
    child('c1', { schoolStatus: 'in_school', programmes: [{ name: 'Football academy', group: 'U12', level: '' }, { name: 'Chess club', group: '', level: 'Beginner' }] }),
    child('c2', { schoolStatus: 'not_in_school', enrolledOn: '2025-12-01' }),
    child('c3', { status: 'exited', exitedOn: '2026-02-01', enrolledOn: '2025-12-01' }),
    child('c4', { enrolledOn: '2026-03-20', photoConsent: NO_CONSENT, programmes: [{ name: 'Saturday meals', group: '', level: '' }] }),
  ];
  const evs = [...events, ev('m1', '2026-03-28', 'Saturday meals', { type: 'meal', headcounts: { new: 6, returning: 24 } })];
  const records = [rec('c1', 'e0'), rec('c1', 'e1'), rec('c1', 'e2'), rec('c1', 'e3'), rec('c2', 'e0'), rec('c2', 'e1')];
  const input: HopeInput = {
    children: kids, programmes: PROGRAMMES, events: evs, records, today: '2026-04-01',
    absenceTasks: [{ status: 'done', outcome: 'Reached' }, { status: 'done', outcome: 'No answer' }, { status: 'open', outcome: null }],
  };
  const m = hopeMetrics(input, { from: '2026-03-01', to: '2026-03-31' });

  it('counts children', () => {
    expect(m.registered).toBe(4);
    expect(m.active).toBe(3);
    expect(m.attendingLast8Weeks).toBe(2);
    expect(m.newlyRegistered).toBe(1);
    expect(m.consentMissing).toBe(1);
  });
  it('meals in headcount mode', () => expect(m.meals).toEqual({ total: 30, sessions: 1, averagePerSession: 30, newChildren: 6, returningChildren: 24 }));
  it('programme attendance', () => {
    const f = m.byProgramme.find((p) => p.name === 'Football academy')!;
    expect(f).toMatchObject({ sessions: 4, children: 2 });
    expect(f.averageAttendance).toBe(1.5);
  });
  it('consistency counts those at 75% or more', () => expect(m.consistencyRate).toBe(50)); // c1 4/4 yes, c2 2/4 no
  it('retention looks at children enrolled 6+ months ago', () => expect(m.retentionRate).toBe(null));
  it('reach', () => { expect(m.reachOne).toBe(2); expect(m.reachTwoPlus).toBe(1); });
  it('school enrolment ignores unknown', () => expect(m.schoolEnrolmentRate).toBe(50));
  it('guardian contact rate', () => { expect(m.guardianContactRate).toBe(50); expect(m.openAbsenceFollowUps).toBe(1); });
  it('retention with older children', () => {
    const old = [child('o1', { enrolledOn: '2025-06-01' }), child('o2', { enrolledOn: '2025-06-01', status: 'exited', exitedOn: '2025-08-01' }), child('o3', { enrolledOn: '2025-06-01', status: 'exited', exitedOn: '2026-01-01' })];
    expect(hopeMetrics({ ...input, children: old }, { from: '2026-03-01', to: '2026-03-31' }).retentionRate).toBe(67);
  });
});

describe('reports', () => {
  const kid = child('c1', { code: 'HC-0001' });
  const input: HopeInput = { children: [kid], programmes: PROGRAMMES, events, records: [], today: '2026-04-01', absenceTasks: [] };
  const period = { from: '2026-03-01', to: '2026-03-31' };
  it('the monthly report holds no names or codes', () => {
    const json = JSON.stringify(buildHopeReport(input, 'monthly', period, 'March 2026', [{ childId: 'c1', programme: 'Football academy', since: '2026-03-07' }], { c1: { code: 'HC-0001', name: 'Mary Wanjiku' } }));
    expect(json).not.toContain('Mary');
    expect(json).not.toContain('HC-0001');
    expect(JSON.parse(json).audience).toBe('counts');
  });
  it('the weekly report lists open follow-ups by code and name', () => {
    const r = buildHopeReport(input, 'weekly', period, 'Week', [{ childId: 'c1', programme: 'Football academy', since: '2026-03-07' }], { c1: { code: 'HC-0001', name: 'Mary Wanjiku' } });
    expect(r.audience).toBe('pastor');
    expect(r.followUps).toEqual([{ code: 'HC-0001', name: 'Mary Wanjiku', programme: 'Football academy', since: '2026-03-07' }]);
  });
});
