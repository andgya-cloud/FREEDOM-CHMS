import Anthropic from '@anthropic-ai/sdk';
import { HttpsError, onCall } from 'firebase-functions/v2/https';
import { db, FieldValue, requireCaller } from './common.js';
import { can, canAccessOrg } from './shared/permissions.js';
import { localDateKey, DEFAULT_TIME_ZONE } from './shared/datetime.js';
import { categoriesFor } from './shared/finance.js';
import { AI_MODEL, checkLimits, maxTokensFor, monthKey, parseMap, parsePayer, shortlist, systemPrompt, userPrompt, type AiKind, type PersonName } from './shared/aiWrite.js';

import { ANTHROPIC_API_KEY } from './aiCore.js';
const text = (v: unknown, max: number) => (typeof v === 'string' ? v.trim().slice(0, max) : '');

/**
 * { orgId, kind, context?, draft?, note?, items? } → { text, guess?, map?, usedThisMonth }
 * kinds: followup, summary, payer (who sent an M-Pesa payment), notice (WhatsApp group notice), sort (bank line categories), remarks (exam remarks).
 * Follow-ups and summaries: pastors, leaders and report viewers. Payer suggestions: people who record gifts; the AI only suggests, a person confirms. The count is kept in aiUsage/ (server only): one document per church per month and
 * one per person per day, both changed in the same transaction that checks the limit, so two taps cannot slip past it.
 */
export const aiWrite = onCall({ secrets: [ANTHROPIC_API_KEY], memory: '256MiB', timeoutSeconds: 60, maxInstances: 5 }, async (request) => {
  const d = (request.data ?? {}) as Record<string, unknown>;
  const orgId = text(d.orgId, 60);
  const KINDS: AiKind[] = ['followup', 'summary', 'payer', 'notice', 'sort', 'remarks'];
  const kind = KINDS.find((k) => k === d.kind) ?? null;
  if (!orgId || !kind) throw new HttpsError('invalid-argument', 'Please check the request.');
  const caller = await requireCaller(request);
  // Pastors and leaders; people who see a report or the money may use it on that page.
  const any = (...ps: Parameters<typeof can>[1][]) => ps.some((x) => can(caller.profile, x));
  const allowed = kind === 'payer' ? any('gifts.write')
    : kind === 'sort' ? any('finance.reports', 'pettycash.approve', 'pettycash.authorize', 'users.manage')
      : kind === 'remarks' ? any('exams.manage', 'users.manage')
        : kind === 'notice' ? any('pastoral.read', 'followups.manage', 'settings.manage')
          : any('pastoral.read', 'finance.reports', 'settings.manage');
  if (!canAccessOrg(caller.profile, orgId) || !allowed) throw new HttpsError('permission-denied', 'You do not have permission to do that.');
  const context = text(d.context, 6000);
  const draft = text(d.draft, 1500);
  const note = text(d.note, 300);
  // Who sent this payment: only a shortlist of member NAMES goes out, never a phone number or an amount.
  let offered: PersonName[] = [];
  if (kind === 'payer') {
    const name = text(d.context, 120);
    if (!name) throw new HttpsError('invalid-argument', 'There is no name on this payment.');
    const people = await db.collection(`organizations/${orgId}/people`).where('deletedAt', '==', null).select('fullName', 'status').get();
    offered = shortlist(name, people.docs.filter((x) => x.get('status') !== 'child').map((x) => ({ id: x.id, fullName: String(x.get('fullName') ?? '') })));
    if (offered.length === 0) return { text: '', guess: { personId: null, confidence: 0, reason: 'No member has a similar name.' }, usedThisMonth: null };
  }
  // Lists (bank lines, exam rows) come as short items with a key; only those keys can come back.
  const items = Array.isArray(d.items) ? (d.items as unknown[]).slice(0, kind === 'remarks' ? 80 : 40) : [];
  let listPrompt = '';
  let keys: string[] = [];
  const dirOf: Record<string, 'in' | 'out'> = {};
  if (kind === 'sort') {
    const rows = items.map((x) => x as Record<string, unknown>).map((x) => ({ k: text(x.k, 20), t: text(x.t, 160), dir: x.dir === 'in' ? 'in' as const : 'out' as const })).filter((x) => x.k && x.t);
    if (!rows.length) throw new HttpsError('invalid-argument', 'There are no lines to sort.');
    rows.forEach((r) => { dirOf[r.k] = r.dir; });
    keys = rows.map((r) => r.k);
    const ids = (dir: 'in' | 'out') => categoriesFor(dir).map((c) => `${c.id} (${c.label})`).join(', ');
    listPrompt = `Allowed for money in: ${ids('in')}\nAllowed for money out: ${ids('out')}\nLines:\n${rows.map((r) => `${r.k} | ${r.dir} | ${r.t}`).join('\n')}`;
  }
  if (kind === 'remarks') {
    const rows = items.map((x) => x as Record<string, unknown>).map((x) => ({ k: text(x.k, 20), line: text(x.line, 300) })).filter((x) => x.k && x.line);
    if (!rows.length) throw new HttpsError('invalid-argument', 'There are no results to comment on.');
    keys = rows.map((r) => r.k);
    listPrompt = `Students:\n${rows.map((r) => `${r.k} | ${r.line}`).join('\n')}`;
  }
  if (kind === 'notice' && !context) throw new HttpsError('invalid-argument', 'Please type what the notice is about.');
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
      max_tokens: maxTokensFor(kind),
      system: systemPrompt(kind),
      messages: [{ role: 'user', content: kind === 'payer'
        ? `Statement name: "${text(d.context, 120)}"\nMembers:\n${offered.map((p) => `${p.id} | ${p.fullName}`).join('\n')}`
        : kind === 'sort' || kind === 'remarks' ? listPrompt
          : kind === 'notice' ? `Leader's notes:\n${context}`
            : userPrompt(kind, context, draft, note) }],
    });
    const out = res.content.map((b) => (b.type === 'text' ? b.text : '')).join('').trim();
    if (!out) throw new Error('empty');
    if (kind === 'payer') return { text: '', guess: parsePayer(out, offered), usedThisMonth: left };
    if (kind === 'sort') {
      const allowedIds = { in: new Set(categoriesFor('in').map((c) => c.id)), out: new Set(categoriesFor('out').map((c) => c.id)) };
      return { text: '', map: parseMap(out, keys, (k, v) => allowedIds[dirOf[k] ?? 'out'].has(v)), usedThisMonth: left };
    }
    if (kind === 'remarks') return { text: '', map: parseMap(out, keys, (_k, v) => v.length <= 200), usedThisMonth: left };
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
