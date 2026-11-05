import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useToast } from '../../state/ToastContext';
import { friendlyError } from '../../lib/errors';
import { saveSponsorList } from '../../lib/hopeWrites';
import { planSponsorUpdate, type SponsorPlan } from '../../../functions/src/shared/hopeSponsorship';
import { formatDateKey } from '../../../functions/src/shared/datetime';
import { HopeGate, useHopePage } from './common';
import { SheetPicker } from './registerParts';
import type { Organization } from '../../state/OrgContext';

export function SponsorListPage() {
  return <HopeGate title="Sponsorship list">{(org) => <SponsorList org={org} />}</HopeGate>;
}

const FILL_LABEL: Record<string, string> = { dateOfBirth: 'date of birth', enrolledOn: 'joined on', sponsorName: 'sponsor', gender: 'gender' };

/**
 * Upload the sponsorship list (Andy, 2026-11-05): the partner's monthly Child Registration List for KE-014. Each
 * child's Child ID, sponsorship status, sponsor and dates go on their profile; empty fields are filled; the page
 * shows who was not found and who is not on the list.
 */
function SponsorList({ org }: { org: Organization }) {
  const h = useHopePage(org);
  const toast = useToast();
  const [plan, setPlan] = useState<SponsorPlan | null>(null);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState<{ done: number; total: number } | null>(null);
  const kids = useMemo(() => h.children.filter((c) => c.code).map((c) => ({
    id: c.id, code: c.code!, sponsorChildId: c.sponsorship?.childId ?? '', dateOfBirth: c.dateOfBirth ?? null, enrolledOn: c.enrolledOn ?? null,
    sponsorName: c.sponsorName ?? '', gender: h.byId(c.id)?.gender ?? '', name: h.nameOf(c.id),
  })), [h]);
  const existing = useMemo(() => Object.fromEntries(h.children.map((c) => [c.id, c.sponsorship])), [h.children]);

  function read(rows: (string | number | Date | null)[][]) {
    const p = planSponsorUpdate(rows, kids, h.today, existing);
    if (!p) { setPlan(null); setError('This sheet has no "Child ID" column. Choose the Child Registration List.'); return; }
    setError(''); setPlan(p);
  }
  function save() {
    if (!plan) return;
    const total = plan.rows.length;
    setSaving({ done: 0, total });
    saveSponsorList(org.id, plan.rows, (done) => setSaving({ done, total }))
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
      <p className="muted small">Upload the monthly Child Registration List (KE-014). Each child's Child ID, sponsorship status, sponsor and dates are saved on their profile. Empty fields such as the date of birth are filled in; nothing already saved is changed.</p>
      <section className="card stack">
        <SheetPicker onRows={read}><span className="small muted">The first time, use the list with the HC codes added. After that, the monthly list as it comes.</span></SheetPicker>
        {error && <p className="notice notice-warn small">{error}</p>}
      </section>
      {plan && (
        <>
          <section className="card stack">
            <h2>{plan.centre || 'The list'}</h2>
            <div className="ck-counts">
              <span className="ok"><b>{plan.rows.length}</b> children found</span>
              <span><b>{sponsored}</b> sponsored</span>
              <span><b>{plan.rows.length - sponsored}</b> not sponsored</span>
              {plan.notFound.length > 0 && <span className="bad"><b>{plan.notFound.length}</b> not found</span>}
            </div>
            <p className="small">Fills in: {Object.keys(fills).length ? Object.entries(fills).map(([k, n]) => `${FILL_LABEL[k]} for ${n}`).join(', ') : 'nothing new'}.</p>
            <button type="button" className="btn btn-primary align-start" disabled={!plan.rows.length} onClick={save}>Update {plan.rows.length} profiles</button>
          </section>
          {plan.notFound.length > 0 && (
            <details className="card hr-fold" open>
              <summary><h2>Not found ({plan.notFound.length})</h2><span className="small muted">Add their HC code in a "Code" column</span></summary>
              <ul className="link-list">{plan.notFound.map((r) => <li key={r.partnerId}><div><span className="link-title">{r.name}</span><span className="link-detail">{r.partnerId} · line {r.line}</span></div></li>)}</ul>
            </details>
          )}
          {differs.length > 0 && (
            <details className="card hr-fold">
              <summary><h2>Different on the list ({differs.length})</h2><span className="small muted">Kept as they are here; check them</span></summary>
              <ul className="link-list">{differs.map((r) => <li key={r.childId}><Link to={`/hope/children/${r.childId}`}><span className="link-title">{r.code} {r.name}</span><span className="link-detail">{r.differs.join(' · ')}</span></Link></li>)}</ul>
            </details>
          )}
          {plan.notOnList.length > 0 && (
            <details className="card hr-fold">
              <summary><h2>Not on the list ({plan.notOnList.length})</h2><span className="small muted">Children here who are not on KE-014</span></summary>
              <ul className="link-list">{plan.notOnList.map((r) => <li key={r.id}><Link to={`/hope/children/${r.id}`}><span className="link-title">{r.code} {r.name}</span></Link></li>)}</ul>
            </details>
          )}
          <p className="small muted">List of {formatDateKey(h.today)}.</p>
        </>
      )}
    </div>
  );
}
