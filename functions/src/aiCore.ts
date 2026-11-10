import Anthropic from '@anthropic-ai/sdk';
import { logger } from 'firebase-functions';
import { defineSecret } from 'firebase-functions/params';
import { db, FieldValue } from './common.js';
import { AI_MODEL, AI_MONTHLY_CAP, maxTokensFor, monthKey, systemPrompt } from './shared/aiWrite.js';

export const ANTHROPIC_API_KEY = defineSecret('ANTHROPIC_API_KEY');

/**
 * The Monday briefing at the top of a weekly report (Andy, 2026-11-10, 1A 2A 3A 4A). It counts in the church's
 * monthly cap, and never stops the report: with no key, the cap reached or any error, the report is made without it.
 */
export async function weeklyBriefing(orgId: string, today: string, facts: string[]): Promise<string | null> {
  if (!facts.length) return null;
  const monthRef = db.doc(`aiUsage/${orgId}_${monthKey(today)}`);
  try {
    const ok = await db.runTransaction(async (tx) => {
      const m = await tx.get(monthRef);
      if (Number(m.get('count') ?? 0) >= AI_MONTHLY_CAP) return false;
      tx.set(monthRef, { orgId, month: monthKey(today), count: FieldValue.increment(1), updatedAt: FieldValue.serverTimestamp() }, { merge: true });
      return true;
    });
    if (!ok) return null;
  } catch (err) {
    logger.warn('weeklyBriefing: count failed', err);
    return null;
  }
  try {
    const client = new Anthropic({ apiKey: ANTHROPIC_API_KEY.value(), timeout: 45_000, maxRetries: 1 });
    const res = await client.messages.create({
      model: AI_MODEL, max_tokens: maxTokensFor('weekly'), system: systemPrompt('weekly'),
      messages: [{ role: 'user', content: `Report figures:\n${facts.join('\n')}` }],
    });
    const out = res.content.map((b) => (b.type === 'text' ? b.text : '')).join('').trim();
    return out ? out.slice(0, 1500) : null;
  } catch (err) {
    await monthRef.set({ count: FieldValue.increment(-1) }, { merge: true }).catch(() => undefined);
    logger.warn('weeklyBriefing: AI failed', err instanceof Error ? err.message : err);
    return null;
  }
}
