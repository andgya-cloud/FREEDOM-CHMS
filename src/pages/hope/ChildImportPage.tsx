import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useToast } from '../../state/ToastContext';
import { friendlyError } from '../../lib/errors';
import { importChildren } from '../../lib/hopeWrites';
import { formatDateKey } from '../../../functions/src/shared/datetime';
import { CHILD_TEMPLATE_EXAMPLE, CHILD_TEMPLATE_HEAD, planChildImport, type ChildImportRow } from '../../../functions/src/shared/hopeRegister';
import { HopeGate, useHopePage } from './common';
import { SheetPicker, TemplateButtons } from './registerParts';
import type { Organization } from '../../state/OrgContext';

export function ChildImportPage() {
  return <HopeGate title="Upload children">{(org) => <ChildImport org={org} />}</HopeGate>;
}

/** Adds many children at once from an Excel or CSV file (Andy 11A). A code in the sheet (HC-0042) is kept; others get the next code. */
function ChildImport({ org }: { org: Organization }) {
  const h = useHopePage(org);
  const toast = useToast();
  const [saving, setSaving] = useState<{ done: number; total: number } | null>(null);
  const [plan, setPlan] = useState<ChildImportRow[] | null>(null);
  const [fileName, setFileName] = useState('');
  const [error, setError] = useState('');
  const [all, setAll] = useState(false);
  const ready = plan?.filter((r) => !r.skip) ?? [];
  const shown = plan ? (all ? plan : plan.slice(0, 60)) : [];

  const busy = !!saving && saving.done < saving.total;
  useEffect(() => {
    if (!busy) return;
    const warn = (e: BeforeUnloadEvent) => { e.preventDefault(); };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [busy]);

  // Shows how many have been saved, so nobody closes the page half way (Andy, 2026-11-04, 4A).
  function add() {
    const total = ready.length;
    setSaving({ done: 0, total });
    importChildren(org.id, ready, h.today, (done) => setSaving({ done, total }))
      .then(() => toast.show(`All ${total} ${total === 1 ? 'child' : 'children'} saved.`))
      .catch((err) => toast.show(friendlyError(err)));
  }

  if (saving) {
    const done = saving.done >= saving.total;
    const pc = saving.total ? Math.round((saving.done / saving.total) * 100) : 100;
    return (
      <div className="page narrow">
        <h1>{done ? '✅ All saved' : 'Saving the children…'}</h1>
        <section className="card stack" aria-live="polite">
          <p className="lead"><b>{saving.done}</b> of <b>{saving.total}</b> saved</p>
          <div className="up-bar" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pc}><i style={{ width: `${pc}%` }} /></div>
          {done ? <Link to="/hope/children" className="btn btn-primary align-start">See the children</Link>
            : <p className="notice notice-warn small">Please keep this page open until it says "All saved". Without internet, it carries on when the internet is back.</p>}
        </section>
      </div>
    );
  }

  return (
    <div className="page narrow">
      <p><Link to="/hope/children">← Children</Link></p>
      <h1>Upload children from Excel or CSV</h1>
      <section className="card stack">
        <p className="small">Fill in the template, one child per row, then choose the file.</p>
        <TemplateButtons name="Hope-children-template" head={CHILD_TEMPLATE_HEAD} example={CHILD_TEMPLATE_EXAMPLE} />
        <SheetPicker onRows={(rows, name) => {
          const p = planChildImport(rows, h.children.map((c) => h.nameOf(c.id)), h.today, h.children.map((c) => c.code ?? '').filter(Boolean));
          setFileName(name);
          setError(p ? '' : 'No "Name" column was found. Use the template\'s headings in the first row.');
          setPlan(p);
        }} />
        {error && <p className="error" role="alert">{error}</p>}
      </section>

      {plan && (
        <section className="card stack">
          <h2>{fileName}</h2>
          <p><b>{ready.length}</b> {ready.length === 1 ? 'child' : 'children'} to add{plan.length > ready.length ? `, ${plan.length - ready.length} skipped` : ''}.</p>
          <ul className="link-list">
            {shown.map((r) => (
              <li key={r.line}>
                <div>
                  <span className="link-title">{r.code && <span className="small muted">{r.code} · </span>}{r.name || `Row ${r.line}`}{r.skip && <span className="badge badge-muted">Skipped: {r.skip}</span>}</span>
                  {!r.skip && <span className="link-detail">{[r.dateOfBirth && `Born ${formatDateKey(r.dateOfBirth)}`, r.school, r.sponsorName && `Sponsor ${r.sponsorName}`, r.parentName && `Parent ${r.parentName}${r.parentPhone ? ` ${r.parentPhone}` : ''}`].filter(Boolean).join(' · ') || 'Name only'}</span>}
                  {r.warn && <span className="link-detail warn-text">Note: {r.warn}</span>}
                </div>
              </li>
            ))}
          </ul>
          {plan.length > shown.length && <button type="button" className="btn btn-quiet align-start" onClick={() => setAll(true)}>Show all {plan.length}</button>}
          <button type="button" className="btn btn-primary align-start" disabled={!ready.length} onClick={add}>Add {ready.length} {ready.length === 1 ? 'child' : 'children'}</button>
        </section>
      )}
    </div>
  );
}
