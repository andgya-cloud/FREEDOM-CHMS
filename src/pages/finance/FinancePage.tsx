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
import { useLedgerMonths } from '../../state/useGiving';
import { orgKind, useDaily, useFinance, type StatementRow } from '../../state/useFinance';
import { removeStatement, saveFinBook, saveLines, saveStatement } from '../../lib/financeWrites';
import { pettyReport, REPORT_APPROVERS, REPORT_PREPARED_BY } from '../../../functions/src/shared/pettyReport';
import { parseAmountCents } from '../../../functions/src/shared/pettyCash';
import {
  autoCategory, categoriesFor, readyMonth, typedCategory, type FinReport, FIN_ACCOUNT_SUGGESTIONS, FIN_CATEGORIES, financialReport, finLabel, finPeriodName, finPeriods, learnKey, lineKey,
  OWE_KINDS, OWN_KINDS, type BankLine, type FinInput, type OwnedItem, type ParsedStatement, type PettyFigures,
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
  const needs = f.statements.reduce((n, s) => n + s.lines.filter((l) => !l.s).length, 0);
  return (
    <div className="page narrow">
      <div className="page-head"><h1>Financial statements</h1></div>
      <p className="lead">{org.name}. Upload a bank or M-Pesa statement; the app sorts every line and makes the monthly or yearly report.</p>
      <UploadCard org={org} statements={f.statements} learned={f.learned} />
      {needs > 0 && <NeedsYouCard org={org} statements={f.statements} learned={f.learned} count={needs} />}
      {f.statements.length > 0 ? <ReportCard org={org} statements={f.statements} budget={f.budget} owned={f.owned} learned={f.learned} />
        : !f.loading && <p className="muted small">No statements yet. Upload the first one above.</p>}
      <OwnedCard org={org} owned={f.owned} />
      <BudgetCard org={org} budget={f.budget} />
      {f.statements.length > 0 && <StatementsCard org={org} statements={f.statements} />}
    </div>
  );
}

// ---- Upload -------------------------------------------------------------------------------

function UploadCard({ org, statements, learned }: { org: Organization; statements: StatementRow[]; learned: Record<string, string> }) {
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
    const fresh = read.lines.filter((l) => !have.has(lineKey(name, l)));
    // A line that matches bank money typed on the day takes the category typed then (Andy, 2026-11-09).
    const taken = new Set<string>();
    const lines: BankLine[] = fresh.map((l) => { const c = typedCategory(l, name, daily.entries, taken); return { ...l, ...(c ? { c, s: true } : autoCategory(l, learned, orgKind(org.type))) }; });
    return { lines, skipped: read.lines.length - fresh.length, sure: lines.filter((l) => l.s).length };
  }, [read, name, statements, learned, org.type, daily.entries]);

  async function save() {
    if (!read || !plan || !file || !name) return;
    if (!plan.lines.length) { toast.show('Every line of this statement is already in.'); return; }
    setBusy(true);
    try {
      await saveStatement(org.id, { account: name, accountKind: isMpesa(name) ? 'mpesa' : 'bank', fileName: file.name, from: plan.lines[0]!.d, to: plan.lines[plan.lines.length - 1]!.d,
        openingCents: plan.lines[0]!.b - plan.lines[0]!.i + plan.lines[0]!.o, closingCents: plan.lines[plan.lines.length - 1]!.b, lines: plan.lines });
      toast.show(`Saved ${plan.lines.length} lines from ${file.name}.`);
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
async function chooseCategory(orgId: string, statements: StatementRow[], learned: Record<string, string>, target: { sid: string; n: number }, c: string): Promise<number> {
  const s0 = statements.find((s) => s.id === target.sid)!;
  const line = s0.lines[target.n]!;
  const dir = line.i > 0 ? 'in' : 'out';
  const key = learnKey(line.t, dir);
  let others = 0;
  const writes: Promise<unknown>[] = [];
  for (const s of statements) {
    let changed = false;
    const lines = s.lines.map((l, n) => {
      if (s.id === target.sid && n === target.n) { changed = true; return { ...l, c, s: true }; }
      if (!l.s && (l.i > 0 ? 'in' : 'out') === dir && learnKey(l.t, dir) === key) { changed = true; others += 1; return { ...l, c, s: true }; }
      return l;
    });
    if (changed) writes.push(saveLines(orgId, s.id, lines));
  }
  if (key.length > 4 && learned[key] !== c) writes.push(saveFinBook(orgId, 'learned', { ...learned, [key]: c }));
  await Promise.all(writes);
  return others;
}

function NeedsYouCard({ org, statements, learned, count }: { org: Organization; statements: StatementRow[]; learned: Record<string, string>; count: number }) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const waiting = useMemo(() => statements.flatMap((s) => s.lines.map((l, n) => ({ l, n, sid: s.id, account: s.account })).filter((x) => !x.l.s))
    .sort((a, b) => b.l.d.localeCompare(a.l.d)).slice(0, 25), [statements]);
  async function pick(sid: string, n: number, c: string) {
    try {
      const others = await chooseCategory(org.id, statements, learned, { sid, n }, c);
      if (others) toast.show(`Also sorted ${others} more line${others === 1 ? '' : 's'} like it.`);
    } catch (err) { toast.show(friendlyError(err)); }
  }
  async function acceptAll() {
    setBusy(true);
    try {
      await Promise.all(statements.filter((s) => s.lines.some((l) => !l.s)).map((s) => saveLines(org.id, s.id, s.lines.map((l) => ({ ...l, s: true })))));
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


function ReportCard({ org, statements, budget, owned, learned }: { org: Organization; statements: StatementRow[]; budget: Record<string, number>; owned: OwnedItem[]; learned: Record<string, string> }) {
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
  const today = new Date(Date.now() + 3 * 3_600_000).toISOString().slice(0, 10);
  const build = useCallback((period: string): FinReport => {
    const hasPetty = p.funds.length > 0 || p.requisitions.length > 0;
    const pf = (x: string): PettyFigures => {
      const r = pettyReport(x, p.funds, p.requisitions, {}, millis);
      return { openingCents: r.openingCents, inCents: r.inCents, outCents: r.outCents, closingCents: r.closingCents, categories: r.categories.map((c) => ({ category: c.category, cents: c.cents })) };
    };
    const prev = (x: string) => (x.length === 4 ? String(+x - 1) : (() => { const [y, m] = x.split('-').map(Number) as [number, number]; return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, '0')}`; })());
    const lastYear = period.length === 4 ? String(+period - 1) : `${+period.slice(0, 4) - 1}${period.slice(4)}`;
    const trendMonths: string[] = period.length === 4 ? Array.from({ length: 12 }, (_, n) => `${period}-${String(n + 1).padStart(2, '0')}`)
      : Array.from({ length: 6 }, (_, n) => { let x = period; for (let k = 0; k < 5 - n; k++) x = prev(x); return x; });
    const topups = p.funds.filter((f) => f.kind === 'topup' && f.status === 'done' && !(f as { pastRecord?: boolean }).pastRecord)
      .map((f) => ({ date: new Date((millis(f.doneAt) ?? Date.now()) + 3 * 3_600_000).toISOString().slice(0, 10), cents: f.amountCents }));
    const input: FinInput = {
      statements, owned, budget,
      petty: hasPetty ? { now: pf(period), before: pf(prev(period)), lastYear: pf(lastYear) } : null,
      pettyOutByMonth: hasPetty ? Object.fromEntries(trendMonths.map((m) => [m, pf(m).outCents])) : {},
      givingRecordedCents: church && period === chosen ? ledger.reduce((n, m) => n + (m.totalCents ?? 0), 0) : null,
      today,
      daily: { entries: daily.entries, topups },
    };
    return financialReport(period, input, (c) => money(org, c));
  }, [statements, owned, budget, p.funds, p.requisitions, church, chosen, ledger, org, daily.entries, today]);
  const rep = useMemo(() => (chosen ? build(chosen) : null), [build, chosen]);
  const ready = useMemo(() => readyMonth(statements, today), [statements, today]);
  const readyRep = useMemo(() => (ready ? (ready === chosen ? rep : build(ready)) : null), [ready, chosen, rep, build]);
  const [params] = useSearchParams();
  const showBalance = params.get('show') === 'balance';

  async function make(kind: 'pdf' | 'excel') {
    if (!rep) return;
    setBusy(kind);
    try {
      if (kind === 'pdf') { const { financeReportPdf } = await import('../../lib/financePdf'); downloadFile(await financeReportPdf(org, rep, approver)); }
      else { const { financeReportWorkbook } = await import('../../lib/financeExcel'); downloadFile(await financeReportWorkbook(org.name, rep, approver)); }
    } catch (err) { toast.show(friendlyError(err)); } finally { setBusy(''); }
  }

  if (!rep) return null;
  return (
    <>
      {readyRep && <ReadyCard org={org} rep={readyRep} approver={approver} />}
      {showBalance && <BalanceCard org={org} rep={rep} />}
      <section className="card stack no-print">
        <h2>Monthly or yearly report</h2>
        <div className="field-row">
          <label className="field"><span>Period</span>
            <select value={chosen} onChange={(e) => setPeriod(e.target.value)}>
              {periods.map((x) => <option key={x} value={x}>{x.length === 4 ? `Whole year ${x}` : finPeriodName(x)}</option>)}
            </select>
          </label>
          <label className="field"><span>Approved by</span>
            <select value={approver} onChange={(e) => setApprover(e.target.value)}>{REPORT_APPROVERS.map((n) => <option key={n} value={n}>{n}</option>)}</select>
          </label>
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
      </section>
      <LinesCard org={org} statements={statements} learned={learned} period={chosen} />
    </>
  );
}

/**
 * The month's statement, ready once the bank statement is in (Andy, 2026-11-09, 4A), with buttons to send
 * it. On a phone the PDF goes straight into WhatsApp or email; on a computer it downloads and the message opens.
 */
function ReadyCard({ org, rep, approver }: { org: Organization; rep: FinReport; approver: string }) {
  const toast = useToast();
  const [busy, setBusy] = useState('');
  const title = `${org.name} · Financial statement · ${rep.name}`;
  const text = `${title}. ${rep.summary.slice(0, 2).join(' ')}`;
  async function go(via: 'pdf' | 'wa' | 'mail') {
    setBusy(via);
    try {
      const { financeReportPdf } = await import('../../lib/financePdf');
      const file = await financeReportPdf(org, rep, approver);
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
      <h2>{waiting ? `${rep.name} statement: ${waiting} line${waiting === 1 ? '' : 's'} need you first` : `✓ ${rep.name} statement is ready`}</h2>
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
        </tbody>
      </table>
    </section>
  );
}

/** Every line of the period, to change a category that was sorted wrongly. */
function LinesCard({ org, statements, learned, period }: { org: Organization; statements: StatementRow[]; learned: Record<string, string>; period: string }) {
  const toast = useToast();
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
              <CategorySelect line={l} onChange={(c) => void chooseCategory(org.id, statements, learned, { sid, n }, c).catch((err) => toast.show(friendlyError(err)))} />
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
        <p className="small muted">The amount planned for each month. A year report multiplies it by the months so far. Leave blank what you do not budget.</p>
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
