import { useCallback, useEffect, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import { httpsCallable } from 'firebase/functions';
import { functions } from '../../firebase';
import { cleanCount } from '../../../functions/src/shared/attendance';
import { COUNTER_INFO, type CounterJob } from '../../../functions/src/shared/counters';
import './counters.css';

type Service = { name: string; count: number; done: boolean };
type Info = { church: string; job: CounterJob; person: string; today: string; services: Service[] };
type Pending = { add: number; set: number | null };

const call = <R,>(data: Record<string, unknown>) => httpsCallable<typeof data, R>(functions, 'serviceCounters', { timeout: 30_000 })(data).then((r) => r.data);
const keyOf = (token: string, day: string, service: string) => `ctr:${token}:${day}:${service}`;
function readPending(key: string): Pending {
  try { const v = JSON.parse(localStorage.getItem(key) ?? 'null') as Pending | null; return v && typeof v.add === 'number' ? v : { add: 0, set: null }; } catch { return { add: 0, set: null }; }
}
function writePending(key: string, p: Pending) {
  try { if (!p.add && p.set === null) localStorage.removeItem(key); else localStorage.setItem(key, JSON.stringify(p)); } catch { /* private window */ }
}

/**
 * A counter's own page from their link (Andy, 2026-11-23, 1A-10A): no password, only their number, big. Each tap of
 * + adds one, "Type the number" sets it. Taps are kept on the phone and sent a moment later, so a weak signal or no
 * internet loses nothing; they go as soon as the phone is back online. "I've finished" tells the office.
 */
export function CounterPage() {
  const { orgId = '', token = '' } = useParams();
  const [info, setInfo] = useState<Info | null>(null);
  const [error, setError] = useState('');
  const [service, setService] = useState('');
  const [pending, setPending] = useState<Pending>({ add: 0, set: null });
  const [waiting, setWaiting] = useState(false);
  const [typing, setTyping] = useState<string | null>(null);
  const [finished, setFinished] = useState(false);
  const sending = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const load = useCallback(() => call<Info>({ action: 'info', orgId, token })
    .then((i) => {
      setInfo(i);
      setService((s) => (i.services.some((x) => x.name === s) ? s : i.services[0]?.name ?? ''));
      setError('');
    })
    .catch((e: { code?: string; message?: string }) => {
      if (/not-found|failed-precondition/.test(e.code ?? '')) setError(e.message || 'This link is not working. Please ask the church office for a new one.');
      else if (!info) setError('No internet just now. Please try again in a moment.');
    }), [orgId, token, info]);

  useEffect(() => { void load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [orgId, token]);

  const key = info && service ? keyOf(token, info.today, service) : '';
  useEffect(() => { if (key) setPending(readPending(key)); setFinished(!!info?.services.find((s) => s.name === service)?.done); }, [key]); // eslint-disable-line react-hooks/exhaustive-deps

  const saved = info?.services.find((s) => s.name === service)?.count ?? 0;
  const shown = (pending.set ?? saved) + pending.add;

  // Send what is kept on the phone; on failure keep it and try again.
  const flush = useCallback(async () => {
    if (!key || sending.current) return;
    const p = readPending(key);
    if (!p.add && p.set === null) { setWaiting(false); return; }
    sending.current = true;
    try {
      const body = p.set !== null ? { set: p.set + p.add } : { add: Math.min(p.add, 500) };
      const r = await call<{ count: number }>({ action: 'count', orgId, token, service, ...body });
      const sent = p.set !== null ? p.add : Math.min(p.add, 500);
      const now = readPending(key);
      const left: Pending = { add: Math.max(0, now.add - sent), set: p.set !== null && now.set === p.set ? null : now.set };
      writePending(key, left);
      setPending(left);
      setInfo((i) => (i ? { ...i, services: i.services.map((s) => (s.name === service ? { ...s, count: r.count } : s)) } : i));
      setWaiting(false);
      sending.current = false;
      if (left.add || left.set !== null) void flush();
    } catch (e) {
      sending.current = false;
      const code = (e as { code?: string }).code ?? '';
      if (/not-found|failed-precondition/.test(code)) { setError((e as { message?: string }).message || 'This link is not working.'); return; }
      setWaiting(true);
      clearTimeout(timer.current);
      timer.current = setTimeout(() => void flush(), 5000);
    }
  }, [key, orgId, token, service]);

  useEffect(() => {
    const online = () => void flush();
    window.addEventListener('online', online);
    void flush();
    return () => window.removeEventListener('online', online);
  }, [flush]);

  const change = (next: Pending) => {
    writePending(key, next);
    setPending(next);
    setFinished(false);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => void flush(), 700);
  };
  const plus = () => {
    if (!key) return;
    if (navigator.vibrate) navigator.vibrate(15);
    change({ ...readPending(key), add: readPending(key).add + 1 });
  };
  const saveTyped = () => {
    if (typing === null || !key) return;
    change({ add: 0, set: cleanCount(typing) });
    setTyping(null);
  };
  const finish = async () => {
    await flush();
    try {
      await call({ action: 'finish', orgId, token, service });
      setFinished(true);
      setInfo((i) => (i ? { ...i, services: i.services.map((s) => (s.name === service ? { ...s, done: true } : s)) } : i));
    } catch { setWaiting(true); }
  };

  if (error) return <div className="center-card welcome-card"><h1>Counting</h1><p>{error}</p></div>;
  if (!info) return <div className="splash" aria-busy="true"><span className="splash-mark" />Loading…</div>;
  const job = COUNTER_INFO[info.job];

  return (
    <div className="center-card welcome-card ctr-card">
      <img src="/org/freedom-church-logo.png" alt="" width={56} height={56} style={{ alignSelf: 'center' }} />
      <p className="ctr-hello muted">Hello {info.person} · {info.church}</p>
      {info.services.length === 0 ? (
        <>
          <h1>{job.emoji} {job.label}</h1>
          <p>There is no service today. On Sunday, or on the day of a special service in the calendar, your counter opens here.</p>
          <button type="button" className="btn" onClick={() => void load()}>Check again</button>
        </>
      ) : (
        <>
          {info.services.length > 1 ? (
            <label className="field"><span>Which service?</span>
              <select value={service} onChange={(e) => setService(e.target.value)}>
                {info.services.map((s) => <option key={s.name} value={s.name}>{s.name}</option>)}
              </select>
            </label>
          ) : <p className="muted" style={{ margin: 0 }}>{service}</p>}
          <p className="ctr-job">{job.emoji} {job.label}</p>
          <p className="ctr-hint muted">{job.hint}</p>
          <div className="ctr-number" aria-live="polite">{shown}</div>
          <button type="button" className="ctr-plus" aria-label={`Add one to ${job.label}`} onClick={plus}>+</button>
          {typing === null ? (
            <button type="button" className="btn" onClick={() => setTyping(String(shown))}>Type the number</button>
          ) : (
            <div className="ctr-type">
              <input type="number" inputMode="numeric" min={0} autoFocus value={typing} aria-label={`${job.label} number`}
                onFocus={(e) => e.target.select()} onChange={(e) => setTyping(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') saveTyped(); }} />
              <button type="button" className="btn btn-primary" onClick={saveTyped}>Save</button>
              <button type="button" className="btn" onClick={() => setTyping(null)}>Cancel</button>
            </div>
          )}
          <p className={`ctr-status${waiting ? ' ctr-wait' : ''}`} aria-live="polite">
            {waiting ? 'No internet just now. Your count is kept on this phone and goes as soon as it is back.'
              : pending.add || pending.set !== null ? 'Saving…' : 'Saved ✓'}
          </p>
          {finished
            ? <div className="ctr-done">Thank you! The office has your number ✓<br /><small>You can still fix it today.</small></div>
            : <button type="button" className="btn btn-primary" onClick={() => void finish()}>I've finished counting</button>}
        </>
      )}
    </div>
  );
}
