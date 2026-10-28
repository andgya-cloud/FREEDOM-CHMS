import { afterAll, beforeAll, beforeEach, describe, it } from 'vitest';
import { assertFails, assertSucceeds, type RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { collection, deleteDoc, doc, getDoc, getDocs, query, serverTimestamp, setDoc, Timestamp, updateDoc, where, writeBatch } from 'firebase/firestore';
import { created, makeEnv, person, seed } from './helpers';

let env: RulesTestEnvironment;
const as = (uid: string) => env.authenticatedContext(uid).firestore();
const EVENT = 'organizations/fcn/events/2026-10-18_sunday_10_00_service';
const event = (uid: string, overrides: Record<string, unknown> = {}) => ({
  orgId: 'fcn', date: '2026-10-18', type: 'service', name: 'Sunday 10:00 service', activity: null,
  headcounts: { adults: 180, teens: 25, children: 40 }, notes: '', ...created(uid), ...overrides,
});
const checkIn = (uid: string, overrides: Record<string, unknown> = {}) => ({
  orgId: 'fcn', eventId: '2026-10-18_sunday_10_00_service', personId: 'p1', date: '2026-10-18',
  status: 'present', method: 'staff', checkedInAt: Timestamp.fromDate(new Date('2026-10-18T07:05:00Z')),
  ...created(uid), ...overrides,
});
const RECORD = 'organizations/fcn/attendance/2026-10-18_sunday_10_00_service_p1';

beforeAll(async () => { env = await makeEnv(); });
afterAll(async () => { await env.cleanup(); });
beforeEach(async () => {
  await env.clearFirestore();
  await seed(env);
});

async function seedEvent() {
  await env.withSecurityRulesDisabled(async (ctx) => {
    await setDoc(doc(ctx.firestore(), EVENT), { ...event('pastor'), createdAt: Timestamp.now(), updatedAt: Timestamp.now() });
  });
}

describe('services and headcounts', () => {
  it('lets an admin open a service and record headcounts in their own organization only', async () => {
    await assertSucceeds(setDoc(doc(as('admin'), EVENT), event('admin')));
    await assertSucceeds(updateDoc(doc(as('admin'), EVENT), { headcounts: { adults: 200, teens: 30, children: 45 }, updatedAt: serverTimestamp(), updatedBy: 'admin' }));
    await assertFails(setDoc(doc(as('admin'), 'organizations/adia/events/2026-10-18_ict'), event('admin', { orgId: 'adia', type: 'class', name: 'ICT' })));
  });

  it('rejects counts that are negative, not whole numbers, or not a known count', async () => {
    await assertFails(setDoc(doc(as('admin'), EVENT), event('admin', { headcounts: { adults: -1 } })));
    await assertFails(setDoc(doc(as('admin'), EVENT), event('admin', { headcounts: { adults: 2.5 } })));
    await assertFails(setDoc(doc(as('admin'), EVENT), event('admin', { headcounts: { adults: '20' } })));
    await assertFails(setDoc(doc(as('admin'), EVENT), event('admin', { headcounts: { visitors: 3 } })));
  });

  it('requires the record id to start with its date, and a known kind of gathering', async () => {
    await assertFails(setDoc(doc(as('admin'), 'organizations/fcn/events/2026-10-11_sunday_10_00_service'), event('admin')));
    await assertFails(setDoc(doc(as('admin'), EVENT), event('admin', { type: 'party' })));
    await assertFails(setDoc(doc(as('admin'), EVENT), event('admin', { date: '18/10/2026' })));
  });

  it('needs the attendance permission and an active account', async () => {
    await assertFails(setDoc(doc(as('inactive'), EVENT), event('inactive')));
    await assertFails(setDoc(doc(env.unauthenticatedContext().firestore(), EVENT), event('nobody')));
  });

  it('never allows a hard delete', async () => {
    await seedEvent();
    await assertFails(deleteDoc(doc(as('pastor'), EVENT)));
  });
});

describe('check-in', () => {
  it('lets an admin check someone in, change the mark, and undo it', async () => {
    await seedEvent();
    await assertSucceeds(setDoc(doc(as('admin'), RECORD), checkIn('admin')));
    await assertSucceeds(updateDoc(doc(as('admin'), RECORD), { status: 'late', updatedAt: serverTimestamp(), updatedBy: 'admin' }));
    await assertSucceeds(updateDoc(doc(as('admin'), RECORD), { deletedAt: serverTimestamp(), deletedBy: 'admin', updatedAt: serverTimestamp(), updatedBy: 'admin' }));
  });

  it('lets a new service and its first check-in be saved together', async () => {
    const db = as('admin');
    const batch = writeBatch(db);
    batch.set(doc(db, EVENT), event('admin'));
    batch.set(doc(db, RECORD), checkIn('admin'));
    await assertSucceeds(batch.commit());
  });

  it('rejects a check-in to a gathering or person that does not exist', async () => {
    await assertFails(setDoc(doc(as('admin'), RECORD), checkIn('admin')));
    await seedEvent();
    await assertFails(setDoc(doc(as('admin'), 'organizations/fcn/attendance/2026-10-18_sunday_10_00_service_ghost'), checkIn('admin', { personId: 'ghost' })));
  });

  it('rejects a check-in on a different date from its gathering, or under the wrong id', async () => {
    await seedEvent();
    await assertFails(setDoc(doc(as('admin'), RECORD), checkIn('admin', { date: '2026-10-11' })));
    await assertFails(setDoc(doc(as('admin'), 'organizations/fcn/attendance/whatever'), checkIn('admin')));
  });

  it('rejects unknown marks and methods, and moving a record to another person', async () => {
    await seedEvent();
    await assertFails(setDoc(doc(as('admin'), RECORD), checkIn('admin', { status: 'asleep' })));
    await assertFails(setDoc(doc(as('admin'), RECORD), checkIn('admin', { method: 'magic' })));
    await assertSucceeds(setDoc(doc(as('admin'), RECORD), checkIn('admin')));
    await env.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), 'organizations/fcn/people/p2'), { ...person('fcn', { fullName: 'Peter Otieno' }), ...created('pastor'), createdAt: Timestamp.now(), updatedAt: Timestamp.now() });
    });
    await assertFails(updateDoc(doc(as('admin'), RECORD), { personId: 'p2', updatedAt: serverTimestamp(), updatedBy: 'admin' }));
  });

  it('keeps each organization’s attendance apart', async () => {
    await seedEvent();
    await assertSucceeds(getDocs(query(collection(as('admin'), 'organizations/fcn/attendance'), where('eventId', '==', '2026-10-18_sunday_10_00_service'))));
    await assertFails(getDocs(collection(as('admin'), 'organizations/adia/attendance')));
    await assertFails(getDocs(collection(as('admin'), 'organizations/adia/events')));
  });

  it('lets a class register mark a student at ADIA', async () => {
    await env.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), 'organizations/adia/events/2026-10-19_ict'), {
        ...event('pastor', { orgId: 'adia', date: '2026-10-19', type: 'class', name: 'ICT', activity: 'ICT', headcounts: {} }),
        createdAt: Timestamp.now(), updatedAt: Timestamp.now(),
      });
    });
    await assertSucceeds(setDoc(doc(as('pastor'), 'organizations/adia/attendance/2026-10-19_ict_s1'), checkIn('pastor', {
      orgId: 'adia', eventId: '2026-10-19_ict', personId: 's1', date: '2026-10-19', status: 'excused', method: 'register',
    })));
    await assertFails(setDoc(doc(as('admin'), 'organizations/adia/attendance/2026-10-19_ict_s1'), checkIn('admin', {
      orgId: 'adia', eventId: '2026-10-19_ict', personId: 's1', date: '2026-10-19', method: 'register',
    })));
  });
});

// Trainers mark only today or yesterday, so their tests use today's date.
const D = new Date().toISOString().slice(0, 10);
const LONG_AGO = '2026-01-05';

describe('a trainer marks only their own class register (Andy, 2026-10-26)', () => {
  const IT = `organizations/adia/events/${D}_it_ict`;
  const OTHER = `organizations/adia/events/${D}_catering`;
  const cls = (uid: string, name: string, overrides: Record<string, unknown> = {}) => ({
    orgId: 'adia', date: `${D}`, type: 'class', name, activity: name, headcounts: {}, notes: '', ...created(uid), ...overrides,
  });
  const mark = (uid: string, eventId: string, overrides: Record<string, unknown> = {}) => ({
    orgId: 'adia', eventId, personId: 's1', date: `${D}`, status: 'present', method: 'register',
    checkedInAt: Timestamp.now(), ...created(uid), ...overrides,
  });
  beforeEach(async () => {
    await env.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), 'users/alphonse'), {
        email: 'alphonse@example.org', displayName: 'Alphonse', roleId: 'trainer', extraPermissions: [], orgIds: ['adia'], allOrgs: false,
        permissions: ['exams.mark'], active: true, registerClasses: ['IT / ICT'], trainerCourseIds: ['it'],
      });
      const db = ctx.firestore();
      const st = { deletedAt: null, deletedBy: null, createdAt: Timestamp.now(), createdBy: 'pastor', updatedAt: Timestamp.now(), updatedBy: 'pastor' };
      await setDoc(doc(db, 'organizations/adia/people/s2'), { ...person('adia'), fullName: 'Student Two', ...st });
      await setDoc(doc(db, 'organizations/adia/students/s1'), { orgId: 'adia', courseId: 'it', intakeId: 'sep', level: '', status: 'enrolled', ...st });
      await setDoc(doc(db, 'organizations/adia/students/s2'), { orgId: 'adia', courseId: 'ctr', intakeId: 'sep', level: '', status: 'enrolled', ...st });
      await setDoc(doc(db, 'organizations/adia/rosters/it'), { orgId: 'adia', courseId: 'it', students: [{ id: 's1', name: 'Student One' }] });
      await setDoc(doc(db, 'organizations/adia/rosters/ctr'), { orgId: 'adia', courseId: 'ctr', students: [{ id: 's2', name: 'Student Two' }] });
      await setDoc(doc(db, 'organizations/adia/courses/it'), { orgId: 'adia', name: 'IT / ICT', ...st });
    });
  });

  it('reads only his department: its class list, its registers, never people or students (Andy, 2026-10-28)', async () => {
    const db = as('alphonse');
    await assertSucceeds(getDoc(doc(db, 'organizations/adia/rosters/it')));
    await assertFails(getDoc(doc(db, 'organizations/adia/rosters/ctr')));
    await assertFails(getDoc(doc(db, 'organizations/adia/people/s1')));
    await assertFails(getDocs(collection(db, 'organizations/adia/people')));
    await assertFails(getDoc(doc(db, 'organizations/adia/students/s1')));
    await assertSucceeds(getDoc(doc(db, 'organizations/adia/courses/it')));
    await env.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), IT), { ...cls('pastor', 'IT / ICT'), createdAt: Timestamp.now(), updatedAt: Timestamp.now() });
      await setDoc(doc(ctx.firestore(), OTHER), { ...cls('pastor', 'Catering'), createdAt: Timestamp.now(), updatedAt: Timestamp.now() });
      await setDoc(doc(ctx.firestore(), `organizations/adia/attendance/${D}_it_ict_s1`), { ...mark('pastor', `${D}_it_ict`), createdAt: Timestamp.now(), updatedAt: Timestamp.now() });
      await setDoc(doc(ctx.firestore(), `organizations/adia/attendance/${D}_catering_s2`), { ...mark('pastor', `${D}_catering`, { personId: 's2' }), createdAt: Timestamp.now(), updatedAt: Timestamp.now() });
    });
    await assertSucceeds(getDocs(query(collection(db, 'organizations/adia/events'), where('name', '==', 'IT / ICT'), where('type', '==', 'class'))));
    await assertFails(getDocs(query(collection(db, 'organizations/adia/events'), where('type', '==', 'class'))));
    await assertFails(getDoc(doc(db, OTHER)));
    await assertSucceeds(getDocs(query(collection(db, 'organizations/adia/attendance'), where('eventId', '==', `${D}_it_ict`))));
    await assertFails(getDocs(query(collection(db, 'organizations/adia/attendance'), where('eventId', '==', `${D}_catering`))));
    await assertFails(getDocs(collection(db, 'organizations/adia/attendance')));
  });

  it('marks only students of his department, even in his own class', async () => {
    await assertSucceeds(setDoc(doc(as('alphonse'), IT), cls('alphonse', 'IT / ICT')));
    await assertFails(setDoc(doc(as('alphonse'), `organizations/adia/attendance/${D}_it_ict_s2`), mark('alphonse', `${D}_it_ict`, { personId: 's2' })));
  });

  it('lets him open his class and mark a student', async () => {
    await assertSucceeds(setDoc(doc(as('alphonse'), IT), cls('alphonse', 'IT / ICT')));
    await assertSucceeds(setDoc(doc(as('alphonse'), `organizations/adia/attendance/${D}_it_ict_s1`), mark('alphonse', `${D}_it_ict`)));
    await assertSucceeds(updateDoc(doc(as('alphonse'), `organizations/adia/attendance/${D}_it_ict_s1`), { status: 'late', updatedAt: serverTimestamp(), updatedBy: 'alphonse' }));
    await assertSucceeds(updateDoc(doc(as('alphonse'), IT), { notes: 'Networking basics', updatedAt: serverTimestamp(), updatedBy: 'alphonse' }));
  });

  it('never lets him open or mark another class', async () => {
    await assertFails(setDoc(doc(as('alphonse'), OTHER), cls('alphonse', 'Catering')));
    await env.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), OTHER), { ...cls('pastor', 'Catering'), createdAt: Timestamp.now(), updatedAt: Timestamp.now() });
    });
    await assertFails(setDoc(doc(as('alphonse'), `organizations/adia/attendance/${D}_catering_s1`), mark('alphonse', `${D}_catering`)));
    await assertFails(updateDoc(doc(as('alphonse'), OTHER), { notes: 'x', updatedAt: serverTimestamp(), updatedBy: 'alphonse' }));
  });

  it('does not let him rename, recount or delete his class', async () => {
    await assertSucceeds(setDoc(doc(as('alphonse'), IT), cls('alphonse', 'IT / ICT')));
    await assertFails(updateDoc(doc(as('alphonse'), IT), { headcounts: { students: 5 }, updatedAt: serverTimestamp(), updatedBy: 'alphonse' }));
    await assertFails(updateDoc(doc(as('alphonse'), IT), { deletedAt: serverTimestamp(), deletedBy: 'alphonse', updatedAt: serverTimestamp(), updatedBy: 'alphonse' }));
    await assertFails(setDoc(doc(as('alphonse'), `organizations/adia/events/${D}_catering`), cls('alphonse', 'IT / ICT', { name: 'Catering' })));
  });

  it('gives a trainer with no register classes nothing to mark', async () => {
    await env.withSecurityRulesDisabled(async (ctx) => {
      await updateDoc(doc(ctx.firestore(), 'users/alphonse'), { registerClasses: [] });
    });
    await assertFails(setDoc(doc(as('alphonse'), IT), cls('alphonse', 'IT / ICT')));
  });
  it('lets him mark the rest of his class in one go', async () => {
    await env.withSecurityRulesDisabled(async (ctx) => {
      const db = ctx.firestore();
      const st = { deletedAt: null, deletedBy: null, createdAt: Timestamp.now(), createdBy: 'pastor', updatedAt: Timestamp.now(), updatedBy: 'pastor' };
      for (const id of ['s3', 's4', 's5', 's6']) {
        await setDoc(doc(db, `organizations/adia/people/${id}`), { ...person('adia'), fullName: id, ...st });
        await setDoc(doc(db, `organizations/adia/students/${id}`), { orgId: 'adia', courseId: 'it', intakeId: 'sep', level: '', status: 'enrolled', ...st });
      }
    });
    const db = as('alphonse');
    await assertSucceeds(setDoc(doc(db, IT), cls('alphonse', 'IT / ICT')));
    const batch = writeBatch(db);
    for (const id of ['s1', 's3', 's4', 's5', 's6']) batch.set(doc(db, `organizations/adia/attendance/${D}_it_ict_${id}`), mark('alphonse', `${D}_it_ict`, { personId: id, status: 'absent' }));
    await assertSucceeds(batch.commit());
  });

  it('lets him type in past results for his own department only (Andy, 2026-10-28)', async () => {
    const result = (studentId: string, courseId: string, extra: Record<string, unknown> = {}) => ({
      orgId: 'adia', cohort: 'Cohort 1', studentId, admissionNo: 'ADIA/IT/2025/1/001', studentName: 'Student', courseId,
      semesters: { 1: { points: 64.5, grade: 'Credit' } }, printed: null, notes: [], ...created('alphonse'), ...extra,
    });
    const db = as('alphonse');
    await assertSucceeds(setDoc(doc(db, 'organizations/adia/examResults/s1_Cohort-1'), result('s1', 'it')));
    await assertSucceeds(updateDoc(doc(db, 'organizations/adia/examResults/s1_Cohort-1'), { semesters: { 1: { points: 70, grade: 'Credit' }, 2: { points: 66, grade: 'Credit' } }, updatedAt: serverTimestamp(), updatedBy: 'alphonse' }));
    await assertSucceeds(getDocs(query(collection(db, 'organizations/adia/examResults'), where('courseId', '==', 'it'))));
    await assertFails(getDocs(query(collection(db, 'organizations/adia/examResults'), where('courseId', '==', 'ctr'))));
    await assertFails(setDoc(doc(db, 'organizations/adia/examResults/s2_Cohort-1'), result('s2', 'ctr')));
    await assertFails(setDoc(doc(db, 'organizations/adia/examResults/s2_Cohort-1'), result('s2', 'it')));
    await assertFails(setDoc(doc(db, 'organizations/adia/examResults/s1_Cohort-2'), result('s1', 'it', { cohort: 'Cohort 2', printed: { points: 60, grade: 'Credit' } })));
    await env.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), 'organizations/adia/examResults/s1_Cohort-3'), { ...result('s1', 'it', { cohort: 'Cohort 3' }), createdBy: 'principal', updatedBy: 'principal', createdAt: Timestamp.now(), updatedAt: Timestamp.now() });
    });
    await assertFails(updateDoc(doc(db, 'organizations/adia/examResults/s1_Cohort-3'), { semesters: {}, updatedAt: serverTimestamp(), updatedBy: 'alphonse' }));
  });

  it('does not let him fill in a register from long ago', async () => {
    await assertFails(setDoc(doc(as('alphonse'), `organizations/adia/events/${LONG_AGO}_it_ict`), cls('alphonse', 'IT / ICT', { date: LONG_AGO })));
  });
});
