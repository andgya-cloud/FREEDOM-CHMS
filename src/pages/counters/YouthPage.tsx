import { useCallback, useEffect, useRef, useState } from 'react';
import { httpsCallable } from 'firebase/functions';
import { functions } from '../../firebase';
import { useChurch } from '../../lib/serviceHosts';
import { useAuth } from '../../state/AuthContext';
import { useToast } from '../../state/ToastContext';
import { friendlyError } from '../../lib/errors';
import { YouthRoom } from '../hope/HopePhotosPage';
import { ssDayLabel } from '../../../functions/src/shared/ssTimetable';
import { YOUTH_GROUP, type YouthCount } from '../../../functions/src/shared/youth';
import { SceneVideo } from '../../components/SceneVideo';
import { firstNameOf, timeGreeting } from '../../components/Greeting';
import { PlusMinus, ResetButton } from './CounterPage';
import { NextMeeting, SsRemindersCard, Timetable, useSsDays, YouthTimetable, type TtProps } from './SsTimetable';
import './counters.css';

type Info = { today: string; edits: boolean; driveFolder: string; meeting: { date: string; name: string } | null; count: number; recent: YouthCount[] };
const call = (data: Record<string, unknown>) => httpsCallable<typeof data, Info>(functions, 'youth', { timeout: 60_000 })(data).then((r) => r.data);

/**
 * Freedom Church Youth (Andy, 2026-11-24, 1A-9A): the Sunday school system for the youth. Sheila counts each meeting
 * (+, −, Type the number, Reset; a Sunday's youth add into the Sunday total), keeps the youth timetable with Andy and
 * Doreen, sends the WhatsApp reminder by hand, and writes in the Youth room.
 */
export function YouthPage() {
  const church = useChurch();
  const { profile } = useAuth();
  const [info, setInfo] = useState<Info | null>(null);
  const [error, setError] = useState('');
  const load = useCallback(() => {
    if (!church) return;
    call({ orgId: church.id, action: 'info' }).then((i) => { setInfo(i); setError(''); }).catch((e) => setError(friendlyError(e)));
  }, [church]);
  useEffect(() => { load(); }, [load]);

  if (!church) return <div className="page narrow"><h1>🔥 Youth</h1><p>The youth belong to Freedom Church.</p></div>;
  if (error) return <div className="page narrow"><h1>🔥 Youth</h1><p className="notice notice-warn">{error}</p></div>;
  if (!info) return <div className="page narrow"><h1>🔥 Youth</h1><p className="muted">Loading…</p></div>;

  const props = { org: church, classes: [YOUTH_GROUP], mine: YOUTH_GROUP, edits: info.edits, today: info.today, driveFolder: info.driveFolder };
  return (
    <YouthTimetable>
      <div className="page lav-today ss-page">
        <YouthWelcome tz={church.timeZone || 'Africa/Nairobi'} info={info} name={profile?.displayName} />
        {info.edits && info.meeting && <YouthCounter orgId={church.id} info={info} onSaved={setInfo} />}
        <YouthDays props={props} info={info} />
        <YouthRoom org={church} ss={{ classes: [YOUTH_GROUP], mine: info.edits ? YOUTH_GROUP : null, leads: info.edits, myCount: info.count }} />
      </div>
    </YouthTimetable>
  );
}

/** The same welcome as Sunday school (9A): the greeting, "Freedom Church Youth", one line for today, the animated logo. */
function YouthWelcome({ tz, info, name }: { tz: string; info: Info; name?: string | null }) {
  const first = firstNameOf(name);
  const today = !info.meeting ? 'No youth meeting today. On a meeting day, or on Sunday, you count here.'
    : info.edits ? `${info.meeting.name}: tap + to count the youth.`
    : `${info.meeting.name}: ${info.count} counted so far.`;
  return (
    <section className="card lav-hero lav-hero-slim">
      <div className="lav-hero-text">
        <span className="lav-eyebrow"><i aria-hidden="true" />{new Intl.DateTimeFormat('en-GB', { weekday: 'long', day: 'numeric', month: 'long', timeZone: tz }).format(new Date())}</span>
        <h1 className="lav-greet">{timeGreeting(tz)}{first ? `, ${first}` : ''}</h1>
        <p className="lav-org"><em>Freedom Church Youth</em></p>
        <p><b>🔥 Youth</b><br />{today}</p>
      </div>
      <div className="lav-scene lav-scene-slim"><SceneVideo name="church-scene" /></div>
    </section>
  );
}

/** Today's count (5A): a big number, + and −, Type the number and Reset. Each change saves straight away. */
function YouthCounter({ orgId, info, onSaved }: { orgId: string; info: Info; onSaved: (i: Info) => void }) {
  const toast = useToast();
  const [adds, setAdds] = useState(0);
  const [typing, setTyping] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const pending = useRef(0);
  const send = useCallback(async (body: Record<string, unknown>) => {
    setBusy(true);
    try { onSaved(await call({ orgId, action: 'count', ...body })); } catch (e) { toast.show(friendlyError(e)); } finally { setBusy(false); }
  }, [orgId, onSaved, toast]);
  const shown = Math.max(0, info.count + adds);
  const step = (d: number) => {
    if (d < 0 && shown <= 0) return;
    pending.current += d;
    setAdds(pending.current);
    if (navigator.vibrate) navigator.vibrate(15);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      const n = pending.current;
      pending.current = 0;
      if (n) void send({ add: n }).finally(() => setAdds(pending.current));
    }, 600);
  };
  const sunday = new Date(`${info.today}T12:00:00Z`).getUTCDay() === 0;
  return (
    <section className="card ctr-card" style={{ margin: '0 auto', width: '100%', maxWidth: 560 }}>
      <p className="muted" style={{ margin: 0 }}>{info.meeting!.name}</p>
      <p className="ctr-job">🔥 Youth</p>
      <div className="ctr-number" aria-live="polite">{shown}</div>
      <PlusMinus label="the youth" onPlus={() => step(1)} onMinus={() => step(-1)} canMinus={shown > 0} />
      {typing === null ? (
        <button type="button" className="btn" onClick={() => setTyping(String(shown))}>Type the number</button>
      ) : (
        <div className="ctr-type">
          <input type="number" inputMode="numeric" min={0} autoFocus value={typing} aria-label="Young people here" onFocus={(e) => e.target.select()} onChange={(e) => setTyping(e.target.value)} />
          <button type="button" className="btn btn-primary" disabled={busy} onClick={() => { void send({ set: Number(typing) || 0 }); setTyping(null); }}>Save</button>
          <button type="button" className="btn" onClick={() => setTyping(null)}>Cancel</button>
        </div>
      )}
      {shown > 0 && <ResetButton onReset={() => { clearTimeout(timer.current); pending.current = 0; setAdds(0); void send({ set: 0 }); }} />}
      <p className="ctr-status muted">{busy || adds ? 'Saving…' : sunday ? 'Saved ✓ It adds into the Sunday total as Youth.' : 'Saved ✓'}</p>
    </section>
  );
}

/** The next meeting, the reminder to send, the last few counts and the year's youth timetable. */
function YouthDays({ props, info }: { props: TtProps; info: Info }) {
  const days = useSsDays(props.org.id);
  const past = info.recent.filter((c) => c.date < info.today || !info.meeting);
  return (
    <>
      {days && <NextMeeting {...props} days={days} />}
      {info.edits && <SsRemindersCard orgId={props.org.id} today={info.today} />}
      {past.length > 0 && (
        <details className="card fold">
          <summary>📊 Last meetings</summary>
          <ul className="link-list">
            {past.map((c) => <li key={c.date}><span className="link-title">{ssDayLabel(c.date, false)} · {c.name}</span><span className="link-detail">{c.count} young people</span></li>)}
          </ul>
        </details>
      )}
      {days ? <Timetable {...props} days={days} /> : <p className="muted">Loading the timetable…</p>}
    </>
  );
}
