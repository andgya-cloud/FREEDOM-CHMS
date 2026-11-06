import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useToast } from '../../state/ToastContext';
import { useHopeDays } from '../../state/useHope';
import { friendlyError } from '../../lib/errors';
import { markMany } from '../../lib/hopeWrites';
import { formatDateKey } from '../../../functions/src/shared/datetime';
import { planPastRegister, type KidMark, type PastRegisterPlan } from '../../../functions/src/shared/hopeRegister';
import { HopeGate, useHopePage } from './common';
import { SheetPicker, TemplateButtons } from './registerParts';
import type { Organization } from '../../state/OrgContext';

export function PastRegisterPage() {
  return <HopeGate title="Upload past registers">{(org) => <PastRegister org={org} />}</HopeGate>;
}

const TEMPLATE_HEAD = ['Date', 'HC code', 'Name', 'Status'];
const TEMPLATE_EXAMPLE = ['2026-06-06', 'HC-0042', 'Faith Akinyi', 'Present'];

/**
 * Past registers from Excel or CSV (Andy, 2026-11-06): one row per child per day (Date, HC code or Name, Status),
 * such as the "Long list" sheet of the consolidated register. Marks already in the app are kept, never replaced.
 */
function PastRegister({ org }: { org: Organization }) {
  const h = useHopePage(org);
  const { days, loading } = useHopeDays(org.id);
  const toast = useToast();
  const [plan, setPlan] = useState<PastRegisterPlan | null>(null);
  const [fileName, setFileName] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState<{ done: number; total: number } | null>(null);
  const [showMissing, setShowMissing] = useState(false);

  // What will actually be added: only children not yet marked on that day.
  const todo = useMemo(() => {
    if (!plan) return [];
    return Object.entries(plan.days).sort(([a], [b]) => a.localeCompare(b)).map(([date, marks]) => {
      const had = days.find((d) => d.date === date)?.marks ?? {};
      const add: Record<string, { s: KidMark }> = {};
      let kept = 0;
      for (const [id, s] of Object.entries(marks)) { if (had[id]) kept++; else add[id] = { s }; }
      const came = Object.values(marks).filter((s) => s === 'present' || s === 'late').length;
      return { date, add, kept, total: Object.keys(marks).length, came };
    });
  }, [plan, days]);
  const adding = todo.reduce((n, d) => n + Object.keys(d.add).length, 0);
  const keptAll = todo.reduce((n, d) => n + d.kept, 0);

  const busy = !!saving && saving.done < saving.total;
  useEffect(() => {
    if (!busy) return;
    const warn = (e: BeforeUnloadEvent) => { e.preventDefault(); };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [busy]);

  async function save() {
    const list = todo.filter((d) => Object.keys(d.add).length);
    setSaving({ done: 0, total: list.length });
    let done = 0;
    try {
      for (const d of list) {
        await markMany(org.id, 'hopeDays', d.date, d.add);
        setSaving({ done: ++done, total: list.length });
      }
      toast.show(`${list.length} ${list.length === 1 ? 'day' : 'days'} saved.`);
    } catch (err) { toast.show(friendlyError(err)); setSaving(null); }
  }

  if (saving) {
    const done = saving.done >= saving.total;
    const pc = saving.total ? Math.round((saving.done / saving.total) * 100) : 100;
    return (
      <div className="page narrow">
        <h1>{done ? '✅ All saved' : 'Saving the registers…'}</h1>
        <section className="card stack" aria-live="polite">
          <p className="lead"><b>{saving.done}</b> of <b>{saving.total}</b> days saved</p>
          <div className="up-bar" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pc}><i style={{ width: `${pc}%` }} /></div>
          {done ? <Link to="/hope/attendance" className="btn btn-primary align-start">See attendance</Link>
            : <p className="notice notice-warn small">Please keep this page open until it says "All saved".</p>}
        </section>
      </div>
    );
  }

  const ready = !h.loading && !h.peopleLoading && !loading;
  return (
    <div className="page narrow">
      <p><Link to="/hope/attendance">← Attendance</Link></p>
      <h1>Upload past registers</h1>
      <section className="card stack">
        <p className="small">One row per child per day, with the headings <b>Date</b>, <b>HC code</b> (or <b>Name</b>) and <b>Status</b> (Present, Absent, Late or Excused). The consolidated register Excel works as it is: its "Long list" sheet is read.</p>
        <TemplateButtons name="Hope-past-register-template" head={TEMPLATE_HEAD} example={TEMPLATE_EXAMPLE} />
        <SheetPicker kind="register" ready={ready} onRows={(rows, name) => {
          const p = planPastRegister(rows, h.children.map((c) => ({ id: c.id, code: c.code ?? null, name: h.nameOf(c.id) })));
          setFileName(name); setPlan(p); setShowMissing(false);
          setError(p ? (p.rows ? '' : 'No rows with a date and a status were found.') : 'No "Date" and "Status" headings were found. Use the template\'s headings in the first row.');
        }} />
        {!ready && <p className="small muted">Loading the children…</p>}
        {error && <p className="error" role="alert">{error}</p>}
      </section>

      {plan && plan.rows > 0 && (
        <section className="card stack">
          <h2>{fileName}</h2>
          <p><b>{todo.length}</b> {todo.length === 1 ? 'day' : 'days'}, <b>{adding}</b> marks to add{keptAll ? `, ${keptAll} already in the app (kept as they are)` : ''}.</p>
          <ul className="link-list">
            {todo.map((d) => (
              <li key={d.date}><div>
                <span className="link-title">{formatDateKey(d.date)}</span>
                <span className="link-detail">{d.came} of {d.total} came{d.kept ? ` · ${d.kept} already marked` : ''}{Object.keys(d.add).length === 0 ? ' · nothing new' : ''}</span>
              </div></li>
            ))}
          </ul>
          {plan.unmatched.length > 0 && (
            <div className="notice notice-warn stack">
              <p><b>{plan.unmatched.length} {plan.unmatched.length === 1 ? 'name was' : 'names were'} not found</b> among the children here, so {plan.unmatched.length === 1 ? 'its rows are' : 'their rows are'} left out. Add the child first, or put their HC code in the file, then upload again: nothing is added twice.</p>
              {showMissing ? <ul className="small">{plan.unmatched.map((u) => <li key={u.name}>{u.name} ({u.rows} {u.rows === 1 ? 'row' : 'rows'})</li>)}</ul>
                : <button type="button" className="btn btn-quiet btn-small align-start" onClick={() => setShowMissing(true)}>Show the names</button>}
            </div>
          )}
          {plan.skipped > 0 && <p className="small muted">{plan.skipped} {plan.skipped === 1 ? 'row has' : 'rows have'} a date but no mark (or a mark but no date), so {plan.skipped === 1 ? 'it was' : 'they were'} skipped.</p>}
          <button type="button" className="btn btn-primary align-start" disabled={!adding} onClick={() => void save()}>Save {adding} marks</button>
        </section>
      )}
    </div>
  );
}
