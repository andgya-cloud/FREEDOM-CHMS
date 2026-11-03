import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import type { Organization } from '../state/OrgContext';
import type { ChurchEvent } from '../state/useAttendance';
import { useToast } from '../state/ToastContext';
import { recordService } from '../lib/attendanceWrites';
import { friendlyError } from '../lib/errors';
import { cleanCount, HEADCOUNT_LABELS, isOtherServiceName, serviceName, splitServiceName, type Headcounts } from '../../functions/src/shared/attendance';
import { ServiceInput, serviceSuggestions } from './ServiceInput';
import { formatDateKey } from '../../functions/src/shared/datetime';

const KEYS = ['adults', 'teens', 'children', 'firstTimers', 'salvations'] as const;
type Key = (typeof KEYS)[number];
const HINTS: Record<Key, string> = { adults: '20 and over', teens: '13 to 19', children: 'Under 13', firstTimers: 'Already in the numbers above', salvations: 'Already in the numbers above' };

/**
 * One card for the day picked at the top of the Service page (Andy, 2026-11-03, 2A 3A): type or pick the service and
 * its time, type the numbers and Save, or open the register to check people in by name. "Total count" is worked out
 * from adults, teens and children.
 */
export function ServiceDayCard({ org, date, todays, events, service, time, setService, setTime, onCheckIn }: {
  org: Organization; date: string; todays: ChurchEvent[]; events: ChurchEvent[];
  service: string; time: string; setService: (v: string) => void; setTime: (v: string) => void; onCheckIn: (name: string) => void;
}) {
  const toast = useToast();
  const suggestions = useMemo(() => serviceSuggestions([...events.map((e) => e.name), ...(org.otherServices ?? [])]), [events, org.otherServices]);
  const [counts, setCounts] = useState<Headcounts>({});
  const [found, setFound] = useState(false);
  const [busy, setBusy] = useState(false);
  // Numbers typed before the saved ones arrive are kept, never wiped by the late answer.
  const typedRef = useRef(false);
  const name = serviceName(service, time);
  const running = todays.filter((e) => e.type === 'service' && !e.programId && !e.groupId);

  // The saved record, kept live: counts sent from the usher phone show here within seconds (Andy, 2026-11-03).
  const saved = running.find((e) => e.name === name) ?? null;
  const savedKey = saved ? JSON.stringify(saved.headcounts ?? {}) : '';
  useEffect(() => { typedRef.current = false; }, [date, name]);
  useEffect(() => {
    setFound(!!saved);
    // Numbers being typed here are kept until saved, never wiped by an update from elsewhere.
    if (!typedRef.current) setCounts(saved ? { ...(saved.headcounts ?? {}) } : {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [date, name, savedKey]);

  const choose = (n: string) => { const s = splitServiceName(n); setService(s.service); setTime(s.time); };
  // Open the day on its service, so its numbers show straight away (Andy, 2026-11-03); typing a new name still works.
  const firstName = running[0]?.name ?? '';
  const lastDate = useRef(date);
  useEffect(() => {
    const newDay = lastDate.current !== date;
    lastDate.current = date;
    if (firstName && (newDay || (!service.trim() && !time)) && !running.some((e) => e.name === name)) choose(firstName);
    // Only when the day or its first service changes, not while typing.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [date, firstName]);

  const total = (counts.adults ?? 0) + (counts.teens ?? 0) + (counts.children ?? 0);

  async function save(e: FormEvent) {
    e.preventDefault();
    if (!name) return toast.show('Type the name of the service.');
    setBusy(true);
    try {
      const clean: Headcounts = {};
      for (const k of KEYS) clean[k] = cleanCount(counts[k]);
      const { synced } = await recordService(org.id, { date, name, other: isOtherServiceName(org.otherServices, name), headcounts: clean });
      synced.catch((err) => toast.show(friendlyError(err)));
      setFound(true);
      typedRef.current = false;
      toast.show(`Saved: ${name}, ${formatDateKey(date)}`);
    } catch (err) {
      toast.show(friendlyError(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="card record-service" aria-label="Service">
      {running.length > 0 && (
        <div className="chips service-chips" role="group" aria-label="Services that day">
          {running.map((e) => (
            <button key={e.id} type="button" className={`chip${e.name === name ? ' chip-on' : ''}`} aria-pressed={e.name === name} onClick={() => choose(e.name)}>{e.name}</button>
          ))}
        </div>
      )}
      <form className="stack" onSubmit={save}>
        <ServiceInput service={service} time={time} onService={setService} onTime={setTime} suggestions={suggestions} />
        {found && <p className="hint">Already recorded. Saving updates it.</p>}
        <div className="record-counts">
          <div className="record-total" aria-live="polite"><b>{total}</b><span>Total count</span><small className="hint">Adults, teens and children</small></div>
          {KEYS.map((k) => (
            <label key={k} className="field record-count">
              <span>{HEADCOUNT_LABELS[k]}</span>
              <input type="number" inputMode="numeric" min={0} value={counts[k] ?? ''} placeholder="0" onFocus={(e) => e.target.select()}
                onChange={(e) => { typedRef.current = true; setCounts((c) => ({ ...c, [k]: cleanCount(e.target.value) })); }} />
              <small className="hint">{HINTS[k]}</small>
            </label>
          ))}
        </div>
        <div className="button-row">
          <button type="submit" className="btn btn-primary" disabled={busy || !name}>Save</button>
          <button type="button" className="btn" disabled={!name} onClick={() => onCheckIn(name)}>Check in by name</button>
        </div>
      </form>
    </section>
  );
}
