import { createHash } from 'node:crypto';
import { logger } from 'firebase-functions';
import { HttpsError, onCall, type CallableRequest } from 'firebase-functions/v2/https';
import { FieldValue, Timestamp } from 'firebase-admin/firestore';
import { db, requireCaller, requireString, type UserProfile } from './common.js';
import { circleLeadEmails, circleMailer, EMAIL, HOPE_EMAIL_APP_PASSWORD, keepTestMail, appUrl } from './circleKit.js';
import { DEFAULT_TIME_ZONE, localDateKey } from './shared/datetime.js';
import { ageOn } from './shared/hope.js';
import { classOf } from './shared/hopeClasses.js';
import { canDeletePhotoReport } from './shared/hopePhotos.js';
import { firstName } from './shared/people.js';
import { poweredByHtml } from './shared/poweredBy.js';
import { canAccessOrg, canKeepAccounts } from './shared/permissions.js';
import {
  amountLabel, BIO_MAX, cleanAmount, cleanPledge, cleanSettings, heldChildren, holdUntil, listed, pledgeFor, pledgeRef,
  receivedText, thankYouText, SAFETY_PROMISE, DATA_CONSENT, updateText, type PledgeForm, type PledgeState, type SponsorSettings,
} from './shared/hopeSponsorPage.js';

const MAX_PER_DAY = 100;
const MAX_PER_SENDER = 5;
const esc = (s: string) => s.replace(/[<>&"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' })[c]!);
type Org = FirebaseFirestore.DocumentData;

async function hopeOrg(orgId: unknown): Promise<{ id: string; org: Org; today: string }> {
  const id = typeof orgId === 'string' ? orgId : '';
  if (!/^[A-Za-z0-9_-]{1,60}$/.test(id)) throw new HttpsError('not-found', 'This page is not linked to the Hope Centre.');
  const snap = await db.doc(`organizations/${id}`).get();
  const org = snap.data();
  if (!snap.exists || org?.deletedAt || org?.type !== 'ministry') throw new HttpsError('not-found', 'This page is not linked to the Hope Centre.');
  return { id, org: org!, today: localDateKey(new Date(), String(org!.timeZone || DEFAULT_TIME_ZONE)) };
}

const settingsRef = (orgId: string) => db.doc(`organizations/${orgId}/hopeMeta/sponsorship`);
const kidsCol = (orgId: string) => db.collection(`organizations/${orgId}/sponsorKids`);
const pledgesCol = (orgId: string) => db.collection(`organizations/${orgId}/sponsorPledges`);
const loadSettings = async (orgId: string) => cleanSettings((await settingsRef(orgId).get()).data());

interface KidInfo { bio: string; hidden: boolean; amount: number | null; photoOk: boolean }
async function loadKids(orgId: string): Promise<Map<string, KidInfo>> {
  const snap = await kidsCol(orgId).get();
  return new Map(snap.docs.map((d) => [d.id, { bio: String(d.get('bio') ?? ''), hidden: d.get('hidden') === true, amount: cleanAmount(d.get('amount')), photoOk: d.get('photoOk') === true }]));
}

interface PledgeDoc {
  lastUpdateOn?: string | null;
  ref: string; state: PledgeState; childIds: string[]; childNames: string[]; general: boolean; name: string; email: string; phone: string; country: string;
  date: string; holdUntil: string; receivedOn?: string | null; receivedByName?: string | null; createdAt?: Timestamp;
}
async function waitingPledges(orgId: string) {
  return (await pledgesCol(orgId).where('state', '==', 'waiting').get()).docs.map((d) => d.data() as PledgeDoc);
}

/** The children on the public page, with what the public may see and nothing more (2A, 3A). */
async function publicChildren(orgId: string, today: string, settings: SponsorSettings) {
  const [children, kids, waiting] = await Promise.all([db.collection(`organizations/${orgId}/children`).get(), loadKids(orgId), waitingPledges(orgId)]);
  const held = heldChildren(waiting, today);
  const shown = children.docs.filter((d) => listed(d.data() as never, kids.get(d.id)?.hidden ?? false));
  const people = shown.length ? await db.getAll(...shown.map((d) => db.doc(`organizations/${orgId}/people/${d.id}`))) : [];
  const nameOf = new Map(people.map((p) => [p.id, p.exists && !p.get('deletedAt') ? firstName(String(p.get('fullName') ?? '')) : '']));
  return shown.map((d) => {
    const c = d.data();
    const k = kids.get(d.id);
    return {
      key: d.id, name: nameOf.get(d.id) ?? '', age: ageOn(c.dateOfBirth, today), stone: classOf(c.dateOfBirth, today)?.id ?? null,
      bio: k?.bio ?? '', amount: k?.amount ?? settings.amount, photo: c.photoConsent?.given === true && c.hasPhoto === true && (k?.photoOk ?? false), held: held.has(d.id),
    };
  }).filter((k) => k.name).sort((a, b) => Number(a.held) - Number(b.held) || (a.age ?? 99) - (b.age ?? 99) || a.name.localeCompare(b.name));
}

/** Sends one email from the Hope Centre's Gmail. A failed email never loses the pledge. */
async function send(to: string[], cc: string[], subject: string, text: string, tag: string, replyTo?: string, attachments?: { filename: string; content: Buffer; contentType: string }[]) {
  if (!to.length) return false;
  try {
    const m = circleMailer('ministry');
    if (!m) return false;
    const html = `<div style="font-family:Arial,sans-serif;max-width:560px;margin:auto;color:#2b2440;line-height:1.55">
<h2 style="color:#5b3f8f;margin:0 0 12px">${esc(subject)}</h2>
${text.split('\n\n').map((p) => `<p style="margin:0 0 12px">${esc(p).replace(/\n/g, '<br>')}</p>`).join('\n')}
${poweredByHtml()}</div>`;
    const info = await m.transport.sendMail({ from: `"Freedom Hope Centre" <${m.from}>`, to: to.join(', '), cc: cc.length ? cc.join(', ') : undefined, replyTo: replyTo || m.from, subject, text, html, attachments });
    await keepTestMail(m.test, info, tag);
    return true;
  } catch (err) {
    logger.warn('Sponsorship email failed', err);
    return false;
  }
}

/** A PDF made on the phone ({ name, data: base64 }), at most 6 MB. */
function pdfAttachment(v: unknown): { filename: string; content: Buffer; contentType: string }[] | undefined {
  const f = (v ?? {}) as { name?: unknown; data?: unknown };
  if (typeof f.data !== 'string' || !f.data || f.data.length > 8_000_000) return undefined;
  const content = Buffer.from(f.data, 'base64');
  if (content.subarray(0, 4).toString() !== '%PDF') return undefined;
  const filename = (typeof f.name === 'string' ? f.name : 'Sponsor-update.pdf').replace(/[^\w.-]+/g, '-').slice(0, 80);
  return [{ filename: filename.endsWith('.pdf') ? filename : `${filename}.pdf`, content, contentType: 'application/pdf' }];
}

/** Only Diana (the Director), Andy and Doreen manage the page (4A, 5A, 10A). */
async function keeper(request: CallableRequest, orgId: string) {
  const caller = await requireCaller(request, undefined, { reviewerOk: true });
  if (!canAccessOrg(caller.profile, orgId) || !canDeletePhotoReport(caller.profile, orgId)) throw new HttpsError('permission-denied', 'Only the Director, Andrew Guya or Doreen manage sponsorship.');
  return caller;
}

/**
 * The sponsorship page (Andy, 2026-11-18). Open to anyone, no sign-in:
 *   'page' { orgId } → { name, settings, children }
 *   'photo' { orgId, key } → { photo } (only for a child on the page, with photo consent)
 *   'pledge' { orgId, childIds, general, name, email, phone, country, website } → { ref, names, text }
 * Diana, Andy and Doreen only:
 *   'admin' { orgId } → { settings, children, pledges }
 *   'settings' { orgId, settings }, 'child' { orgId, childId, bio, hidden, amount }
 *   'received' { orgId, id }, 'cancel' { orgId, id }
 */
export const hopeSponsor = onCall({ invoker: 'public', memory: '512MiB', timeoutSeconds: 60, maxInstances: 10, secrets: [HOPE_EMAIL_APP_PASSWORD] }, async (request) => {
  const data = (request.data ?? {}) as Record<string, unknown>;
  const { id: orgId, org, today } = await hopeOrg(data.orgId);
  const action = String(data.action ?? '');

  if (action === 'page') {
    const settings = await loadSettings(orgId);
    return { name: String(org.name || 'Freedom Hope Centre'), settings, children: await publicChildren(orgId, today, settings) };
  }

  if (action === 'photo') {
    const key = requireString(data.key, 'the child', { max: 60 });
    if (!/^[A-Za-z0-9_-]+$/.test(key)) throw new HttpsError('not-found', 'No photo.');
    const [c, k, p] = await Promise.all([db.doc(`organizations/${orgId}/children/${key}`).get(), kidsCol(orgId).doc(key).get(), db.doc(`organizations/${orgId}/childPhotos/${key}`).get()]);
    const child = c.data();
    if (!child || !listed(child as never, k.get('hidden') === true) || child.photoConsent?.given !== true || k.get('photoOk') !== true || !p.exists) throw new HttpsError('not-found', 'No photo.');
    return { photo: String(p.get('photo') ?? '') };
  }

  if (action === 'pledge') {
    if (typeof data.website === 'string' && data.website.trim()) return { ref: '', names: [], text: '' };
    let form: PledgeForm;
    try { form = cleanPledge(data); } catch (err) { throw new HttpsError('invalid-argument', (err as Error).message); }
    const sender = createHash('sha256').update(`${today}|${request.rawRequest?.ip ?? ''}`).digest('hex').slice(0, 24);
    const dayRef = db.doc(`organizations/${orgId}/welcomeDays/sponsor_${today}`);
    const senderRef = db.doc(`organizations/${orgId}/welcomeDays/sponsor_${today}_${sender}`);
    const settings = await loadSettings(orgId);
    const kids = await loadKids(orgId);
    const counter = db.doc(`organizations/${orgId}/counters/sponsorPledges`);
    const pledge = pledgesCol(orgId).doc();
    const people = form.childIds.map((id) => db.doc(`organizations/${orgId}/people/${id}`));
    const result = await db.runTransaction(async (tx) => {
      const [day, from, count, waiting] = await Promise.all([tx.get(dayRef), tx.get(senderRef), tx.get(counter), tx.get(pledgesCol(orgId).where('state', '==', 'waiting'))]);
      if ((day.get('count') ?? 0) >= MAX_PER_DAY || (from.get('count') ?? 0) >= MAX_PER_SENDER) {
        throw new HttpsError('resource-exhausted', 'Thank you! We already have your details for today. Please call the Hope Centre on 0794 645 455 if anything is missing.');
      }
      const held = heldChildren(waiting.docs.map((d) => d.data() as PledgeDoc), today);
      const childDocs = form.childIds.length ? await tx.getAll(...form.childIds.map((id) => db.doc(`organizations/${orgId}/children/${id}`))) : [];
      const peopleDocs = people.length ? await tx.getAll(...people) : [];
      const names: string[] = [];
      for (const [i, c] of childDocs.entries()) {
        const name = firstName(String(peopleDocs[i]?.get('fullName') ?? ''));
        if (!c.exists || !name || !listed(c.data() as never, kids.get(c.id)?.hidden ?? false)) throw new HttpsError('failed-precondition', 'One of the children you chose has just been sponsored. Please choose again.');
        if (held.has(c.id)) throw new HttpsError('failed-precondition', `${name} has just been chosen by someone else. Please choose another child.`);
        names.push(name);
      }
      const n = Number(count.get('next') ?? 1);
      const ref = pledgeRef(n);
      tx.set(counter, { next: n + 1 }, { merge: true });
      tx.set(dayRef, { count: FieldValue.increment(1), date: today }, { merge: true });
      tx.set(senderRef, { count: FieldValue.increment(1), date: today }, { merge: true });
      tx.set(pledge, {
        orgId, ref, state: 'waiting', childIds: form.childIds, childNames: names, general: form.general,
        name: form.name, email: form.email, phone: form.phone, country: form.country,
        promise: form.childIds.length ? SAFETY_PROMISE : null, dataConsent: DATA_CONSENT, agreedOn: today,
        date: today, holdUntil: holdUntil(today), createdAt: FieldValue.serverTimestamp(), createdBy: 'sponsor-page',
        receivedOn: null, receivedBy: null, receivedByName: null,
      });
      return { ref, names };
    });
    const names = pledgeFor(result.names, form.general);
    const first = firstName(form.name);
    const note = thankYouText(first, names, result.ref, settings);
    if (form.email) await send([form.email], [], `Thank you, ${first}`, note, 'sponsor-thanks');
    // Diana, with Andy and Doreen copied, hears about every pledge (10A).
    const leads = await circleLeadEmails('ministry', orgId).catch(() => ({ to: [] as string[], cc: [] as string[] }));
    const who = [form.name, form.country].filter(Boolean).join(', ');
    const contact = [form.email, form.phone].filter(Boolean).join(' · ') || 'no email or phone given';
    await send(leads.to, leads.cc, `New sponsor: ${form.name} (${result.ref})`,
      `${who} would like to support ${names.join(', ')}.\n\nContact: ${contact}\nReference: ${result.ref}\n\nWhen the money shows in the bank, open Sponsorship and tap Money received:\n${appUrl()}/hope/sponsorship`,
      'sponsor-new', EMAIL.test(form.email) ? form.email : undefined);
    return { ref: result.ref, names, text: note, amount: amountLabel(settings.amount, settings.per) };
  }

  // Everything below is for Diana, Andy and Doreen.
  const caller = await keeper(request, orgId);
  const me = caller.profile as UserProfile;
  const myName = me.displayName || caller.email;
  const stamp = { updatedAt: FieldValue.serverTimestamp(), updatedBy: caller.uid, updatedByName: myName };

  if (action === 'admin') {
    const settings = await loadSettings(orgId);
    const [children, kids, pledges] = await Promise.all([
      db.collection(`organizations/${orgId}/children`).get(), loadKids(orgId), pledgesCol(orgId).orderBy('createdAt', 'desc').limit(300).get(),
    ]);
    const list = pledges.docs.map((d) => ({ id: d.id, ...(d.data() as PledgeDoc), createdAt: undefined })).filter((p) => p.state !== 'deleted');
    const held = heldChildren(list, today);
    const rows = children.docs.filter((d) => listed({ ...d.data(), sponsorName: '' } as never, false)).map((d) => {
      const c = d.data();
      const k = kids.get(d.id);
      return {
        id: d.id, code: String(c.code ?? ''), sponsorName: String(c.sponsorName ?? ''), sponsored: !!String(c.sponsorName ?? '').trim(), hidden: k?.hidden ?? false, bio: k?.bio ?? '', amount: k?.amount ?? null,
        held: held.has(d.id), photo: c.photoConsent?.given === true && c.hasPhoto === true, consent: c.photoConsent?.given ?? null, photoOk: k?.photoOk ?? false,
      };
    });
    return { settings, children: rows, pledges: list, today };
  }

  if (caller.profile.roleId === 'reviewer') throw new HttpsError('permission-denied', 'Reviewers look at everything but change nothing.');

  if (action === 'settings') {
    const s = cleanSettings(data.settings);
    await settingsRef(orgId).set({ ...s, ...stamp });
    return { settings: s };
  }

  if (action === 'child') {
    const childId = requireString(data.childId, 'the child', { max: 60 });
    if (childId.includes('/')) throw new HttpsError('invalid-argument', 'Please check the child.');
    const c = await db.doc(`organizations/${orgId}/children/${childId}`).get();
    if (!c.exists || c.get('deletedAt')) throw new HttpsError('not-found', 'This child was not found.');
    const bio = typeof data.bio === 'string' ? data.bio.replace(/\s+/g, ' ').trim().slice(0, BIO_MAX) : '';
    await kidsCol(orgId).doc(childId).set({ orgId, bio, hidden: data.hidden === true, amount: cleanAmount(data.amount), photoOk: data.photoOk === true, ...stamp });
    return { ok: true };
  }

  if (action === 'delete') {
    // Andy or Doreen may delete any entry (Andy, 2026-11-18). It leaves every list and frees any child it held;
    // the record is kept underneath, marked deleted, so it can be found again if needed.
    if (!canKeepAccounts(caller.profile)) throw new HttpsError('permission-denied', 'Only Mr Andrew or Doreen can delete an entry.');
    const id = requireString(data.id, 'the entry', { max: 60 });
    const ref = pledgesCol(orgId).doc(id);
    const snap = await ref.get();
    if (!snap.exists || snap.get('state') === 'deleted') throw new HttpsError('not-found', 'That entry is no longer there.');
    await ref.update({ state: 'deleted', stateBefore: snap.get('state') ?? null, deletedOn: today, deletedAt: FieldValue.serverTimestamp(), deletedBy: caller.uid, deletedByName: myName });
    return { ok: true };
  }

  if (action === 'received' || action === 'cancel') {
    const id = requireString(data.id, 'the pledge', { max: 60 });
    const ref = pledgesCol(orgId).doc(id);
    const p = await db.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      const pl = snap.data() as PledgeDoc | undefined;
      if (!pl) throw new HttpsError('not-found', 'That pledge is no longer there.');
      if (pl.state !== 'waiting') throw new HttpsError('failed-precondition', 'That pledge has already been dealt with.');
      const kids = action === 'received' && pl.childIds.length ? await tx.getAll(...pl.childIds.map((c) => db.doc(`organizations/${orgId}/children/${c}`))) : [];
      if (action === 'received') {
        // The child becomes Sponsored with the giver's name, and leaves the public page (10A).
        for (const k of kids) {
          if (!k.exists || String(k.get('sponsorName') ?? '').trim()) continue;
          tx.update(k.ref, {
            sponsorName: pl.name, ...(pl.email && !k.get('sponsorEmail') ? { sponsorEmail: pl.email } : {}),
            ...(pl.phone && !k.get('sponsorPhone') ? { sponsorPhone: pl.phone.slice(0, 30) } : {}),
            updatedAt: FieldValue.serverTimestamp(), updatedBy: caller.uid,
          });
        }
      }
      tx.update(ref, action === 'received'
        ? { state: 'received', receivedOn: today, receivedBy: caller.uid, receivedByName: myName }
        : { state: 'cancelled', cancelledOn: today, cancelledBy: caller.uid, cancelledByName: myName });
      return pl;
    });
    let emailed = false;
    if (action === 'received' && p.email) {
      // The welcome pack (4A): each child's Sponsor update, made on the phone, attached.
      emailed = await send([p.email], [], `Your gift has arrived, ${firstName(p.name)}`, receivedText(firstName(p.name), pledgeFor(p.childNames, p.general), p.ref), 'sponsor-received', undefined, pdfAttachment(data.pdf));
    }
    return { ok: true, emailed };
  }

  if (action === 'update') {
    // The term update (4A): Diana, Andy or Doreen send it when they choose. Nothing goes out on its own.
    const id = requireString(data.id, 'the pledge', { max: 60 });
    const ref = pledgesCol(orgId).doc(id);
    const pl = (await ref.get()).data() as PledgeDoc | undefined;
    if (!pl || pl.state !== 'received') throw new HttpsError('failed-precondition', 'Updates go to sponsors whose money has arrived.');
    if (!EMAIL.test(pl.email)) throw new HttpsError('failed-precondition', 'This sponsor gave no email. Please send it on WhatsApp instead.');
    const files = pdfAttachment(data.pdf);
    if (!files) throw new HttpsError('invalid-argument', 'The update could not be attached. Please try again.');
    const ok = await send([pl.email], [], `News from Freedom Hope Centre, ${firstName(pl.name)}`, updateText(firstName(pl.name), pledgeFor(pl.childNames, false)), 'sponsor-update', undefined, files);
    if (!ok) throw new HttpsError('unavailable', 'The email could not be sent. Please try again.');
    await ref.update({ lastUpdateOn: today, lastUpdateBy: myName });
    return { ok: true };
  }

  throw new HttpsError('invalid-argument', 'Unknown action.');
});
