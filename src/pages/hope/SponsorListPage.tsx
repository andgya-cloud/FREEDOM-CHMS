import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useToast } from '../../state/ToastContext';
import { friendlyError } from '../../lib/errors';
import { saveSponsorList } from '../../lib/hopeWrites';
import { NOT_ON_LIST, notOnListSponsorship, planSponsorUpdate } from '../../../functions/src/shared/hopeSponsorship';
import { formatDateKey } from '../../../functions/src/shared/datetime';
import { HopeGate, useHopePage } from './common';
import { SheetPicker } from './registerParts';
import type { Organization } from '../../state/OrgContext';

export function SponsorListPage() {
  return <HopeGate title="Sponsorship list">{(org) => <SponsorList org={org} />}</HopeGate>;
}

const FILL_LABEL: Record<string, string> = { dateOfBirth: 'birth date', enrolledOn: 'registration date', sponsorName: 'sponsor', gender: 'gender' };
type Rows = (string | number | Date | null)[][];

/**
 * Upload the sponsorship list (Andy, 2026-11-05, 1A-5A): the partner's monthly Child Registration List for KE-014, as
 * it comes, with no HC codes. Children are matched by name and birth date; any the app is not sure of are listed to
 * pick. The list is right for birth date, gender, registration date and sponsor; our names are kept, and children
 * not on the list are marked "Not on KE-014".
 */
function SponsorList({ org }: { org: Organization }) {
  const h = useHopePage(org);
  const toast = useToast();
  const [rows, setRows] = useState<Rows | null>(null);
  const [picks, setPicks] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState<{ done: number; total: number } | null>(null);
  const kids = useMemo(() => h.children.filter((c) => c.code).map((c) => ({
    id: c.id, code: c.code!, sponsorChildId: c.sponsorship?.childId ?? '', dateOfBirth: c.dateOfBirth ?? null, enrolledOn: c.enrolledOn ?? null,
    sponsorName: c.sponsorName ?? '', gender: h.byId(c.id)?.gender ?? '', name: h.nameOf(c.id),
  })), [h]);
  const existing = useMemo(() => Object.fromEntries(h.children.map((c) => [c.id, c.sponsorship])), [h.children]);
  const plan = useMemo(() => (rows ? planSponsorUpdate(rows, kids, h.today, existing, picks) : null), [rows, kids, h.today, existing, picks]);
  const error = rows && !plan ? 'This sheet has no "Child ID" column. Choose the Child Registration List.' : '';
  // Only children whose mark changes are written again.
  const toMark = useMemo(() => (plan ? plan.notOnList.filter((c) => existing[c.id]?.status !== NOT_ON_LIST) : []), [plan, existing]);

  function read(r: Rows) { setPicks({}); setRows(r); }
  function save() {
    if (!plan) return;
    const total = plan.rows.length + toMark.length;
    const mark = toMark.map((c) => ({ id: c.id, sponsorship: notOnListSponsorship(plan.centre, h.today) }));
    setSaving({ done: 0, total });
    saveSponsorList(org.id, plan.rows, (done) => setSaving({ done, total }), mark)
      .then(() => toast.show(`${total} profiles updated.`))
      .catch((err) => { toast.show(friendlyError(err)); setSaving(null); });
  }

  const fills = plan ? plan.rows.reduce((m, r) => { for (const k of Object.keys(r.fill)) m[k] = (m[k] ?? 0) + 1; return m; }, {} as Record<string, number>) : {};
  const differs = plan?.rows.filter((r) => r.differs.length) ?? [];
  const sponsored = plan?.rows.filter((r) => /^sponsored/i.test(r.sponsorship.status)).length ?? 0;

  if (saving) {
    const done = saving.done >= saving.total;
    return (
      <div className="page narrow">
        <h1>{done ? '✅ Profiles updated' : 'Updating the profiles…'}</h1>
        <section className="card stack" aria-live="polite">
          <p className="lead"><b>{saving.done}</b> of <b>{saving.total}</b></p>
          <div className="up-bar"><i style={{ width: `${saving.total ? Math.round((saving.done / saving.total) * 100) : 100}%` }} /></div>
          {done ? <Link to="/hope/children" className="btn btn-primary align-start">See the children</Link> : <p className="notice notice-warn small">Please keep this page open until it says "Profiles updated".</p>}
        </section>
      </div>
    );
  }

  return (
    <div className="page narrow">
      <p><Link to="/hope/children">← Children</Link></p>
      <h1>Sponsorship list</h1>
      <p className="muted small">Upload the monthly Child Registration List (KE-014) as it comes. Each child is found by name and birth date. The list is taken as right for the birth date, gender, registration date and sponsor; our spelling of names is kept.</p>
      <section className="card stack">
        <SheetPicker onRows={read} />
        {error && <p className="notice notice-warn small">{error}</p>}
      </section>
      {plan && (
        <>
          {plan.unsure.length > 0 && (
            <section className="card stack">
              <h2>Please check ({plan.unsure.length})</h2>
              <p className="small muted">The app is not sure who these are. Choose the child for each one.</p>
              {plan.unsure.map((u) => (
                <label key={u.partnerId} className="field"><span><b>{u.name}</b> · {u.partnerId}{u.dateOfBirth ? ` · born ${formatDateKey(u.dateOfBirth)}` : ''}</span>
                  <select value="" onChange={(e) => setPicks({ ...picks, [u.partnerId]: e.target.value === 'none' ? '' : e.target.value })}>
                    <option value="" disabled>Choose…</option>
                    {u.candidates.map((c) => <option key={c.id} value={c.id}>{c.code} {c.name}{c.dateOfBirth ? ` (born ${formatDateKey(c.dateOfBirth)})` : ''}</option>)}
                    <option value="none">None of these</option>
                  </select>
                </label>
              ))}
            </section>
          )}
          <section className="card stack">
            <h2>{plan.centre || 'The list'}</h2>
            <div className="ck-counts">
              <span className="ok"><b>{plan.rows.length}</b> children found</span>
              <span><b>{sponsored}</b> sponsored</span>
              <span><b>{plan.rows.length - sponsored}</b> not sponsored</span>
              {plan.notOnList.length > 0 && <span><b>{plan.notOnList.length}</b> not on KE-014</span>}
              {plan.notFound.length > 0 && <span className="bad"><b>{plan.notFound.length}</b> not found</span>}
            </div>
            <p className="small">Updates: {Object.keys(fills).length ? Object.entries(fills).map(([k, n]) => `${FILL_LABEL[k]} for ${n}`).join(', ') : 'nothing new'}.</p>
            {plan.unsure.length > 0 && <p className="notice notice-warn small">Choose the {plan.unsure.length} {plan.unsure.length === 1 ? 'child' : 'children'} under "Please check" first.</p>}
            <button type="button" className="btn btn-primary align-start" disabled={!plan.rows.length || plan.unsure.length > 0} onClick={save}>Update {plan.rows.length + toMark.length} profiles</button>
          </section>
          {differs.length > 0 && (
            <details className="card hr-fold">
              <summary><h2>Changed to match KE-014 ({differs.length})</h2><span className="small muted">What will change on each profile</span></summary>
              <ul className="link-list">{differs.map((r) => <li key={r.childId}><Link to={`/hope/children/${r.childId}`}><span className="link-title">{r.code} {r.name}</span><span className="link-detail">{r.differs.join(' · ')}</span></Link></li>)}</ul>
            </details>
          )}
          {plan.notOnList.length > 0 && (
            <details className="card hr-fold">
              <summary><h2>Not on KE-014 ({plan.notOnList.length})</h2><span className="small muted">Marked "Not on KE-014" on their profile</span></summary>
              <ul className="link-list">{plan.notOnList.map((r) => <li key={r.id}><Link to={`/hope/children/${r.id}`}><span className="link-title">{r.code} {r.name}</span></Link></li>)}</ul>
            </details>
          )}
          {plan.notFound.length > 0 && (
            <details className="card hr-fold">
              <summary><h2>On KE-014 but not here ({plan.notFound.length})</h2><span className="small muted">Register them first, then upload again</span></summary>
              <ul className="link-list">{plan.notFound.map((r) => <li key={r.partnerId}><div><span className="link-title">{r.name}</span><span className="link-detail">{r.partnerId} · line {r.line}</span></div></li>)}</ul>
            </details>
          )}
          <p className="small muted">List of {formatDateKey(h.today)}.</p>
        </>
      )}
    </div>
  );
}
