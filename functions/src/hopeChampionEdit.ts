import { HttpsError, onCall } from 'firebase-functions/v2/https';
import { Timestamp } from 'firebase-admin/firestore';
import { auth, db, requireCaller, requireString, type UserProfile } from './common.js';
import { contactEmail } from './pettyContacts.js';
import { CHAMPION_SIGN_MINUTES, championSignerRole, isChampionManager, type ChampionSigner } from './shared/hopeChampionPay.js';

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const MONTH = /^\d{4}-\d{2}$/;
const str = (v: unknown, max: number) => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim().slice(0, max) : '');
const pay = (v: unknown) => (v == null || v === '' ? null : Number.isInteger(v) && (v as number) >= 0 && (v as number) <= 5_000_000 ? (v as number) : undefined);

/**
 * Child Champions' details and pay (Andy, 2026-11-05): every change to a champion's details, appreciation or extra
 * amounts needs two signatures, Andy or Doreen and the Director (Diana), each with their own password. The phone
 * proves each password with a short sign-in (`proofs`); the change is saved here, never straight from the phone.
 * - "signers": who may sign, as keeper (Andy, Doreen) or director, with the emails their password is tried on
 * - "save": { proofs: [a, b], champions: [{ id?, name, phone, email, duty, status, joinedOn, weeklyPay, monthlyPay }],
 *   addExtras: [{ championId, month, amount, reason }], removeExtras: [id] }
 */
export const hopeChampionEdit = onCall({ invoker: 'public', memory: '512MiB', timeoutSeconds: 60 }, async (request) => {
  const caller = await requireCaller(request);
  const me = caller.profile as UserProfile;
  const data = (request.data ?? {}) as Record<string, unknown>;
  const orgId = requireString(data.orgId, 'the organization', { max: 80 });
  if (!isChampionManager(me, orgId)) throw new HttpsError('permission-denied', 'Only the Director, Andy or Doreen change champions.');
  const base = `organizations/${orgId}`;

  if (data.action === 'signers') {
    const users = (await db.collection('users').where('active', '==', true).get()).docs
      .map((d) => ({ d, role: championSignerRole(d.data() as UserProfile, orgId) })).filter((x) => x.role);
    const logins = users.length ? await auth.getUsers(users.map((x) => ({ uid: x.d.id }))).catch(() => null) : null;
    const login = new Map((logins?.users ?? []).map((u) => [u.uid, u.email ?? '']));
    return {
      signers: users.map(({ d, role }) => {
        const u = d.data() as UserProfile;
        const name = u.displayName || u.email;
        return { uid: d.id, name, role, emails: [...new Set([login.get(d.id), u.email, contactEmail(name)].filter((e): e is string => !!e).map((e) => e.toLowerCase()))] };
      }).sort((a, b) => a.name.localeCompare(b.name)),
    };
  }
  if (data.action !== 'save') throw new HttpsError('invalid-argument', 'Unknown action.');

  // The two signatures: two different people, one Andy or Doreen and one the Director, each typed in the last minutes.
  const proofs = Array.isArray(data.proofs) ? data.proofs.slice(0, 2) : [];
  const signers: { uid: string; name: string; role: ChampionSigner }[] = [];
  for (const p of proofs) {
    const token = typeof p === 'string' && p.startsWith('idtoken:') ? await auth.verifyIdToken(p.slice(8)).catch(() => null) : null;
    if (!token || Date.now() / 1000 - token.auth_time > (CHAMPION_SIGN_MINUTES + 5) * 60) throw new HttpsError('permission-denied', 'A password could not be confirmed. Please sign again.');
    const u = (await db.doc(`users/${token.uid}`).get()).data() as UserProfile | undefined;
    const role = u && u.active !== false ? championSignerRole(u, orgId) : null;
    if (!role) throw new HttpsError('permission-denied', 'Only Andy or Doreen and the Director can sign.');
    signers.push({ uid: token.uid, name: u!.displayName || u!.email, role });
  }
  if (signers.length !== 2 || signers[0]!.uid === signers[1]!.uid || !signers.some((s) => s.role === 'keeper') || !signers.some((s) => s.role === 'director')) {
    throw new HttpsError('permission-denied', 'Two signatures are needed: Andy or Doreen, and the Director.');
  }
  const signedBy = signers.map((s) => s.name).join(' and ');

  const now = Timestamp.now();
  const stamp = { updatedAt: now, updatedBy: caller.uid };
  const batch = db.batch();
  let changed = 0;
  const champions = Array.isArray(data.champions) ? data.champions.slice(0, 300) : [];
  for (const raw of champions) {
    const c = (raw ?? {}) as Record<string, unknown>;
    const name = str(c.name, 120);
    const weeklyPay = pay(c.weeklyPay), monthlyPay = pay(c.monthlyPay);
    if (name.length < 2 || weeklyPay === undefined || monthlyPay === undefined) throw new HttpsError('invalid-argument', `Please check ${name || 'a champion'}.`);
    const email = str(c.email, 120);
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new HttpsError('invalid-argument', `${name}'s email does not look right.`);
    const fields = {
      name, phone: str(c.phone, 30), email, duty: str(c.duty, 80), status: c.status === 'left' ? 'left' : 'active',
      joinedOn: typeof c.joinedOn === 'string' && DATE.test(c.joinedOn) ? c.joinedOn : null, weeklyPay, monthlyPay,
      signedBy, ...stamp,
    };
    if (typeof c.id === 'string' && c.id) {
      if (c.id.includes('/')) throw new HttpsError('invalid-argument', 'Please check the champion.');
      const ref = db.doc(`${base}/champions/${c.id}`);
      const snap = await ref.get();
      if (!snap.exists || snap.get('deletedAt')) throw new HttpsError('not-found', `${name} was not found.`);
      batch.update(ref, fields);
    } else {
      batch.set(db.collection(`${base}/champions`).doc(), { orgId, ...fields, code: null, deletedAt: null, deletedBy: null, createdAt: now, createdBy: caller.uid });
    }
    changed += 1;
  }
  const adds = Array.isArray(data.addExtras) ? data.addExtras.slice(0, 100) : [];
  for (const raw of adds) {
    const x = (raw ?? {}) as Record<string, unknown>;
    const reason = str(x.reason, 200);
    const amount = x.amount;
    if (typeof x.championId !== 'string' || !x.championId || x.championId.includes('/') || typeof x.month !== 'string' || !MONTH.test(x.month)
      || !Number.isInteger(amount) || (amount as number) <= 0 || (amount as number) > 1_000_000 || reason.length < 2) throw new HttpsError('invalid-argument', 'Please check the extra amount.');
    if (!(await db.doc(`${base}/champions/${x.championId}`).get()).exists) throw new HttpsError('not-found', 'That champion was not found.');
    batch.set(db.collection(`${base}/championExtras`).doc(), { orgId, championId: x.championId, month: x.month, amount, reason, signedBy, deletedAt: null, deletedBy: null, createdAt: now, createdBy: caller.uid, ...stamp });
    changed += 1;
  }
  const removes = Array.isArray(data.removeExtras) ? data.removeExtras.slice(0, 100) : [];
  for (const id of removes) {
    if (typeof id !== 'string' || !id || id.includes('/')) throw new HttpsError('invalid-argument', 'Please check the extra amount.');
    batch.update(db.doc(`${base}/championExtras/${id}`), { deletedAt: now, deletedBy: caller.uid, signedBy, ...stamp });
    changed += 1;
  }
  if (!changed) return { saved: 0, signedBy };
  await batch.commit();
  return { saved: changed, signedBy };
});
