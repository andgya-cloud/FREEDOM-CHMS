import { createHash } from 'node:crypto';
import { HttpsError, onCall } from 'firebase-functions/v2/https';
import { db, FieldValue } from './common.js';
import { localDateKey, DEFAULT_TIME_ZONE } from './shared/datetime.js';
import { readTranscriptSerial } from './shared/examRegister.js';
import { admissionKey } from './shared/examResults.js';

const MAX_PER_SENDER = 40;
const text = (v: unknown, max: number) => (typeof v === 'string' ? v.trim().slice(0, max) : '');

/**
 * The public check page behind each transcript's QR code (Andy, 2026-11-19, 7A): anyone, such as an
 * employer, can confirm that a transcript is genuine. The QR code holds a long random code; typing a
 * serial number also needs the student's admission number, so nobody can look students up by guessing.
 * It says only what the transcript itself says, and whether a newer one has been printed since.
 *   { orgId, token }                 → the transcript
 *   { orgId, serial, admissionNo }   → the transcript
 */
export const verifyTranscript = onCall({ invoker: 'public', memory: '256MiB', timeoutSeconds: 30, maxInstances: 5 }, async (request) => {
  const data = (request.data ?? {}) as Record<string, unknown>;
  const orgId = text(data.orgId, 60);
  if (!/^[A-Za-z0-9_-]{1,60}$/.test(orgId)) throw new HttpsError('not-found', 'This check page is not linked to a college.');
  const org = (await db.doc(`organizations/${orgId}`).get()).data();
  if (!org || org.type !== 'college') throw new HttpsError('not-found', 'This check page is not linked to a college.');
  const orgName = String(org.name || 'ADIA Training Centre');
  if (data.action === 'info') return { orgName };

  const today = localDateKey(new Date(), String(org.timeZone || DEFAULT_TIME_ZONE));
  const sender = createHash('sha256').update(`${today}|${request.rawRequest?.ip ?? ''}`).digest('hex').slice(0, 24);
  const senderRef = db.doc(`organizations/${orgId}/welcomeDays/verify_${today}_${sender}`);
  await db.runTransaction(async (tx) => {
    const from = await tx.get(senderRef);
    if ((from.get('count') ?? 0) >= MAX_PER_SENDER) throw new HttpsError('resource-exhausted', 'Too many checks today. Please try again tomorrow, or call the college.');
    tx.set(senderRef, { count: FieldValue.increment(1), date: today }, { merge: true });
  });

  const col = db.collection(`organizations/${orgId}/examTranscripts`);
  let doc: FirebaseFirestore.DocumentSnapshot | undefined;
  const token = text(data.token, 40);
  if (token) {
    if (!/^[A-Za-z0-9]{16,40}$/.test(token)) return { orgName, found: false };
    doc = await col.doc(token).get();
  } else {
    const serial = readTranscriptSerial(text(data.serial, 40));
    const adm = admissionKey(text(data.admissionNo, 80));
    if (!serial || !adm) throw new HttpsError('invalid-argument', 'Type the transcript number and the admission number.');
    doc = (await col.where('serial', '==', serial).limit(5).get()).docs.find((d) => admissionKey(d.get('admissionNo')) === adm);
  }
  const t = doc?.exists ? doc.data() : undefined;
  if (!t || t.deletedAt) return { orgName, found: false };
  // A newer transcript for the same student and cohort means this one was replaced by a later result.
  const later = (await col.where('studentId', '==', t.studentId).get()).docs
    .filter((d) => d.get('cohort') === t.cohort && !d.get('deletedAt') && Number(d.get('n')) + Number(d.get('year')) * 1e6 > Number(t.n) + Number(t.year) * 1e6)
    .sort((a, b) => Number(b.get('year')) * 1e6 + Number(b.get('n')) - (Number(a.get('year')) * 1e6 + Number(a.get('n'))))[0];
  return {
    orgName, found: true,
    transcript: {
      serial: String(t.serial), name: String(t.name), admissionNo: String(t.admissionNo), programme: String(t.programme), cohort: String(t.cohort),
      finalPoints: (t.finalPoints as number | null) ?? null, finalGrade: String(t.finalGrade ?? ''), provisional: t.provisional === true, issuedOn: String(t.issuedOn),
      newer: later ? String(later.get('serial')) : null,
    },
  };
});
