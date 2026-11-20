import { autoCategory, bankMoney, isMpesaAccount, lineKey, typedCategory, type BankLine, type BankMoney, type DailyBankEntry, type TypedBalance, type ParsedStatement } from '../../../functions/src/shared/finance';
import { saveStatement } from '../../lib/financeWrites';
import { isLocked, orgKind, type FinMonthRow, type StatementRow } from '../../state/useFinance';

export const kenyaToday = () => new Date(Date.now() + 3 * 3_600_000).toISOString().slice(0, 10);

export interface UploadPlan { lines: BankLine[]; skipped: number; closed: number; sure: number }

/**
 * The lines of a read statement that are new for an account: lines already saved are left out (so the same
 * statement can be uploaded twice safely), and so are lines in a closed month (5A). Each new line is sorted.
 */
export function planUpload(read: ParsedStatement, name: string, ctx: {
  statements: readonly StatementRow[]; learned: Readonly<Record<string, string>>; orgType: string | undefined;
  daily: readonly DailyBankEntry[]; months: Readonly<Record<string, FinMonthRow>>;
}): UploadPlan {
  const have = new Set(ctx.statements.filter((s) => s.account === name).flatMap((s) => s.lines.map((l) => lineKey(name, l))));
  const fresh = read.lines.filter((l) => !have.has(lineKey(name, l)) && !isLocked(ctx.months, l.d));
  const closed = read.lines.filter((l) => !have.has(lineKey(name, l)) && isLocked(ctx.months, l.d)).length;
  // A line that matches bank money typed on the day takes the category typed then (Andy, 2026-11-09).
  const taken = new Set<string>();
  const lines: BankLine[] = fresh.map((l) => {
    const c = typedCategory(l, name, ctx.daily, taken);
    return { ...l, ...(c ? { c, s: true } : autoCategory(l, ctx.learned, orgKind(ctx.orgType))) };
  });
  return { lines, skipped: read.lines.length - fresh.length - closed, closed, sure: lines.filter((l) => l.s).length };
}

export const accountKindOf = (name: string): 'bank' | 'mpesa' => (isMpesaAccount(name) ? 'mpesa' : 'bank');

/** Saves the plan's lines and returns the money in the bank as it now stands, worked out at once. */
export async function savePlan(orgId: string, account: string, fileName: string, plan: UploadPlan, statements: readonly StatementRow[], approved: readonly { day: string; cents: number }[], typed: readonly TypedBalance[] = []): Promise<BankMoney> {
  const lines = plan.lines;
  const first = lines[0]!; const last = lines[lines.length - 1]!;
  const kind = accountKindOf(account);
  await saveStatement(orgId, { account, accountKind: kind, fileName, from: first.d, to: last.d, openingCents: first.b - first.i + first.o, closingCents: last.b, lines });
  return bankMoney([...statements, { account, accountKind: kind, from: first.d, fileName, lines }], approved, kenyaToday(), typed);
}

/** Turns money into "KES 1,234.00"-style text; passed in so this file needs no organization. */
type Fmt = (cents: number) => string;
const showDay = (d: string) => d.split('-').reverse().join('/');

/**
 * What an upload did to the money in the bank, in plain words (Andy, 2026-11-20, 4A 5A).
 * `before` is the money before the upload; `after` is null when nothing was saved.
 */
export function uploadNote(fmt: Fmt, account: string, read: ParsedStatement, before: BankMoney, after: BankMoney | null): { text: string; tone: 'ok' | 'warn' } {
  const mine = before.sources.find((s) => s.account === account);
  if (!after) {
    const upTo = mine?.asOf ?? before.asOf;
    return { text: upTo ? `Already up to date to ${showDay(upTo)}. Every line of this file is already in, so Money in the bank stays at ${fmt(before.bankCents)}.` : 'Every line of this file is already in.', tone: 'ok' };
  }
  if (accountKindOf(account) === 'mpesa') return { text: `Saved to ${account}. That is an M-Pesa account, so it does not change Money in the bank.`, tone: 'warn' };
  if (mine && read.to && read.to < mine.asOf) {
    return { text: `This file runs to ${showDay(read.to)}, older than the statement already in (to ${showDay(mine.asOf)}). Its missing lines were added; Money in the bank stays at ${fmt(after.bankCents)}.`, tone: 'warn' };
  }
  if (after.typed) {
    return { text: `Saved. The balance ${after.typed.byName} typed for ${showDay(after.typed.day)} is newer than this statement, so Money in the bank stays at ${fmt(after.bankCents)}.`, tone: 'ok' };
  }
  const changed = after.bankCents !== before.bankCents || after.asOf !== before.asOf;
  return {
    text: `${changed ? 'Balance updated' : 'Saved'}: Money in the bank is now ${fmt(after.bankCents)} (statement to ${showDay(after.asOf)}), and ${fmt(after.availableCents)} is available for petty cash.`,
    tone: 'ok',
  };
}

/**
 * Whether a file read in Match bank payments is a whole bank statement (so it also updates Money in the bank,
 * Andy 2026-11-20, 3A) and not just a list of payments: money both in and out, the balance running through
 * every line without a break, and never below zero (a list with no balance column runs negative).
 */
export function looksLikeFullStatement(read: ParsedStatement): boolean {
  const ls = read.lines;
  return ls.length >= 3 && !read.problems.length && read.balanceBreaks === 0
    && ls.some((l) => l.i > 0) && ls.some((l) => l.o > 0) && ls.every((l) => l.b >= 0);
}
