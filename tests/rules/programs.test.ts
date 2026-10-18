import { afterAll, beforeAll, beforeEach, describe, it } from 'vitest';
import { assertFails, assertSucceeds, type RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { deleteDoc, doc, getDoc, serverTimestamp, setDoc, Timestamp, updateDoc } from 'firebase/firestore';
import { created, makeEnv, seed } from './helpers';

let env: RulesTestEnvironment;
const as = (uid: string) => env.authenticatedContext(uid).firestore();
const old = Timestamp.fromDate(new Date('2026-01-01T00:00:00Z'));
const stamps = { deletedAt: null, deletedBy: null, createdAt: old, createdBy: 'pastor', updatedAt: old, updatedBy: 'pastor' };

const program = (uid: string, overrides: Record<string, unknown> = {}) => ({
  orgId: 'fcn', name: 'Freedom 252', description: '', topics: [{ id: 'topic_01', name: 'Topic 1' }],
  completionRule: { type: 'all_topics' }, pipelineStageId: 'freedom_252', completedLabel: 'Graduated',
  schedule: 'Tuesday 20:00', active: true, ...created(uid), ...overrides,
});
const cohort = (uid: string, overrides: Record<string, unknown> = {}) => ({
  orgId: 'fcn', programId: 'freedom_252', name: 'November 2026', startDate: '2026-11-03', endDate: null,
  schedule: 'Tuesday 20:00', active: true, ...created(uid), ...overrides,
});
const enrollment = (uid: string, overrides: Record<string, unknown> = {}) => ({
  orgId: 'fcn', programId: 'freedom_252', personId: 'p1', cohortId: 'nov2026', status: 'active',
  enrolledDate: '2026-11-03', completedDate: null, completedAuto: false, topicsCovered: [], notes: '',
  ...created(uid), ...overrides,
});
const CLASS = 'organizations/fcn/events/2026-11-03_freedom_252_nov2026';
const session = (uid: string, overrides: Record<string, unknown> = {}) => ({
  orgId: 'fcn', date: '2026-11-03', type: 'class', name: 'Freedom 252 · November 2026', activity: 'Freedom 252',
  headcounts: {}, notes: '', programId: 'freedom_252', cohortId: 'nov2026', topicIds: ['topic_01'],
  mentor: 'Pastor Andy', mentorId: null, ...created(uid), ...overrides,
});
const mark = (uid: string, overrides: Record<string, unknown> = {}) => ({
  orgId: 'fcn', eventId: '2026-11-03_freedom_252_nov2026', personId: 'p1', date: '2026-11-03', status: 'present',
  method: 'register', checkedInAt: Timestamp.now(), programId: 'freedom_252', ...created(uid), ...overrides,
});
const group = (uid: string, overrides: Record<string, unknown> = {}) => ({
  orgId: 'fcn', name: 'Kilimani group', leaderId: 'p1', leaderName: 'Grace Wanjiku', meetingDay: 'wednesday',
  meetingTime: '19:00', place: 'Kilimani', startDate: '2026-10-01', active: true, ...created(uid), ...overrides,
});

beforeAll(async () => { env = await makeEnv(); });
afterAll(async () => { await env.cleanup(); });
beforeEach(async () => {
  await env.clearFirestore();
  await seed(env);
  await env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    await setDoc(doc(db, 'organizations/fcn/programs/freedom_252'), { ...program('pastor'), ...stamps });
    await setDoc(doc(db, 'organizations/fcn/cohorts/nov2026'), { ...cohort('pastor'), ...stamps });
    await setDoc(doc(db, 'organizations/fcn/groups/kilimani1'), { ...group('pastor'), ...stamps });
    await setDoc(doc(db, 'organizations/fcn/teams/ushers'), { orgId: 'fcn', name: 'Ushers', leaderId: null, leaderName: '', active: true, ...stamps });
  });
});

describe('programmes', () => {
  it('lets only staff with settings access define a programme and its topics', async () => {
    const ref = (db: ReturnType<typeof as>) => doc(db, 'organizations/fcn/programs/growth_track');
    await assertFails(setDoc(ref(as('admin')), program('admin', { name: 'Growth Track' })));
    await assertSucceeds(setDoc(ref(as('settingsAdmin')), program('settingsAdmin', { name: 'Growth Track' })));
    await assertSucceeds(getDoc(ref(as('admin'))));
  });

  it('rejects an unreadable programme id, a bad completion rule, or another organization', async () => {
    await assertFails(setDoc(doc(as('pastor'), 'organizations/fcn/programs/Growth Track'), program('pastor')));
    await assertFails(setDoc(doc(as('pastor'), 'organizations/fcn/programs/gt'), program('pastor', { completionRule: { type: 'vibes' } })));
    await assertFails(setDoc(doc(as('pastor'), 'organizations/fcn/programs/gt'), program('pastor', { completionRule: { type: 'topic_count', count: 0 } })));
    await assertFails(setDoc(doc(as('settingsAdmin'), 'organizations/adia/programs/gt'), program('settingsAdmin', { orgId: 'adia' })));
  });

  it('lets an admin add a cohort and enrol a real person, once per programme', async () => {
    await assertSucceeds(setDoc(doc(as('admin'), 'organizations/fcn/cohorts/feb2027'), cohort('admin', { name: 'February 2027', startDate: '2027-02-02' })));
    await assertSucceeds(setDoc(doc(as('admin'), 'organizations/fcn/enrollments/freedom_252_p1'), enrollment('admin')));
    await assertFails(setDoc(doc(as('admin'), 'organizations/fcn/enrollments/someid'), enrollment('admin')));
    await assertFails(setDoc(doc(as('admin'), 'organizations/fcn/enrollments/freedom_252_ghost'), enrollment('admin', { personId: 'ghost' })));
    await assertFails(setDoc(doc(as('admin'), 'organizations/fcn/enrollments/nothing_p1'), enrollment('admin', { programId: 'nothing' })));
    await assertFails(setDoc(doc(as('admin'), 'organizations/fcn/enrollments/freedom_252_p1'), enrollment('admin', { status: 'graduated' })));
  });

  it('never allows a hard delete of programme data', async () => {
    await assertFails(deleteDoc(doc(as('pastor'), 'organizations/fcn/programs/freedom_252')));
    await assertFails(deleteDoc(doc(as('pastor'), 'organizations/fcn/cohorts/nov2026')));
  });
});

describe('programme classes and attendance', () => {
  it('lets an admin start a class whose id names its programme and cohort', async () => {
    await assertSucceeds(setDoc(doc(as('admin'), CLASS), session('admin')));
    await assertSucceeds(setDoc(doc(as('admin'), 'organizations/fcn/events/2026-12-05_freedom_252_makeup'), session('admin', { date: '2026-12-05', cohortId: null })));
    await assertFails(setDoc(doc(as('admin'), 'organizations/fcn/events/2026-11-03_whatever'), session('admin')));
    await assertFails(setDoc(doc(as('admin'), 'organizations/fcn/events/2026-11-03_nothing_nov2026'), session('admin', { programId: 'nothing' })));
    await assertFails(setDoc(doc(as('admin'), CLASS), session('admin', { type: 'service' })));
  });

  it('keeps programme fields off ordinary services', async () => {
    await assertFails(setDoc(doc(as('admin'), 'organizations/fcn/events/2026-11-01_sunday'), {
      orgId: 'fcn', date: '2026-11-01', type: 'service', name: 'Sunday', activity: null, headcounts: {}, notes: '',
      topicIds: ['topic_01'], ...created('admin'),
    }));
  });

  it('requires a check-in to carry the same programme as its class', async () => {
    await assertSucceeds(setDoc(doc(as('admin'), CLASS), session('admin')));
    const ref = doc(as('admin'), 'organizations/fcn/attendance/2026-11-03_freedom_252_nov2026_p1');
    await assertFails(setDoc(ref, mark('admin', { programId: null })));
    await assertFails(setDoc(ref, mark('admin', { programId: 'growth_track' })));
    await assertSucceeds(setDoc(ref, mark('admin')));
  });
});

describe('Dream Team and Freedom Groups', () => {
  it('lets an admin add a department member and a group member for real people only', async () => {
    await assertSucceeds(setDoc(doc(as('admin'), 'organizations/fcn/teamMembers/ushers_p1'), {
      orgId: 'fcn', teamId: 'ushers', personId: 'p1', role: 'Usher', startDate: '2026-10-18', endDate: null, status: 'active', ...created('admin'),
    }));
    await assertFails(setDoc(doc(as('admin'), 'organizations/fcn/teamMembers/ushers_ghost'), {
      orgId: 'fcn', teamId: 'ushers', personId: 'ghost', role: 'Usher', startDate: '2026-10-18', endDate: null, status: 'active', ...created('admin'),
    }));
    await assertSucceeds(setDoc(doc(as('admin'), 'organizations/fcn/groupMembers/kilimani1_p1'), {
      orgId: 'fcn', groupId: 'kilimani1', personId: 'p1', joinedDate: '2026-10-18', leftDate: null, status: 'active', ...created('admin'),
    }));
  });

  it('checks a group meeting day and keeps groups inside the organization', async () => {
    await assertFails(setDoc(doc(as('admin'), 'organizations/fcn/groups/westlands1'), group('admin', { meetingDay: 'someday' })));
    await assertSucceeds(setDoc(doc(as('admin'), 'organizations/fcn/groups/westlands1'), group('admin')));
    await assertFails(setDoc(doc(as('admin'), 'organizations/adia/groups/westlands1'), group('admin', { orgId: 'adia' })));
  });

  it('records a weekly group meeting only for a real group, with a matching id', async () => {
    const meeting = (overrides: Record<string, unknown> = {}) => ({
      orgId: 'fcn', date: '2026-10-21', type: 'group', name: 'Kilimani group', activity: null, headcounts: {}, notes: '',
      groupId: 'kilimani1', ...created('admin'), ...overrides,
    });
    await assertSucceeds(setDoc(doc(as('admin'), 'organizations/fcn/events/2026-10-21_group_kilimani1'), meeting()));
    await assertFails(setDoc(doc(as('admin'), 'organizations/fcn/events/2026-10-21_group_nope'), meeting({ groupId: 'nope' })));
    await assertFails(setDoc(doc(as('admin'), 'organizations/fcn/events/2026-10-21_kilimani'), meeting()));
  });

  it('keeps a stamped audit trail on every change', async () => {
    await assertFails(updateDoc(doc(as('admin'), 'organizations/fcn/groups/kilimani1'), { place: 'Lavington', updatedAt: serverTimestamp(), updatedBy: 'someone-else' }));
    await assertSucceeds(updateDoc(doc(as('admin'), 'organizations/fcn/groups/kilimani1'), { place: 'Lavington', updatedAt: serverTimestamp(), updatedBy: 'admin' }));
  });
});
