import { createHmac, timingSafeEqual } from 'node:crypto';
import { onDocumentWritten } from 'firebase-functions/v2/firestore';
import { onSchedule } from 'firebase-functions/v2/scheduler';
import { onRequest } from 'firebase-functions/v2/https';
import { defineSecret } from 'firebase-functions/params';
import { logger } from 'firebase-functions/v2';
import { FieldValue, Timestamp, type DocumentData } from 'firebase-admin/firestore';
import { db } from './common.js';
import { DEFAULT_TIME_ZONE, zonedParts } from './shared/datetime.js';
import { recipientFor, firstNameOf, type Contact } from './shared/followups.js';
import {
  AUTO_TEMPLATES, autoTemplate, buildParams, digitsOf, failureHint, isSendingHour, isStopMessage, metaNameFor, modeFor,
  nextStatus, previewText, readyToSend, sendPayload, sendingReady, withWhatsAppDefaults, type OutboxStatus, type WhatsAppSettings,
} from './shared/whatsapp.js';

/** Set with `firebase functions:secrets:set` (scripts/whatsapp-setup.sh). Never written in code, Firestore or chat. */
const WHATSAPP_TOKEN = defineSecret('WHATSAPP_TOKEN');
const WHATSAPP_APP_SECRET = defineSecret('WHATSAPP_APP_SECRET');
const WHATSAPP_VERIFY_TOKEN = defineSecret('WHATSAPP_VERIFY_TOKEN');

const SYSTEM = 'system';
const MAX_PER_RUN = 50;
const apiBase = () => process.env.WHATSAPP_API_BASE || 'https://graph.facebook.com/v21.0';

async function loadSettings(): Promise<WhatsAppSettings> {
  const snap = await db.doc('settings/whatsapp').get();
  return withWhatsAppDefaults(snap.exists ? (snap.data() as Partial<WhatsAppSettings>) : null);
}

const stamps = () => ({ updatedAt: FieldValue.serverTimestamp(), updatedBy: SYSTEM });

function contactOf(id: string, d: DocumentData | undefined): Contact | null {
  if (!d || d.deletedAt != null) return null;
  return {
    id,
    fullName: (d.fullName as string) ?? '',
    firstName: d.firstName as string | undefined,
    status: d.status as string | undefined,
    phone: (d.phone as string | null) ?? null,
    whatsapp: (d.whatsapp as string | null) ?? null,
    whatsappConsent: (d.whatsappConsent as Contact['whatsappConsent']) ?? null,
    guardianId: (d.guardianId as string | null) ?? null,
  };
}

async function recipientOfTask(orgId: string, personId: string) {
  const base = `organizations/${orgId}/people`;
  const person = contactOf(personId, (await db.doc(`${base}/${personId}`).get()).data());
  if (!person) return null;
  const guardian = person.guardianId ? contactOf(person.guardianId, (await db.doc(`${base}/${person.guardianId}`).get()).data()) : null;
  return { person, recipient: recipientFor(person, guardian) };
}

/** The values that fill a template's slots. `staffName` is whoever approved it; automatic messages are signed by "the team". */
function fieldsFor(org: DocumentData, to: Contact, about: Contact, viaGuardian: boolean, staffName: string) {
  return {
    first_name: firstNameOf(to),
    child_name: viaGuardian ? firstNameOf(about) : '',
    campus: (org.name as string | undefined) ?? '',
    service_time: ((org.serviceTimes as string[] | undefined) ?? [])[0] ?? '',
    staff_name: staffName.split(' ')[0] ?? '',
  };
}

const todayIn = (timeZone: string, now = new Date()) => {
  const p = zonedParts(now, timeZone);
  return `${p.year}-${String(p.month).padStart(2, '0')}-${String(p.day).padStart(2, '0')}`;
};

// ---- 1. Every hour: turn due follow-ups into messages waiting to be approved (or sent) ----------

const AUTO_IDS = AUTO_TEMPLATES.map((t) => t.id);

export async function queueWhatsappDue(now = new Date()): Promise<{ queued: number }> {
  const settings = await loadSettings();
  if (!sendingReady(settings) || !AUTO_IDS.some((id) => modeFor(settings, id) !== 'off')) return { queued: 0 };
  let queued = 0;
  const orgs = await db.collection('organizations').get();
  for (const org of orgs.docs) {
    if (org.get('deletedAt') != null || org.get('active') === false) continue;
    const timeZone = (org.get('timeZone') as string | undefined) ?? DEFAULT_TIME_ZONE;
    if (!isSendingHour(now, timeZone)) continue;
    const tasks = await db.collection(`organizations/${org.id}/followUps`).where('status', '==', 'open').where('templateId', 'in', AUTO_IDS).get();
    let made = 0;
    for (const task of tasks.docs) {
      if (made >= MAX_PER_RUN) break;
      const templateId = task.get('templateId') as string;
      const mode = modeFor(settings, templateId);
      const dueAt = (task.get('dueAt') as Timestamp | undefined)?.toDate() ?? null;
      if (mode === 'off' || task.get('deletedAt') != null || task.get('lastMessageAt') != null || !readyToSend(templateId, dueAt, now)) continue;
      const found = await recipientOfTask(org.id, task.get('personId') as string);
      if (!found || !found.recipient.ok) continue;
      const { person, recipient } = found;
      const params = buildParams(templateId, fieldsFor(org.data(), recipient.to, person, recipient.viaGuardian, ''));
      const ref = db.doc(`organizations/${org.id}/whatsappOutbox/${task.id}`);
      try {
        await ref.create({
          orgId: org.id, followUpId: task.id, templateId, personId: person.id, personName: person.fullName,
          toPersonId: recipient.to.id, toName: recipient.to.fullName, viaGuardian: recipient.viaGuardian,
          params, preview: previewText(templateId, params), mode,
          status: (mode === 'auto' ? 'queued' : 'pending_approval') satisfies OutboxStatus,
          approvedBy: null, approvedByName: null, wamid: null, errorCode: null, error: null, repliedAt: null,
          sentAt: null, deliveredAt: null, readAt: null, deletedAt: null,
          createdAt: FieldValue.serverTimestamp(), createdBy: SYSTEM, ...stamps(),
        });
        made += 1;
        queued += 1;
      } catch (err) {
        if ((err as { code?: number }).code !== 6) throw err; // 6 = ALREADY_EXISTS: queued on an earlier run
      }
    }
  }
  logger.info(`WhatsApp: ${queued} messages queued`);
  return { queued };
}

export const whatsappQueue = onSchedule(
  // Cloud Scheduler isn't offered in africa-south1, so this job runs from Europe.
  { schedule: 'every 60 minutes', timeZone: 'Africa/Nairobi', region: process.env.SCHEDULER_REGION || 'europe-west1', timeoutSeconds: 300 },
  async () => { await queueWhatsappDue(); },
);

// ---- 2. When a message is approved (or automatic): send it through the Cloud API --------------------

async function fail(ref: FirebaseFirestore.DocumentReference, code: number | null, detail: string) {
  await ref.update({ status: 'failed', errorCode: code, error: detail.slice(0, 300), ...stamps() });
}

export async function sendOutbox(orgId: string, outboxId: string, token: string): Promise<void> {
  const ref = db.doc(`organizations/${orgId}/whatsappOutbox/${outboxId}`);
  // Claim the message so a repeated trigger can't send it twice.
  const claimed = await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists || snap.get('status') !== 'queued' || snap.get('claimedAt') != null) return null;
    tx.update(ref, { claimedAt: FieldValue.serverTimestamp(), ...stamps() });
    return snap.data()!;
  });
  if (!claimed) return;

  const settings = await loadSettings();
  const templateId = claimed.templateId as string;
  if (!sendingReady(settings) || !autoTemplate(templateId)) return fail(ref, null, 'WhatsApp sending is switched off in Settings.');
  const task = await db.doc(`organizations/${orgId}/followUps/${claimed.followUpId}`).get();
  if (!task.exists || task.get('status') !== 'open' || task.get('deletedAt') != null) {
    await ref.update({ status: 'cancelled', error: 'The follow-up was closed before this was sent.', ...stamps() });
    return;
  }
  // Consent is checked again now: it may have been withdrawn since the message was queued.
  const found = await recipientOfTask(orgId, claimed.personId as string);
  if (!found || !found.recipient.ok) {
    await ref.update({ status: 'cancelled', error: found && !found.recipient.ok ? found.recipient.reason : 'The person was removed.', ...stamps() });
    return;
  }
  const { person, recipient } = found;
  const org = (await db.doc(`organizations/${orgId}`).get()).data() ?? {};
  const staffName = (claimed.approvedByName as string | null) ?? '';
  const params = buildParams(templateId, fieldsFor(org, recipient.to, person, recipient.viaGuardian, staffName));

  let response: Response;
  try {
    response = await fetch(`${apiBase()}/${settings.phoneNumberId}/messages`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(sendPayload(recipient.phone, metaNameFor(settings, templateId), settings.language, params)),
    });
  } catch (err) {
    logger.error('WhatsApp send failed to reach Meta', err);
    return fail(ref, null, 'Could not reach WhatsApp. Check the internet connection of the server and try again.');
  }
  const body = (await response.json().catch(() => ({}))) as { messages?: { id: string }[]; error?: { code?: number; message?: string } };
  const wamid = body.messages?.[0]?.id;
  if (!response.ok || !wamid) {
    const code = body.error?.code ?? null;
    logger.warn(`WhatsApp send refused (${response.status}, code ${code})`);
    return fail(ref, code, failureHint(code));
  }

  const to = digitsOf(recipient.phone);
  const batch = db.batch();
  batch.update(ref, { status: 'sent', wamid, params, preview: previewText(templateId, params), sentAt: FieldValue.serverTimestamp(), error: null, errorCode: null, ...stamps() });
  // Server-only lookups so Meta's updates and replies (which carry only a message id or a number) find their way back.
  batch.set(db.doc(`waMessages/${wamid}`), { orgId, outboxId, createdAt: FieldValue.serverTimestamp() });
  batch.set(db.doc(`waRecipients/${to}`), { orgId, personId: recipient.to.id, updatedAt: FieldValue.serverTimestamp() });
  batch.set(db.collection(`organizations/${orgId}/messages`).doc(), {
    orgId, personId: person.id, toPersonId: recipient.to.id, toName: recipient.to.fullName, viaGuardian: recipient.viaGuardian,
    channel: 'whatsapp', templateId, templateName: autoTemplate(templateId)!.label.slice(0, 80), followUpId: claimed.followUpId, giftId: null,
    sensitive: false, senderName: staffName ? `${staffName} (automatic)` : 'Automatic', createdAt: FieldValue.serverTimestamp(), createdBy: SYSTEM,
  });
  batch.update(task.ref, { lastMessageAt: FieldValue.serverTimestamp(), ...stamps() });
  await batch.commit();
}

export const onWhatsappOutboxWritten = onDocumentWritten(
  { document: 'organizations/{orgId}/whatsappOutbox/{outboxId}', secrets: [WHATSAPP_TOKEN], timeoutSeconds: 60 },
  async (event) => {
    const after = event.data?.after.exists ? event.data.after.data() : undefined;
    const before = event.data?.before.exists ? event.data.before.data() : undefined;
    if (!after || after.status !== 'queued' || before?.status === 'queued') return;
    await sendOutbox(event.params.orgId, event.params.outboxId, WHATSAPP_TOKEN.value());
  },
);

// ---- 3. Meta calls this with delivery updates and replies --------------------------------------

export function validSignature(rawBody: Buffer | undefined, header: string | undefined, appSecret: string): boolean {
  if (!rawBody || !header || !appSecret) return false;
  const expected = Buffer.from(`sha256=${createHmac('sha256', appSecret).update(rawBody).digest('hex')}`);
  const given = Buffer.from(header);
  return given.length === expected.length && timingSafeEqual(given, expected);
}

interface MetaStatus { id: string; status: string; errors?: { code?: number }[] }
interface MetaMessage { from: string; type?: string; text?: { body?: string } }
interface MetaPayload { entry?: { changes?: { value?: { statuses?: MetaStatus[]; messages?: MetaMessage[] } }[] }[] }

export async function applyStatus(s: MetaStatus): Promise<void> {
  const incoming = s.status as 'sent' | 'delivered' | 'read' | 'failed';
  if (!['sent', 'delivered', 'read', 'failed'].includes(incoming)) return;
  const map = await db.doc(`waMessages/${s.id}`).get();
  if (!map.exists) return;
  const ref = db.doc(`organizations/${map.get('orgId')}/whatsappOutbox/${map.get('outboxId')}`);
  await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) return;
    const current = snap.get('status') as OutboxStatus;
    const next = nextStatus(current, incoming);
    const update: DocumentData = { ...stamps() };
    if (next !== current) update.status = next;
    if (incoming === 'delivered') update.deliveredAt = FieldValue.serverTimestamp();
    if (incoming === 'read') update.readAt = FieldValue.serverTimestamp();
    if (incoming === 'failed' && next === 'failed') {
      const code = s.errors?.[0]?.code ?? null;
      update.errorCode = code;
      update.error = failureHint(code);
    }
    tx.update(ref, update);
  });
}

/** Someone replied. "Stop" turns their WhatsApp consent off and cancels anything waiting for them; any other reply is noted. */
export async function applyReply(m: MetaMessage): Promise<void> {
  const map = await db.doc(`waRecipients/${digitsOf(m.from)}`).get();
  if (!map.exists) return;
  const orgId = map.get('orgId') as string;
  const personId = map.get('personId') as string;
  const personRef = db.doc(`organizations/${orgId}/people/${personId}`);
  const waiting = await db.collection(`organizations/${orgId}/whatsappOutbox`).where('toPersonId', '==', personId).get();

  if (m.type === 'text' && isStopMessage(m.text?.body)) {
    const org = await db.doc(`organizations/${orgId}`).get();
    const person = await personRef.get();
    if (person.exists) {
      await personRef.update({
        'whatsappConsent.given': false,
        'whatsappConsent.stoppedAt': todayIn((org.get('timeZone') as string | undefined) ?? DEFAULT_TIME_ZONE),
        'whatsappConsent.recordedBy': SYSTEM,
        ...stamps(),
      });
    }
    for (const doc of waiting.docs) {
      if (['pending_approval', 'queued'].includes(doc.get('status') as string)) {
        await doc.ref.update({ status: 'cancelled', error: 'They asked us to stop.', ...stamps() });
      }
    }
    logger.info(`WhatsApp: ${personId} in ${orgId} asked to stop`);
    return;
  }
  // Any other reply: mark the latest message so staff can see the person answered.
  const latest = waiting.docs.filter((d) => d.get('sentAt') != null).sort((a, b) => b.get('sentAt').toMillis() - a.get('sentAt').toMillis())[0];
  if (latest) await latest.ref.update({ repliedAt: FieldValue.serverTimestamp(), ...stamps() });
}

export const whatsappWebhook = onRequest(
  { secrets: [WHATSAPP_APP_SECRET, WHATSAPP_VERIFY_TOKEN], cors: false, timeoutSeconds: 60 },
  async (req, res) => {
    if (req.method === 'GET') {
      // Meta's one-time check that this address is ours.
      const ok = req.query['hub.mode'] === 'subscribe' && req.query['hub.verify_token'] === WHATSAPP_VERIFY_TOKEN.value();
      if (ok) res.status(200).send(String(req.query['hub.challenge'] ?? ''));
      else res.status(403).send('Forbidden');
      return;
    }
    if (req.method !== 'POST') {
      res.status(405).send('Method not allowed');
      return;
    }
    if (!validSignature(req.rawBody, req.get('x-hub-signature-256'), WHATSAPP_APP_SECRET.value())) {
      res.status(401).send('Bad signature');
      return;
    }
    try {
      const payload = req.body as MetaPayload;
      for (const entry of payload.entry ?? []) {
        for (const change of entry.changes ?? []) {
          for (const s of change.value?.statuses ?? []) await applyStatus(s);
          for (const m of change.value?.messages ?? []) await applyReply(m);
        }
      }
      res.status(200).send('ok');
    } catch (err) {
      logger.error('WhatsApp webhook failed', err);
      res.status(500).send('error'); // Meta retries
    }
  },
);
