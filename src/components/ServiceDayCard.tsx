import { useEffect, useMemo, useRef, useState } from 'react';
import type { Organization } from '../state/OrgContext';
import type { ChurchEvent } from '../state/useAttendance';
import { useToast } from '../state/ToastContext';
import { saveServiceCount } from '../lib/attendanceWrites';
import { friendlyError } from '../lib/errors';
import { cleanCount, HEADCOUNT_LABELS, isOtherServiceName, serviceName, splitServiceName, type Headcounts } from '../../functions/src/shared/attendance';
import { serviceSuggestions } from './ServiceInput';

const KEYS = ['adults', 'teens', 'children', 'firstTimers', 'salvations'] as const;
type Key = (typeof KEYS)[number];
const HINTS: Record<Key, string> = { adults: '20 and over', teens: '13 to 19', children: 'Under 13', firstTimers: 'Already counted above', salvations: 'Already counted above' };

/**
 * The counting card on the Service page (Andy, 2026-11-03, 1A-6A): type the service, then tap – and + (or type a
 * number) in six dark-green boxes. Every change saves by itself, and taps from phones and the web add up. The numbers
 * follow the saved record live, so counts from the usher phones show here within seconds.
 */
export function ServiceDayCard({ org, date, time, setTime, todays, events, onCheckIn, onName }: {
  org: Organization; date: string; time: string; setTime: (t: string) => void; todays: ChurchEvent[]; events: ChurchEvent[]; onCheckIn: (name: string) => void; onName?: (name: string) => void;
}) {
  const toast = useToast();
  const running = todays.filter((e) => e.type === 'service' && !e.programId && !e.groupId);
  const suggestions = useMemo(
    () => [...new Set([...running.map((e) => e.name), ...serviceSuggestions([...events.map((e) => e.name), ...(org.otherServices ?? [])])])],
    [running, events, org.otherServices],
  );
  const [service, setServiceText] = useState('');
  // Picking a saved service ("Main service 09:30") fills the name and moves its time to the Time box.
  const setService = (text: string) => {
    const s = splitServiceName(text);
    if (running.some((r) => r.name === text.trim()) || s.time) { setServiceText(s.service); if (s.time) setTime(s.time); }
    else setServiceText(text);
  };
  const name = serviceName(service, time);
  useEffect(() => { onName?.(name); }, [name, onName]);
  const saved = running.find((e) => e.name === name) ?? null;
  const counts: Headcounts = saved?.headcounts ?? {};
  const total = (counts.adults ?? 0) + (counts.teens ?? 0) + (counts.children ?? 0);

  // Open the day on its first service, so its numbers show straight away.
  const firstName = running[0]?.name ?? '';
  const lastDate = useRef(date);
  useEffect(() => {
    const newDay = lastDate.current !== date;
    lastDate.current = date;
    if (firstName && (newDay || !service.trim()) && !running.some((e) => e.name === name)) setService(firstName);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [date, firstName]);

  // "Saving…" until the server has it, then "Saved ✓".
  const [status, setStatus] = useState<'idle' | 'saving' | 'saved'>('idle');
  const pending = useRef(0);
  const track = (p: Promise<unknown>) => {
    pending.current += 1;
    setStatus('saving');
    p.then(() => { pending.current -= 1; if (pending.current === 0) setStatus('saved'); })
      .catch((err) => { pending.current -= 1; setStatus('idle'); toast.show(friendlyError(err)); });
  };
  const where = () => ({ date, name, other: isOtherServiceName(org.otherServices, name), exists: !!saved });

  const tap = (k: Key, add: number) => {
    if (!name) return toast.show('Type the service first.');
    if (add < 0 && (counts[k] ?? 0) <= 0) return;
    track(saveServiceCount(org.id, where(), k, { add }));
  };

  // A typed number stays on screen while typing and is saved a moment after the last key.
  const [draft, setDraft] = useState<Partial<Record<Key, string>>>({});
  const timers = useRef<Partial<Record<Key, ReturnType<typeof setTimeout>>>>({});
  useEffect(() => { setDraft({}); setStatus('idle'); }, [date, name]);
  const type = (k: Key, text: string) => {
    if (!name) return toast.show('Type the service first.');
    setDraft((d) => ({ ...d, [k]: text }));
    clearTimeout(timers.current[k]);
    timers.current[k] = setTimeout(() => {
      track(saveServiceCount(org.id, where(), k, { set: cleanCount(text) }));
      setDraft((d) => { const n = { ...d }; delete n[k]; return n; });
    }, 800);
  };

  return (
    <section className="card count-card" aria-label="Count the service">
      <label className="field"><span>Service</span>
        <input value={service} maxLength={100} list="service-names" placeholder="Type the service, for example Main service" autoComplete="off"
          onChange={(e) => setService(e.target.value)} />
        <datalist id="service-names">{suggestions.map((s) => <option key={s} value={s} />)}</datalist>
      </label>
      <p className="count-status small" aria-live="polite">
        {!name ? 'Type the service, then tap to count.'
          : status === 'saving' ? 'Saving…'
          : status === 'saved' ? `Saved ✓ ${name}`
          : saved ? `Counting into ${name}` : `${name}: the first tap starts this service.`}
      </p>
      <div className="count-grid">
        {KEYS.map((k) => (
          <div key={k} className="count-box">
            <span className="count-label">{HEADCOUNT_LABELS[k]}</span>
            <input className="count-number" type="number" inputMode="numeric" min={0} aria-label={HEADCOUNT_LABELS[k]} disabled={!name}
              value={draft[k] ?? String(counts[k] ?? 0)} onFocus={(e) => e.target.select()} onChange={(e) => type(k, e.target.value)} />
            <div className="count-taps">
              <button type="button" className="count-tap" aria-label={`One less: ${HEADCOUNT_LABELS[k]}`} disabled={!name || (counts[k] ?? 0) <= 0} onClick={() => tap(k, -1)}>–</button>
              <button type="button" className="count-tap count-plus" aria-label={`One more: ${HEADCOUNT_LABELS[k]}`} disabled={!name} onClick={() => tap(k, 1)}>+</button>
            </div>
            <small className="count-hint">{HINTS[k]}</small>
          </div>
        ))}
        <div className="count-box count-total" aria-live="polite">
          <span className="count-label">Total count</span>
          <b className="count-number">{total}</b>
          <small className="count-hint">Adults, teens and children</small>
        </div>
      </div>
      <div className="button-row">
        <button type="button" className="btn" disabled={!name} onClick={() => onCheckIn(name)}>Check in by name</button>
      </div>
    </section>
  );
}
