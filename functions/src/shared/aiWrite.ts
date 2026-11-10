/**
 * "Write it for me" (Andy, 2026-11-10, 1A 2A 3A+B 4A): leaders can ask for a drafted WhatsApp follow-up message or a
 * short summary of a report. English only. The draft always lands in a box the leader can change; nothing is sent
 * by the AI. Limits: this many drafts a month for the whole church, and fewer a day for each person.
 */
export const AI_MODEL = 'claude-haiku-5-5';
export const AI_MONTHLY_CAP = 300;
export const AI_DAILY_PER_USER = 30;
export const AI_MAX_TOKENS = 500;

export type AiKind = 'followup' | 'summary';

const RULES = [
  'You write for Freedom Church in Nairobi, Kenya. Write in plain, warm, simple English.',
  'Never invent facts, numbers, dates or names. Use only what you are given.',
  'Do not use em-dashes, headings or bullet symbols in a WhatsApp message. No emojis unless the draft already has one.',
].join(' ');

export function systemPrompt(kind: AiKind): string {
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
