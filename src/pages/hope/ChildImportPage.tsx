import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
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

/** Adds many children at once from an Excel or CSV file (Andy 11A). Each gets an HC code as usual. */
function ChildImport({ org }: { org: Organization }) {
  const h = useHopePage(org);
  const toast = useToast();
  const navigate = useNavigate();
  const [plan, setPlan] = useState<ChildImportRow[] | null>(null);
  const [fileName, setFileName] = useState('');
  const [error, setError] = useState('');
  const [all, setAll] = useState(false);
  const ready = plan?.filter((r) => !r.skip) ?? [];
  const shown = plan ? (all ? plan : plan.slice(0, 60)) : [];

  function add() {
    importChildren(org.id, ready, h.today).catch((err) => toast.show(friendlyError(err)));
    toast.show(`${ready.length} ${ready.length === 1 ? 'child' : 'children'} added. Codes (HC-…) appear in a moment.`);
    navigate('/hope/children');
  }

  return (
    <div className="page narrow">
      <p><Link to="/hope/children">← Children</Link></p>
      <h1>Upload children from Excel or CSV</h1>
      <section className="card stack">
        <p className="small">1. Download a template. 2. Fill in one child per row (only the name is needed). 3. Choose the file and check the list before adding.</p>
        <TemplateButtons name="Hope-children-template" head={CHILD_TEMPLATE_HEAD} example={CHILD_TEMPLATE_EXAMPLE} />
        <p className="small muted">Dates can be 2016-05-14 or 14/05/2016. Consent is Yes or No; leave it blank if it is not on file. Photos are added on each child's page.</p>
        <SheetPicker onRows={(rows, name) => {
          const p = planChildImport(rows, h.children.map((c) => h.nameOf(c.id)), h.today);
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
                  <span className="link-title">{r.name || `Row ${r.line}`}{r.skip && <span className="badge badge-muted">Skipped: {r.skip}</span>}</span>
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
