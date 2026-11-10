/**
 * "Write it for me" (Andy, 2026-11-10, 1A 2A 3A+B 4A): leaders can ask for a drafted WhatsApp follow-up message or a
 * short summary of a report. English only. The draft always lands in a box the leader can change; nothing is sent
 * by the AI. Limits: this many drafts a month for the whole church, and fewer a day for each person.
 */
export const AI_MODEL = 'claude-haiku-5-5';
export const AI_MONTHLY_CAP = 300;
export const AI_DAILY_PER_USER = 30;
export const AI_MAX_TOKENS = 500;

export type AiKind = 'followup' | 'summary' | 'payer' | 'notice' | 'sort' | 'remarks';

/** Longer answers for the kinds that come back as a list. */
export const maxTokensFor = (kind: AiKind) => (kind === 'sort' || kind === 'remarks' ? 2000 : AI_MAX_TOKENS);

const RULES = [
  'You write for Freedom Church in Nairobi, Kenya. Write in plain, warm, simple English.',
  'Never invent facts, numbers, dates or names. Use only what you are given.',
  'Do not use em-dashes, headings or bullet symbols in a WhatsApp message. No emojis unless the draft already has one.',
].join(' ');

export function systemPrompt(kind: AiKind): string {
  if (kind === 'notice') {
    return `${RULES} You turn a church leader's short notes into one WhatsApp group notice for church members. Start with a short friendly line, give what, when and where exactly as given, and end with a warm invitation. Keep it under 90 words. Reply with the notice text only.`;
  }
  if (kind === 'sort') {
    return `${RULES} You sort church bank statement lines into accounting categories. For each line you get a key, the description and whether money came in or went out, and the list of category ids allowed for that direction. Choose the most likely category id from the allowed list only. If you cannot tell, leave the line out. Reply with JSON only, an object of key to category id, for example {"3": "utilities"}.`;
  }
  if (kind === 'remarks') {
    return `${RULES} You write short exam remarks for a vocational training college's result slips. For each student you get a key, their average, grade, attendance percentage and course marks (no names). Write one encouraging, honest remark of at most 15 words for each, naming a strength or what to work on. Do not mention the key or invent anything. Reply with JSON only, an object of key to remark, for example {"1": "Strong practical work; keep revising theory."}.`;
  }
  if (kind === 'payer') {
    return `${RULES} You help a church treasurer work out who sent an M-Pesa payment. You get the name printed on the statement and a short list of church members (id and name). Names on M-Pesa are often shortened, reordered, misspelled or use a middle name. Pick a member only if the name clearly refers to the same person; if two members could fit, or none clearly does, pick none. Reply with JSON only: {"personId": "<id or null>", "confidence": <0-100>, "reason": "<one short sentence>"}`;
  }
  return kind === 'followup'
    ? `${RULES} You rewrite a draft WhatsApp message from a church leader so it sounds personal and caring. Keep it under 70 words, keep every fact and the greeting by first name, and reply with the message text only.`
    : `${RULES} You summarise a church report for a pastor. Write 3 to 5 short plain sentences: what stands out, what dropped, and one thing to do next. Reply with the summary text only.`;
}

export function userPrompt(kind: AiKind, context: string, draft: string, note: string): string {
  if (kind === 'followup') {
    return `Why we are writing: ${context || 'a friendly follow-up'}\n${note ? `Leader's note: ${note}\n` : ''}Draft to improve:\n${draft}`;
  }
  return `Report figures:\n${context}${note ? `\nLeader's note: ${note}` : ''}`;
}

/** "2026-11" for a date in the church's own time zone. */
export const monthKey = (dateKey: string) => dateKey.slice(0, 7);

export type LimitCheck = { ok: true } | { ok: false; why: string };

export function checkLimits(monthCount: number, userDayCount: number): LimitCheck {
  if (monthCount >= AI_MONTHLY_CAP) return { ok: false, why: `The church has used all ${AI_MONTHLY_CAP} drafts for this month. It starts again next month.` };
  if (userDayCount >= AI_DAILY_PER_USER) return { ok: false, why: `You have used ${AI_DAILY_PER_USER} drafts today. Please try again tomorrow.` };
  return { ok: true };
}

export type PersonName = { id: string; fullName: string };
const tokens = (n: string) => n.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').split(/[^a-z]+/).filter((t) => t.length >= 3);

/** A short list of people whose name shares the start of a word with the statement name, so only a few names go to the AI. */
export function shortlist(statementName: string, people: readonly PersonName[], max = 30): PersonName[] {
  const want = tokens(statementName).map((t) => t.slice(0, 3));
  if (want.length === 0) return [];
  const scored = people.map((p) => {
    const have = new Set(tokens(p.fullName).map((t) => t.slice(0, 3)));
    return { p, hits: want.filter((w) => have.has(w)).length };
  }).filter((x) => x.hits > 0);
  return scored.sort((a, b) => b.hits - a.hits).slice(0, max).map((x) => x.p);
}

export type PayerGuess = { personId: string | null; confidence: number; reason: string };

/** Reads the AI's JSON; the person must be one of those we offered, or it is thrown away. */
export function parsePayer(raw: string, offered: readonly PersonName[]): PayerGuess {
  const none: PayerGuess = { personId: null, confidence: 0, reason: 'No clear match in the member list.' };
  const m = /\{[\s\S]*\}/.exec(raw);
  if (!m) return none;
  try {
    const j = JSON.parse(m[0]) as { personId?: unknown; confidence?: unknown; reason?: unknown };
    const id = typeof j.personId === 'string' ? j.personId : null;
    if (!id || !offered.some((p) => p.id === id)) return none;
    const confidence = Math.max(0, Math.min(100, Math.round(Number(j.confidence) || 0)));
    return { personId: id, confidence, reason: typeof j.reason === 'string' ? j.reason.slice(0, 200) : '' };
  } catch { return none; }
}

/** Reads a JSON object of key to text; only keys we sent are kept, and each value must pass `ok`. */
export function parseMap(raw: string, keys: readonly string[], ok: (key: string, value: string) => boolean): Record<string, string> {
  const m = /\{[\s\S]*\}/.exec(raw);
  if (!m) return {};
  try {
    const j = JSON.parse(m[0]) as Record<string, unknown>;
    const out: Record<string, string> = {};
    for (const k of keys) {
      const v = j[k];
      if (typeof v === 'string' && v.trim() && ok(k, v.trim())) out[k] = v.trim();
    }
    return out;
  } catch { return {}; }
}
