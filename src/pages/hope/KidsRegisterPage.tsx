import { useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useAuth } from '../../state/AuthContext';
import { useToast } from '../../state/ToastContext';
import { useChildPhotos, useHopeDays } from '../../state/useHope';
import { ConfirmDialog } from '../../components/ConfirmDialog';
import { friendlyError } from '../../lib/errors';
import { markKid, markMany } from '../../lib/hopeWrites';
import { DoorScan } from './DoorScan';
import { useClubs } from '../../state/useHope';
import { clubDayOnOrBefore, scheduleText } from '../../../functions/src/shared/hopeClubs';
import { ChampionsPanel } from './ChampionsPage';
import { formatDateKey } from '../../../functions/src/shared/datetime';
import { isCurrentChild, normalizeCode } from '../../../functions/src/shared/hope';
import { birthdayThisWeek, dayTrend, streak, rateFrom, saturdayOnOrBefore, type KidEntry } from '../../../functions/src/shared/hopeRegister';
import { canKeepAccounts, HELPER_ROLE_ID } from '../../../functions/src/shared/permissions';
import { CleanupButton } from '../../components/CleanupDialog';
import { HopeGate, useHopePage } from './common';
import { Avatar, Delights, nowTime, RegisterCalendar, tick, TrendCard } from './registerParts';
import type { Organization } from '../../state/OrgContext';

export function KidsRegisterPage() {
  return <HopeGate title="Registers">{(org) => <Registers org={org} />}</HopeGate>;
}

type Which = 'children' | 'champions' | 'club';

/**
 * One Registers page (Andy, 2026-11-04, 9A): a switch for the children, the Child Champions or a club, each with
 * the same calendar and the same marking buttons.
 */
function Registers({ org }: { org: Organization }) {
  const [params, setParams] = useSearchParams();
  const w = (['children', 'champions', 'club'].includes(params.get('w') ?? '') ? params.get('w') : 'children') as Which;
  const { profile } = useAuth();
  const helper = profile?.roleId === HELPER_ROLE_ID;
  const opts: [Which, string][] = helper ? [['children', '🧒 Children'], ['club', '⭐ Clubs']] : [['children', '🧒 Children'], ['champions', '🙌 Champions'], ['club', '⭐ Clubs']];
  return (
    <div className="page narrow">
      <h1>Registers</h1>
      <div className="segmented hr-switch" role="radiogroup" aria-label="Which register">
        {opts.map(([k, label]) => (
          <button key={k} type="button" role="radio" aria-checked={w === k} className={w === k ? 'on' : ''} onClick={() => setParams(k === 'children' ? {} : { w: k }, { replace: true })}>{label}</button>
        ))}
      </div>
      {w === 'children' && <KidsRegister org={org} />}
      {w === 'champions' && <ChampionsPanel org={org} />}
      {w === 'club' && <ClubSessions org={org} />}
    </div>
  );
}

/** Each club's own register (Part 2): pick the club; it opens on its last meeting day. */
function ClubSessions({ org }: { org: Organization }) {
  const h = useHopePage(org);
  const c = useClubs(org.id);
  const clubs = c.clubs.filter((x) => x.status === 'active');
  const weekday = new Intl.DateTimeFormat('en-GB', { weekday: 'long', timeZone: 'UTC' }).format(new Date(`${h.today}T12:00:00Z`));
  if (!c.loading && clubs.length === 0) return <div className="card"><p>No clubs yet. <Link to="/hope/clubs">Set up the clubs</Link> first.</p></div>;
  return (
    <ul className="link-list">
      {clubs.map((x) => {
        const last = clubDayOnOrBefore(x.day, h.today);
        const r = rateFrom(Object.values(c.days.find((d) => d.clubId === x.id && d.date === last)?.marks ?? {}));
        return (
          <li key={x.id}>
            <Link to={`/hope/clubs/${x.id}`} className="hr-who">
              <span className="cl-emoji" aria-hidden="true">{x.emoji || '⭐'}</span>
              <span className="grow"><span className="link-title">{x.name}{x.day === weekday && <span className="badge badge-ok">Meets today</span>}</span>
                <span className="link-detail">{scheduleText(x) || 'Day not set'} · {x.memberIds.length} members · {r.marked ? `${r.present} came on ${formatDateKey(last)}` : `not marked for ${formatDateKey(last)}`}</span></span>
            </Link>
          </li>
        );
      })}
    </ul>
  );
}

type View = 'photos' | 'ticks';
const VIEW_KEY = 'hope.register.view';
const here = (e?: KidEntry) => e?.s === 'present' || e?.s === 'departing';

/**
 * The children's weekly register as a check-in (Andy, 2026-11-04, 1A): tap a child's photo, or tick their box, as
 * they arrive. The time is kept. "Finish" marks everyone not ticked as absent. Excused, with a reason, is on the
 * tick list. Departing and Departed are no longer here; they are on the child's page (3A).
 */
function KidsRegister({ org }: { org: Organization }) {
  const h = useHopePage(org);
  const { can, profile } = useAuth();
  const toast = useToast();
  const { days } = useHopeDays(org.id);
  const photos = useChildPhotos(org.id);
  const [params] = useSearchParams();
  // "Check in" opens today, any day of the week (Andy, 2026-11-05, 1A); a day from Reports → Attendance opens that day.
  const asked = params.get('d');
  const [date, setDate] = useState(() => (asked === 'today' ? h.today : asked && /^\d{4}-\d{2}-\d{2}$/.test(asked) && asked <= h.today ? asked : saturdayOnOrBefore(h.today)));
  const keeper = canKeepAccounts(profile);
  const [pick, setPick] = useState(false);
  const [q, setQ] = useState('');
  const [view, setView] = useState<View>(() => { try { return localStorage.getItem(VIEW_KEY) === 'ticks' ? 'ticks' : 'photos'; } catch { return 'photos'; } });
  const [finishing, setFinishing] = useState(false);
  const [scan, setScan] = useState(false);
  const canMark = can('attendance.write');
  const helper = profile?.roleId === HELPER_ROLE_ID;
  const fail = (err: unknown) => toast.show(friendlyError(err));

  const day = days.find((d) => d.date === date);
  const marks = day?.marks ?? {};
  const markedDays = useMemo(() => new Set(days.filter((d) => Object.keys(d.marks ?? {}).length).map((d) => d.date)), [days]);
  const trend = useMemo(() => dayTrend(days), [days]);

  const everyone = useMemo(() => h.children
    .filter((c) => marks[c.id] || (isCurrentChild(c) && (!c.enrolledOn || c.enrolledOn <= date)))
    .map((c) => ({ c, name: h.nameOf(c.id) }))
    .sort((a, b) => a.name.localeCompare(b.name)), [h.children, h.nameOf, marks, date]);
  const list = useMemo(() => {
    const text = q.trim().toLowerCase();
    const code = normalizeCode(q);
    return everyone.filter(({ c, name }) => !text || name.toLowerCase().includes(text) || (c.code ?? '').toLowerCase().includes(text) || (!!code && c.code === code));
  }, [everyone, q]);

  const r = rateFrom(Object.values(marks));
  const notYet = everyone.filter(({ c }) => !marks[c.id]);

  function choose(v: View) { setView(v); try { localStorage.setItem(VIEW_KEY, v); } catch { /* private window */ } }
  function toggle(childId: string) {
    if (!canMark) return;
    if (here(marks[childId])) { markKid(org.id, date, childId, null).catch(fail); return; }
    tick();
    markKid(org.id, date, childId, { s: 'present', t: date === h.today ? nowTime() : null, r: null }).catch(fail);
  }
  /** A card read at the door (12A): checks the child in, and says who. */
  function scanned(code: string): string {
    const c = h.children.find((x) => x.code === code);
    if (!c) return `No child has the code ${code}.`;
    const name = h.nameOf(c.id);
    if (here(marks[c.id])) return `✓ ${name} is already checked in${marks[c.id]?.t ? ` (${marks[c.id]!.t})` : ''}.`;
    tick();
    const t = date === h.today ? nowTime() : null;
    markKid(org.id, date, c.id, { s: 'present', t, r: null }).catch(fail);
    return `✓ ${name} checked in${t ? ` at ${t}` : ''}`;
  }
  function excuse(childId: string) {
    if (!canMark) return;
    markKid(org.id, date, childId, marks[childId]?.s === 'excused' ? null : { s: 'excused', t: null, r: null }).catch(fail);
  }
  function reason(childId: string, text: string) {
    markKid(org.id, date, childId, { s: 'excused', t: null, r: text.trim().slice(0, 200) || null }).catch(fail);
  }
  function finish() {
    setFinishing(false);
    const entries = Object.fromEntries(notYet.map(({ c }) => [c.id, { s: 'absent', t: null, r: null }]));
    markMany(org.id, 'hopeDays', date, entries).catch(fail);
    setQ('');
    toast.show(`Register finished: ${r.present} here, ${notYet.length + r.absent} absent.`);
  }

  return (
    <>
      <section className="card ck-head">
        <div className="ck-day">
          <span className="ck-day-ico" aria-hidden="true">📅</span>
          <span className="grow"><b>{date === h.today ? 'Today' : formatDateKey(date)}</b>
            <span className="small muted">{date === h.today ? formatDateKey(date) : 'Tap "Change day" for another day'}</span></span>
          <button type="button" className="btn btn-quiet" aria-expanded={pick} onClick={() => setPick(!pick)}>{pick ? 'Close' : 'Change day'}</button>
        </div>
        {keeper && day && <div className="ck-reset"><CleanupButton orgId={org.id} kind="hopeDay" id={date} label="Reset this day" /><span className="small muted">For testing: moves this day's marks to the Bin.</span></div>}
        {pick && <RegisterCalendar value={date} onChange={(d) => { setDate(d); setPick(false); }} marked={markedDays} today={h.today} />}
        <div className="ck-counts" aria-live="polite">
          <span className="ok"><b>{r.present}</b> here</span>
          <span><b>{notYet.length}</b> not yet</span>
          {r.absent > 0 && <span className="bad"><b>{r.absent}</b> absent</span>}
          {r.excused > 0 && <span><b>{r.excused}</b> excused</span>}
        </div>
      </section>

      {scan && canMark && <DoorScan onCode={scanned} onClose={() => setScan(false)} />}
      <div className="ck-tools">
        {canMark && !scan && <button type="button" className="btn" onClick={() => setScan(true)}>📷 Scan</button>}
        <input type="search" className="search" placeholder="Find a name or code" aria-label="Find a child" value={q} onChange={(e) => setQ(e.target.value)} />
        <div className="segmented" role="radiogroup" aria-label="How to mark">
          <button type="button" role="radio" aria-checked={view === 'photos'} className={view === 'photos' ? 'on' : ''} onClick={() => choose('photos')}>🖼️ Photos</button>
          <button type="button" role="radio" aria-checked={view === 'ticks'} className={view === 'ticks' ? 'on' : ''} onClick={() => choose('ticks')}>☑️ Tick list</button>
        </div>
      </div>
      <p className="small muted ck-hint">{view === 'photos' ? 'Tap a child\'s photo when they arrive. Tap again to undo.' : 'Tick each child who is here. Tap "Excused" if they are away for a good reason.'}</p>

      {h.loading ? <p className="muted">Loading…</p> : everyone.length === 0 ? (
        <div className="card"><p>No children on the register yet.{can('people.write') && <> <Link to="/hope/children/import">Upload them from Excel</Link>.</>}</p></div>
      ) : list.length === 0 ? <div className="card"><p className="muted">No child matches "{q}".</p></div> : view === 'photos' ? (
        <ul className="ck-grid">
          {list.map(({ c, name }) => {
            const e = marks[c.id];
            const on = here(e);
            const [first, ...rest] = name.split(' ');
            return (
              <li key={c.id}>
                <button type="button" className={`ck-tile${on ? ' on' : ''}${e?.s === 'absent' ? ' ab' : ''}${e?.s === 'excused' ? ' ex' : ''}`} aria-pressed={on} disabled={!canMark}
                  aria-label={`${name}${on ? ', here' : e?.s === 'absent' ? ', absent' : e?.s === 'excused' ? ', excused' : ''}`} onClick={() => toggle(c.id)}>
                  <span className="ck-photo">
                    <Avatar photo={c.photoConsent?.given ? photos.get(c.id) : null} name={name} size={84} />
                    {on && <span className="ck-mark" aria-hidden="true">✓</span>}
                    <span className="ck-delight"><Delights birthday={birthdayThisWeek(c.dateOfBirth, h.today)} streak={streak(c.id, days)} /></span>
                  </span>
                  <b className="ck-first">{first}</b>
                  <span className="ck-rest">{rest.join(' ')}</span>
                  <span className="ck-state">{on ? (e?.t ? `✓ ${e.t}` : '✓ Here') : e?.s === 'absent' ? 'Absent' : e?.s === 'excused' ? 'Excused' : h.codeOf(c)}</span>
                </button>
              </li>
            );
          })}
        </ul>
      ) : (
        <ul className="ck-list">
          {list.map(({ c, name }) => {
            const e = marks[c.id];
            const on = here(e);
            return (
              <li key={c.id} className={`card ck-row${on ? ' on' : ''}${e?.s === 'absent' ? ' ab' : ''}`}>
                <label className="ck-tick">
                  <input type="checkbox" checked={on} disabled={!canMark} onChange={() => toggle(c.id)} />
                  <Avatar photo={c.photoConsent?.given ? photos.get(c.id) : null} name={name} size={44} />
                  <span className="grow"><b>{name}</b><span className="small muted">{h.codeOf(c)}{on && e?.t ? ` · came ${e.t}` : e?.s === 'absent' ? ' · absent' : ''}</span></span>
                </label>
                <button type="button" className={`chip${e?.s === 'excused' ? ' chip-on' : ''}`} aria-pressed={e?.s === 'excused'} disabled={!canMark} onClick={() => excuse(c.id)}>Excused</button>
                {keeper && e && <button type="button" className="chip" title="Clear this child's mark (testing)" onClick={() => { markKid(org.id, date, c.id, null).catch(fail); }}>↺ Reset</button>}
                {e?.s === 'excused' && (
                  <input className="ck-reason" aria-label={`Why ${name} is away`} disabled={!canMark} maxLength={200} defaultValue={e.r ?? ''} key={`${date}${e.r}`} placeholder="Why? Sick, school trip…"
                    onBlur={(ev) => ev.target.value.trim() !== (e.r ?? '') && reason(c.id, ev.target.value)} />
                )}
              </li>
            );
          })}
        </ul>
      )}

      {canMark && everyone.length > 0 && notYet.length > 0 && r.present > 0 && (
        <div className="ck-finish">
          <span><b>{r.present}</b> here · <b>{notYet.length}</b> not yet</span>
          <button type="button" className="btn btn-primary" onClick={() => setFinishing(true)}>Finish</button>
        </div>
      )}

      {!helper && <TrendCard title="Attendance as time goes" trend={trend} />}

      <ConfirmDialog open={finishing} title="Finish the register?"
        body={`The ${notYet.length} ${notYet.length === 1 ? 'child' : 'children'} not ticked will be marked absent. You can still change anyone afterwards.`}
        confirmLabel="Yes, finish" onConfirm={finish} onCancel={() => setFinishing(false)} />
    </>
  );
}
