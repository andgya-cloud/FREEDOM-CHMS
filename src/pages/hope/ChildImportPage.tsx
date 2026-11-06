import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useToast } from '../../state/ToastContext';
import { friendlyError } from '../../lib/errors';
import { importChildren, updateChild } from '../../lib/hopeWrites';
import { updatePerson } from '../../lib/peopleWrites';
import { formatDateKey } from '../../../functions/src/shared/datetime';
import { CHILD_TEMPLATE_EXAMPLE, CHILD_TEMPLATE_HEAD, planChildImport, whatFile, childUpdate, type ChildImportRow } from '../../../functions/src/shared/hopeRegister';
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
  const [saving, setSaving] = useState<{ done: number; total: number; what?: 'updated' } | null>(null);
  const [plan, setPlan] = useState<ChildImportRow[] | null>(null);
  const [fileName, setFileName] = useState('');
  const [error, setError] = useState('');
  const [sponsorList, setSponsorList] = useState(false);
  const [register, setRegister] = useState(false);
  const [all, setAll] = useState(false);
  // Children already here are updated with what the sheet says (Andy, 2026-11-06): matched by HC code, then by name.
  const updates = useMemo(() => {
    if (!plan) return [];
    const byCode = new Map(h.children.filter((c) => c.code).map((c) => [c.code!.toUpperCase(), c]));
    const byName = new Map(h.children.map((c) => [h.nameOf(c.id).trim().toLowerCase().replace(/\s+/g, ' '), c]));
    return plan.filter((r) => r.skip === 'already on the register').flatMap((r) => {
      const c = (r.givenCode ? byCode.get(r.givenCode) : undefined) ?? byName.get(r.name.trim().toLowerCase().replace(/\s+/g, ' '));
      if (!c) return [];
      const u = childUpdate(r, {
        gender: h.byId(c.id)?.gender ?? '', dateOfBirth: c.dateOfBirth ?? null, school: c.school ?? '', schoolClass: c.schoolClass ?? '',
        sponsorName: c.sponsorName ?? '', sponsorPhone: c.sponsorPhone ?? '', sponsorEmail: c.sponsorEmail ?? '', parentName: c.parentName ?? '',
        parentPhone: c.parentPhone ?? '', enrolledOn: c.enrolledOn ?? null, photoConsent: c.photoConsent?.given ?? null,
        guardianConsent: c.guardianConsent?.given ?? null, payment: c.payment ?? null,
      });
      return u.said.length ? [{ id: c.id, code: c.code ?? '', name: h.nameOf(c.id), ...u }] : [];
    });
  }, [plan, h]);
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
  async function update() {
    const total = updates.length;
    setSaving({ done: 0, total, what: 'updated' });
    let done = 0;
    try {
      for (const u of updates) {
        const { photoConsent, guardianConsent, ...rest } = u.child;
        await updateChild(org.id, u.id, {
          ...rest,
          ...(photoConsent != null ? { photoConsent: { given: photoConsent, date: h.today } } : {}),
          ...(guardianConsent != null ? { guardianConsent: { given: guardianConsent, date: h.today } } : {}),
        });
        if (u.gender) await updatePerson(org.id, u.id, { gender: u.gender });
        setSaving({ done: ++done, total, what: 'updated' });
      }
      toast.show(`${total} ${total === 1 ? 'child' : 'children'} updated.`);
    } catch (err) { toast.show(friendlyError(err)); setSaving(null); }
  }
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
        <h1>{done ? '✅ All saved' : saving.what ? 'Updating the children…' : 'Saving the children…'}</h1>
        <section className="card stack" aria-live="polite">
          <p className="lead"><b>{saving.done}</b> of <b>{saving.total}</b> {saving.what ?? 'saved'}</p>
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
      <h1>Upload or update children from Excel or CSV</h1>
      <section className="card stack">
        <p className="small">Fill in the template, one child per row, then choose the file. A child already here (same HC code or same name) is <b>updated</b> with what the sheet says; empty cells leave their profile as it is.</p>
        <TemplateButtons name="Hope-children-template" head={CHILD_TEMPLATE_HEAD} example={CHILD_TEMPLATE_EXAMPLE} />
        <SheetPicker kind="children" ready={!h.loading && !h.peopleLoading} onRows={(rows, name) => {
          // The partner's Child Registration List (KE-014) belongs on the Sponsorship list page (Andy, 2026-11-05).
          if (rows.some((r) => r.some((c) => String(c ?? '').trim().toLowerCase() === 'child id'))) {
            setFileName(name); setPlan(null); setSponsorList(true); setError(''); return;
          }
          setSponsorList(false);
          // A past register belongs on its own page (Andy, 2026-11-06).
          if (whatFile(rows) === 'register') { setFileName(name); setPlan(null); setRegister(true); setError(''); return; }
          setRegister(false);
          const p = planChildImport(rows, h.children.map((c) => h.nameOf(c.id)), h.today, h.children.map((c) => c.code ?? '').filter(Boolean));
          setFileName(name);
          setError(p ? '' : 'No "Name" column was found. Use the template\'s headings in the first row.');
          setPlan(p);
        }} />
        {error && <p className="error" role="alert">{error}</p>}
        {register && (
          <div className="notice notice-warn stack">
            <p><b>This is an attendance register</b>, not a list of new children. It adds past days to the children already here.</p>
            <Link to="/hope/register/upload" className="btn btn-primary align-start">📋 Open Upload past registers</Link>
          </div>
        )}
        {sponsorList && (
          <div className="notice notice-warn stack">
            <p><b>This is the KE-014 sponsorship list</b>, not a list of new children. It updates the children already here with their Child ID, sponsor and dates.</p>
            <Link to="/hope/children/sponsors" className="btn btn-primary align-start">🤝 Open the Sponsorship list page</Link>
          </div>
        )}
      </section>

      {plan && updates.length > 0 && (
        <section className="card stack">
          <h2>Update {updates.length} {updates.length === 1 ? 'child' : 'children'} already here</h2>
          <ul className="link-list">
            {updates.map((u) => (
              <li key={u.id}><div>
                <span className="link-title">{u.code && <span className="small muted">{u.code} · </span>}{u.name}</span>
                <span className="link-detail">{u.said.join(' · ')}</span>
              </div></li>
            ))}
          </ul>
          <button type="button" className="btn btn-primary align-start" onClick={() => void update()}>Update {updates.length} {updates.length === 1 ? 'child' : 'children'}</button>
        </section>
      )}

      {plan && (ready.length > 0 || updates.length === 0) && (
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
