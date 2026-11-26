import { useEffect, useState } from 'react';
import { httpsCallable } from 'firebase/functions';
import { functions } from '../../firebase';
import { useJobChurch } from '../../lib/serviceHosts';
import { HEADCOUNT_LABELS, type HeadcountKey } from '../../../functions/src/shared/attendance';
import { formatDateKey } from '../../../functions/src/shared/datetime';
import { PoweredBy } from '../../components/PoweredBy';

interface Service { id: string; date: string; name: string; counts: Partial<Record<HeadcountKey, number>>; people: string[] }

const ORDER: HeadcountKey[] = ['adults', 'teens', 'children', 'youth', 'all', 'firstTimers', 'salvations'];

/**
 * Sunday numbers, to look at only (Andy, 2026-11-26, 2A 3A): each service of the last eight weeks with its counts and
 * who checked in, for someone with the "Freedom Church, limited" Sunday tick (Diana).
 */
export function SundayNumbersPage() {
  const church = useJobChurch();
  const [services, setServices] = useState<Service[] | null>(null);
  const [error, setError] = useState('');
  const [open, setOpen] = useState('');
  useEffect(() => {
    if (!church) return;
    setServices(null);
    setError('');
    httpsCallable<{ orgId: string }, { services: Service[] }>(functions, 'sundayNumbers')({ orgId: church.id })
      .then((r) => setServices(r.data.services))
      .catch((e: { message?: string }) => setError(e.message ?? 'Could not load the Sunday numbers.'));
  }, [church?.id]);
  if (!church) return <div className="page narrow"><h1>Sunday numbers</h1><p>Sunday numbers are part of Freedom Church.</p></div>;
  return (
    <div className="page narrow">
      <h1>Sunday numbers</h1>
      <p className="muted">{church.name}: the last eight weeks. To change a number, ask Mr Andrew.</p>
      {error && <p className="notice notice-warn">{error}</p>}
      {!services && !error && <p className="muted">Loading…</p>}
      {services?.length === 0 && <p className="muted">No services in the last eight weeks yet.</p>}
      {services?.map((s) => (
        <section key={s.id} className="card stack">
          <h2>{formatDateKey(s.date)} · {s.name}</h2>
          {ORDER.some((k) => s.counts[k]) ? (
            <table className="table">
              <tbody>
                {ORDER.filter((k) => s.counts[k]).map((k) => <tr key={k}><td>{HEADCOUNT_LABELS[k]}</td><td className="num">{s.counts[k]}</td></tr>)}
              </tbody>
            </table>
          ) : <p className="muted small">No counts entered.</p>}
          {s.people.length > 0 ? (
            <>
              <button type="button" className="btn btn-quiet align-start" onClick={() => setOpen(open === s.id ? '' : s.id)}>
                {open === s.id ? 'Hide' : 'Show'} who checked in ({s.people.length})
              </button>
              {open === s.id && <ul className="small">{s.people.map((n, i) => <li key={`${n}-${i}`}>{n}</li>)}</ul>}
            </>
          ) : <p className="muted small">Nobody checked in by name.</p>}
        </section>
      ))}
      <PoweredBy />
    </div>
  );
}
