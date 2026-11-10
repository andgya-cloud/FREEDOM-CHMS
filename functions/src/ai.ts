import Anthropic from '@anthropic-ai/sdk';
import { HttpsError, onCall } from 'firebase-functions/v2/https';
import { defineSecret } from 'firebase-functions/params';
import { db, FieldValue, requireCaller } from './common.js';
import { can, canAccessOrg } from './shared/permissions.js';
import { localDateKey, DEFAULT_TIME_ZONE } from './shared/datetime.js';
import { AI_MAX_TOKENS, AI_MODEL, checkLimits, monthKey, systemPrompt, userPrompt, type AiKind } from './shared/aiWrite.js';

const ANTHROPIC_API_KEY = defineSecret('ANTHROPIC_API_KEY');
const text = (v: unknown, max: number) => (typeof v === 'string' ? v.trim().slice(0, max) : '');

/**
 * { orgId, kind: 'followup' | 'summary', context, draft?, note? } → { text, left }
 * Leaders (pastoral access) only. The count is kept in aiUsage/ (server only): one document per church per month and
 * one per person per day, both changed in the same transaction that checks the limit, so two taps cannot slip past it.
 */
export const aiWrite = onCall({ secrets: [ANTHROPIC_API_KEY], memory: '256MiB', timeoutSeconds: 60, maxInstances: 5 }, async (request) => {
  const d = (request.data ?? {}) as Record<string, unknown>;
  const orgId = text(d.orgId, 60);
  const kind = d.kind === 'summary' ? 'summary' : d.kind === 'followup' ? 'followup' : null;
  if (!orgId || !kind) throw new HttpsError('invalid-argument', 'Please check the request.');
  const caller = await requireCaller(request, 'pastoral.read');
  if (!canAccessOrg(caller.profile, orgId) || !can(caller.profile, 'pastoral.read')) {
    throw new HttpsError('permission-denied', 'You do not have permission to do that.');
  }
  const context = text(d.context, 6000);
  const draft = text(d.draft, 1500);
  const note = text(d.note, 300);
  if (kind === 'followup' && !draft) throw new HttpsError('invalid-argument', 'There is no message to improve yet.');
  if (kind === 'summary' && !context) throw new HttpsError('invalid-argument', 'There is nothing to summarise.');

  const org = await db.doc(`organizations/${orgId}`).get();
  const tz = String(org.get('timeZone') ?? DEFAULT_TIME_ZONE);
  const today = localDateKey(new Date(), tz);
  const monthRef = db.doc(`aiUsage/${orgId}_${monthKey(today)}`);
  const dayRef = db.doc(`aiUsage/${orgId}_${caller.uid}_${today}`);

  // Take the count first; give it back if the AI could not answer, so a failed try costs nothing.
  const left = await db.runTransaction(async (tx) => {
    const [m, u] = await Promise.all([tx.get(monthRef), tx.get(dayRef)]);
    const monthCount = Number(m.get('count') ?? 0);
    const verdict = checkLimits(monthCount, Number(u.get('count') ?? 0));
    if (!verdict.ok) throw new HttpsError('resource-exhausted', verdict.why);
    tx.set(monthRef, { orgId, month: monthKey(today), count: FieldValue.increment(1), updatedAt: FieldValue.serverTimestamp() }, { merge: true });
    tx.set(dayRef, { orgId, uid: caller.uid, day: today, count: FieldValue.increment(1), updatedAt: FieldValue.serverTimestamp() }, { merge: true });
    return monthCount + 1;
  });

  try {
    const client = new Anthropic({ apiKey: ANTHROPIC_API_KEY.value(), timeout: 45_000, maxRetries: 1 });
    const res = await client.messages.create({
      model: AI_MODEL,
      max_tokens: AI_MAX_TOKENS,
      system: systemPrompt(kind as AiKind),
      messages: [{ role: 'user', content: userPrompt(kind as AiKind, context, draft, note) }],
    });
    const out = res.content.map((b) => (b.type === 'text' ? b.text : '')).join('').trim();
    if (!out) throw new Error('empty');
    return { text: out, usedThisMonth: left };
  } catch (err) {
    await Promise.all([
      monthRef.set({ count: FieldValue.increment(-1) }, { merge: true }),
      dayRef.set({ count: FieldValue.increment(-1) }, { merge: true }),
    ]);
    console.error('aiWrite failed', err instanceof Error ? err.message : err);
    throw new HttpsError('unavailable', 'The writing helper could not answer just now. Please try again in a minute.');
  }
});
