import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useOrg, type Organization } from '../../state/OrgContext';
import { useAuth } from '../../state/AuthContext';
import { useToast } from '../../state/ToastContext';
import { friendlyError } from '../../lib/errors';
import { downloadFile } from '../../lib/givingPdf';
import { money } from '../school/common';
import { KpiCard, KpiRow } from '../../components/charts';
import { millis, usePettyCash } from '../../state/usePettyCash';
import { approvedAfter, useBankMoney } from './BankMoney';
import { reopenPettyMonth } from '../../lib/pettyPin';
import { useLedgerMonths } from '../../state/useGiving';
import { isLocked, orgKind, useDaily, useFinance, type FinMonthRow, type StatementRow } from '../../state/useFinance';
import { approveFinMonth, prepareFinMonth, removeStatement, reopenFinMonth, saveFinBook, saveLines, saveStatement } from '../../lib/financeWrites';
import { REPORT_APPROVERS, REPORT_PREPARED_BY } from '../../../functions/src/shared/pettyReport';
import type { FinSigned } from '../../lib/financePdf';
import { ADIA_TOPUP_NAMES, parseAmountCents } from '../../../functions/src/shared/pettyCash';
import {
  autoCategory, categoriesFor, freeToSpend, potBalances, potLabel, potFor, potNames, readyMonth, spentInMonth, typedCategory, type FinReport, FIN_ACCOUNT_SUGGESTIONS, FIN_CATEGORIES, financialReport, finLabel, finPeriodName, finPeriods, learnKey, lineKey,
  OWE_KINDS, OWN_KINDS, type BankLine, type FinInput, type OwnedItem, type ParsedStatement,
} from '../../../functions/src/shared/finance';

const num = (c: number) => { const t = (Math.abs(c) / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); return c < 0 ? `(${t})` : t; };
const FIN_TYPES = ['church_campus', 'college', 'ministry'];
const day = (d: string) => d.split('-').reverse().join('/');
const isMpesa = (name: string) => /m-?pesa|paybill|till/i.test(name);

/**
 * Financial statements (Andy, 2026-11-08, 1A-8A): upload Family Bank or M-Pesa statements (PDF, Excel or
 * CSV), let the app sort each line, then download the Income and Expenditure, Balance Sheet, Cash Flow,
 * Bank Reconciliation and Budget vs Actual for a month or a year, as PDF or Excel. Each organization on its own.
 */
export default function FinancePage() {
  const { current, organizations, select } = useOrg();
  if (current && FIN_TYPES.includes(current.type)) return <Books org={current} />;
  const orgs = organizations.filter((o) => FIN_TYPES.includes(o.type) && !o.deletedAt);
  return (
    <div className="page narrow">
      <h1>Financial statements</h1>
      <div className="card">
        <p>Which organization?</p>
        <div className="chips">{orgs.map((o) => <button key={o.id} type="button" className="chip" onClick={() => select(o.id)}>{o.name}</button>)}</div>
      </div>
    </div>
  );
}

function Books({ org }: { org: Organization }) {
  const f = useFinance(org);
  if (!f.allowed) return <div className="page narrow"><h1>Financial statements</h1><p>This is for the people who keep the accounts.</p></div>;
  const needs = f.statements.reduce((n, s) => n + s.lines.filter((l) => !l.s && !isLocked(f.months, l.d)).length, 0);
  return (
    <div className="page narrow">
      <div className="page-head"><h1>Financial statements</h1></div>
      <p className="lead">{org.name}. Upload a bank or M-Pesa statement; the app sorts every line and makes the monthly or yearly report.</p>
      {f.statements.length > 0 && <FreeCard org={org} statements={f.statements} budget={f.budget} />}
      <UploadCard org={org} statements={f.statements} learned={f.learned} months={f.months} />
      {needs > 0 && <NeedsYouCard org={org} statements={f.statements} learned={f.learned} count={needs} months={f.months} />}
      {f.statements.length > 0 ? <ReportCard org={org} statements={f.statements} budget={f.budget} owned={f.owned} learned={f.learned} months={f.months} />
        : !f.loading && <p className="muted small">No statements yet. Upload the first one above.</p>}
      <OwnedCard org={org} owned={f.owned} />
      <BudgetCard org={org} budget={f.budget} />
      {f.statements.length > 0 && <StatementsCard org={org} statements={f.statements} />}
    </div>
  );
}

// ---- Upload -------------------------------------------------------------------------------

type Months = Record<string, FinMonthRow>;
const kenyaToday = () => new Date(Date.now() + 3 * 3_600_000).toISOString().slice(0, 10);

function UploadCard({ org, statements, learned, months }: { org: Organization; statements: StatementRow[]; learned: Record<string, string>; months: Months }) {
  const toast = useToast();
  const daily = useDaily(org);
  const accounts = useMemo(() => [...new Set([...statements.map((s) => s.account), ...FIN_ACCOUNT_SUGGESTIONS])], [statements]);
  const [account, setAccount] = useState(accounts[0] ?? FIN_ACCOUNT_SUGGESTIONS[0]!);
  const [newName, setNewName] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [password, setPassword] = useState('');
  const [locked, setLocked] = useState(false);
  const [read, setRead] = useState<ParsedStatement | null>(null);
  const [busy, setBusy] = useState(false);
  const name = account === '__new' ? newName.trim() : account;

  async function open(fl: File, pw?: string) {
    setBusy(true);
    try {
      const { readBankStatement, StatementPasswordError } = await import('../../lib/bankStatementFile');
      try {
        setRead(await readBankStatement(fl, pw));
        setLocked(false);
      } catch (err) {
        if (err instanceof StatementPasswordError) { setLocked(true); if (err.wrong) toast.show(err.message); } else throw err;
      }
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
    setFile(fl); setRead(null); setPassword(''); setLocked(false);
    void open(fl);
  }

  // Lines already saved for this account are left out, so the same statement can be uploaded twice safely.
  const plan = useMemo(() => {
    if (!read || !name) return null;
    const have = new Set(statements.filter((s) => s.account === name).flatMap((s) => s.lines.map((l) => lineKey(name, l))));
    // Lines in a month already closed stay out too: that month was approved as it was (5A).
    const fresh = read.lines.filter((l) => !have.has(lineKey(name, l)) && !isLocked(months, l.d));
    const closed = read.lines.filter((l) => !have.has(lineKey(name, l)) && isLocked(months, l.d)).length;
    // A line that matches bank money typed on the day takes the category typed then (Andy, 2026-11-09).
    const taken = new Set<string>();
    const lines: BankLine[] = fresh.map((l) => { const c = typedCategory(l, name, daily.entries, taken); return { ...l, ...(c ? { c, s: true } : autoCategory(l, learned, orgKind(org.type))) }; });
    return { lines, skipped: read.lines.length - fresh.length - closed, closed, sure: lines.filter((l) => l.s).length };
  }, [read, name, statements, learned, org.type, daily.entries, months]);

  async function save() {
    if (!read || !plan || !file || !name) return;
    if (!plan.lines.length) { toast.show('Every line of this statement is already in.'); return; }
    setBusy(true);
    try {
      await saveStatement(org.id, { account: name, accountKind: isMpesa(name) ? 'mpesa' : 'bank', fileName: file.name, from: plan.lines[0]!.d, to: plan.lines[plan.lines.length - 1]!.d,
        openingCents: plan.lines[0]!.b - plan.lines[0]!.i + plan.lines[0]!.o, closingCents: plan.lines[plan.lines.length - 1]!.b, lines: plan.lines });
      toast.show(`Saved ${plan.lines.length} lines from ${file.name}, month by month.`);
      setFile(null); setRead(null); setAccount(name);
    } catch (err) {
      toast.show(friendlyError(err));
    } finally {
      setBusy(false);
    }
  }

  const inC = read?.lines.reduce((n, l) => n + l.i, 0) ?? 0;
  const outC = read?.lines.reduce((n, l) => n + l.o, 0) ?? 0;
  return (
    <section className="card stack no-print">
      <h2>Upload a statement</h2>
      <div className="field-row">
        <label className="field"><span>Account</span>
          <select value={account} onChange={(e) => setAccount(e.target.value)}>
            {accounts.map((a) => <option key={a} value={a}>{a}</option>)}
            <option value="__new">Another account…</option>
          </select>
        </label>
        {account === '__new' && <label className="field"><span>Account name</span><input value={newName} maxLength={80} onChange={(e) => setNewName(e.target.value)} placeholder="Family Bank building fund" /></label>}
      </div>
      <label className="btn align-start">
        {busy ? 'Reading…' : file ? 'Choose another file' : 'Choose the statement (PDF, Excel or CSV)'}
        <input type="file" accept=".pdf,.xlsx,.csv,application/pdf" hidden onChange={choose} disabled={busy} />
      </label>
      {locked && file && (
        <form className="field-row" onSubmit={(e) => { e.preventDefault(); void open(file, password); }}>
          <label className="field"><span>Statement password</span><input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoFocus /></label>
          <button type="submit" className="btn btn-primary align-end" disabled={!password || busy}>Open</button>
        </form>
      )}
      {read && plan && (
        <>
          <ul className="plain small">
            <li><strong>{file?.name}</strong>: {read.lines.length} lines, {day(read.from)} to {day(read.to)}</li>
            <li>Opening {money(org, read.openingCents)} · Money in {money(org, inC)} · Money out {money(org, outC)} · Closing {money(org, read.closingCents)}</li>
            {plan.skipped > 0 && <li>{plan.skipped} line{plan.skipped === 1 ? ' is' : 's are'} already in and will be left out.</li>}
            {plan.closed > 0 && <li>{plan.closed} line{plan.closed === 1 ? ' falls' : 's fall'} in a month already closed and will be left out.</li>}
            <li>{plan.sure} sorted automatically{plan.lines.length - plan.sure ? `; ${plan.lines.length - plan.sure} will wait for you to confirm` : ''}.</li>
          </ul>
          {(read.problems.length > 0 || read.balanceBreaks > 0) && (
            <div className="petty-warn small">
              {read.problems.map((p) => <div key={p}>{p}</div>)}
              {read.balanceBreaks > 0 && <div>In {read.balanceBreaks} place{read.balanceBreaks === 1 ? '' : 's'} the balance does not follow from the line before. Check the file is the full statement.</div>}
            </div>
          )}
          {!name && <p className="small">Type the account name first.</p>}
          <button type="button" className="btn btn-primary align-start" disabled={busy || !name || !plan.lines.length} onClick={() => void save()}>
            {plan.lines.length ? `Save ${plan.lines.length} lines to ${name || 'the account'}` : 'Nothing new to save'}
          </button>
        </>
      )}
    </section>
  );
}

// ---- Confirming categories --------------------------------------------------------------------

function CategorySelect({ line, onChange }: { line: BankLine; onChange: (c: string) => void }) {
  return (
    <select aria-label="Category" value={line.c} onChange={(e) => onChange(e.target.value)}>
      {categoriesFor(line.i > 0 ? 'in' : 'out').map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
    </select>
  );
}

/** Choosing a category for a line also sorts every other waiting line like it, and is remembered for next time. */
async function chooseCategory(orgId: string, statements: StatementRow[], learned: Record<string, string>, target: { sid: string; n: number }, c: string, months: Months): Promise<number> {
  const s0 = statements.find((s) => s.id === target.sid)!;
  const line = s0.lines[target.n]!;
  const dir = line.i > 0 ? 'in' : 'out';
  const key = learnKey(line.t, dir);
  let others = 0;
  const writes: Promise<unknown>[] = [];
  for (const s of statements) {
    let changed = false;
    if (isLocked(months, s.from) || isLocked(months, s.to)) continue;
    const lines = s.lines.map((l, n) => {
      if (s.id === target.sid && n === target.n) { changed = true; return { ...l, c, s: true }; }
      if (!l.s && !isLocked(months, l.d) && (l.i > 0 ? 'in' : 'out') === dir && learnKey(l.t, dir) === key) { changed = true; others += 1; return { ...l, c, s: true }; }
      return l;
    });
    if (changed) writes.push(saveLines(orgId, s.id, lines));
  }
  if (key.length > 4 && learned[key] !== c) writes.push(saveFinBook(orgId, 'learned', { ...learned, [key]: c }));
  await Promise.all(writes);
  return others;
}

function NeedsYouCard({ org, statements, learned, count, months }: { org: Organization; statements: StatementRow[]; learned: Record<string, string>; count: number; months: Months }) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const waiting = useMemo(() => statements.flatMap((s) => s.lines.map((l, n) => ({ l, n, sid: s.id, account: s.account })).filter((x) => !x.l.s && !isLocked(months, x.l.d)))
    .sort((a, b) => b.l.d.localeCompare(a.l.d)).slice(0, 25), [statements, months]);
  async function pick(sid: string, n: number, c: string) {
    try {
      const others = await chooseCategory(org.id, statements, learned, { sid, n }, c, months);
      if (others) toast.show(`Also sorted ${others} more line${others === 1 ? '' : 's'} like it.`);
    } catch (err) { toast.show(friendlyError(err)); }
  }
  async function acceptAll() {
    setBusy(true);
    try {
      await Promise.all(statements.filter((s) => s.lines.some((l) => !l.s) && !isLocked(months, s.from) && !isLocked(months, s.to)).map((s) => saveLines(org.id, s.id, s.lines.map((l) => ({ ...l, s: true })))));
      toast.show('All the guesses are confirmed.');
    } catch (err) { toast.show(friendlyError(err)); } finally { setBusy(false); }
  }
  return (
    <section className="card stack no-print">
      <div className="card-head"><h2>Needs you ({count})</h2></div>
      <p className="small muted">The app was not sure about these lines. Choose the right category; it remembers your choice for lines like it in future.</p>
      <ul className="plain">
        {waiting.map(({ l, n, sid, account }) => (
          <li key={`${sid}-${n}`} className="fin-line">
            <div className="fin-line-text">
              <span className="small muted">{day(l.d)} · {account}</span>
              <span>{l.t}</span>
              <strong className={l.i ? 'fin-in' : 'fin-out'}>{l.i ? `+ ${money(org, l.i)}` : `- ${money(org, l.o)}`}</strong>
            </div>
            <CategorySelect line={l} onChange={(c) => void pick(sid, n, c)} />
          </li>
        ))}
      </ul>
      <button type="button" className="btn align-start" disabled={busy} onClick={() => void acceptAll()}>{busy ? 'Saving…' : `The guesses are right: confirm all ${count}`}</button>
    </section>
  );
}

// ---- The report -----------------------------------------------------------------------------------


function ReportCard({ org, statements, budget, owned, learned, months }: { org: Organization; statements: StatementRow[]; budget: Record<string, number>; owned: OwnedItem[]; learned: Record<string, string>; months: Months }) {
  const toast = useToast();
  const { can } = useAuth();
  const p = usePettyCash(org);
  const periods = useMemo(() => finPeriods(statements), [statements]);
  const [period, setPeriod] = useState('');
  const [approver, setApprover] = useState<string>(REPORT_APPROVERS[0]);
  const [busy, setBusy] = useState<'' | 'pdf' | 'excel'>('');
  const chosen = period && periods.includes(period) ? period : periods[0] ?? '';
  const church = org.type === 'church_campus' && can('finance.reports');
  const ledgerFrom = chosen.length === 4 ? `${chosen}-01` : chosen;
  const ledgerTo = chosen.length === 4 ? `${chosen}-12` : chosen;
  const { months: ledger } = useLedgerMonths(church && chosen ? org.id : '', ledgerFrom, ledgerTo);

  const daily = useDaily(org);
  const today = kenyaToday();
  const build = useCallback((period: string): FinReport => {
    const input: FinInput = {
      statements, owned, budget,
      // Petty cash is paid from the bank (Andy, 2026-11-09, 1A): its payments are already statement lines,
      // so the vouchers are not added again and there is no petty cash box on the Balance Sheet.
      petty: null,
      pettyOutByMonth: {},
      givingRecordedCents: church && period === chosen ? ledger.reduce((n, m) => n + (m.totalCents ?? 0), 0) : null,
      today,
      daily: null,
    };
    return financialReport(period, input, (c) => money(org, c));
  }, [statements, owned, budget, p.funds, p.requisitions, church, chosen, ledger, org, daily.entries, today]);
  const rep = useMemo(() => (chosen ? build(chosen) : null), [build, chosen]);
  const ready = useMemo(() => readyMonth(statements, today), [statements, today]);
  const readyRep = useMemo(() => (ready ? (ready === chosen ? rep : build(ready)) : null), [ready, chosen, rep, build]);
  const [params] = useSearchParams();
  const showBalance = params.get('show') === 'balance';

  const signed = signedFor(months[chosen]);
  const approvedBy = signed?.approvedName ?? approver;
  async function make(kind: 'pdf' | 'excel') {
    if (!rep) return;
    setBusy(kind);
    try {
      if (kind === 'pdf') { const { financeReportPdf } = await import('../../lib/financePdf'); downloadFile(await financeReportPdf(org, rep, approvedBy, signed)); }
      else { const { financeReportWorkbook } = await import('../../lib/financeExcel'); downloadFile(await financeReportWorkbook(org.name, rep, approvedBy)); }
    } catch (err) { toast.show(friendlyError(err)); } finally { setBusy(''); }
  }

  if (!rep) return null;
  return (
    <>
      {readyRep && <ReadyCard org={org} rep={readyRep} approver={signedFor(months[readyRep.period])?.approvedName ?? approver} signed={signedFor(months[readyRep.period])} />}
      {showBalance && <BalanceCard org={org} rep={rep} />}
      <section className="card stack no-print">
        <h2>Monthly or yearly report</h2>
        <div className="field-row">
          <label className="field"><span>Period</span>
            <select value={chosen} onChange={(e) => setPeriod(e.target.value)}>
              {periods.map((x) => <option key={x} value={x}>{x.length === 4 ? `Whole year ${x}` : finPeriodName(x)}</option>)}
            </select>
          </label>
          {!signed && <label className="field"><span>Approved by</span>
            <select value={approver} onChange={(e) => setApprover(e.target.value)}>{REPORT_APPROVERS.map((n) => <option key={n} value={n}>{n}</option>)}</select>
          </label>}
        </div>
        <KpiRow label="The period at a glance">
          <KpiCard label="Income" value={money(org, rep.totalIncome.cents)} />
          <KpiCard label="Running costs" value={money(org, rep.totalExpenses.cents)} />
          <KpiCard label={rep.surplus.cents >= 0 ? 'Surplus' : 'Deficit'} value={money(org, Math.abs(rep.surplus.cents))} tone={rep.surplus.cents >= 0 ? 'ok' : 'warn'} />
          <KpiCard label="Cash at the end" value={money(org, rep.cash.closingCents)} />
        </KpiRow>
        <p className="small">{rep.summary.join(' ')}</p>
        {rep.checks.some((c) => !c.ok) && <div className="petty-warn small">{rep.checks.filter((c) => !c.ok).map((c) => <div key={c.text}>{c.text}</div>)}</div>}
        <p className="small muted">Income and Expenditure, Balance Sheet, Cash Flow, Bank Reconciliation, Budget vs Actual and the daily records against the bank, with charts. Prepared by {REPORT_PREPARED_BY.name} ({REPORT_PREPARED_BY.role}).</p>
        <div className="row-actions">
          <button type="button" className="btn btn-primary" disabled={!!busy} onClick={() => void make('pdf')}>{busy === 'pdf' ? 'Making PDF…' : 'Download PDF'}</button>
          <button type="button" className="btn" disabled={!!busy} onClick={() => void make('excel')}>{busy === 'excel' ? 'Making Excel…' : 'Download Excel'}</button>
        </div>
        {chosen.length === 7 && <MonthClose org={org} month={chosen} row={months[chosen]} waiting={rep.needsYou} />}
      </section>
      <LinesCard org={org} statements={statements} learned={learned} period={chosen} months={months} />
    </>
  );
}

/**
 * The month's statement, ready once the bank statement is in (Andy, 2026-11-09, 4A), with buttons to send
 * it. On a phone the PDF goes straight into WhatsApp or email; on a computer it downloads and the message opens.
 */
function ReadyCard({ org, rep, approver, signed }: { org: Organization; rep: FinReport; approver: string; signed: FinSigned | null }) {
  const toast = useToast();
  const [busy, setBusy] = useState('');
  const title = `${org.name} · Financial statement · ${rep.name}`;
  const text = `${title}. ${rep.summary.slice(0, 2).join(' ')}`;
  async function go(via: 'pdf' | 'wa' | 'mail') {
    setBusy(via);
    try {
      const { financeReportPdf } = await import('../../lib/financePdf');
      const file = await financeReportPdf(org, rep, approver, signed);
      if (via === 'pdf') { downloadFile(file); return; }
      const nav = navigator as Navigator & { canShare?: (d: { files: File[] }) => boolean };
      if (nav.canShare?.({ files: [file] })) { await navigator.share({ files: [file], title, text }); return; }
      downloadFile(file);
      if (via === 'wa') window.open(`https://wa.me/?text=${encodeURIComponent(`${text}\n\n(The PDF has been downloaded: attach it to this message.)`)}`, '_blank', 'noopener');
      else window.location.href = `mailto:?subject=${encodeURIComponent(title)}&body=${encodeURIComponent(`${text}\n\nThe PDF statement is attached.`)}`;
    } catch (err) {
      if ((err as { name?: string }).name !== 'AbortError') toast.show(friendlyError(err));
    } finally { setBusy(''); }
  }
  const waiting = rep.needsYou;
  return (
    <section className="card stack no-print fin-ready">
      <h2>{waiting ? `${rep.name} statement: ${waiting} line${waiting === 1 ? '' : 's'} need you first` : signed ? `✓ ${rep.name} statement approved by ${signed.approvedName}` : `✓ ${rep.name} statement is ready`}</h2>
      {rep.match && <p className="small muted">Daily records: {rep.match.matched.length} typed bank amount{rep.match.matched.length === 1 ? '' : 's'} found on the statement{rep.match.typedMissing.length ? `, ${rep.match.typedMissing.length} not found` : ''}; {rep.match.topupsMatched} petty cash top-up{rep.match.topupsMatched === 1 ? '' : 's'} found{rep.match.topupsMissing.length ? `, ${rep.match.topupsMissing.length} not found` : ''}.</p>}
      <div className="row-actions">
        <button type="button" className="btn btn-primary" disabled={!!busy} onClick={() => void go('pdf')}>{busy === 'pdf' ? 'Making PDF…' : 'Download PDF'}</button>
        <button type="button" className="btn" disabled={!!busy} onClick={() => void go('mail')}>Send Email</button>
        <button type="button" className="btn" disabled={!!busy} onClick={() => void go('wa')}>Send WhatsApp</button>
      </div>
    </section>
  );
}

/** The Balance Sheet on screen, opened from the Financial statements dropdown (Andy, 2026-11-09, 5A). */
function BalanceCard({ org, rep }: { org: Organization; rep: FinReport }) {
  const ref = useRef<HTMLElement>(null);
  useEffect(() => { ref.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }); }, []);
  const bs = rep.balanceSheet;
  const row = (label: string, cents: number, cls = '') => <tr key={label + cents} className={cls}><td>{label}</td><td className="num">{num(cents)}</td></tr>;
  return (
    <section ref={ref} className="card stack">
      <h2>Balance Sheet · {rep.name}</h2>
      <p className="small muted">At the end of the period chosen below. Amounts in {org.currency || 'KES'}. Add land, vehicles and loans under "What we own and owe".</p>
      <table className="table fin-bs">
        <tbody>
          <tr className="fin-bs-head"><td colSpan={2}>What we own (assets)</td></tr>
          {bs.assets.map((a) => row(a.label, a.cents, a.indent ? 'fin-bs-sub' : ''))}
          {row('Total assets', bs.totalAssets, 'fin-bs-total')}
          <tr className="fin-bs-head"><td colSpan={2}>What we owe (liabilities)</td></tr>
          {bs.liabilities.length ? bs.liabilities.map((a) => row(a.label, a.cents, a.indent ? 'fin-bs-sub' : '')) : row('Nothing recorded', 0)}
          {row('Total liabilities', bs.totalLiabilities, 'fin-bs-total')}
          {row('Net assets (accumulated fund)', bs.netAssets, 'fin-bs-total')}
          {bs.restrictedCents !== 0 && row('Held for set purposes (# pots)', bs.restrictedCents, 'fin-bs-sub')}
          {bs.restrictedCents !== 0 && row('General fund', bs.generalCents, 'fin-bs-sub')}
        </tbody>
      </table>
      {rep.pots.length > 0 && (
        <table className="table fin-bs">
          <tbody>
            <tr className="fin-bs-head"><td>Held for a set purpose</td><td className="num">Given</td><td className="num">Spent</td><td className="num">Held</td></tr>
            {rep.pots.map((x) => <tr key={x.name}><td>#{x.name}</td><td className="num">{num(x.inCents)}</td><td className="num">{num(x.outCents)}</td><td className="num">{num(x.closingCents)}</td></tr>)}
          </tbody>
        </table>
      )}
    </section>
  );
}

/** Every line of the period, to change a category that was sorted wrongly. */
function LinesCard({ org, statements, learned, period, months }: { org: Organization; statements: StatementRow[]; learned: Record<string, string>; period: string; months: Months }) {
  const toast = useToast();
  const pots = useMemo(() => potNames(statements), [statements]);
  const [newPot, setNewPot] = useState<{ key: string; text: string } | null>(null);
  async function setPot(sid: string, n: number, f: string) {
    const st = statements.find((x) => x.id === sid);
    if (!st) return;
    try { await saveLines(org.id, sid, st.lines.map((l, k) => (k === n ? { ...l, f } : l))); } catch (err) { toast.show(friendlyError(err)); }
  }
  const [q, setQ] = useState('');
  const [shown, setShown] = useState(40);
  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return statements.flatMap((s) => s.lines.map((l, n) => ({ l, n, sid: s.id, account: s.account })))
      .filter((x) => x.l.d.startsWith(period) && (!needle || `${x.l.t} ${x.l.r} ${finLabel(x.l.c)}`.toLowerCase().includes(needle)))
      .sort((a, b) => b.l.d.localeCompare(a.l.d));
  }, [statements, period, q]);
  return (
    <details className="card fold-card no-print">
      <summary>Lines in {finPeriodName(period)} ({rows.length})</summary>
      <div className="stack">
        <input type="search" placeholder="Search description or category" value={q} onChange={(e) => setQ(e.target.value)} />
        <ul className="plain">
          {rows.slice(0, shown).map(({ l, n, sid, account }) => (
            <li key={`${sid}-${n}`} className="fin-line">
              <div className="fin-line-text">
                <span className="small muted">{day(l.d)} · {account}{l.r ? ` · ${l.r}` : ''}</span>
                <span>{l.t}</span>
                <strong className={l.i ? 'fin-in' : 'fin-out'}>{l.i ? `+ ${money(org, l.i)}` : `- ${money(org, l.o)}`}</strong>
              </div>
              {isLocked(months, l.d) ? <span className="small muted">{finLabel(l.c)}{potFor(l) ? ` · #${potFor(l)}` : ''} · closed</span> : (
                <div className="fin-line-picks">
                  <CategorySelect line={l} onChange={(c) => void chooseCategory(org.id, statements, learned, { sid, n }, c, months).catch((err) => toast.show(friendlyError(err)))} />
                  {newPot?.key === `${sid}-${n}` ? (
                    <form className="row-actions" onSubmit={(e) => { e.preventDefault(); const v = newPot.text.trim().replace(/^#/, '').toUpperCase().slice(0, 30); if (v) void setPot(sid, n, v); setNewPot(null); }}>
                      <input aria-label="New purpose" value={newPot.text} maxLength={31} autoFocus placeholder="#PAINTING" onChange={(e) => setNewPot({ key: newPot.key, text: e.target.value })} />
                      <button type="submit" className="btn btn-quiet">Save</button>
                    </form>
                  ) : (
                    <select aria-label="Purpose" value={potFor(l)} onChange={(e) => (e.target.value === '__new' ? setNewPot({ key: `${sid}-${n}`, text: '#' }) : void setPot(sid, n, e.target.value))}>
                      <option value="">No set purpose</option>
                      {[...new Set([...pots, potFor(l)].filter(Boolean))].map((x) => <option key={x} value={x}>#{x}</option>)}
                      <option value="__new">New purpose…</option>
                    </select>
                  )}
                </div>
              )}
            </li>
          ))}
        </ul>
        {rows.length > shown && <button type="button" className="btn btn-quiet align-start" onClick={() => setShown(shown + 80)}>Show more</button>}
      </div>
    </details>
  );
}

// ---- What we own and owe, the budget, the uploads ------------------------------------------------------

function OwnedCard({ org, owned }: { org: Organization; owned: OwnedItem[] }) {
  const toast = useToast();
  const [side, setSide] = useState<'own' | 'owe'>('own');
  const [kind, setKind] = useState<string>(OWN_KINDS[0]);
  const [name, setName] = useState('');
  const [amount, setAmount] = useState('');
  const [asOf, setAsOf] = useState(new Date().toISOString().slice(0, 10));
  async function add() {
    const cents = parseAmountCents(amount);
    if (!name.trim() || !cents) { toast.show('Type what it is and its value.'); return; }
    const item: OwnedItem = { id: Math.random().toString(36).slice(2, 10), side, kind, name: name.trim().slice(0, 80), cents, asOf };
    try { await saveFinBook(org.id, 'owned', [...owned, item]); setName(''); setAmount(''); } catch (err) { toast.show(friendlyError(err)); }
  }
  async function remove(id: string) {
    try { await saveFinBook(org.id, 'owned', owned.filter((i) => i.id !== id)); } catch (err) { toast.show(friendlyError(err)); }
  }
  return (
    <details className="card fold-card no-print">
      <summary>What we own and owe ({owned.length})</summary>
      <div className="stack">
        <p className="small muted">For the Balance Sheet: land, vehicles, equipment, loans and unpaid bills the bank statement cannot show. Cash, bank and petty cash are added for you.</p>
        {owned.length > 0 && (
          <ul className="plain small">
            {owned.map((i) => (
              <li key={i.id} className="fin-line">
                <span>{i.side === 'own' ? 'We own' : 'We owe'} · {i.kind}: <strong>{i.name}</strong> {money(org, i.cents)} (from {day(i.asOf)})</span>
                <button type="button" className="btn btn-quiet" onClick={() => void remove(i.id)}>Remove</button>
              </li>
            ))}
          </ul>
        )}
        <div className="field-row">
          <label className="field"><span>We…</span>
            <select value={side} onChange={(e) => { const s = e.target.value as 'own' | 'owe'; setSide(s); setKind(s === 'own' ? OWN_KINDS[0] : OWE_KINDS[0]); }}>
              <option value="own">own this</option><option value="owe">owe this</option>
            </select>
          </label>
          <label className="field"><span>Kind</span>
            <select value={kind} onChange={(e) => setKind(e.target.value)}>{(side === 'own' ? OWN_KINDS : OWE_KINDS).map((k) => <option key={k}>{k}</option>)}</select>
          </label>
        </div>
        <div className="field-row">
          <label className="field"><span>What</span><input value={name} maxLength={80} onChange={(e) => setName(e.target.value)} placeholder={side === 'own' ? 'Church van KCA 123A' : 'Sacco loan'} /></label>
          <label className="field"><span>Value (KES)</span><input inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} /></label>
        </div>
        <label className="field"><span>From date</span><input type="date" value={asOf} onChange={(e) => setAsOf(e.target.value)} /></label>
        <button type="button" className="btn align-start" onClick={() => void add()}>Add</button>
      </div>
    </details>
  );
}

function BudgetCard({ org, budget }: { org: Organization; budget: Record<string, number> }) {
  const toast = useToast();
  const [draft, setDraft] = useState<Record<string, string>>({});
  const cats = FIN_CATEGORIES.filter((c) => c.group === 'income' || c.group === 'expense' || c.group === 'capital');
  const value = (id: string) => draft[id] ?? (budget[id] ? String(budget[id] / 100) : '');
  async function save() {
    const next: Record<string, number> = {};
    for (const c of cats) { const cents = parseAmountCents(value(c.id)) ?? 0; if (cents > 0) next[c.id] = cents; }
    try { await saveFinBook(org.id, 'budget', next); setDraft({}); toast.show('Budget saved.'); } catch (err) { toast.show(friendlyError(err)); }
  }
  const set = Object.keys(budget).length;
  return (
    <details className="card fold-card no-print">
      <summary>Monthly budget{set ? ` (${set} lines)` : ''}</summary>
      <div className="stack">
        <p className="small muted">The amount planned for each month, one budget for everything: petty cash spending counts in its category too. A year report multiplies it by the months so far. Leave blank what you do not budget. Requisitions warn at 80% and 100%.</p>
        <div className="fin-budget">
          {cats.map((c) => (
            <label key={c.id} className="field"><span>{c.label}</span>
              <input inputMode="decimal" value={value(c.id)} onChange={(e) => setDraft({ ...draft, [c.id]: e.target.value })} placeholder="0" />
            </label>
          ))}
        </div>
        <button type="button" className="btn btn-primary align-start" onClick={() => void save()}>Save budget</button>
      </div>
    </details>
  );
}

function StatementsCard({ org, statements }: { org: Organization; statements: StatementRow[] }) {
  const toast = useToast();
  const [ask, setAsk] = useState('');
  return (
    <details className="card fold-card no-print">
      <summary>Statements uploaded ({statements.length})</summary>
      <ul className="plain small">
        {statements.map((s) => (
          <li key={s.id} className="fin-line">
            <span><strong>{s.account}</strong> · {day(s.from)} to {day(s.to)} · {s.lines.length} lines · {s.fileName}</span>
            {ask === s.id
              ? <span className="row-actions"><button type="button" className="btn btn-danger" onClick={() => void removeStatement(org.id, s.id).then(() => setAsk('')).catch((err) => toast.show(friendlyError(err)))}>Yes, take it out</button>
                <button type="button" className="btn btn-quiet" onClick={() => setAsk('')}>Keep</button></span>
              : <button type="button" className="btn btn-quiet" onClick={() => setAsk(s.id)}>Take out</button>}
          </li>
        ))}
      </ul>
    </details>
  );
}

// ---- Closing the month (Andy, 2026-11-09, 5A) -------------------------------------------------------

const onDay = (t: unknown) => { const ms = millis(t); return ms ? new Date(ms).toLocaleDateString('en-KE', { day: 'numeric', month: 'short', year: 'numeric' }) : ''; };
function signedFor(row: FinMonthRow | undefined): FinSigned | null {
  if (row?.status !== 'closed') return null;
  return { preparedName: row.preparedName ?? '', preparedOn: onDay(row.preparedAt), approvedName: row.approvedName ?? '', approvedOn: onDay(row.approvedAt) };
}
const plain = (n: string) => n.toLowerCase().replace(/[^a-z]/g, '');
const APPROVER_NAMES = new Set([...REPORT_APPROVERS, ...ADIA_TOPUP_NAMES].map(plain));

/** Daniel marks the month prepared; Andrew, Doreen or Elias approves it in the app, which locks the month. */
function MonthClose({ org, month, row, waiting }: { org: Organization; month: string; row: FinMonthRow | undefined; waiting: number }) {
  const { user, profile, can } = useAuth();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const name = profile?.displayName ?? '';
  const pastor = can('users.manage');
  const approver = pastor || APPROVER_NAMES.has(plain(name));
  async function run(f: () => Promise<unknown>, done: string) {
    setBusy(true);
    try { await f(); toast.show(done); } catch (err) { toast.show(friendlyError(err)); } finally { setBusy(false); }
  }
  const status = row?.status ?? 'open';
  // One month close (Andy, 2026-11-09, 1A): it locks the month's requisitions too, so none may still wait for signatures.
  const p = usePettyCash(org);
  const reqsWaiting = p.requisitions.filter((r) => r.month === month && (r.status === 'submitted' || r.status === 'checked'));
  const blocked = waiting > 0 || reqsWaiting.length > 0;
  const reopen = async () => {
    await reopenFinMonth(org.id, month);
    // A month closed earlier on the old petty cash Month end page opens with it.
    await reopenPettyMonth(org.id, month, 'Opened again in Financial statements').catch(() => undefined);
  };
  return (
    <div className="fin-close">
      <h3>Closing {finPeriodName(month)}</h3>
      {status === 'closed' ? (
        <>
          <p className="small">✓ Closed. Prepared by {row?.preparedName} on {onDay(row?.preparedAt)}; approved by {row?.approvedName} on {onDay(row?.approvedAt)}. Its bank lines and requisitions can no longer change.</p>
          {pastor && <button type="button" className="btn btn-quiet align-start" disabled={busy} onClick={() => void run(reopen, 'The month is open again.')}>Open the month again</button>}
        </>
      ) : status === 'prepared' ? (
        <>
          <p className="small">Prepared by {row?.preparedName} on {onDay(row?.preparedAt)}. Waiting for {REPORT_APPROVERS.join(', ').replace(/, ([^,]*)$/, ' or $1')} to approve.</p>
          {approver && row?.preparedUid !== user?.uid && (
            <button type="button" className="btn btn-primary align-start" disabled={busy || blocked} onClick={() => void run(() => approveFinMonth(org.id, month, { preparedUid: row!.preparedUid!, preparedName: row!.preparedName!, preparedAt: row!.preparedAt }, name), `${finPeriodName(month)} is approved and closed.`)}>
              Approve and close the month
            </button>
          )}
          {row?.preparedUid === user?.uid && <p className="small muted">Someone else approves it.</p>}
        </>
      ) : (
        <>
          <p className="small muted">Upload the bank statement by the 5th of the next month, sort every line, then mark the month prepared for approval. Closing it also locks the month's petty cash requisitions and receipts.</p>
          {reqsWaiting.length > 0 && <p className="petty-warn small">Approve or reject the waiting requisitions first ({reqsWaiting.map((r) => r.number ?? 'new').slice(0, 5).join(', ')}).</p>}
          <button type="button" className="btn align-start" disabled={busy || blocked} onClick={() => void run(() => prepareFinMonth(org.id, month, name), 'Marked prepared. The approver can now approve it.')}>
            {waiting > 0 ? `Sort the ${waiting} waiting line${waiting === 1 ? '' : 's'} first` : 'Mark as prepared'}
          </button>
        </>
      )}
    </div>
  );
}

// ---- Free to spend (Andy, 2026-11-09, 3A) ---------------------------------------------------------------

/**
 * What can be spent now: bank (the latest statement balance plus bank money typed since) and petty cash, less
 * money held for # purposes and requests waiting for signatures. People give every week, so the card also
 * says what should be free at the month end once the expected giving is in and the rest of the budget spent.
 */
function FreeCard({ org, statements, budget }: { org: Organization; statements: StatementRow[]; budget: Record<string, number> }) {
  const p = usePettyCash(org);
  const bank = useBankMoney(org);
  const today = kenyaToday();
  const month = today.slice(0, 7);
  const f = useMemo(() => {
    const hasPetty = p.requisitions.length > 0;
    // Requisitions are paid from the bank (Andy, 2026-11-09): only those approved after the statement are not in its lines yet.
    const petty = approvedAfter(p.requisitions, bank.asOf, month);
    const held = potBalances(statements).reduce((n, x) => n + Math.max(0, x.cents), 0);
    return freeToSpend({
      statements, entries: [], paidSinceCents: bank.paidSinceCents, waitingCents: hasPetty ? p.summary.pendingCents : 0,
      heldCents: held, budget, spentThisMonth: spentInMonth(month, statements, [], petty), today,
    });
  }, [p.requisitions, p.summary, statements, budget, month, today, bank.paidSinceCents, bank.asOf]);
  const pots = useMemo(() => potBalances(statements).filter((x) => x.cents > 0), [statements]);
  const asOf = f.accounts.reduce((m, a) => (a.asOf > m ? a.asOf : m), '');
  return (
    <section className="card stack no-print">
      <h2>Free to spend</h2>
      <KpiRow label="Money free to spend">
        <KpiCard label="Free to spend now" value={money(org, f.freeCents)} tone={f.freeCents >= 0 ? 'ok' : 'warn'} />
        <KpiCard label="Bank, less approved since" value={money(org, f.cashCents)} note={asOf ? `Bank as at ${day(asOf)}` : undefined} />
        <KpiCard label="Held for # purposes" value={money(org, f.heldCents)} />
        <KpiCard label="Requests waiting" value={money(org, f.waitingCents)} />
      </KpiRow>
      <p className="small">
        People give about {money(org, f.weeklyGivingCents)} a week. With about {money(org, f.expectedCents)} still to come this month
        {f.budgetLeftCents ? ` and ${money(org, f.budgetLeftCents)} of this month's budget still to spend` : ''}, about <strong>{money(org, f.afterMonthCents)}</strong> should be free at the month end.
      </p>
      <details className="small">
        <summary>How this is worked out</summary>
        <ul className="plain">
          {f.accounts.map((a) => <li key={a.account}>{a.account}: {money(org, a.cents)} (statement to {day(a.asOf)}, plus bank money typed since)</li>)}
          <li>Requisitions approved since the statement: {money(org, f.paidSinceCents)}</li>
          {pots.map((x) => <li key={x.name}>Held for #{x.name} ({potLabel(x.name)}): {money(org, x.cents)}</li>)}
          <li>Requests waiting for signatures: {money(org, f.waitingCents)}</li>
          <li>Money given with a code such as #PAINTING is held for that purpose and not counted as free.</li>
        </ul>
      </details>
    </section>
  );
}
