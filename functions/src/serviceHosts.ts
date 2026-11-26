import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { logger } from 'firebase-functions';
import { defineSecret } from 'firebase-functions/params';
import { HttpsError, onCall } from 'firebase-functions/v2/https';
import { onSchedule } from 'firebase-functions/v2/scheduler';
import { getStorage } from 'firebase-admin/storage';
import nodemailer, { type Transporter } from 'nodemailer';
import { db, FieldValue, requireCaller, requireString, writeAudit, type UserProfile } from './common.js';
import { can, canAccessOrg, isHostManagerAt, isPrayerManager, limitedCan, REVIEWER_ROLE_ID } from './shared/permissions.js';
import { letterheadFor } from './shared/pettyVoucher.js';
import { localDateKey } from './shared/datetime.js';
import { poweredByHtml } from './shared/poweredBy.js';
import {
  addDays, cleanAway, cleanEmail, cleanName, cleanPhone, cleanServices, cleanSpecials, clock, dayLabel, DOC_MAX_BYTES, firstName,
  hostMessage, isEmail, nextFree, PLAN_WEEKS, plannedDates, reminderFor, settingsOr, suggestFill, waNumber,
  welcomeMessage, isTeam, TEAM_INFO, TEAMS, type Team, type HostSettings, type ReminderKind, type RotaSlot, type ServiceHost,
} from './shared/serviceHosts.js';

/**
 * Service hosts (Andy, 2026-11-17). Everything is written here, never by the app: the hosts list, the services,
 * the requirements document, who hosts each date, and the hosts' own Yes / I can't answers (they never sign in,
 * so their link carries a signed token). Reminders go from the church's Gmail at 6 PM; Andy gets a Monday summary.
 */
const CHURCH_EMAIL_APP_PASSWORD = defineSecret('CHURCH_EMAIL_APP_PASSWORD');
const TZ = 'Africa/Nairobi';
const appUrl = () => process.env.APP_URL || 'https://freedom-chms.web.app';
const HOST_ID = /^[A-Za-z0-9]{6,40}$/;
const SLOT_ID = /^\d{4}-\d{2}-\d{2}_[a-z0-9]{3,24}$/;

// Each team (Service hosts, Sunday prayer) keeps its own collections (TEAM_INFO.col).
const hostsCol = (team: Team, orgId: string) => db.collection(`organizations/${orgId}/${TEAM_INFO[team].col.people}`);
const rotaCol = (team: Team, orgId: string) => db.collection(`organizations/${orgId}/${TEAM_INFO[team].col.rota}`);
const settingsRef = (team: Team, orgId: string) => db.doc(`organizations/${orgId}/${TEAM_INFO[team].col.settings}/main`);
const sentCol = (team: Team, orgId: string) => db.collection(`organizations/${orgId}/${TEAM_INFO[team].col.sent}`);

interface Org { id: string; name: string; type: string; serviceTimes: string[] }
async function loadOrg(orgId: string): Promise<Org> {
  const o = await db.doc(`organizations/${orgId}`).get();
  if (!o.exists || o.get('deletedAt') != null) throw new HttpsError('not-found', 'This church was not found.');
  return { id: orgId, name: String(o.get('name') ?? 'Freedom Church'), type: String(o.get('type') ?? ''), serviceTimes: (o.get('serviceTimes') as string[] | undefined) ?? [] };
}
async function loadSettings(team: Team, org: Org): Promise<HostSettings> {
  return settingsOr((await settingsRef(team, org.id).get()).data() as Partial<HostSettings> | undefined, org.serviceTimes, team);
}
async function loadHosts(team: Team, orgId: string): Promise<ServiceHost[]> {
  const snap = await hostsCol(team, orgId).get();
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }) as ServiceHost).filter((h) => !h.deletedAt);
}
async function loadRota(team: Team, orgId: string, from: string, to: string): Promise<RotaSlot[]> {
  const snap = await rotaCol(team, orgId).where('date', '>=', from).where('date', '<=', to).get();
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }) as RotaSlot);
}

/** Andy, plus the leaders he ticks in Settings (10A). */
export const isHostManager = (p: UserProfile | undefined | null) => !!p && (can(p, 'rota.manage') || can(p, 'users.manage'));

/* ---------- The hosts' own links ---------- */

const hmac = (key: string, value: string) => createHmac('sha256', Buffer.from(key, 'hex')).update(value).digest('hex');
async function linkKey(): Promise<string> {
  const ref = db.doc('serviceHostKeys/_links');
  const snap = await ref.get();
  if (snap.exists) return String(snap.get('key'));
  await ref.create({ key: randomBytes(24).toString('hex'), createdAt: FieldValue.serverTimestamp() }).catch(() => undefined);
  return String((await ref.get()).get('key'));
}
const tokenFor = (team: Team, key: string, orgId: string, slot: string, hostId: string) => `${slot}~${hostId}~${hmac(key, `${team}|${orgId}|${slot}|${hostId}`).slice(0, 24)}`;
async function linkFor(team: Team, orgId: string, slot: string, hostId: string): Promise<string> {
  return `${appUrl()}/${TEAM_INFO[team].answerPath}/${encodeURIComponent(orgId)}/${tokenFor(team, await linkKey(), orgId, slot, hostId)}`;
}
async function readToken(team: Team, orgId: string, token: string): Promise<{ slot: string; hostId: string }> {
  const [slot = '', hostId = '', sig = ''] = token.split('~');
  if (!SLOT_ID.test(slot) || !HOST_ID.test(hostId)) throw new HttpsError('not-found', 'This link is not right.');
  const want = Buffer.from(tokenFor(team, await linkKey(), orgId, slot, hostId).split('~')[2]!);
  const got = Buffer.from(sig);
  if (want.length !== got.length || !timingSafeEqual(want, got)) throw new HttpsError('not-found', 'This link is not right.');
  return { slot, hostId };
}

/* ---------- Email ---------- */

let transport: Transporter | null = null;
function mailer(org: Org): { t: Transporter; from: string; name: string } | null {
  const lh = letterheadFor({ type: org.type, name: org.name });
  let pass = '';
  if (process.env.PETTY_MAIL_TEST_DIR) pass = 'test';
  else { try { pass = CHURCH_EMAIL_APP_PASSWORD.value().replace(/\s+/g, ''); } catch { pass = ''; } }
  if (!lh.email || !pass) return null;
  transport ??= process.env.PETTY_MAIL_TEST_DIR ? nodemailer.createTransport({ jsonTransport: true }) : nodemailer.createTransport({ service: 'gmail', auth: { user: lh.email, pass } });
  return { t: transport, from: lh.email, name: lh.name };
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const button = (href: string, label: string, colour: string) =>
  `<a href="${esc(href)}" style="background:${colour};color:#ffffff;text-decoration:none;padding:12px 20px;border-radius:8px;font-size:15px;font-weight:bold;display:inline-block;margin:0 8px 8px 0">${label}</a>`;

function html(team: Team, org: Org, heading: string, text: string, buttons = ''): string {
  // The link line is shown as buttons instead of a bare address.
  const body = text.split('\n').filter((l) => !/https?:\/\//.test(l)).join('\n').trim();
  return `<!doctype html><html><body style="margin:0;background:#f4f5f9;font-family:Arial,Helvetica,sans-serif">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f5f9;padding:24px 0"><tr><td align="center">
<table role="presentation" width="560" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border-radius:14px;overflow:hidden">
<tr><td style="background:#2e8b57;height:6px"></td></tr>
<tr><td style="padding:24px 28px 8px;color:#6b7280;font-size:13px">${esc(org.name)} · ${TEAM_INFO[team].roles}</td></tr>
<tr><td style="padding:0 28px 10px;color:#0b112c;font-size:21px;font-weight:bold">${esc(heading)}</td></tr>
<tr><td style="padding:4px 28px 14px;color:#1f2937;font-size:15px;line-height:1.5;white-space:pre-wrap">${esc(body)}</td></tr>
${buttons ? `<tr><td style="padding:4px 28px 18px">${buttons}</td></tr>` : ''}
<tr><td style="padding:14px 28px 22px;color:#6b7280;font-size:12px;border-top:1px solid #f1f1f1">Sent from Insight-IQ for ${esc(org.name)}.${poweredByHtml()}</td></tr>
</table></td></tr></table></body></html>`;
}

async function docAttachment(s: HostSettings): Promise<{ filename: string; content: Buffer; contentType: string }[]> {
  if (!s.doc) return [];
  try {
    const [buf] = await getStorage().bucket().file(s.doc.path).download();
    return [{ filename: s.doc.name, content: buf, contentType: s.doc.type || 'application/octet-stream' }];
  } catch (err) {
    logger.warn('Service host document could not be read', err);
    return [];
  }
}

async function send(org: Org, to: { name: string; email: string }[], subject: string, text: string, htmlBody: string, attachments: Awaited<ReturnType<typeof docAttachment>> = []): Promise<number> {
  const m = mailer(org);
  if (!m) return 0;
  let sent = 0;
  for (const r of to) {
    if (!isEmail(r.email)) continue;
    try {
      await m.t.sendMail({ from: `"${m.name}" <${m.from}>`, to: `"${r.name.replace(/"/g, '')}" <${r.email}>`, subject, text: `${text}\n\nPowered by Insight-IQ`, html: htmlBody, attachments });
      sent += 1;
    } catch (err) {
      logger.warn('Service host email failed', err);
      if ((err as { code?: string })?.code === 'EAUTH') break;
    }
  }
  return sent;
}

/** Who hears about a team (Andy, 2026-11-26, 6A): Service hosts to Diana, Andy and Doreen; Sunday prayer to Andy, Doreen and Elizabeth. */
async function managersOf(team: Team, orgId: string): Promise<{ name: string; email: string }[]> {
  const snap = await db.collection('users').where('active', '==', true).get();
  return snap.docs.map((d) => d.data() as UserProfile)
    .filter((u) => u.roleId !== REVIEWER_ROLE_ID && isEmail(u.email ?? '')
      && (team === 'prayer' ? isPrayerManager(u, orgId) : isHostManagerAt(u, orgId)))
    .map((u) => ({ name: u.displayName || u.email, email: u.email }));
}

async function sendReminder(team: Team, org: Org, s: HostSettings, slot: RotaSlot, host: ServiceHost, days: number, kind: ReminderKind): Promise<number> {
  const link = await linkFor(team, org.id, slot.id, host.id);
  const m = hostMessage({ church: org.name, hostName: host.name, serviceName: slot.serviceName, date: slot.date, time: slot.time, days, kind, link, doc: s.doc ? 'attached' : null, team });
  const buttons = kind === 'ask'
    ? `${button(`${link}?a=yes`, "✓ Yes, I'll lead", '#2e8b57')}${button(`${link}?a=no`, "I can't", '#b42318')}`
    : button(link, 'Open my details', '#0b112c');
  return send(org, [{ name: host.name, email: host.email }], m.subject, m.text, html(team, org, m.subject, m.text, buttons), await docAttachment(s));
}

/* ---------- What Andy and his leaders do ---------- */

export const serviceHosts = onCall({ invoker: 'public', memory: '512MiB', timeoutSeconds: 120, secrets: [CHURCH_EMAIL_APP_PASSWORD] }, async (request) => {
  const data = (request.data ?? {}) as Record<string, unknown>;
  const action = String(data.action ?? '');
  const orgId = requireString(data.orgId, 'the church', { max: 80 });
  // Service hosts or the Sunday prayer schedule (Andy, 2026-11-17).
  const team: Team = isTeam(data.team) ? data.team : 'host';
  const info = TEAM_INFO[team];
  const today = localDateKey(new Date(), TZ);

  // A host's own link: no sign-in.
  if (action === 'answerInfo' || action === 'answer' || action === 'answerDoc') {
    const org = await loadOrg(orgId);
    const { slot: sid, hostId } = await readToken(team, orgId, requireString(data.token, 'the link', { max: 200 }));
    const ref = rotaCol(team, orgId).doc(sid);
    const [snap, hostSnap, s] = await Promise.all([ref.get(), hostsCol(team, orgId).doc(hostId).get(), loadSettings(team, org)]);
    const slot = snap.exists ? ({ id: snap.id, ...snap.data() } as RotaSlot) : null;
    const mine = !!slot && slot.hostId === hostId && slot.status === 'set';
    if (action === 'answerDoc') {
      // A host reached on WhatsApp reads the requirements from their own link.
      if (!hostSnap.exists || hostSnap.get('deletedAt') || !s.doc) throw new HttpsError('not-found', 'The requirements are not available.');
      const [buf] = await getStorage().bucket().file(s.doc.path).download();
      return { name: s.doc.name, type: s.doc.type, base64: buf.toString('base64') };
    }
    if (action === 'answer') {
      if (!mine) throw new HttpsError('failed-precondition', 'This service is no longer yours. Thank you all the same.');
      if (slot!.date < today) throw new HttpsError('failed-precondition', 'This service has already happened.');
      const answer = data.answer === 'yes' ? 'yes' : data.answer === 'no' ? 'no' : '';
      if (!answer) throw new HttpsError('invalid-argument', 'Please choose Yes or I can\'t.');
      const reason = typeof data.reason === 'string' ? data.reason.trim().slice(0, 300) : '';
      const changed = slot!.answer !== answer;
      await ref.update({ answer, reason: answer === 'no' ? reason : '', answeredOn: today, updatedAt: FieldValue.serverTimestamp() });
      if (changed && answer === 'no') {
        // 5A: Andy hears at once, with the next free host to ask.
        const [hosts, rota] = await Promise.all([loadHosts(team, orgId), loadRota(team, orgId, addDays(today, -180), addDays(today, PLAN_WEEKS * 7))]);
        const next = nextFree(slot!.date, hosts, rota.filter((r) => r.id !== slot!.id), [hostId]);
        const hostName = String(hostSnap.get('name') ?? slot!.hostName);
        const subject = `${hostName} can't lead the ${slot!.serviceName} on ${dayLabel(slot!.date, false)}`;
        const text = `${hostName} said they can't lead the ${slot!.serviceName} on ${dayLabel(slot!.date, false)}${slot!.time ? ` at ${clock(slot!.time)}` : ''}.${reason ? `\nTheir reason: ${reason}` : ''}\n\n${next ? `${next.name} is free that day and has had the fewest turns.` : 'Nobody else is free that day yet.'} Open ${info.title} to choose someone.\n${appUrl()}${info.page}`;
        await send(org, await managersOf(team, orgId), subject, text, html(team, org, subject, text, button(`${appUrl()}${info.page}`, 'Choose someone else', '#0b112c')));
      }
      return { ok: true, answer };
    }
    return {
      church: org.name,
      firstName: firstName(String(hostSnap.get('name') ?? '')),
      mine,
      past: !!slot && slot.date < today,
      serviceName: slot?.serviceName ?? '',
      date: slot?.date ?? '',
      time: slot?.time ?? '',
      answer: mine ? slot!.answer : 'pending',
      hasDoc: !!s.doc,
    };
  }

  const caller = await requireCaller(request, undefined, { reviewerOk: action === 'downloadDoc' && team === 'host' });
  // Sunday prayer is its own (Andy, 2026-11-26): Andy, Doreen and whoever they tick, even from another organization.
  if (team === 'prayer') {
    if (!isPrayerManager(caller.profile, orgId)) throw new HttpsError('permission-denied', 'Only Mr Andrew, Doreen and the people they choose plan the Sunday prayer schedule.');
  } else {
    const reviewer = action === 'downloadDoc' && caller.profile.roleId === REVIEWER_ROLE_ID && canAccessOrg(caller.profile, orgId);
    if (!isHostManagerAt(caller.profile, orgId) && !reviewer) {
      throw new HttpsError('permission-denied', `Only Mr Andrew and the leaders he chooses plan the ${info.title.toLowerCase()} schedule.`);
    }
  }
  const org = await loadOrg(orgId);
  if (org.type !== 'church_campus') throw new HttpsError('failed-precondition', `${info.title} is part of the church.`);
  const audit = (docPath: string, note: string) => writeAudit({ actorUid: caller.uid, actorEmail: caller.email, action: 'update', path: docPath, collection: docPath.split('/').at(-2) ?? '', docId: docPath.split('/').at(-1) ?? '', orgId, note });

  if (action === 'saveHost') {
    const id = typeof data.id === 'string' && HOST_ID.test(data.id) ? data.id : '';
    const name = cleanName(data.name);
    if (name.length < 2) throw new HttpsError('invalid-argument', 'Please type the host\'s name.');
    const phone = cleanPhone(data.phone);
    const email = cleanEmail(data.email);
    if (email && !isEmail(email)) throw new HttpsError('invalid-argument', 'Please check the email address.');
    if (!phone && !email) throw new HttpsError('invalid-argument', 'Please add a phone number or an email, so the host can be reminded.');
    const personId = typeof data.personId === 'string' && /^[A-Za-z0-9_-]{4,60}$/.test(data.personId) ? data.personId : null;
    const fields = { name, phone, email, personId, active: data.active !== false, away: cleanAway(data.away), updatedAt: FieldValue.serverTimestamp(), updatedBy: caller.uid };
    const ref = id ? hostsCol(team, orgId).doc(id) : hostsCol(team, orgId).doc();
    let welcomed = false;
    if (id) {
      const before = await ref.get();
      if (!before.exists || before.get('deletedAt')) throw new HttpsError('not-found', 'This host was not found.');
      await ref.update(fields);
      // A new name shows on the dates they already have.
      if (before.get('name') !== name) {
        const theirs = await rotaCol(team, orgId).where('hostId', '==', id).get();
        await Promise.all(theirs.docs.map((d) => d.ref.update({ hostName: name })));
      }
    } else {
      await ref.set({ ...fields, orgId, joinedOn: today, deletedAt: null, createdAt: FieldValue.serverTimestamp(), createdBy: caller.uid });
      // 8A: a welcome email with the requirements when someone joins.
      if (email) {
        const s = await loadSettings(team, org);
        const w = welcomeMessage(org.name, name, !!s.doc, team);
        welcomed = (await send(org, [{ name, email }], w.subject, w.text, html(team, org, w.subject, w.text), await docAttachment(s))) > 0;
      }
    }
    await audit(ref.path, id ? `${info.role} changed` : `${info.role} added`);
    return { id: ref.id, welcomed };
  }

  if (action === 'removeHost') {
    const id = requireString(data.id, 'the host', { max: 40 });
    const ref = hostsCol(team, orgId).doc(id);
    await ref.update({ deletedAt: FieldValue.serverTimestamp(), deletedBy: caller.uid, active: false });
    // Their future dates become empty again.
    const theirs = await rotaCol(team, orgId).where('hostId', '==', id).get();
    await Promise.all(theirs.docs.filter((d) => String(d.get('date')) >= today).map((d) => d.ref.delete()));
    await audit(ref.path, `${info.role} removed`);
    return { ok: true };
  }

  if (action === 'saveSettings') {
    const services = cleanServices(data.services);
    if (!services.length) throw new HttpsError('invalid-argument', 'Keep at least one service.');
    await settingsRef(team, orgId).set({ services, specials: cleanSpecials(data.specials), updatedAt: FieldValue.serverTimestamp(), updatedBy: caller.uid }, { merge: true });
    await audit(settingsRef(team, orgId).path, `${info.title} services changed`);
    return { ok: true };
  }

  if (action === 'uploadDoc') {
    const name = requireString(data.name, 'the file name', { max: 120 }).replace(/[\\/:*?"<>|]+/g, '-');
    if (!/\.(pdf|docx?|odt|txt)$/i.test(name)) throw new HttpsError('invalid-argument', 'Please choose a PDF or Word document.');
    const buf = Buffer.from(requireString(data.base64, 'the file', { max: Math.ceil(DOC_MAX_BYTES * 1.4) }), 'base64');
    if (!buf.length || buf.length > DOC_MAX_BYTES) throw new HttpsError('invalid-argument', 'The document must be smaller than 6 MB.');
    const type = /\.pdf$/i.test(name) ? 'application/pdf' : /\.docx$/i.test(name) ? 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' : /\.doc$/i.test(name) ? 'application/msword' : /\.odt$/i.test(name) ? 'application/vnd.oasis.opendocument.text' : 'text/plain';
    const path = `${info.col.people}/${orgId}/${randomBytes(6).toString('hex')}-${name}`;
    const old = (await settingsRef(team, orgId).get()).get('doc') as HostSettings['doc'] | undefined;
    await getStorage().bucket().file(path).save(buf, { contentType: type, resumable: false });
    await settingsRef(team, orgId).set({ doc: { name, type, size: buf.length, path, uploadedOn: today }, updatedAt: FieldValue.serverTimestamp(), updatedBy: caller.uid }, { merge: true });
    if (old?.path) await getStorage().bucket().file(old.path).delete().catch(() => undefined);
    await audit(settingsRef(team, orgId).path, `${info.title} requirements document uploaded`);
    return { ok: true };
  }

  if (action === 'removeDoc') {
    const old = (await settingsRef(team, orgId).get()).get('doc') as HostSettings['doc'] | undefined;
    await settingsRef(team, orgId).set({ doc: null, updatedAt: FieldValue.serverTimestamp(), updatedBy: caller.uid }, { merge: true });
    if (old?.path) await getStorage().bucket().file(old.path).delete().catch(() => undefined);
    return { ok: true };
  }

  if (action === 'downloadDoc') {
    const s = await loadSettings(team, org);
    if (!s.doc) throw new HttpsError('not-found', 'No document has been uploaded yet.');
    const [buf] = await getStorage().bucket().file(s.doc.path).download();
    return { name: s.doc.name, type: s.doc.type, base64: buf.toString('base64') };
  }

  if (action === 'assign') {
    const sid = requireString(data.slotId, 'the date', { max: 40 });
    if (!SLOT_ID.test(sid)) throw new HttpsError('invalid-argument', 'Please check the date.');
    const date = sid.slice(0, 10);
    if (date < today) throw new HttpsError('failed-precondition', 'This date has passed.');
    const s = await loadSettings(team, org);
    const planned = plannedDates(s, date, 1).find((p) => p.id === sid);
    if (!planned) throw new HttpsError('failed-precondition', 'This service is no longer on the list. Check Services in Settings.');
    const ref = rotaCol(team, orgId).doc(sid);
    const hostId = typeof data.hostId === 'string' && data.hostId ? data.hostId : null;
    if (!hostId) { await ref.delete(); return { ok: true }; }
    const h = await hostsCol(team, orgId).doc(hostId).get();
    if (!h.exists || h.get('deletedAt') || h.get('active') === false) throw new HttpsError('not-found', 'This host was not found.');
    const before = await ref.get();
    const same = before.exists && before.get('hostId') === hostId;
    await ref.set({
      orgId, date, serviceKey: planned.serviceKey, serviceName: planned.serviceName, time: planned.time, hostId, hostName: String(h.get('name')),
      status: 'set', ...(same ? {} : { answer: 'pending', reason: '', answeredOn: null }), updatedAt: FieldValue.serverTimestamp(), updatedBy: caller.uid,
    }, { merge: true });
    return { ok: true };
  }

  if (action === 'suggest') {
    const s = await loadSettings(team, org);
    const from = addDays(today, 1);
    const dates = plannedDates(s, from);
    const [hosts, rota] = await Promise.all([loadHosts(team, orgId), loadRota(team, orgId, addDays(today, -180), addDays(from, PLAN_WEEKS * 7))]);
    const usable = rota.filter((r) => r.status === 'set');
    const fill = suggestFill(dates, hosts, usable);
    const byId = new Map(hosts.map((h) => [h.id, h]));
    const batch = db.batch();
    for (const d of dates) {
      const pick = fill.get(d.id);
      const existing = rota.find((r) => r.id === d.id);
      if (existing?.status === 'set' && existing.answer !== 'no') continue;
      if (!pick) continue;
      if (existing?.status === 'set') continue; // a "can't" date stays for Andy to choose himself
      batch.set(rotaCol(team, orgId).doc(d.id), {
        orgId, date: d.date, serviceKey: d.serviceKey, serviceName: d.serviceName, time: d.time, hostId: pick, hostName: byId.get(pick)!.name,
        status: 'suggested', answer: 'pending', reason: '', answeredOn: null, updatedAt: FieldValue.serverTimestamp(), updatedBy: caller.uid,
      });
    }
    await batch.commit();
    return { suggested: fill.size, hosts: hosts.filter((h) => h.active).length };
  }

  if (action === 'useSuggestions' || action === 'clearSuggestions') {
    const snap = await rotaCol(team, orgId).where('status', '==', 'suggested').get();
    const ids = Array.isArray(data.slotIds) ? new Set((data.slotIds as unknown[]).filter((x): x is string => typeof x === 'string')) : null;
    const batch = db.batch();
    let n = 0;
    for (const d of snap.docs) {
      if (ids && !ids.has(d.id)) continue;
      if (action === 'useSuggestions') batch.update(d.ref, { status: 'set', updatedAt: FieldValue.serverTimestamp(), updatedBy: caller.uid });
      else batch.delete(d.ref);
      n += 1;
    }
    await batch.commit();
    return { count: n };
  }

  if (action === 'whatsapp') {
    // 6A: the same words as the email, for Andy or a helper to send with one tap.
    const sid = requireString(data.slotId, 'the date', { max: 40 });
    const snap = await rotaCol(team, orgId).doc(sid).get();
    if (!snap.exists) throw new HttpsError('not-found', 'Choose a host first.');
    const slot = { id: snap.id, ...snap.data() } as RotaSlot;
    const h = await hostsCol(team, orgId).doc(slot.hostId ?? '_').get();
    if (!h.exists) throw new HttpsError('not-found', 'This host was not found.');
    const s = await loadSettings(team, org);
    const days = Math.max(0, Math.round((Date.parse(slot.date) - Date.parse(today)) / 86_400_000));
    const kind: ReminderKind = slot.answer === 'yes' ? 'routine' : 'ask';
    const m = hostMessage({ church: org.name, hostName: String(h.get('name')), serviceName: slot.serviceName, date: slot.date, time: slot.time, days: days || 1, kind, link: await linkFor(team, orgId, slot.id, h.id), doc: s.doc ? 'link' : null, team });
    await snap.ref.update({ waOn: today });
    return { phone: waNumber(String(h.get('phone') ?? '')), text: m.text };
  }

  throw new HttpsError('invalid-argument', 'Unknown action.');
});

/* ---------- 6 PM reminders and the Monday summary ---------- */

async function churches(): Promise<Org[]> {
  const snap = await db.collection('organizations').where('type', '==', 'church_campus').get();
  return snap.docs.filter((o) => o.get('deletedAt') == null && o.get('active') !== false)
    .map((o) => ({ id: o.id, name: String(o.get('name') ?? ''), type: 'church_campus', serviceTimes: (o.get('serviceTimes') as string[] | undefined) ?? [] }));
}

export async function sendHostReminders(now = new Date()): Promise<number> {
  const today = localDateKey(now, TZ);
  let sent = 0;
  for (const org of await churches()) for (const team of TEAMS) {
    const slots = (await loadRota(team, org.id, addDays(today, 1), addDays(today, 7))).filter((r) => r.status === 'set' && r.hostId);
    if (!slots.length) continue;
    const [s, hosts] = await Promise.all([loadSettings(team, org), loadHosts(team, org.id)]);
    const byId = new Map(hosts.map((h) => [h.id, h]));
    for (const slot of slots) {
      const host = byId.get(slot.hostId!);
      if (!host || !host.active) continue;
      const before = await sentCol(team, org.id).where('slotId', '==', slot.id).where('hostId', '==', host.id).get();
      const r = reminderFor(slot, today, before.docs.map((d) => Number(d.get('days'))));
      if (!r) continue;
      const ref = sentCol(team, org.id).doc(`${slot.id}_${host.id}_${r.days}`);
      try { await ref.create({ slotId: slot.id, hostId: host.id, days: r.days, kind: r.kind, on: today, at: FieldValue.serverTimestamp() }); } catch { continue; }
      const emails = host.email ? await sendReminder(team, org, s, slot, host, r.days, r.kind) : 0;
      await Promise.all([ref.update({ emails }), rotaCol(team, org.id).doc(slot.id).update({ remindedOn: today, remindedDays: r.days, remindedKind: r.kind })]);
      sent += 1;
    }
  }
  return sent;
}

export const serviceHostReminders = onSchedule(
  { schedule: '0 18 * * *', timeZone: TZ, region: process.env.SCHEDULER_REGION || 'europe-west1', timeoutSeconds: 300, secrets: [CHURCH_EMAIL_APP_PASSWORD] },
  async () => { await sendHostReminders(); },
);

const ANSWER_WORD = { yes: '✓ Accepted', no: "✗ Can't", pending: '… Waiting for an answer' } as const;

export async function sendHostSummary(now = new Date()): Promise<number> {
  const today = localDateKey(now, TZ);
  let sent = 0;
  for (const org of await churches()) for (const team of TEAMS) {
    const info = TEAM_INFO[team];
    // Only a team that has people (the prayer schedule stays quiet until Andy starts it).
    if (!(await loadHosts(team, org.id)).length) continue;
    const s = await loadSettings(team, org);
    const dates = plannedDates(s, today, 4);
    const rota = new Map((await loadRota(team, org.id, today, addDays(today, 28))).map((r) => [r.id, r]));
    if (!dates.length) continue;
    const lines = dates.map((d) => {
      const r = rota.get(d.id);
      const who = r?.status === 'set' && r.hostId ? `${r.hostName} · ${ANSWER_WORD[r.answer] ?? ''}` : r?.status === 'suggested' ? `${r.hostName} (suggested, not chosen yet)` : 'Nobody yet';
      return `${dayLabel(d.date, false)} · ${d.serviceName}: ${who}`;
    });
    const empty = dates.filter((d) => !(rota.get(d.id)?.status === 'set' && rota.get(d.id)?.answer !== 'no')).length;
    const subject = `${info.roles} for the next 4 weeks${empty ? ` (${empty} still need someone)` : ''}`;
    const text = `Good morning. Here are the ${info.roles} for the coming weeks at ${org.name}:\n\n${lines.join('\n')}\n\nOpen ${info.title}: ${appUrl()}${info.page}`;
    sent += await send(org, await managersOf(team, org.id), subject, text, html(team, org, subject, text, button(`${appUrl()}${info.page}`, `Open ${info.title}`, '#0b112c')));
  }
  return sent;
}

export const serviceHostSummary = onSchedule(
  { schedule: '0 7 * * 1', timeZone: TZ, region: process.env.SCHEDULER_REGION || 'europe-west1', timeoutSeconds: 180, secrets: [CHURCH_EMAIL_APP_PASSWORD] },
  async () => { await sendHostSummary(); },
);


/**
 * Sunday numbers for the "Freedom Church, limited" tick (Andy, 2026-11-26, 2A 3A): each service of the last eight
 * weeks with its counts and the names of who checked in, to look at only. Read here so the person never needs the
 * church's people list.
 */
export const sundayNumbers = onCall({ memory: '512MiB', timeoutSeconds: 60 }, async (request) => {
  const data = (request.data ?? {}) as Record<string, unknown>;
  const orgId = requireString(data.orgId, 'the church', { max: 80 });
  const caller = await requireCaller(request);
  const full = canAccessOrg(caller.profile, orgId) && (can(caller.profile, 'people.read') || can(caller.profile, 'attendance.write'));
  if (!full && !limitedCan(caller.profile, orgId, 'sunday')) throw new HttpsError('permission-denied', 'Only the people Mr Andrew chooses see the Sunday numbers.');
  const today = localDateKey(new Date(), TZ);
  const from = addDays(today, -56);
  const base = `organizations/${orgId}`;
  const evSnap = await db.collection(`${base}/events`).where('date', '>=', from).where('date', '<=', today).get();
  const services = evSnap.docs
    .map((d) => ({ id: d.id, ...(d.data() as { date: string; type: string; name?: string; programId?: string | null; groupId?: string | null; deletedAt?: unknown; headcounts?: Record<string, number> | null }) }))
    .filter((e) => e.type === 'service' && !e.programId && !e.groupId && !e.deletedAt)
    .sort((a, b) => b.date.localeCompare(a.date) || (a.name ?? '').localeCompare(b.name ?? ''));
  const marks = await Promise.all(services.map((e) => db.collection(`${base}/attendance`).where('eventId', '==', e.id).get()));
  const ids = [...new Set(marks.flatMap((m) => m.docs.filter((d) => ['present', 'late'].includes(d.get('status')) && !d.get('deletedAt')).map((d) => String(d.get('personId')))))];
  const names = new Map<string, string>();
  for (let i = 0; i < ids.length; i += 300) {
    const refs = ids.slice(i, i + 300).map((id) => db.doc(`${base}/people/${id}`));
    if (refs.length) for (const p of await db.getAll(...refs)) if (p.exists && !p.get('deletedAt')) names.set(p.id, String(p.get('fullName') ?? ''));
  }
  const keys = ['adults', 'teens', 'children', 'youth', 'all', 'firstTimers', 'salvations'];
  return {
    services: services.map((e, i) => {
      const h = e.headcounts ?? {};
      const counts: Record<string, number> = {};
      for (const k of keys) if (typeof h[k] === 'number' && h[k]! > 0) counts[k] = h[k]!;
      const people = marks[i]!.docs.filter((d) => ['present', 'late'].includes(d.get('status')) && !d.get('deletedAt'))
        .map((d) => names.get(String(d.get('personId'))) ?? '').filter(Boolean).sort((a, b) => a.localeCompare(b));
      return { id: e.id, date: e.date, name: e.name ?? 'Service', counts, people };
    }),
  };
});
