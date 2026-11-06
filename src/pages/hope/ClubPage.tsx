import { useMemo, useState, type FormEvent, type ReactNode } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { useAuth } from '../../state/AuthContext';
import { useToast } from '../../state/ToastContext';
import { useChampions, useChildPhotos, useClubs } from '../../state/useHope';
import { friendlyError } from '../../lib/errors';
import { addClubWin, markClub, removeClubWin, updateClub, type ClubInput } from '../../lib/hopeWrites';
import { formatDateKey } from '../../../functions/src/shared/datetime';
import { isCurrentChild, normalizeCode } from '../../../functions/src/shared/hope';
import { dayTrend, type KidEntry } from '../../../functions/src/shared/hopeRegister';
import {
  clubDayId, clubDayOnOrBefore, clubSummary, levelLabel, memberRate, scheduleText, WEEKDAYS, WIN_EMOJI, WIN_KIND_LABELS, WIN_KINDS,
  type Club, type ClubDay, type WinKind,
} from '../../../functions/src/shared/hopeClubs';
import { HopeGate, useHopePage } from './common';
import { Avatar, nowTime, PctBadge, tick, TrendCard } from './registerParts';
import { DoorScan } from './DoorScan';
import { RemoveDialog } from '../../components/CleanupDialog';
import { HELPER_ROLE_ID } from '../../../functions/src/shared/permissions';
import { classOf, hasAllergy } from '../../../functions/src/shared/hopeClasses';
import {
  cameOf, chipTitle, classChips, countMarks, Empty, Field, Frame, longDate, MoreMenu, PhotoTile, RegRow, RgIcon, SessionStrip, sessionDays, shown,
  SummaryBand, Toolbar, useCanReset, type MenuItem, type RgStatus, type View,
} from './RegisterKit';
import { EMOJIS } from './ClubsPage';
import { CleanupButton } from '../../components/CleanupDialog';
import type { Organization } from '../../state/OrgContext';

export function ClubPage() {
  return <HopeGate title="Club">{(org) => <ClubScreen org={org} />}</HopeGate>;
}

type Tab = 'register' | 'members' | 'wins' | 'about';
type H = ReturnType<typeof useHopePage>;

function ClubScreen({ org }: { org: Organization }) {
  const { clubId = '' } = useParams();
  const h = useHopePage(org);
  const c = useClubs(org.id);
  const champ = useChampions(org.id);
  const [params, setParams] = useSearchParams();
  const tab = (['register', 'members', 'wins', 'about'].includes(params.get('tab') ?? '') ? params.get('tab') : 'register') as Tab;
  const club = c.clubs.find((x) => x.id === clubId);
  const days = useMemo(() => c.days.filter((d) => d.clubId === clubId), [c.days, clubId]);
  const wins = useMemo(() => c.wins.filter((w) => w.clubId === clubId), [c.wins, clubId]);

  if (!club) return <div className="page narrow"><p><Link to="/hope/clubs">← Clubs</Link></p><p>{c.loading ? 'Loading…' : 'This club was not found.'}</p></div>;
  const s = clubSummary(club, days);
  const leaders = champ.champions.filter((x) => club.leaderIds.includes(x.id));
  const tabs: [Tab, string][] = [['register', 'Register'], ['members', `Members (${club.memberIds.length})`], ['wins', `Wins (${wins.length})`], ['about', 'About']];

  return (
    <div className="page narrow">
      <p><Link to="/hope/clubs">← Clubs</Link></p>
      <section className="card cl-head">
        <span className="cl-emoji big" aria-hidden="true">{club.emoji || '⭐'}</span>
        <div className="stack">
          <h1>{club.name}{club.status === 'paused' && <span className="badge badge-muted">Paused</span>}</h1>
          <CleanupButton orgId={org.id} kind="club" id={club.id} back="/hope/clubs" hope />
          <p className="muted">{scheduleText(club) || 'Day and time not set yet'}</p>
          <p className="small">{leaders.length ? `Led by ${leaders.map((x) => x.name).join(', ')}` : 'No champion leader yet'}</p>
        </div>
        <div className="cl-head-stats">
          <PctBadge pct={s.pct} />
          <span className="small muted">{s.sessions} {s.sessions === 1 ? 'session' : 'sessions'}</span>
        </div>
      </section>
      <div className="segmented hr-switch" role="tablist">
        {tabs.map(([k, label]) => <button key={k} type="button" role="tab" aria-selected={tab === k} className={tab === k ? 'on' : ''} onClick={() => setParams(k === 'register' ? {} : { tab: k }, { replace: true })}>{label}</button>)}
      </div>
      {tab === 'register' && <ClubRegisterBody org={org} club={club} days={days} h={h} start={clubDayOnOrBefore(club.day, h.today)} bare />}
      {tab === 'members' && <Members org={org} club={club} days={days} h={h} />}
      {tab === 'wins' && <Wins org={org} club={club} wins={wins} h={h} />}
      {tab === 'about' && <About org={org} club={club} champions={champ.champions} />}
    </div>
  );
}

/**
 * A club's register, in the same calm layout as the children's (Registers brief, 2026-11-06): the club's meeting
 * days, one summary band, the class chips, and one line (or one photo) per member. `bare` leaves out the page head,
 * for the club's own page.
 */
export function ClubRegisterBody({ org, club, days, h, start, ptabs, subtabs, picker, bare }: {
  org: Organization; club: Club; days: ClubDay[]; h: H; start: string; ptabs?: ReactNode; subtabs?: ReactNode; picker?: ReactNode; bare?: boolean;
}) {
  const { can, profile } = useAuth();
  const toast = useToast();
  const photos = useChildPhotos(org.id);
  const [date, setDate] = useState(start);
  const [q, setQ] = useState('');
  const [only, setOnly] = useState(false);
  const [chip, setChip] = useState('all');
  const [view, setView] = useState<View>('list');
  const [scan, setScan] = useState(false);
  const [resetting, setResetting] = useState(false);
  const canReset = useCanReset(org.id);
  const marker = can('attendance.write');
  const helper = profile?.roleId === HELPER_ROLE_ID;
  const fail = (err: unknown) => toast.show(friendlyError(err));
  const day = days.find((d) => d.date === date);
  const marks = day?.marks ?? {};
  const ids = [...new Set([...club.memberIds, ...Object.keys(marks)])];
  const everyone = ids.map((id) => ({ id, name: h.nameOf(id), child: h.children.find((x) => x.id === id) }))
    .filter((x) => x.child).map((x) => ({ ...x, child: x.child!, cls: classOf(x.child!.dateOfBirth, date) })).sort((a, b) => a.name.localeCompare(b.name));
  const chips = classChips(everyone, (x) => x.cls);
  const group = chip === 'all' || chips.some((c) => c.id === chip) ? chip : 'all';
  const inGroup = everyone.filter((x) => group === 'all' || (group === 'none' ? !x.cls : x.cls?.id === group));
  const counts = countMarks(inGroup.map((x) => x.id), marks);
  const text = q.trim().toLowerCase();
  const list = inGroup.filter((x) => (!only || !shown(marks[x.id]?.s)) && (!text || x.name.toLowerCase().includes(text) || (x.child.code ?? '').toLowerCase().includes(text)));
  const pctOf = (d: string) => {
    const m = days.find((x) => x.date === d)?.marks ?? {};
    return Object.keys(m).length ? cameOf(countMarks([...new Set([...club.memberIds, ...Object.keys(m)])], m)) : null;
  };

  function mark(id: string, s: RgStatus | null, extra: Partial<KidEntry> = {}) {
    if (!marker) return;
    const old = marks[id];
    if (s === 'present' && !shown(old?.s)) tick();
    const there = s === 'present' || s === 'late';
    markClub(org.id, club.id, date, { [id]: s ? { s, t: there ? (old?.t ?? (date === h.today ? nowTime() : null)) : null, r: old?.r ?? null, ...extra } : null }).catch(fail);
  }
  function scanned(code: string): string {
    const c = h.children.find((x) => x.code === code);
    if (!c) return `No child has the code ${code}.`;
    const name = h.nameOf(c.id);
    if (!club.memberIds.includes(c.id)) return `${name} is not a member of ${club.name}.`;
    if (shown(marks[c.id]?.s) === 'present') return `✓ ${name} is already here.`;
    mark(c.id, 'present');
    return `✓ ${name} is here`;
  }
  function bulkAbsent() {
    const left = inGroup.filter((x) => !shown(marks[x.id]?.s));
    markClub(org.id, club.id, date, Object.fromEntries(left.map((x) => [x.id, { s: 'absent', t: null, r: null }]))).catch(fail);
  }

  const menu: MenuItem[] = [];
  if (canReset && day && Object.keys(marks).length) menu.push({ label: 'Reset this day', hint: 'Moves every mark for this day to the Bin', danger: true, onClick: () => setResetting(true) });
  const actions = (
    <>
      {marker && <button type="button" className="btn btn-primary" aria-pressed={scan} onClick={() => setScan(!scan)}><RgIcon name="cam" />Scan cards</button>}
      <MoreMenu items={menu} />
    </>
  );
  const body = (
    <>
      {picker}
      {scan && marker && <DoorScan onCode={scanned} onClose={() => setScan(false)} />}
      <SessionStrip days={sessionDays(clubDayOnOrBefore(club.day, h.today), 6, [date])} value={date} onChange={setDate} pctOf={pctOf} today={h.today} />
      <SummaryBand title={group === 'all' ? `${club.emoji || '⭐'} ${club.name}` : chipTitle(group, club.name)} counts={counts} showPct={!helper}
        onBulk={marker && !helper ? bulkAbsent : undefined} note={marker ? undefined : 'Your role can see this register but not change it.'} />
      <Toolbar q={q} onQ={setQ} placeholder="Search club members" only={only} onOnly={setOnly} view={view} onView={setView} chips={chips} chip={group} onChip={setChip} chipsLabel="Filter by class" />
      {everyone.length === 0 ? (
        <div className="card"><Empty title="No members yet"><Link to={`/hope/clubs/${club.id}?tab=members`}>Add the members</Link> first.</Empty></div>
      ) : list.length === 0 ? (
        <div className="card"><Empty title={only && !q ? 'Everyone is marked' : 'No match'}>{only && !q ? 'Nothing left to do in this view.' : 'Try a different name or filter.'}</Empty></div>
      ) : view === 'photos' ? (
        <div className="card">
          <ul className="rg-tiles">
            {list.map(({ id, name, child }) => (
              <PhotoTile key={id} name={name} photo={child.photoConsent?.given ? photos.get(id) : null} status={shown(marks[id]?.s)} time={marks[id]?.t} disabled={!marker}
                allergy={hasAllergy(child.allergies) ? child.allergies : null} onMark={(s) => mark(id, s)} />
            ))}
          </ul>
        </div>
      ) : (
        <ul className="card rg-list">
          {list.map(({ id, name, child, cls }) => {
            const e = marks[id];
            const s = shown(e?.s);
            const pct = helper ? null : memberRate(id, days).pct;
            const sub = [cls?.name, club.levels[id], pct != null ? `${pct}%` : null].filter(Boolean).join(' · ');
            return (
              <RegRow key={id} name={name} sub={sub} photo={child.photoConsent?.given ? photos.get(id) : null} allergy={hasAllergy(child.allergies) ? child.allergies : null}
                to={!helper && can('people.read') ? `/hope/children/${id}` : undefined} status={s} disabled={!marker} onMark={(x) => mark(id, x)}
                details={helper || !e ? undefined : (
                  <Field label="Notes" wide><input disabled={!marker} maxLength={200} defaultValue={e.r ?? ''} key={`${date}${e.r}`} placeholder={s === 'excused' ? 'Sick, at school, travelled…' : 'Anything to remember'}
                    onBlur={(ev) => ev.target.value.trim() !== (e.r ?? '') && s && mark(id, s, { r: ev.target.value.trim() || null })} /></Field>
                )} />
            );
          })}
        </ul>
      )}
      {!helper && <div className="rg-trend"><TrendCard title="Attendance as time goes" trend={dayTrend(days)} /></div>}
      <RemoveDialog orgId={org.id} items={[{ kind: 'clubDay', id: clubDayId(club.id, date) }]} open={resetting} onClose={() => setResetting(false)} onDone={() => setResetting(false)} />
    </>
  );
  if (bare) return <div className="rg"><div className="rg-head rg-bare"><p>{longDate(date)}</p><div className="rg-actions">{actions}</div></div>{body}</div>;
  return <Frame date={date} actions={actions} ptabs={ptabs} subtabs={subtabs}>{body}</Frame>;
}

function Members({ org, club, days, h }: { org: Organization; club: Club; days: ClubDay[]; h: H }) {
  const { can } = useAuth();
  const toast = useToast();
  const photos = useChildPhotos(org.id);
  const [q, setQ] = useState('');
  const canEdit = can('people.write');
  const fail = (err: unknown) => toast.show(friendlyError(err));
  const full = club.capacity > 0 && club.memberIds.length >= club.capacity;
  const members = club.memberIds.map((id) => ({ id, name: h.nameOf(id), child: h.children.find((x) => x.id === id), rate: memberRate(id, days) }))
    .filter((x) => x.child).sort((a, b) => a.name.localeCompare(b.name));
  const text = q.trim().toLowerCase();
  const code = normalizeCode(q);
  const others = text ? h.children.filter((c) => isCurrentChild(c) && !club.memberIds.includes(c.id))
    .filter((c) => h.nameOf(c.id).toLowerCase().includes(text) || (!!code && c.code === code)).slice(0, 8) : [];

  function add(id: string) {
    if (full) { toast.show(`${club.name} is full (${club.capacity}). Raise the limit under About.`); return; }
    updateClub(org.id, club.id, { memberIds: [...club.memberIds, id] }).catch(fail);
    toast.show(`${h.nameOf(id)} joined ${club.name}`);
    setQ('');
  }
  function remove(id: string) {
    const levels = { ...club.levels };
    delete levels[id];
    updateClub(org.id, club.id, { memberIds: club.memberIds.filter((x) => x !== id), levels }).catch(fail);
    toast.show(`${h.nameOf(id)} left ${club.name}. Their attendance is kept.`);
  }

  return (
    <>
      {canEdit && (
        <section className="card stack">
          <h2>Add a member</h2>
          <input type="search" className="search" placeholder="Type a child's name or code" aria-label="Find a child to add" value={q} onChange={(e) => setQ(e.target.value)} />
          {others.length > 0 && <div className="chips">{others.map((c) => <button key={c.id} type="button" className="chip" onClick={() => add(c.id)}>+ {h.nameOf(c.id)}</button>)}</div>}
          {text && others.length === 0 && <p className="small muted">No child matches who isn't already a member.</p>}
          {club.capacity > 0 && <p className="small muted">{club.memberIds.length} of {club.capacity} places taken.</p>}
        </section>
      )}
      {members.length === 0 ? <div className="card"><p className="muted">No members yet.</p></div> : (
        <ul className="hr-list">
          {members.map(({ id, name, child, rate }) => (
            <li key={id} className="card hr-row">
              <div className="hr-who">
                <Avatar photo={child!.photoConsent?.given ? photos.get(id) : null} name={name} />
                <div><Link to={`/hope/children/${id}`} className="link-title">{name}</Link>
                  <span className="small muted"> {rate.marked ? `${rate.present} of ${rate.present + rate.absent} sessions` : 'Not marked yet'}</span>
                  {rate.pct != null && rate.present + rate.absent >= 3 && rate.pct < 50 && <span className="badge badge-warn">Coming less than half the time</span>}
                </div>
                <PctBadge pct={rate.pct} />
              </div>
              <div className="hr-fields">
                <label className="hr-inline grow"><span>{levelLabel(club)}</span>
                  <input disabled={!canEdit} maxLength={60} defaultValue={club.levels[id] ?? ''} key={club.levels[id] ?? ''} onBlur={(e) => e.target.value.trim() !== (club.levels[id] ?? '') && updateClub(org.id, club.id, { levels: { ...club.levels, [id]: e.target.value.trim().slice(0, 60) } }).catch(fail)} />
                </label>
                {canEdit && <button type="button" className="btn btn-quiet" onClick={() => remove(id)}>Remove</button>}
              </div>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

function Wins({ org, club, wins, h }: { org: Organization; club: Club; wins: ReturnType<typeof useClubs>['wins']; h: H }) {
  const { can } = useAuth();
  const toast = useToast();
  const canAdd = can('attendance.write');
  const [open, setOpen] = useState(false);
  const [date, setDate] = useState(h.today);
  const [kind, setKind] = useState<WinKind>('award');
  const [title, setTitle] = useState('');
  const [note, setNote] = useState('');
  const [who, setWho] = useState<string[]>([]);
  function submit(e: FormEvent) {
    e.preventDefault();
    if (title.trim().length < 2) return;
    addClubWin(org.id, { clubId: club.id, date, kind, title, note, childIds: who }).catch((err) => toast.show(friendlyError(err)));
    toast.show('🎉 Win saved');
    setOpen(false); setTitle(''); setNote(''); setWho([]);
  }
  return (
    <>
      {canAdd && !open && <button type="button" className="btn btn-primary align-start" onClick={() => setOpen(true)}>🎉 Add a win</button>}
      {open && (
        <form className="card form" onSubmit={submit} noValidate>
          <h2>Add a win</h2>
          <div className="field-row">
            <label className="field"><span>What kind?</span><select value={kind} onChange={(e) => setKind(e.target.value as WinKind)}>{WIN_KINDS.map((k) => <option key={k} value={k}>{WIN_EMOJI[k]} {WIN_KIND_LABELS[k]}</option>)}</select></label>
            <label className="field"><span>Date</span><input type="date" value={date} max={h.today} onChange={(e) => setDate(e.target.value)} /></label>
          </div>
          <label className="field"><span>What happened?</span><input value={title} maxLength={120} placeholder="Won the under-12 tournament, sold 40 bars of soap…" onChange={(e) => setTitle(e.target.value)} /></label>
          <label className="field"><span>More details (optional)</span><textarea rows={3} maxLength={1000} value={note} onChange={(e) => setNote(e.target.value)} /></label>
          {club.memberIds.length > 0 && (
            <div className="field"><span>Children involved (optional)</span>
              <div className="chips">{club.memberIds.map((id) => <button key={id} type="button" className={`chip${who.includes(id) ? ' chip-on' : ''}`} aria-pressed={who.includes(id)} onClick={() => setWho(who.includes(id) ? who.filter((x) => x !== id) : [...who, id])}>{h.nameOf(id)}</button>)}</div>
            </div>
          )}
          <div className="chips"><button type="submit" className="btn btn-primary" disabled={title.trim().length < 2}>Save the win</button><button type="button" className="btn btn-quiet" onClick={() => setOpen(false)}>Cancel</button></div>
        </form>
      )}
      {wins.length === 0 ? <div className="card"><p className="muted">No wins logged yet. Every certificate, match won, show or first sale counts.</p></div> : (
        <ul className="cl-wins">
          {wins.map((w) => (
            <li key={w.id} className="card">
              <span className="cl-win-emoji" aria-hidden="true">{WIN_EMOJI[w.kind]}</span>
              <div className="stack">
                <b>{w.title}</b>
                <span className="small muted">{formatDateKey(w.date)} · {WIN_KIND_LABELS[w.kind]}</span>
                {w.note && <span className="small">{w.note}</span>}
                {w.childIds.length > 0 && <span className="small">With {w.childIds.map((id) => h.nameOf(id)).join(', ')}</span>}
              </div>
              {can('people.write') && <button type="button" className="btn btn-quiet" onClick={() => { removeClubWin(org.id, w.id).catch((err) => toast.show(friendlyError(err))); }}>Remove</button>}
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

function About({ org, club, champions }: { org: Organization; club: Club; champions: ReturnType<typeof useChampions>['champions'] }) {
  const { can } = useAuth();
  const toast = useToast();
  const canEdit = can('people.write');
  const [f, setF] = useState<Pick<ClubInput, 'name' | 'emoji' | 'description' | 'day' | 'time' | 'endTime' | 'place' | 'capacity' | 'leaderIds' | 'status'>>({
    name: club.name, emoji: club.emoji, description: club.description, day: club.day, time: club.time, endTime: club.endTime, place: club.place,
    capacity: club.capacity, leaderIds: club.leaderIds, status: club.status,
  });
  const active = champions.filter((x) => x.status === 'active' || f.leaderIds.includes(x.id));
  function save(e: FormEvent) {
    e.preventDefault();
    if (f.name.trim().length < 2) return;
    updateClub(org.id, club.id, { ...f, name: f.name.trim().slice(0, 60), description: f.description.trim().slice(0, 500), place: f.place.trim().slice(0, 80), capacity: Math.max(0, Math.min(1000, Math.floor(f.capacity) || 0)) })
      .catch((err) => toast.show(friendlyError(err)));
    toast.show('Saved');
  }
  return (
    <form className="card form" onSubmit={save} noValidate>
      <label className="field"><span>Club name</span><input disabled={!canEdit} value={f.name} maxLength={60} onChange={(e) => setF({ ...f, name: e.target.value })} /></label>
      <div className="field"><span>Picture</span><div className="cl-emoji-pick">{EMOJIS.map((x) => <button key={x} type="button" disabled={!canEdit} aria-pressed={f.emoji === x} className={f.emoji === x ? 'on' : ''} onClick={() => setF({ ...f, emoji: x })}>{x}</button>)}</div></div>
      <label className="field"><span>What the club does (optional)</span><textarea disabled={!canEdit} rows={2} maxLength={500} value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} /></label>
      <div className="field-row">
        <label className="field"><span>Meets on</span><select disabled={!canEdit} value={f.day} onChange={(e) => setF({ ...f, day: e.target.value as Club['day'] })}>{WEEKDAYS.map((d) => <option key={d}>{d}</option>)}</select></label>
        <label className="field"><span>From</span><input disabled={!canEdit} type="time" value={f.time} onChange={(e) => setF({ ...f, time: e.target.value })} /></label>
        <label className="field"><span>To</span><input disabled={!canEdit} type="time" value={f.endTime} onChange={(e) => setF({ ...f, endTime: e.target.value })} /></label>
      </div>
      <div className="field-row">
        <label className="field"><span>Where</span><input disabled={!canEdit} value={f.place} maxLength={80} placeholder="Hall, field, kitchen…" onChange={(e) => setF({ ...f, place: e.target.value })} /></label>
        <label className="field"><span>Most children (0 = no limit)</span><input disabled={!canEdit} type="number" min={0} max={1000} value={f.capacity} onChange={(e) => setF({ ...f, capacity: Number(e.target.value) })} /></label>
      </div>
      <fieldset className="stack">
        <legend>Champion leaders</legend>
        {active.length === 0 ? <p className="small muted">Add champions under Registers → Champions first.</p> : (
          <div className="chips">{active.map((x) => <button key={x.id} type="button" disabled={!canEdit} className={`chip${f.leaderIds.includes(x.id) ? ' chip-on' : ''}`} aria-pressed={f.leaderIds.includes(x.id)}
            onClick={() => setF({ ...f, leaderIds: f.leaderIds.includes(x.id) ? f.leaderIds.filter((y) => y !== x.id) : [...f.leaderIds, x.id].slice(0, 30) })}>{x.name}</button>)}</div>
        )}
      </fieldset>
      <label className="check"><input type="checkbox" disabled={!canEdit} checked={f.status === 'paused'} onChange={(e) => setF({ ...f, status: e.target.checked ? 'paused' : 'active' })} /><span>Paused for now (kept, but hidden from the club list)</span></label>
      {canEdit && <button type="submit" className="btn btn-primary align-start">Save</button>}
    </form>
  );
}
