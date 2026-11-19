import { afterAll, beforeAll, beforeEach, describe, it } from 'vitest';
import { assertFails, assertSucceeds, type RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { doc, getDoc, runTransaction, serverTimestamp, setDoc, updateDoc } from 'firebase/firestore';
import { created, makeEnv, seed } from './helpers';

let env: RulesTestEnvironment;
const as = (uid: string) => env.authenticatedContext(uid).firestore();
const REG = 'organizations/adia/examRegisters/Cohort-4__NITA-college-exams-Dec-2026';
const reg = (uid: string, over: Record<string, unknown> = {}) => ({
  orgId: 'adia', cohort: 'Cohort 4', sitting: 'NITA & college exams · Dec 2026', entries: {}, locked: false, lockedOn: null, lockedByName: null,
  rules: { passMark: 39, minAttendance: 75 }, ...created(uid), ...over,
});
const stamp = (uid: string) => ({ updatedAt: serverTimestamp(), updatedBy: uid });
const transcript = (uid: string, n: number) => ({
  orgId: 'adia', serial: `ADIA/TR/2026/${String(n).padStart(4, '0')}`, year: 2026, n, studentId: 's1', cohort: 'Cohort 4', name: 'Grace', admissionNo: 'A1', programme: 'ICT',
  finalPoints: null, finalGrade: 'Incomplete', provisional: true, fingerprint: '[]', issuedOn: '2026-11-19', issuedByName: 'Principal', ...created(uid),
});

beforeAll(async () => { env = await makeEnv(); });
afterAll(async () => { await env.cleanup(); });
beforeEach(async () => {
  await env.clearFirestore();
  await seed(env);
  await env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    const u = (roleId: string, permissions: string[]) => ({ email: `${roleId}@example.org`, displayName: roleId, roleId, extraPermissions: [], orgIds: ['adia'], allOrgs: false, permissions, active: true });
    await setDoc(doc(db, 'users/principal'), u('principal', ['people.read', 'people.write', 'attendance.write', 'exams.manage', 'school.manage', 'fees.balances']));
    await setDoc(doc(db, 'users/trainer'), u('trainer', ['exams.mark']));
    await setDoc(doc(db, 'users/staff'), u('staff', ['people.read']));
  });
});

describe('exam register', () => {
  it('is kept by the principal only', async () => {
    await assertSucceeds(setDoc(doc(as('principal'), REG), reg('principal')));
    await assertFails(setDoc(doc(as('trainer'), 'organizations/adia/examRegisters/x'), reg('trainer')));
    await assertFails(getDoc(doc(as('trainer'), REG)));
    await assertFails(getDoc(doc(as('staff'), REG)));
    await assertSucceeds(updateDoc(doc(as('principal'), REG), { 'entries.s1': { sits: 'nita', trade: 'ICT', grade: 'Grade III', indexNo: '', feePaid: false, nitaResult: 'pending', typedPoints: null }, ...stamp('principal') }));
    await assertSucceeds(updateDoc(doc(as('principal'), REG), { locked: true, lockedOn: '2026-11-19', lockedByName: 'Principal', ...stamp('principal') }));
    // A register keeps its cohort and sitting.
    await assertFails(updateDoc(doc(as('principal'), REG), { cohort: 'Cohort 5', ...stamp('principal') }));
  });
});

describe('transcript serial numbers', () => {
  it('needs the counter to cover each number, and never goes back', async () => {
    const db = as('principal');
    await assertSucceeds(runTransaction(db, async (tx) => {
      tx.set(doc(db, 'organizations/adia/examTranscripts/abcdefghijklmnopqrst'), transcript('principal', 1));
      tx.set(doc(db, 'organizations/adia/examCounters/transcripts-2026'), { orgId: 'adia', year: 2026, last: 1, ...created('principal') });
    }));
    // A number beyond the counter is refused.
    await assertFails(setDoc(doc(db, 'organizations/adia/examTranscripts/bbcdefghijklmnopqrst'), transcript('principal', 5)));
    await assertFails(updateDoc(doc(db, 'organizations/adia/examCounters/transcripts-2026'), { last: 0, ...stamp('principal') }));
    await assertFails(updateDoc(doc(db, 'organizations/adia/examTranscripts/abcdefghijklmnopqrst'), { finalGrade: 'Distinction', ...stamp('principal') }));
    await assertFails(getDoc(doc(as('staff'), 'organizations/adia/examTranscripts/abcdefghijklmnopqrst')));
  });

  it('lets school staff read provisional copies but nobody write them', async () => {
    await assertSucceeds(getDoc(doc(as('staff'), 'organizations/adia/provisionalCertificates/s1')));
    await assertFails(setDoc(doc(as('principal'), 'organizations/adia/provisionalCertificates/s1'), { orgId: 'adia', studentId: 's1' }));
  });
});
