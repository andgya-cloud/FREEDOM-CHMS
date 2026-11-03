import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import type { Organization } from '../state/OrgContext';
import type { ChurchEvent } from '../state/useAttendance';
import { useToast } from '../state/ToastContext';
import { findService, recordService } from '../lib/attendanceWrites';
import { friendlyError } from '../lib/errors';
import { cleanCount, HEADCOUNT_LABELS, isOtherServiceName, serviceName, type Headcounts } from '../../functions/src/shared/attendance';
import { ServiceInput, serviceSuggestions } from './ServiceInput';
import { formatDateKey } from '../../functions/src/shared/datetime';

const KEYS = ['adults', 'teens', 'children', 'firstTimers', 'salvations'] as const;
type Key = (typeof KEYS)[number];
const HINTS: Record<Key, string> = { adults: '20 and over', teens: '13 to 19', children: 'Under 13', firstTimers: 'Already in the numbers above', salvations: 'Already in the numbers above' };

const shift = (key: string, days: number) => {
  const d = new Date(`${key}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
};
/** The last Sunday on or before the day. */
const lastSunday = (key: string) => shift(key, -new Date(`${key}T12:00:00Z`).getUTCDay());

/**
 * "Record a past service" (Andy, 2026-11-02, 1A-4A): pick the day and the service (a Sunday service, or a midweek,
 * youth or special one), type the numbers, Save. "Save and do the week before" steps back a week, so past Sundays
 * can be filled in one after another. Names can be added afterwards on the service's page.
 */
export function RecordServiceCard({ org, today, events }: { org: Organization; today: string; events: ChurchEvent[] }) {
  const toast = useToast();
  // Type the service and its time (Andy, 2026-11-03); names used before are suggested.
  const suggestions = useMemo(() => serviceSuggestions([...events.map((e) => e.name), ...(org.otherServices ?? [])]), [events, org.otherServices]);

  const [date, setDate] = useState(() => lastSunday(today));
  const [service, setService] = useState('');
  const [time, setTime] = useState('');
  const [counts, setCounts] = useState<Headcounts>({});
  const [found, setFound] = useState(false);
  const [busy, setBusy] = useState(false);
  const [last, setLast] = useState<{ id: string; label: string } | null>(null);
  const name = serviceName(service, time);
  const isOther = isOtherServiceName(org.otherServices, name);

  // Show what is already saved for that day and service, so it can be corrected rather than typed twice.
  useEffect(() => {
    let live = true;
    setFound(false);
    if (!name || !date) { setCounts({}); return; }
    findService(org.id, date, name)
      .then((f) => { if (live) { setCounts(f?.headcounts ?? {}); setFound(!!f); } })
      .catch(() => { if (live) setCounts({}); });
    return () => { live = false; };
  }, [org.id, date, name]);

  const total = (counts.adults ?? 0) + (counts.teens ?? 0) + (counts.children ?? 0);

  async function save(andBack: boolean) {
    if (!name) return toast.show('Type the name of the service.');
    if (date > today) return toast.show('Choose a day that has already happened.');
    setBusy(true);
    try {
      const clean: Headcounts = {};
      for (const k of KEYS) clean[k] = cleanCount(counts[k]);
      const { id, synced } = await recordService(org.id, { date, name, other: isOther, headcounts: clean });
      synced.catch((err) => toast.show(friendlyError(err)));
      const label = `${name}, ${formatDateKey(date)}`;
      setLast({ id, label });
      toast.show(`Saved: ${label}`);
      if (andBack) setDate(shift(date, -7));
    } catch (err) {
      toast.show(friendlyError(err));
    } finally {
      setBusy(false);
    }
  }

  const submit = (e: FormEvent) => { e.preventDefault(); void save(false); };

  return (
    <section className="card record-service" aria-label="Record a past service">
      <h2>Record a past service</h2>
      <form className="stack" onSubmit={submit}>
        <div className="form-grid">
          <label className="field"><span>Day</span>
            <input type="date" value={date} max={today} onChange={(e) => setDate(e.target.value || lastSunday(today))} />
          </label>
        </div>
        <ServiceInput service={service} time={time} onService={setService} onTime={setTime} suggestions={suggestions} />
        {found && <p className="hint">Already recorded. Saving updates it.</p>}
        <div className="record-counts">
          {KEYS.map((k) => (
            <label key={k} className="field record-count">
              <span>{HEADCOUNT_LABELS[k]}</span>
              <input type="number" inputMode="numeric" min={0} value={counts[k] ?? ''} placeholder="0" onFocus={(e) => e.target.select()}
                onChange={(e) => setCounts((c) => ({ ...c, [k]: cleanCount(e.target.value) }))} />
              <small className="hint">{HINTS[k]}</small>
            </label>
          ))}
        </div>
        <p className="small"><b>Total: {total}</b> <span className="muted">(adults, teens and children)</span></p>
        <div className="button-row">
          <button type="submit" className="btn btn-primary" disabled={busy}>Save</button>
          <button type="button" className="btn" disabled={busy} onClick={() => void save(true)}>Save and do the week before</button>
        </div>
        {last && <p className="small">Saved {last.label}. <Link to={`/attendance/${org.id}/${last.id}`}>Add the names of who came</Link></p>}
      </form>
    </section>
  );
}
