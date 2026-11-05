import { createHash } from 'node:crypto';
import { HttpsError, onCall } from 'firebase-functions/v2/https';
import { db, FieldValue } from './common.js';
import { localDateKey, DEFAULT_TIME_ZONE } from './shared/datetime.js';
import { firstName, HOW_HEARD_OPTIONS, pipelineEntryId, tidyName } from './shared/people.js';
import { normalizePhone } from './shared/phone.js';

/** Who wrote the record: the visitor, through the card at the door. */
const WELCOME = 'welcome-card';
/** Spam guards: cards per church per day, and per phone or network per day. */
const MAX_PER_DAY = 300;
const MAX_PER_SENDER = 6;

const text = (v: unknown, max: number) => (typeof v === 'string' ? v.trim().slice(0, max) : '');

/**
 * The visitor's card behind the QR poster at the door (Andy, 2026-10-31, 3A). Anyone may open it without signing
 * in, so it does one thing only: add a first-time visitor (or a prayer need for someone already known) to a
 * Freedom Church campus. The visitor then shows in People and gets the usual welcome follow-ups.
 *   { orgId, action: 'info' }   → { name }
 *   { orgId, action: 'send', fullName, phone, whatsapp, consent, howHeard, invitedBy, prayer, website }
 */
export const welcomeCard = onCall({ invoker: 'public', memory: '256MiB', timeoutSeconds: 30, maxInstances: 5 }, async (request) => {
  const data = (request.data ?? {}) as Record<string, unknown>;
  const orgId = text(data.orgId, 60);
  if (!/^[A-Za-z0-9_-]{1,60}$/.test(orgId)) throw new HttpsError('not-found', 'This card is not linked to a church.');
  const orgSnap = await db.doc(`organizations/${orgId}`).get();
  const org = orgSnap.data();
  if (!orgSnap.exists || org?.deletedAt || org?.type !== 'church_campus') throw new HttpsError('not-found', 'This card is not linked to a church.');
  const orgName = String(org.name ?? 'Freedom Church');
  if (data.action === 'info') return { name: orgName };

  // A hidden "website" box that people never see; automated spam fills it in.
  if (text(data.website, 200)) return { ok: true, firstName: '' };

  const fullName = tidyName(text(data.fullName, 120));
  if (fullName.length < 2 || !/[a-z]/i.test(fullName)) throw new HttpsError('invalid-argument', 'Please type your name.');
  const phone = normalizePhone(text(data.phone, 30));
  if (!phone) throw new HttpsError('invalid-argument', 'Please type your phone number, for example 0712 345 678.');
  const onWhatsApp = data.whatsapp !== false;
  const consent = data.consent === true && onWhatsApp;
  const howHeard = HOW_HEARD_OPTIONS.includes(text(data.howHeard, 60)) ? text(data.howHeard, 60) : null;
  const invitedBy = tidyName(text(data.invitedBy, 120)) || null;
  const prayer = text(data.prayer, 2000);

  const tz = String(org.timeZone || DEFAULT_TIME_ZONE);
  const today = localDateKey(new Date(), tz);
  const ip = request.rawRequest?.ip ?? '';
  const sender = createHash('sha256').update(`${today}|${ip}|${phone}`).digest('hex').slice(0, 24);
  const dayRef = db.doc(`organizations/${orgId}/welcomeDays/${today}`);
  const senderRef = db.doc(`organizations/${orgId}/welcomeDays/${today}_${sender}`);
  await db.runTransaction(async (tx) => {
    const [day, from] = await Promise.all([tx.get(dayRef), tx.get(senderRef)]);
    if ((day.get('count') ?? 0) >= MAX_PER_DAY || (from.get('count') ?? 0) >= MAX_PER_SENDER) {
      throw new HttpsError('resource-exhausted', 'Thank you! We already have your card. An usher can help if anything is missing.');
    }
    tx.set(dayRef, { count: FieldValue.increment(1), date: today }, { merge: true });
    tx.set(senderRef, { count: FieldValue.increment(1), date: today }, { merge: true });
  });

  const stamps = { deletedAt: null, deletedBy: null, createdAt: FieldValue.serverTimestamp(), createdBy: WELCOME, updatedAt: FieldValue.serverTimestamp(), updatedBy: WELCOME };
  const people = db.collection(`organizations/${orgId}/people`);
  const known = (await people.where('phone', '==', phone).limit(5).get()).docs.find((d) => d.get('deletedAt') == null);
  const batch = db.batch();
  let personId: string;
  if (known) {
    // Already in People (perhaps a returning guest): no second record, only the prayer need below.
    personId = known.id;
  } else {
    const ref = people.doc();
    personId = ref.id;
    batch.set(ref, {
      orgId, fullName, firstName: firstName(fullName), phone, whatsapp: onWhatsApp ? phone : null,
      whatsappConsent: { given: consent, date: today, recordedBy: WELCOME, stoppedAt: null },
      email: null, status: 'visitor', firstVisitDate: today, gender: null, householdId: null, guardianId: null,
      howHeard, invitedBy, invitedById: null, serviceAttended: null, customFields: {}, possibleDuplicateIds: [], ...stamps,
    });
    batch.set(db.doc(`organizations/${orgId}/pipeline/${pipelineEntryId(personId, 'visitor')}`), {
      orgId, personId, stageId: 'visitor', sensitive: false, status: 'completed', date: today, notes: 'Filled in the visitor card at the door', details: {}, ...stamps,
    });
  }
  if (prayer) {
    batch.set(db.collection(`organizations/${orgId}/prayerRequests`).doc(), { orgId, personId, text: prayer, status: 'open', ...stamps });
  }
  await batch.commit();
  return { ok: true, firstName: firstName(fullName), returning: !!known };
});
