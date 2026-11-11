import { httpsCallable } from 'firebase/functions';
import { functions } from '../firebase';

/** Asks the writing helper (a leader-only function with a monthly cap) for words. Returns the text, or throws a message to show. */
export async function aiWrite(args: { orgId: string; kind: 'followup' | 'summary' | 'notice' | 'ask'; context: string; draft?: string; note?: string }): Promise<string> {
  try {
    const r = await httpsCallable<typeof args, { text: string }>(functions, 'aiWrite')(args);
    return r.data.text;
  } catch (err) {
    const e = err as { code?: string; message?: string };
    const known = e?.code === 'functions/resource-exhausted' || e?.code === 'functions/unavailable' || e?.code === 'functions/permission-denied' || e?.code === 'functions/invalid-argument';
    throw new Error(known && e.message ? e.message.replace(/\s*\[\d+\]$/, '') : 'The writing helper could not answer. Please check your internet and try again.');
  }
}

export type PayerGuess = { personId: string | null; confidence: number; reason: string };

/** Asks who sent an M-Pesa payment. Only the statement name leaves the app (the server adds a few member names); the answer is a suggestion for a person to check. */
export async function aiWhoPaid(orgId: string, statementName: string): Promise<PayerGuess> {
  try {
    const r = await httpsCallable<Record<string, unknown>, { guess: PayerGuess }>(functions, 'aiWrite')({ orgId, kind: 'payer', context: statementName });
    return r.data.guess;
  } catch (err) {
    const e = err as { code?: string; message?: string };
    const known = e?.code === 'functions/resource-exhausted' || e?.code === 'functions/unavailable' || e?.code === 'functions/permission-denied';
    throw new Error(known && e.message ? e.message.replace(/\s*\[\d+\]$/, '') : 'The helper could not answer. Please check your internet and try again.');
  }
}

/** For lists: sends keyed items, gets back key to text (a category id, or a remark). Only keys sent come back. */
export async function aiMap(orgId: string, kind: 'sort' | 'remarks' | 'welcome', items: Record<string, string>[], context = ''): Promise<Record<string, string>> {
  try {
    const r = await httpsCallable<Record<string, unknown>, { map: Record<string, string> }>(functions, 'aiWrite')({ orgId, kind, items, context });
    return r.data.map ?? {};
  } catch (err) {
    const e = err as { code?: string; message?: string };
    const known = e?.code === 'functions/resource-exhausted' || e?.code === 'functions/unavailable' || e?.code === 'functions/permission-denied' || e?.code === 'functions/invalid-argument';
    throw new Error(known && e.message ? e.message.replace(/\s*\[\d+\]$/, '') : 'The helper could not answer. Please check your internet and try again.');
  }
}

/** This month's use of the helper for an organisation (Andy and Settings managers only). */
export async function aiUsage(orgId: string): Promise<{ used: number; cap: number; month: string }> {
  const r = await httpsCallable<Record<string, unknown>, { used: number; cap: number; month: string }>(functions, 'aiWrite')({ action: 'usage', orgId });
  return r.data;
}

export type FilledRequest = { category: string; payee: string; items: { description: string; quantity: number; unitPrice: number }[] };
/** Turns spoken or typed words into a petty cash request to check (nothing is saved). */
export async function aiFill(orgId: string, words: string): Promise<FilledRequest> {
  try {
    const r = await httpsCallable<Record<string, unknown>, { fill: FilledRequest }>(functions, 'aiWrite')({ orgId, kind: 'fill', context: words });
    return r.data.fill;
  } catch (err) {
    const e = err as { code?: string; message?: string };
    throw new Error(e?.code && e.code !== 'functions/internal' && e.message ? e.message.replace(/\s*\[\d+\]$/, '') : 'The helper could not answer. Please check your internet and try again.');
  }
}
