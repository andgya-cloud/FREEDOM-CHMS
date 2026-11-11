import { useMemo, useState, type ReactNode } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '../../state/AuthContext';
import { useToast } from '../../state/ToastContext';
import { useChampions, useChildPhotos, useClubs, useHopeDays } from '../../state/useHope';
import { arrivalMark } from '../../../functions/src/shared/hopeChampionPay';
import { friendlyError } from '../../lib/errors';
import { markChampion, markKid, markMany } from '../../lib/hopeWrites';
import { DoorScan } from './DoorScan';
import { clubDayOnOrBefore } from '../../../functions/src/shared/hopeClubs';
import { ChampionsPanel } from './ChampionsPage';
import { ClubRegisterBody } from './ClubPage';
import { isCurrentChild, normalizeCode } from '../../../functions/src/shared/hope';
import { birthdayThisWeek, dayTrend, kidRate, streak, saturdayOnOrBefore, type HopeDay, type KidEntry } from '../../../functions/src/shared/hopeRegister';
import { HELPER_ROLE_ID } from '../../../functions/src/shared/permissions';
import { RemoveDialog } from '../../components/CleanupDialog';
import { HopeGate, useHopePage } from './common';
import { classOf, hasAllergy, HOPE_CLASSES } from '../../../functions/src/shared/hopeClasses';
import { Delights, nowTime, tick, TrendCard } from './registerParts';
import {
  chipTitle, classChips, countMarks, cameOf, Empty, Field, Frame, MoreMenu, PhotoTile, PrimaryTabs, RegRow, RgIcon, SessionStrip, sessionDays, shown, SubTabs,
  SummaryBand, Toolbar, useCanReset, type MenuItem, type RgStatus, type View,
} from './RegisterKit';
import type { Organization } from '../../state/OrgContext';

export function KidsRegisterPage() {
  return <HopeGate title="Registers">{(org) => <Registers org={org} />}</HopeGate>;
}

type Which = 'children' | 'champions' | 'club';

/**
 * One Registers page (Andy, 2026-11-04, 9A; calm redesign from the Registers brief, 2026-11-06): one primary tab row
 * for the children, the Child Champions and the clubs, each with the same session strip, summary band and rows.
 */
function Registers({ org }: { org: Organization }) {
  const [params, setParams] = useSearchParams();
  const { profile } = useAuth();
  const helper = profile?.roleId === HELPER_ROLE_ID;
  // A class volunteer (a Hope helper with a class) sees only their own class register (brief).
  const volunteer = helper && (profile?.hopeClassIds?.length ?? 0) > 0;
  const opts: [Which, string][] = volunteer ? [['children', 'Children']] : helper ? [['children', 'Children'], ['club', 'Clubs']] : [['children', 'Children'], ['champions', 'Champions'], ['club', 'Clubs']];
  const asked = params.get('w') as Which | null;
  const w: Which = opts.some(([k]) => k === asked) ? asked! : 'children';
  const ptabs = <PrimaryTabs value={w} options={opts} onChange={(k) => setParams(k === 'children' ? {} : { w: k }, { replace: true })} />;
  return (
    <div className="page rg">
      {w === 'children' && <KidsRegister org={org} ptabs={ptabs} />}
      {w === 'champions' && <ChampionsPanel org={org} ptabs={ptabs} />}
      {w === 'club' && <ClubSessions org={org} ptabs={ptabs} />}
    </div>
  );
}

/** The clubs' registers: pick the club; it opens on its last meeting day. */
function ClubSessions({ org, ptabs }: { org: Organization; ptabs: ReactNode }) {
  const h = useHopePage(org);
  const c = useClubs(org.id);
  const [params, setParams] = useSearchParams();
  const clubs = c.clubs.filter((x) => x.status === 'active');
  const weekday = new Intl.DateTimeFormat('en-GB', { weekday: 'long', timeZone: 'UTC' }).format(new Date(`${h.today}T12:00:00Z`));
  const club = clubs.find((x) => x.id === params.get('club')) ?? clubs.find((x) => x.day === weekday) ?? clubs[0];
  const subtabs = <SubTabs value="register" options={[{ id: 'register', label: 'Register' }, { id: 'clubs', label: 'The clubs', to: '/hope/clubs' }]} onChange={() => undefined} />;
  if (!c.loading && clubs.length === 0) {
    return <Frame ptabs={ptabs} subtabs={subtabs}><div className="card"><Empty title="No clubs yet"><Link to="/hope/clubs">Set up the clubs</Link> first.</Empty></div></Frame>;
  }
  if (!club) return <Frame ptabs={ptabs}><p className="muted">Loading…</p></Frame>;
  return (
    <ClubRegisterBody key={club.id} org={org} club={club} days={c.days.filter((d) => d.clubId === club.id)} h={h} ptabs={ptabs} subtabs={subtabs}
      picker={(
        <div className="rg-clubs" role="group" aria-label="Which club">
          {clubs.map((x) => (
            <button key={x.id} type="button" className="rg-club" aria-pressed={x.id === club.id} onClick={() => setParams({ w: 'club', club: x.id }, { replace: true })}>
              <span aria-hidden="true">{x.emoji || '⭐'}</span>{x.name}<small>{x.day === weekday ? 'today' : x.day}</small>
            </button>
          ))}
        </div>
      )}
      start={clubDayOnOrBefore(club.day, h.today)} />
  );
}

const VIEW_KEY = 'hope.register.view';
function savedView(): View { try { return localStorage.getItem(VIEW_KEY) === 'photos' ? 'photos' : 'list'; } catch { return 'list'; } }
function keepView(v: View) { try { localStorage.setItem(VIEW_KEY, v); } catch { /* private window */ } }

/** The children on the register for a day: current and enrolled by then, and anyone already marked. */
function onRegister<T extends { id: string; enrolledOn?: string | null }>(children: readonly T[], marks: Record<string, unknown>, date: string, current: (c: T) => boolean) {
  return children.filter((c) => marks[c.id] || (current(c) && (!c.enrolledOn || c.enrolledOn <= date)));
}

/**
 * The children's weekly register. Tap Present, Late, Absent or Excused on each line, or tap a photo in the Photos
 * view. Time in fills in by itself only when marking on the day of the session.
 */
function KidsRegister({ org, ptabs }: { org: Organization; ptabs: ReactNode }) {
  const h = useHopePage(org);
  const { can, profile } = useAuth();
  const toast = useToast();
  const { days } = useHopeDays(org.id);
  const photos = useChildPhotos(org.id);
  const champs = useChampions(org.id);
  const [params] = useSearchParams();
  const helper = profile?.roleId === HELPER_ROLE_ID;
  const myClasses = helper ? profile?.hopeClassIds ?? [] : [];
  const volunteer = myClasses.length > 0;
  // "Check in" opens today, any day of the week (Andy, 2026-11-05, 1A); a day from Reports → Attendance opens that day.
  const asked = params.get('d');
  const [date, setDate] = useState(() => (asked === 'today' ? h.today : asked && /^\d{4}-\d{2}-\d{2}$/.test(asked) && asked <= h.today ? asked : saturdayOnOrBefore(h.today)));
  const [q, setQ] = useState('');
  const [only, setOnly] = useState(false);
  const [view, setView] = useState<View>(savedView);
  const [chip, setChip] = useState('all');
  const [scan, setScan] = useState(false);
  const [resetting, setResetting] = useState(false);
  const canMark = can('attendance.write');
  const canReset = useCanReset(org.id);
  const navigate = useNavigate();
  const fail = (err: unknown) => toast.show(friendlyError(err));

  const day = days.find((d) => d.date === date);
  const marks = useMemo(() => day?.marks ?? {}, [day]);

  const everyone = useMemo(() => onRegister(h.children, marks, date, isCurrentChild)
    .map((c) => ({ c, name: h.nameOf(c.id), cls: classOf(c.dateOfBirth, date) }))
    .filter((x) => !volunteer || (x.cls && myClasses.includes(x.cls.id)))
    .sort((a, b) => a.name.localeCompare(b.name)), [h.children, h.nameOf, marks, date, volunteer, myClasses]);
  const chips = classChips(everyone, (x) => x.cls, !volunteer || myClasses.length > 1);
  const group = chip === 'all' || chips.some((c) => c.id === chip) ? chip : 'all';
  const inGroup = useMemo(() => everyone.filter((x) => group === 'all' || (group === 'none' ? !x.cls : x.cls?.id === group)), [everyone, group]);
  const counts = countMarks(inGroup.map((x) => x.c.id), marks);
  const list = useMemo(() => {
    const text = q.trim().toLowerCase();
    const code = normalizeCode(q);
    return inGroup.filter(({ c, name }) => (!only || !shown(marks[c.id]?.s))
      && (!text || name.toLowerCase().includes(text) || (c.code ?? '').toLowerCase().includes(text) || (!!code && c.code === code)));
  }, [inGroup, q, only, marks]);

  const sessions = sessionDays(saturdayOnOrBefore(h.today), 6, [date]);
  const pctOf = (d: string) => {
    const m = days.find((x) => x.date === d)?.marks ?? {};
    if (!Object.keys(m).length) return null;
    const ids = onRegister(h.children, m, d, isCurrentChild).map((c) => c.id);
    return cameOf(countMarks(ids, m));
  };

  function mark(childId: string, s: RgStatus | null, extra: Partial<KidEntry> = {}) {
    if (!canMark) return;
    if (!s) { markKid(org.id, date, childId, null).catch(fail); return; }
    const old = marks[childId];
    const there = s === 'present' || s === 'late';
    if (s === 'present' && !shown(old?.s)) tick();
    // Time in fills in only when marking on the day itself (brief: it used to fill a time that did not match the day).
    const entry: KidEntry = { s, t: there ? (old?.t ?? (date === h.today ? nowTime() : null)) : null, r: old?.r ?? null, ...extra };
    markKid(org.id, date, childId, entry).catch(fail);
  }
  /** A card read at the door (12A): checks the child in, and says who. */
  function scanned(code: string): string {
    // A Child Champion's card checks them in on their register, late after 8:30am (Andy, 2026-11-05, 11A 12).
    if (code.startsWith('CC-')) {
      const x = champs.champions.find((y) => y.code === code);
      if (!x) return `No champion has the code ${code}.`;
      const old = champs.days.find((d) => d.date === date)?.marks?.[x.id];
      if (old && (old.s === 'present' || old.s === 'late')) return `✓ ${x.name} is already checked in${old.in ? ` (${old.in})` : ''}.`;
      const t = date === h.today ? nowTime() : null;
      const s = arrivalMark(t);
      markChampion(org.id, date, x.id, { s, in: t, out: null, duty: x.duty || null, r: null }).catch(fail);
      return `✓ ${x.name} (champion) checked in${t ? ` at ${t}` : ''}${s === 'late' ? ' · late' : ''}`;
    }
    const c = h.children.find((x) => x.code === code);
    if (!c) return `No child has the code ${code}.`;
    const name = h.nameOf(c.id);
    const old = marks[c.id];
    if (old && (old.s === 'present' || old.s === 'late' || old.s === 'departing')) return `✓ ${name} is already checked in${old.t ? ` (${old.t})` : ''}.`;
    mark(c.id, 'present');
    return `✓ ${name} checked in${date === h.today ? ` at ${nowTime()}` : ''}`;
  }
  function bulkAbsent() {
    const ids = inGroup.filter(({ c }) => !shown(marks[c.id]?.s)).map(({ c }) => c.id);
    markMany(org.id, 'hopeDays', date, Object.fromEntries(ids.map((id) => [id, { s: 'absent', t: null, r: null }]))).catch(fail);
    toast.show(`✅ Register finished. Well done! ${ids.length} marked absent.`);
  }

  const menu: MenuItem[] = [];
  if (canMark && date === h.today && !volunteer) menu.push({ label: 'Gate mode', hint: 'A screen at the door for scanning cards', onClick: () => navigate('/hope/gate') });
  if (canReset && day && Object.keys(marks).length) menu.push({ label: 'Reset this day', hint: `Moves every mark for ${date.slice(8)}/${date.slice(5, 7)} to the Bin`, danger: true, onClick: () => setResetting(true) });
  const actions = (
    <>
      {can('people.write') && !helper && <Link to="/hope/children/import" className="btn rg-ghost"><RgIcon name="up" />Upload from Excel</Link>}
      {canMark && <button type="button" className="btn btn-primary" aria-pressed={scan} onClick={() => setScan(!scan)}><RgIcon name="cam" />Scan cards</button>}
      <MoreMenu items={menu} />
    </>
  );
  const title = volunteer && myClasses.length === 1 ? chipTitle(myClasses[0]!, '') : chipTitle(group, 'All children');
  const note = volunteer ? `You are marking attendance for ${myClasses.map((id) => HOPE_CLASSES.find((k) => k.id === id)?.name ?? id).join(' and ')} only.`
    : !canMark ? 'Your role can see this register but not change it.' : undefined;

  return (
    <Frame date={date} actions={actions} ptabs={ptabs}>
      {scan && canMark && <DoorScan onCode={scanned} onClose={() => setScan(false)} />}
      {!volunteer && <SessionStrip days={sessions} value={date} onChange={setDate} pctOf={pctOf} today={h.today} />}
      <SummaryBand title={title} counts={counts} showPct={!volunteer} onBulk={canMark && !helper ? bulkAbsent : undefined} note={note} />
      <Toolbar q={q} onQ={setQ} placeholder="Search children" only={only} onOnly={setOnly} view={view} onView={(v) => { setView(v); keepView(v); }}
        chips={chips} chip={group} onChip={setChip} chipsLabel="Filter by class" />

      {h.loading ? <p className="muted">Loading…</p> : everyone.length === 0 ? (
        <div className="card"><Empty title="No children on the register yet">{can('people.write') && !helper && <Link to="/hope/children/import">Upload them from Excel</Link>}</Empty></div>
      ) : list.length === 0 ? (
        <div className="card"><Empty title={only && !q ? 'Everyone is marked' : 'No match'}>{only && !q ? 'Nothing left to do in this view.' : 'Try a different name or filter.'}</Empty></div>
      ) : view === 'photos' ? (
        <div className="card">
          <ul className="rg-tiles">
            {list.map(({ c, name }) => {
              const e = marks[c.id];
              return (
                <PhotoTile key={c.id} name={name} photo={c.photoConsent?.given ? photos.get(c.id) : null} status={shown(e?.s)} time={e?.t} disabled={!canMark}
                  allergy={hasAllergy(c.allergies) ? c.allergies : null} onMark={(s) => mark(c.id, s)}
                  extra={<span className="ck-delight"><Delights birthday={birthdayThisWeek(c.dateOfBirth, h.today)} streak={streak(c.id, days)} /></span>} />
              );
            })}
          </ul>
        </div>
      ) : (
        <ul className="card rg-list">
          {list.map(({ c, name, cls }) => {
            const e = marks[c.id];
            const s = shown(e?.s);
            const age = h.ageOf(c);
            const pct = helper ? null : kidRate(c.id, days as HopeDay[]).pct;
            const sub = [cls?.name, age != null ? `${age} yrs` : null, pct != null ? `${pct}%` : null, s && e?.t ? `in ${e.t}` : null].filter(Boolean).join(' · ');
            return (
              <RegRow key={c.id} name={name} sub={sub} photo={c.photoConsent?.given ? photos.get(c.id) : null} allergy={hasAllergy(c.allergies) ? c.allergies : null}
                to={!helper && can('people.read') ? `/hope/children/${c.id}` : undefined} status={s} disabled={!canMark} onMark={(x) => mark(c.id, x)}
                details={helper || !e ? undefined : (
                  <>
                    {(s === 'present' || s === 'late') && (
                      <Field label="Time in"><input type="time" disabled={!canMark} defaultValue={e.t ?? ''} key={`t${date}${e.t}`} onBlur={(ev) => ev.target.value !== (e.t ?? '') && mark(c.id, s, { t: ev.target.value || null })} /></Field>
                    )}
                    <Field label="Notes" wide><input disabled={!canMark} maxLength={200} defaultValue={e.r ?? ''} key={`r${date}${e.r}`} placeholder={s === 'excused' ? 'Why? Sick, school trip…' : 'Anything to remember'}
                      onBlur={(ev) => ev.target.value.trim() !== (e.r ?? '') && mark(c.id, s, { r: ev.target.value.trim().slice(0, 200) || null })} /></Field>
                  </>
                )} />
            );
          })}
        </ul>
      )}

      {!helper && <div className="rg-trend"><TrendCard title="Attendance as time goes" trend={dayTrend(days)} /></div>}
      {!helper && <p className="rg-foot">Late counts as came. "% came" counts everyone on the register, including those not marked yet.</p>}
      <RemoveDialog orgId={org.id} items={[{ kind: 'hopeDay', id: date }]} open={resetting} onClose={() => setResetting(false)} onDone={() => setResetting(false)} />
    </Frame>
  );
}

