import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { collection, doc, setDoc } from 'firebase/firestore';
import { db } from '../../firebase';
import { useOrg } from '../../state/OrgContext';
import { useToast } from '../../state/ToastContext';
import { useReportSettings } from '../../state/useReports';
import { useLiveQuery } from '../../lib/useQuery';
import { createStamps, updateRecord } from '../../lib/records';
import { trackWrite } from '../../lib/sync';
import { friendlyError } from '../../lib/errors';
import { formatMoney, parseAmount } from '../../../functions/src/shared/giving';

interface StaffRow { id: string; displayName: string; active: boolean }

/** Who counts as a regular attender, who gets reports by email, and giving budgets. */
export function ReportSettingsPage() {
  const { settings, exists, ready } = useReportSettings();
  const { organizations } = useOrg();
  const toast = useToast();
  const { rows: staffRows } = useLiveQuery<StaffRow>(() => collection(db, 'staff'), []);
  const staff = useMemo(() => staffRows.filter((s) => s.active).sort((a, b) => a.displayName.localeCompare(b.displayName)), [staffRows]);
  const [weeks, setWeeks] = useState(3);
  const [emailEnabled, setEmailEnabled] = useState(false);
  const [recipients, setRecipients] = useState<string[]>([]);
  const [budgets, setBudgets] = useState<Record<string, string>>({});
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    if (!ready || dirty) return;
    setWeeks(settings.regularWeeks ?? 3);
    setEmailEnabled(settings.emailEnabled ?? false);
    setRecipients(settings.recipientUids ?? []);
    setBudgets(Object.fromEntries(Object.entries(settings.budgets ?? {}).map(([k, v]) => [k, String(v / 100)])));
  }, [ready, settings, dirty]);

  const touch = <T,>(set: (v: T) => void) => (v: T) => { set(v); setDirty(true); };

  function save() {
    const clean: Record<string, number> = {};
    for (const [orgId, text] of Object.entries(budgets)) {
      if (!text.trim()) continue;
      const cents = parseAmount(text);
      if (cents == null) return toast.show('Please check the budget amounts.');
      clean[orgId] = cents;
    }
    const data = { regularWeeks: weeks, emailEnabled, recipientUids: recipients, budgets: clean };
    const ref = doc(db, 'settings', 'reports');
    (exists ? updateRecord(ref, data) : trackWrite(setDoc(ref, { ...data, ...createStamps() }))).catch((err) => toast.show(friendlyError(err)));
    setDirty(false);
    toast.show('Report settings saved');
  }

  return (
    <div className="page narrow">
      <p><Link to="/settings">← Settings</Link></p>
      <h1>Reports</h1>
      <p className="lead">Weekly reports every Monday at 07:00, monthly reports on the 1st at 07:00.</p>

      <section className="card stack">
        <h2>Regular attenders</h2>
        <label className="field">
          <span>Someone is a regular attender if they came to a service in at least</span>
          <select value={weeks} onChange={(e) => touch(setWeeks)(Number(e.target.value))}>
            {[1, 2, 3, 4, 5, 6, 7, 8].map((n) => <option key={n} value={n}>{n} of the last 8 weeks</option>)}
          </select>
        </label>
        <p className="small muted">Used for the scorecard, drop-off alerts and the care messages after 3 weeks away.</p>
      </section>

      <section className="card stack">
        <h2>Email</h2>
        <label className="check">
          <input type="checkbox" checked={emailEnabled} onChange={(e) => touch(setEmailEnabled)(e.target.checked)} /> Email each report as a PDF
        </label>
        <p className="small muted">Needs the email sender set up in Firebase first (see the Stage 7 notes). Each person's copy only has what their access allows: giving only goes to staff with finance reports.</p>
        <fieldset className="stack">
          <legend className="small">Send to (none ticked means the pastor)</legend>
          {staff.map((s) => (
            <label key={s.id} className="check">
              <input
                type="checkbox"
                checked={recipients.includes(s.id)}
                onChange={(e) => touch(setRecipients)(e.target.checked ? [...recipients, s.id] : recipients.filter((x) => x !== s.id))}
              /> {s.displayName}
            </label>
          ))}
        </fieldset>
      </section>

      <section className="card stack">
        <h2>Giving budget (optional)</h2>
        <p className="small muted">A monthly budget shows giving against budget in the pastor's copy. Weekly reports use a week's share (12 months ÷ 52 weeks).</p>
        {organizations.filter((o) => o.type === 'church_campus').map((o) => (
          <label key={o.id} className="field">
            <span>{o.name}, per month ({o.currency || 'KES'})</span>
            <input inputMode="decimal" value={budgets[o.id] ?? ''} placeholder="No budget" onChange={(e) => touch(setBudgets)({ ...budgets, [o.id]: e.target.value })} />
            {budgets[o.id] && parseAmount(budgets[o.id]!) != null && <span className="hint">{formatMoney(parseAmount(budgets[o.id]!)!, o.currency || 'KES')}</span>}
          </label>
        ))}
      </section>

      <div className="dialog-actions">
        <button type="button" className="btn btn-primary" disabled={!dirty} onClick={save}>Save</button>
      </div>
    </div>
  );
}
