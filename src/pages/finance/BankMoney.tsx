import { useMemo, useState, type ChangeEvent } from 'react';
import { Link } from 'react-router-dom';
import type { Organization } from '../../state/OrgContext';
import { money } from '../school/common';
import { KpiCard, KpiRow } from '../../components/charts';
import { millis, usePettyCash, type RequisitionRow } from '../../state/usePettyCash';
import { useDaily, useFinance } from '../../state/useFinance';
import { useToast } from '../../state/ToastContext';
import { useAuth } from '../../state/AuthContext';
import { typeBankBalance } from '../../lib/pettyPin';
import { canTypeBankBalance, typesWithoutPin } from '../../../functions/src/shared/bankTyped';
import { friendlyError } from '../../lib/errors';
import { accountKindOf, kenyaToday, planUpload, savePlan, uploadNote, type UploadPlan } from './statementUpload';
import { bankMoney, FIN_ACCOUNT_SUGGESTIONS, type BankMoney, type ParsedStatement } from '../../../functions/src/shared/finance';

const EAT = 3 * 3_600_000;
const dayOf = (ms: number) => new Date(ms + EAT).toISOString().slice(0, 10);
const shortDay = (d: string) => new Date(`${d}T12:00:00Z`).toLocaleDateString('en-KE', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });

/** Requisitions approved in a month after the statement's last day: paid from the bank but not in its lines yet. */
export function approvedAfter(reqs: readonly RequisitionRow[], asOf: string, month: string) {
  return reqs.filter((r) => r.status === 'approved' && !r.pastRecord)
    .map((r) => ({ day: dayOf(millis(r.approved?.at) ?? millis(r.createdAt) ?? Date.now()), category: r.category, cents: r.totalCents }))
    .filter((x) => x.day > asOf && x.day.startsWith(month));
}

/**
 * Petty cash is paid from the bank (Andy, 2026-11-09, 1A 2A): the money available is the bank balance on the
 * latest uploaded statement, less the requisitions approved after that statement's last day.
 */
export function useBankMoney(org: Organization): BankMoney & { ready: boolean; approved: { day: string; cents: number }[] } {
  const fin = useFinance(org);
  const p = usePettyCash(org);
  return useMemo(() => {
    const approved = p.requisitions.filter((r) => r.status === 'approved' && !r.pastRecord)
      .map((r) => ({ day: dayOf(millis(r.approved?.at) ?? millis(r.createdAt) ?? Date.now()), cents: r.totalCents }));
    return { ...bankMoney(fin.statements, approved, kenyaToday(), fin.typed), approved, ready: !fin.loading && !p.loading };
  }, [fin.statements, fin.typed, fin.loading, p.requisitions, p.loading]);
}

/** The Overview card: bank balance, paid since, available, where it comes from, and an upload right here (2A). */
export function BankMoneyCard({ org }: { org: Organization }) {
  const m = useBankMoney(org);
  if (!m.ready) return null;
  return (
    <section className="card stack">
      <h2>Money in the bank</h2>
      {m.asOf ? (
        <KpiRow label="Money in the bank">
          <KpiCard label={`Bank balance, ${shortDay(m.asOf)}`} value={money(org, m.bankCents)} note={m.typed ? `Typed by ${m.typed.byName}` : 'From the statement'} />
          <KpiCard label="Approved since" value={money(org, m.paidSinceCents)} note={`${m.paidSince} requisition${m.paidSince === 1 ? '' : 's'}`} />
          <KpiCard label="Available" value={money(org, m.availableCents)} tone={m.availableCents > 0 ? 'ok' : 'warn'} />
        </KpiRow>
      ) : <p className="petty-warn">No bank statement or typed balance yet, so requisitions cannot be approved.</p>}
      {m.differs.map((x) => (
        <p key={`${x.day}${x.typedCents}`} className="petty-warn small">
          On {shortDay(x.day)} {x.byName} typed {money(org, x.typedCents)}, but the statement shows {money(org, x.statementCents)} at the end of that day.
        </p>
      ))}
      {m.sources.length > 0 && (
        <p className="small muted">
          Statement{m.typed ? ' (older than the typed balance)' : ''}: {m.sources.map((x) => `${x.account}: ${money(org, x.cents)} on ${shortDay(x.asOf)}${x.fileName ? ` (${x.fileName})` : ''}`).join('; ')}.
        </p>
      )}
      {m.futureLines > 0 && <p className="petty-warn small">{m.futureLines} statement line{m.futureLines === 1 ? ' is' : 's are'} dated after today and left out. Check the dates in <Link to="/finance">Financial statements</Link>.</p>}
      <QuickUpload org={org} money={m} />
      <TypeBalance org={org} />
    </section>
  );
}

/**
 * Upload the latest bank statement from the petty cash page (Andy, 2026-11-20, 2A): it is read, saved to the
 * bank account and the balance above changes at once. A file with problems waits for "Save anyway".
 */
function QuickUpload({ org, money: m }: { org: Organization; money: BankMoney & { approved: { day: string; cents: number }[] } }) {
  const fin = useFinance(org);
  const daily = useDaily(org);
  const toast = useToast();
  const accounts = useMemo(() => {
    const bank = [...new Set(fin.statements.filter((s) => accountKindOf(s.account) === 'bank').map((s) => s.account))];
    const latest = [...m.sources].sort((a, b) => b.asOf.localeCompare(a.asOf))[0]?.account;
    return bank.length ? [...bank].sort((a, b) => (a === latest ? -1 : b === latest ? 1 : 0)) : [FIN_ACCOUNT_SUGGESTIONS[0]!];
  }, [fin.statements, m.sources]);
  const [picked, setPicked] = useState('');
  const account = picked && accounts.includes(picked) ? picked : accounts[0]!;
  const [file, setFile] = useState<File | null>(null);
  const [password, setPassword] = useState('');
  const [locked, setLocked] = useState(false);
  const [busy, setBusy] = useState(false);
  const [held, setHeld] = useState<{ read: ParsedStatement; plan: UploadPlan } | null>(null);
  const [note, setNote] = useState<{ text: string; tone: 'ok' | 'warn' } | null>(null);
  if (!fin.allowed) return <p className="small muted"><Link to="/finance">Financial statements</Link></p>;
  const fmt = (c: number) => money(org, c);

  async function save(read: ParsedStatement, plan: UploadPlan, fl: File) {
    if (!plan.lines.length) { setNote(uploadNote(fmt, account, read, m, null)); return; }
    const after = await savePlan(org.id, account, fl.name, plan, fin.statements, m.approved, fin.typed);
    setNote(uploadNote(fmt, account, read, m, after));
  }
  async function open(fl: File, pw?: string) {
    setBusy(true); setNote(null); setHeld(null);
    try {
      const { readBankStatement, StatementPasswordError } = await import('../../lib/bankStatementFile');
      let read: ParsedStatement;
      try {
        read = await readBankStatement(fl, pw);
        setLocked(false);
      } catch (err) {
        if (err instanceof StatementPasswordError) { setLocked(true); if (err.wrong) toast.show(err.message); return; }
        throw err;
      }
      if (!read.lines.length) { setNote({ text: 'No lines with a date and an amount were found in this file. Is it the bank statement?', tone: 'warn' }); return; }
      const plan = planUpload(read, account, { statements: fin.statements, learned: fin.learned, orgType: org.type, daily: daily.entries, months: fin.months });
      // A clean statement saves straight away; one with problems waits for a person to look (Andy, 2026-11-20).
      if (read.problems.length || read.balanceBreaks > 0) { setHeld({ read, plan }); return; }
      await save(read, plan, fl);
      setFile(null);
    } catch (err) {
      toast.show(friendlyError(err));
    } finally {
      setBusy(false);
    }
  }
  function choose(e: ChangeEvent<HTMLInputElement>) {
    const fl = e.target.files?.[0];
    e.target.value = '';
    if (!fl) return;
    setFile(fl); setPassword(''); setLocked(false);
    void open(fl);
  }
  async function saveAnyway() {
    if (!held || !file) return;
    setBusy(true);
    try { await save(held.read, held.plan, file); setHeld(null); setFile(null); } catch (err) { toast.show(friendlyError(err)); } finally { setBusy(false); }
  }

  return (
    <div className="stack">
      {accounts.length > 1 && (
        <label className="field"><span>Bank account</span>
          <select value={account} onChange={(e) => setPicked(e.target.value)}>{accounts.map((a) => <option key={a} value={a}>{a}</option>)}</select>
        </label>
      )}
      <label className="btn btn-primary align-start">
        {busy ? 'Reading…' : 'Upload bank statement'}
        <input type="file" accept=".pdf,.xlsx,.csv,application/pdf" hidden onChange={choose} disabled={busy} />
      </label>
      {locked && file && (
        <form className="field-row" onSubmit={(e) => { e.preventDefault(); void open(file, password); }}>
          <label className="field"><span>Statement password</span><input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoFocus /></label>
          <button type="submit" className="btn btn-primary align-end" disabled={!password || busy}>Open</button>
        </form>
      )}
      {held && (
        <div className="petty-warn small stack">
          {held.read.problems.map((x) => <div key={x}>{x}</div>)}
          {held.read.balanceBreaks > 0 && <div>In {held.read.balanceBreaks} place{held.read.balanceBreaks === 1 ? '' : 's'} the balance does not follow from the line before. Check the file is the full statement.</div>}
          <button type="button" className="btn align-start" disabled={busy} onClick={() => void saveAnyway()}>Save anyway</button>
        </div>
      )}
      {note && <p className={note.tone === 'ok' ? 'petty-ok small' : 'petty-warn small'}>{note.text}</p>}
      <p className="small muted">Any day, even part of a month. Lines already in are left out. Sorting and reports are in <Link to="/finance">Financial statements</Link>.</p>
    </div>
  );
}

/**
 * Type the bank balance (Andy, 2026-11-20, 1A 2A 3A 6A): Andrew, Doreen, Elias and Daniel. Andrew and Doreen
 * need no PIN; Elias and Daniel type their own. It counts when it is as new as the statements, and the last
 * five typed balances show who typed them.
 */
function TypeBalance({ org }: { org: Organization }) {
  const fin = useFinance(org);
  const { profile } = useAuth();
  const toast = useToast();
  const name = profile?.displayName ?? '';
  const mayType = canTypeBankBalance(name);
  const noPin = typesWithoutPin(name);
  const [open, setOpen] = useState(false);
  const [amount, setAmount] = useState('');
  const [day, setDay] = useState(kenyaToday());
  const [pin, setPin] = useState('');
  const [busy, setBusy] = useState(false);
  const cents = parseBalanceCents(amount);
  const recent = [...fin.typed].reverse().slice(0, 5);
  async function save() {
    if (cents == null || !day) return;
    setBusy(true);
    try {
      const who = await typeBankBalance({ orgId: org.id, day, cents, pin: noPin ? '' : pin.trim() });
      toast.show(`Bank balance ${money(org, cents)} for ${shortDay(day)} saved by ${who}.`);
      setAmount(''); setPin(''); setOpen(false); setDay(kenyaToday());
    } catch (err) {
      toast.show(friendlyError(err));
    } finally {
      setBusy(false);
    }
  }
  if (!mayType && !recent.length) return null;
  return (
    <div className="stack">
      {mayType && !open && <button type="button" className="btn align-start" onClick={() => setOpen(true)}>Type the bank balance</button>}
      {mayType && open && (
        <form className="stack" onSubmit={(e) => { e.preventDefault(); void save(); }}>
          <div className="field-row">
            <label className="field"><span>Bank balance (KES)</span><input inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="84,350" autoFocus /></label>
            <label className="field"><span>On</span><input type="date" value={day} max={kenyaToday()} onChange={(e) => setDay(e.target.value)} /></label>
          </div>
          {!noPin && <label className="field"><span>Your PIN</span><input type="password" inputMode="numeric" value={pin} onChange={(e) => setPin(e.target.value)} /></label>}
          <div className="field-row">
            <button type="submit" className="btn btn-primary align-start" disabled={busy || cents == null || (!noPin && !pin.trim())}>{busy ? 'Saving…' : 'Save balance'}</button>
            <button type="button" className="btn btn-quiet align-start" onClick={() => setOpen(false)}>Cancel</button>
          </div>
        </form>
      )}
      {recent.length > 0 && (
        <div className="small">
          <strong>Typed balances</strong>
          <ul className="plain small muted">
            {recent.map((x) => <li key={x.id}>{shortDay(x.day)}: {money(org, x.cents)}, typed by {x.byName}</li>)}
          </ul>
        </div>
      )}
    </div>
  );
}

/** A typed balance: "84,350", "84350.50"; a minus is allowed for an overdrawn account. */
function parseBalanceCents(text: string): number | null {
  const s = text.replace(/KES|Ksh|,|\s/gi, '');
  if (!/^-?\d+(\.\d{1,2})?$/.test(s)) return null;
  return Math.round(Number(s) * 100);
}
