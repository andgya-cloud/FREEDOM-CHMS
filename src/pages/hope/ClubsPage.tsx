import { useMemo, useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../../state/AuthContext';
import { useToast } from '../../state/ToastContext';
import { useClubs } from '../../state/useHope';
import { friendlyError } from '../../lib/errors';
import { addClub, addStarterClubs } from '../../lib/hopeWrites';
import { clubDayOnOrBefore, clubSummary, scheduleText, WEEKDAYS, type Club, type Weekday } from '../../../functions/src/shared/hopeClubs';
import { rateFrom } from '../../../functions/src/shared/hopeRegister';
import { HopeGate, useHopePage } from './common';
import { PctBadge } from './registerParts';
import type { Organization } from '../../state/OrgContext';

export function ClubsPage() {
  return <HopeGate title="Clubs">{(org) => <Clubs org={org} />}</HopeGate>;
}

const EMOJIS = ['⚽', '♟️', '🎵', '🧵', '🧁', '💻', '🧶', '🧼', '🎨', '🏀', '📚', '🌱', '🎭', '🥁', '🏐', '✂️'];

/** All the clubs as cards (Andy, 2026-11-04, Part 2), with this week's attendance, and a way to add a club. */
function Clubs({ org }: { org: Organization }) {
  const h = useHopePage(org);
  const { can } = useAuth();
  const toast = useToast();
  const c = useClubs(org.id);
  const [adding, setAdding] = useState(false);
  const [showPaused, setShowPaused] = useState(false);
  const canEdit = can('people.write');
  const shown = c.clubs.filter((x) => showPaused || x.status === 'active');

  function starters() {
    try {
      const { added, synced } = addStarterClubs(org.id, h.children, c.clubs.map((x) => x.name));
      synced.catch((err) => toast.show(friendlyError(err)));
      toast.show(`${added} clubs added. Football, Chess and Music start with the children already in them.`);
    } catch (err) { toast.show(friendlyError(err)); }
  }

  return (
    <div className="page">
      <div className="page-head">
        <h1>Clubs</h1>
        {canEdit && !adding && <button type="button" className="btn btn-primary" onClick={() => setAdding(true)}>Add a club</button>}
      </div>
      {adding && <NewClub org={org} onDone={() => setAdding(false)} />}
      {!c.loading && c.clubs.length < 8 && canEdit && (
        <section className="card stack">
          <h2>Set up the Hope Centre clubs</h2>
          <p className="small">One tap adds Football Academy, Chess Club, Music Academy, Fashion and Design, Baking, Computer, Mat Making, and Soap and Detergents. Clubs already here are skipped. You can change each club's day, time and leaders afterwards.</p>
          <button type="button" className="btn btn-primary align-start" onClick={starters}>Add the clubs</button>
        </section>
      )}
      {c.loading ? <p className="muted">Loading…</p> : shown.length === 0 ? <div className="card"><p className="muted">No clubs yet.</p></div> : (
        <ul className="cl-grid">
          {shown.map((x) => <ClubCard key={x.id} club={x} today={h.today} days={c.days.filter((d) => d.clubId === x.id)} wins={c.wins.filter((w) => w.clubId === x.id).length} />)}
        </ul>
      )}
      {c.clubs.some((x) => x.status === 'paused') && (
        <label className="check"><input type="checkbox" checked={showPaused} onChange={(e) => setShowPaused(e.target.checked)} /><span>Show paused clubs</span></label>
      )}
    </div>
  );
}

function ClubCard({ club, today, days, wins }: { club: Club; today: string; days: ReturnType<typeof useClubs>['days']; wins: number }) {
  const s = clubSummary(club, days);
  const last = clubDayOnOrBefore(club.day, today);
  const lastDay = rateFrom(Object.values(days.find((d) => d.date === last)?.marks ?? {}));
  return (
    <li>
      <Link to={`/hope/clubs/${club.id}`} className={`card cl-card${club.status === 'paused' ? ' paused' : ''}`}>
        <span className="cl-emoji" aria-hidden="true">{club.emoji || '⭐'}</span>
        <span className="cl-badge"><PctBadge pct={s.pct} /></span>
        <b className="cl-name">{club.name}</b>
        <span className="small muted">{scheduleText(club) || 'Day and time not set'}</span>
        <span className="cl-stats">
          <span><b>{club.memberIds.length}</b>{club.capacity ? `/${club.capacity}` : ''} members</span>
          <span><b>{lastDay.marked ? lastDay.present : '–'}</b> came last {club.day.slice(0, 3)}</span>
          <span><b>{wins}</b> {wins === 1 ? 'win' : 'wins'}</span>
        </span>
        {club.status === 'paused' && <span className="badge badge-muted">Paused</span>}
        {s.atRisk.length > 0 && <span className="badge badge-warn">{s.atRisk.length} coming less than half the time</span>}
      </Link>
    </li>
  );
}

function NewClub({ org, onDone }: { org: Organization; onDone: () => void }) {
  const toast = useToast();
  const navigate = useNavigate();
  const [name, setName] = useState('');
  const [emoji, setEmoji] = useState('⭐');
  const [day, setDay] = useState<Weekday>('Saturday');
  const [time, setTime] = useState('');
  const [endTime, setEndTime] = useState('');
  const [error, setError] = useState('');
  const ok = useMemo(() => name.trim().length >= 2, [name]);
  function submit(e: FormEvent) {
    e.preventDefault();
    if (!ok) return setError('Give the club a name.');
    try {
      const id = addClub(org.id, { name: name.trim().slice(0, 60), emoji, description: '', day, time, endTime, place: '', capacity: 0, memberIds: [], leaderIds: [], levels: {}, legacyProgramme: null, status: 'active' });
      toast.show(`${name.trim()} added. Now add its members and leaders.`);
      onDone();
      navigate(`/hope/clubs/${id}?tab=members`);
    } catch (err) { toast.show(friendlyError(err)); }
  }
  return (
    <form className="card form" onSubmit={submit} noValidate>
      <h2>Add a club</h2>
      <label className="field"><span>Club name</span><input value={name} maxLength={60} placeholder="Art Club, Drama Club…" onChange={(e) => setName(e.target.value)} /></label>
      <div className="field"><span>Picture</span><div className="cl-emoji-pick">{EMOJIS.map((x) => <button key={x} type="button" aria-pressed={emoji === x} className={emoji === x ? 'on' : ''} onClick={() => setEmoji(x)}>{x}</button>)}</div></div>
      <div className="field-row">
        <label className="field"><span>Meets on</span><select value={day} onChange={(e) => setDay(e.target.value as Weekday)}>{WEEKDAYS.map((d) => <option key={d}>{d}</option>)}</select></label>
        <label className="field"><span>From</span><input type="time" value={time} onChange={(e) => setTime(e.target.value)} /></label>
        <label className="field"><span>To</span><input type="time" value={endTime} onChange={(e) => setEndTime(e.target.value)} /></label>
      </div>
      {error && <p className="error" role="alert">{error}</p>}
      <div className="chips"><button type="submit" className="btn btn-primary">Add the club</button><button type="button" className="btn btn-quiet" onClick={onDone}>Cancel</button></div>
    </form>
  );
}

export { EMOJIS };
