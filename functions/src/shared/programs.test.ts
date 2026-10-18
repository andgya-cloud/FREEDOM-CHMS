import { describe, expect, it } from 'vitest';
import {
  coverage,
  missedMeetings,
  nextEnrollmentState,
  nextStageStatus,
  programIdFor,
  programSessionIdFor,
  STANDARD_PROGRAMS,
  topicIdFor,
  type Topic,
} from './programs';

const F252 = STANDARD_PROGRAMS.freedom_252!;
const GT = STANDARD_PROGRAMS.growth_track!;

describe('standard programmes', () => {
  it('match the brief: Growth Track has four pillars, Freedom 252 has 24 topics, the Master Class waits for its curriculum', () => {
    expect(GT.topics.map((t) => t.name)).toEqual(['Know God', 'Find Freedom', 'Discover Purpose', 'Make a Difference']);
    expect(F252.topics).toHaveLength(24);
    expect(new Set(F252.topics.map((t) => t.id)).size).toBe(24);
    expect(F252.schedule).toBe('Tuesday 20:00');
    expect(STANDARD_PROGRAMS.communication_master_class!.topics).toEqual([]);
  });
});

describe('topic coverage', () => {
  const session = (id: string, date: string, topicIds: string[], extra: Record<string, unknown> = {}) => ({ id, date, topicIds, ...extra });
  const mark = (eventId: string, status = 'present', extra: Record<string, unknown> = {}) => ({ eventId, status, ...extra });

  it('counts each topic once across cohorts and make-up classes, and only when present or late', () => {
    const sessions = [
      session('a', '2026-11-03', ['topic_01']),
      session('b', '2026-11-10', ['topic_02']),
      session('c', '2026-11-17', ['topic_03']),
      session('makeup', '2026-12-05', ['topic_01', 'topic_04']),
    ];
    const c = coverage(F252.topics, F252.completionRule, sessions, [mark('a'), mark('b', 'late'), mark('c', 'absent'), mark('makeup')]);
    expect(c.count).toBe(3);
    expect(c.covered.get('topic_01')).toBe('2026-11-03');
    expect(c.covered.has('topic_03')).toBe(false);
    expect(c.complete).toBe(false);
  });

  it('ignores deleted classes, taken-back check-ins and topics no longer on the programme', () => {
    const topics: Topic[] = [{ id: 'one', name: 'One' }];
    const sessions = [session('a', '2026-11-03', ['one'], { deletedAt: 'x' }), session('b', '2026-11-04', ['one', 'gone'])];
    expect(coverage(topics, { type: 'all_topics' }, sessions, [mark('a'), mark('b', 'present', { deletedAt: 'x' })]).count).toBe(0);
    expect(coverage(topics, { type: 'all_topics' }, sessions, [mark('b')]).count).toBe(1);
  });

  it('graduates a Freedom 252 student on the day the 24th topic is covered', () => {
    const sessions = F252.topics.map((t, i) => session(`s${i}`, `2027-${String(Math.floor(i / 4) + 1).padStart(2, '0')}-${String((i % 4) * 7 + 1).padStart(2, '0')}`, [t.id]));
    const marks = sessions.map((s) => mark(s.id));
    const almost = coverage(F252.topics, F252.completionRule, sessions, marks.slice(0, 23));
    expect(almost).toMatchObject({ count: 23, total: 24, complete: false, completedDate: null });
    const done = coverage(F252.topics, F252.completionRule, sessions, marks);
    expect(done).toMatchObject({ count: 24, complete: true, completedDate: sessions[23]!.date });
  });

  it('supports "any N topics" and never completes a programme with no topics', () => {
    const topics: Topic[] = [{ id: 'a', name: 'A' }, { id: 'b', name: 'B' }, { id: 'c', name: 'C' }];
    const sessions = [session('x', '2026-11-01', ['a']), session('y', '2026-11-08', ['c'])];
    expect(coverage(topics, { type: 'topic_count', count: 2 }, sessions, [mark('x'), mark('y')])).toMatchObject({ complete: true, completedDate: '2026-11-08' });
    expect(coverage([], { type: 'all_topics' }, sessions, [mark('x')]).complete).toBe(false);
  });
});

describe('enrolment status after recounting', () => {
  const done = { complete: true, completedDate: '2027-04-20' };
  const notDone = { complete: false, completedDate: null };

  it('completes an active enrolment by itself, and undoes only an automatic completion', () => {
    expect(nextEnrollmentState({ status: 'active', completedDate: null, completedAuto: false }, done)).toEqual({ status: 'completed', completedDate: '2027-04-20', completedAuto: true });
    expect(nextEnrollmentState({ status: 'completed', completedDate: '2027-04-20', completedAuto: true }, notDone)).toEqual({ status: 'active', completedDate: null, completedAuto: false });
    const byHand = { status: 'completed' as const, completedDate: '2027-01-01', completedAuto: false };
    expect(nextEnrollmentState(byHand, notDone)).toBe(byHand);
    const dropped = { status: 'dropped' as const, completedDate: null, completedAuto: false };
    expect(nextEnrollmentState(dropped, done)).toBe(dropped);
  });
});

describe('journey stages', () => {
  it('only move forward', () => {
    expect(nextStageStatus(null, 'in_progress')).toBe('in_progress');
    expect(nextStageStatus('completed', 'in_progress')).toBeNull();
    expect(nextStageStatus('in_progress', 'completed')).toBe('completed');
    expect(nextStageStatus('completed', 'dropped')).toBeNull();
    expect(nextStageStatus('in_progress', 'dropped')).toBe('dropped');
    expect(nextStageStatus('completed', 'completed')).toBeNull();
  });
});

describe('ids', () => {
  it('are stable, so two devices starting the same class offline share one record', () => {
    expect(programSessionIdFor('2026-11-03', 'freedom_252', 'nov26')).toBe('2026-11-03_freedom_252_nov26');
    expect(programSessionIdFor('2026-12-05', 'freedom_252', null)).toBe('2026-12-05_freedom_252_makeup');
    expect(programIdFor('Marriage Course', ['growth_track'])).toBe('marriage_course');
    expect(programIdFor('Growth Track', ['growth_track'])).toBe('growth_track_2');
    expect(topicIdFor('Know God', ['know_god'])).toBe('know_god_2');
  });
});

describe('missed group meetings', () => {
  // 2026-10-20 is a Tuesday.
  it('counts passed meeting days with no meeting that week, from the latest back', () => {
    expect(missedMeetings(['2026-10-06'], 'tuesday', '2026-09-01', '2026-10-21')).toEqual({ inARow: 2, lastMissed: '2026-10-20' });
    expect(missedMeetings(['2026-10-06', '2026-10-20'], 'tuesday', '2026-09-01', '2026-10-21').inARow).toBe(0);
  });

  it('accepts a meeting moved to another day of the same week', () => {
    expect(missedMeetings(['2026-10-15', '2026-10-24'], 'tuesday', '2026-09-01', '2026-10-27').inARow).toBe(0);
  });

  it('does not count today before it is over, or weeks before the group started', () => {
    expect(missedMeetings(['2026-10-13'], 'tuesday', '2026-09-01', '2026-10-20').inARow).toBe(0);
    expect(missedMeetings([], 'tuesday', '2026-10-10', '2026-10-21')).toEqual({ inARow: 2, lastMissed: '2026-10-20' });
    expect(missedMeetings([], 'tuesday', '2026-10-19', '2026-10-21').inARow).toBe(1);
  });
});
