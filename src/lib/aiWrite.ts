import { httpsCallable } from 'firebase/functions';
import { functions } from '../firebase';

/** Asks the writing helper (a leader-only function with a monthly cap) for words. Returns the text, or throws a message to show. */
export async function aiWrite(args: { orgId: string; kind: 'followup' | 'summary'; context: string; draft?: string; note?: string }): Promise<string> {
  try {
    const r = await httpsCallable<typeof args, { text: string }>(functions, 'aiWrite')(args);
    return r.data.text;
  } catch (err) {
    const e = err as { code?: string; message?: string };
    const known = e?.code === 'functions/resource-exhausted' || e?.code === 'functions/unavailable' || e?.code === 'functions/permission-denied';
    throw new Error(known && e.message ? e.message.replace(/\s*\[\d+\]$/, '') : 'The writing helper could not answer. Please check your internet and try again.');
  }
}
