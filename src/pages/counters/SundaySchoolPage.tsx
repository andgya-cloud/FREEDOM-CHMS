import { useCallback, useEffect, useRef, useState } from 'react';
import { httpsCallable } from 'firebase/functions';
import { functions } from '../../firebase';
import { useChurch } from '../../lib/serviceHosts';
import { useAuth } from '../../state/AuthContext';
import { useToast } from '../../state/ToastContext';
import { friendlyError } from '../../lib/errors';
import { SundaySchoolRoom } from '../hope/HopePhotosPage';
import { ssTeacherLabel } from '../../../functions/src/shared/circles';
import { ssClassLabel, ssClassWithLeader, type ClassCounts, type SsClass } from '../../../functions/src/shared/sundaySchool';
import './counters.css';

type Info = { classes: SsClass[]; mine: SsClass | null; leads: boolean; today: string; service: string; counts: ClassCounts; total: number | null };
const call = (data: Record<string, unknown>) => httpsCallable<typeof data, Info>(functions, 'serviceCounters', { timeout: 60_000 })(data).then((r) => r.data);

/**
 * Freedom Church Sunday school (Andy, 2026-11-23, 1A-9A). A teacher counts their own class with a big + (the classes
 * add up into the service's Children), then writes in the Sunday school room: wins, the class report, requests and
 * conversations. Dorothy Mohart, Andy and Doreen see every class and every post, and keep the class list.
 */
export function SundaySchoolPage() {
  const church = useChurch();
  const { profile } = useAuth();
  const toast = useToast();
  const [info, setInfo] = useState<Info | null>(null);
  const [error, setError] = useState('');
  const load = useCallback(() => {
    if (!church) return;
    call({ orgId: church.id, action: 'ssInfo' }).then((i) => { setInfo(i); setError(''); }).catch((e) => setError(friendlyError(e)));
  }, [church]);
  useEffect(() => { load(); }, [load]);

  if (!church) return <div className="page narrow"><h1>🧒 Sunday school</h1><p>Sunday school belongs to Freedom Church.</p></div>;
  if (error) return <div className="page narrow"><h1>🧒 Sunday school</h1><p className="notice notice-warn">{error}</p></div>;
  if (!info) return <div className="page narrow"><h1>🧒 Sunday school</h1><p className="muted">Loading…</p></div>;

  return (
    <div className="page narrow stack">
      <div>
        <h1>🧒 Sunday school</h1>
        {info.mine && <p className="muted" style={{ margin: 0 }}>{ssTeacherLabel(info.mine.name)}</p>}
      </div>
      {info.mine && <ClassCounter orgId={church.id} info={info} onSaved={setInfo} />}
      {!info.mine && profile?.roleId === 'ssteacher' && <p className="notice notice-warn">Your class is not on the list. Please ask Dorothy to add it.</p>}
      {info.leads && <TodayClasses info={info} />}
      {info.leads && <ClassesEditor orgId={church.id} classes={info.classes} onSaved={(i) => { setInfo(i); toast.show('Classes saved.'); }} />}
      <SundaySchoolRoom org={church} ss={{ classes: info.classes, mine: info.mine, leads: info.leads, myCount: info.mine ? info.counts[info.mine.id]?.count ?? 0 : 0 }} />
    </div>
  );
}

/** The teacher's own class count (1A): a big number, a big +, and "Type the number". Each change saves straight away. */
function ClassCounter({ orgId, info, onSaved }: { orgId: string; info: Info; onSaved: (i: Info) => void }) {
  const toast = useToast();
  const mine = info.mine!;
  const saved = info.counts[mine.id]?.count ?? 0;
  const [adds, setAdds] = useState(0);
  const [typing, setTyping] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const pending = useRef(0);

  const send = useCallback(async (body: Record<string, unknown>) => {
    setBusy(true);
    try { onSaved(await call({ orgId, action: 'classCount', ...body })); } catch (e) { toast.show(friendlyError(e)); } finally { setBusy(false); }
  }, [orgId, onSaved, toast]);

  const plus = () => {
    pending.current += 1;
    setAdds(pending.current);
    if (navigator.vibrate) navigator.vibrate(15);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      const n = pending.current;
      pending.current = 0;
      void send({ add: n }).finally(() => setAdds(pending.current));
    }, 600);
  };

  if (!info.service) return <section className="card"><h2>{mine.name}</h2><p className="muted">There is no service today. On Sunday, or on the day of a special service in the calendar, you count your class here.</p></section>;
  return (
    <section className="card ctr-card" style={{ margin: '0 auto', width: '100%' }}>
      <p className="muted" style={{ margin: 0 }}>{info.service}</p>
      <p className="ctr-job">🧒 {ssClassLabel(mine)}</p>
      <div className="ctr-number" aria-live="polite">{saved + adds}</div>
      <button type="button" className="ctr-plus" aria-label={`Add one child to ${mine.name}`} onClick={plus}>+</button>
      {typing === null ? (
        <button type="button" className="btn" onClick={() => setTyping(String(saved + adds))}>Type the number</button>
      ) : (
        <div className="ctr-type">
          <input type="number" inputMode="numeric" min={0} autoFocus value={typing} aria-label="Children in my class" onFocus={(e) => e.target.select()} onChange={(e) => setTyping(e.target.value)} />
          <button type="button" className="btn btn-primary" disabled={busy} onClick={() => { void send({ set: Number(typing) || 0 }); setTyping(null); }}>Save</button>
          <button type="button" className="btn" onClick={() => setTyping(null)}>Cancel</button>
        </div>
      )}
      <p className="ctr-status muted">{busy || adds ? 'Saving…' : 'Saved ✓ It adds into the service numbers.'}</p>
    </section>
  );
}

/** Dorothy's view of today: each class's count and the Children total that goes into the service. */
function TodayClasses({ info }: { info: Info }) {
  if (!info.classes.length) return null;
  return (
    <section className="card">
      <h2>Today{info.service ? ` · ${info.service}` : ''}</h2>
      {!info.service ? <p className="muted">No service today.</p> : (
        <ul className="link-list">
          {info.classes.map((c) => (
            <li key={c.id}><span className="link-title">{ssClassWithLeader(c)}</span>
              <span className="link-detail">{info.counts[c.id] ? `${info.counts[c.id]!.count} children · ${info.counts[c.id]!.teacher}` : 'Not counted yet'}</span></li>
          ))}
          <li><b>All classes: {info.total ?? 0}</b> <span className="small muted">children's classes go into Children, the Teens class into Teens</span></li>
        </ul>
      )}
    </section>
  );
}

/** The class list (2A): Dorothy, Andy or Doreen type each class and its ages. */
function ClassesEditor({ orgId, classes, onSaved }: { orgId: string; classes: SsClass[]; onSaved: (i: Info) => void }) {
  const toast = useToast();
  const [rows, setRows] = useState<SsClass[]>(classes);
  const [busy, setBusy] = useState(false);
  useEffect(() => { setRows(classes); }, [classes]);
  const set = (i: number, k: 'name' | 'ages' | 'leader', v: string) => setRows((r) => r.map((x, j) => (j === i ? { ...x, [k]: v } : x)));
  const changed = JSON.stringify(rows) !== JSON.stringify(classes);
  async function save() {
    setBusy(true);
    try { onSaved(await call({ orgId, action: 'ssClasses', classes: rows })); } catch (e) { toast.show(friendlyError(e)); } finally { setBusy(false); }
  }
  return (
    <details className="card fold" open={classes.length === 0}>
      <summary>Classes and ages{classes.length ? ` (${classes.length})` : ''}</summary>
      <p className="small muted">Each class leader is given one class on their account. The children's classes add up into Children on the Sunday page, and the Teens class into Teens.</p>
      <ul className="ctr-jobs">
        {rows.map((c, i) => (
          <li key={c.id || i} className="ctr-jobrow">
            <div className="ctr-jobfields">
              <input value={c.name} maxLength={40} placeholder="Class name, e.g. Juniors" aria-label="Class name" onChange={(e) => set(i, 'name', e.target.value)} />
              <input value={c.ages} maxLength={30} placeholder="Ages, e.g. 6-8" aria-label="Ages" onChange={(e) => set(i, 'ages', e.target.value)} />
              <input value={c.leader} maxLength={60} placeholder="Class leader" aria-label="Class leader" onChange={(e) => set(i, 'leader', e.target.value)} />
              <button type="button" className="btn btn-quiet" aria-label={`Remove ${c.name || 'this class'}`} onClick={() => setRows((r) => r.filter((_, j) => j !== i))}>✕</button>
            </div>
          </li>
        ))}
      </ul>
      <div className="btn-line">
        <button type="button" className="btn" onClick={() => setRows((r) => [...r, { id: '', name: '', ages: '', leader: '' }])}>+ Add a class</button>
        {changed && <button type="button" className="btn btn-primary" disabled={busy} onClick={() => void save()}>Save classes</button>}
      </div>
    </details>
  );
}
