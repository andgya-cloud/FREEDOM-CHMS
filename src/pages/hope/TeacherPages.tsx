import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../../state/AuthContext';
import { useChildPhotos, useHopeDays } from '../../state/useHope';
import { firstNameOf, timeGreeting } from '../../components/Greeting';
import { PoweredBy } from '../../components/PoweredBy';
import { Stone } from '../../components/Stone';
import { HopeGate, useHopePage } from './common';
import { listPhotoReports, type PhotoList } from '../../lib/hopePhotos';
import { isCurrentChild } from '../../../functions/src/shared/hope';
import { daysToBirthday } from '../../../functions/src/shared/hopeRegister';
import { classNamesOf, classOf, classProgress, HOPE_CLASSES, teacherLabel, type HopeClass } from '../../../functions/src/shared/hopeClasses';
import { isRequestKind } from '../../../functions/src/shared/circles';
import { formatDateKey } from '../../../functions/src/shared/datetime';
import type { Organization } from '../../state/OrgContext';

/**
 * Freedom Hope Centre class teachers (Andy, 2026-11-22, 1A-10A). A teacher has their own login and class (Jasper,
 * Rubies, Sapphire, Emerald or Topaz). Their marks go straight into Diana's one register; they see every child's
 * birthday (look only) and write their notes and requests in the Teachers' room.
 */

const firstWord = (name: string) => name.trim().split(/\s+/)[0] ?? name;

interface Birthday { id: string; first: string; photo: string | null; cls: HopeClass | null; day: string; turning: number | null; ahead: number }

/** Every current child's next birthday, with the age they turn and their class on that day. Names and photos only. */
function useBirthdays(org: Organization): { list: Birthday[]; today: string; loading: boolean } {
  const h = useHopePage(org);
  const photos = useChildPhotos(org.id);
  const list = useMemo(() => h.children.filter(isCurrentChild).flatMap((c) => {
    const ahead = daysToBirthday(c.dateOfBirth, h.today);
    if (ahead == null || !c.dateOfBirth) return [];
    // A birthday a few days ago still counts this week (from three days before to three days after).
    const back = daysToBirthday(c.dateOfBirth, shift(h.today, -3));
    const passed = back != null && back <= 3 && ahead > 3 ? back - 3 : ahead;
    const day = shift(h.today, passed);
    const turning = Number(day.slice(0, 4)) - Number(c.dateOfBirth.slice(0, 4));
    return [{
      id: c.id, first: firstWord(h.nameOf(c.id)), photo: c.photoConsent?.given ? photos.get(c.id) ?? null : null,
      cls: classOf(c.dateOfBirth, day), day, turning: turning > 0 ? turning : null, ahead: passed,
    }];
  }).sort((a, b) => a.day.localeCompare(b.day) || a.first.localeCompare(b.first)), [h.children, h.today, h.nameOf, photos]);
  return { list, today: h.today, loading: h.loading };
}

function shift(day: string, n: number): string {
  const d = new Date(`${day}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

function BirthdayRow({ b, today }: { b: Birthday; today: string }) {
  const when = b.day === today ? 'Today 🎉' : b.ahead === 1 ? 'Tomorrow' : b.ahead === -1 ? 'Yesterday' : formatDateKey(b.day);
  return (
    <li className={`row bd-row${b.ahead < 0 ? ' bd-past' : ''}`}>
      <span className="bd-face" aria-hidden="true">{b.photo ? <img src={b.photo} alt="" /> : '🎈'}</span>
      <span className="row-main">
        <span className="row-title">{b.first}{b.turning ? <> turns <b>{b.turning}</b></> : null}</span>
        <span className="row-sub">{when}</span>
      </span>
      {b.cls && <span className="bd-class"><Stone c={b.cls} size={20} />{b.cls.name}</span>}
    </li>
  );
}

/** The birthdays page (5A): this week and this month, every class, look only. */
export function HopeBirthdaysPage() {
  return <HopeGate title="Birthdays">{(org) => <Birthdays org={org} />}</HopeGate>;
}

function Birthdays({ org }: { org: Organization }) {
  const { list, today, loading } = useBirthdays(org);
  const week = list.filter((b) => b.ahead >= -3 && b.ahead <= 3);
  const month = list.filter((b) => b.day.slice(0, 7) === today.slice(0, 7) && !week.includes(b));
  const monthName = new Intl.DateTimeFormat('en-GB', { month: 'long', timeZone: 'UTC' }).format(new Date(`${today}T12:00:00Z`));
  return (
    <div className="page narrow">
      <h1>🎂 Birthdays</h1>
      <p className="muted">Every class, so you can celebrate together. You can look, not change.</p>
      {loading ? <p className="muted">Loading…</p> : (
        <>
          <section className="card">
            <h2>This week</h2>
            {week.length ? <ul className="list">{week.map((b) => <BirthdayRow key={b.id} b={b} today={today} />)}</ul> : <p className="muted">No birthdays this week.</p>}
          </section>
          <section className="card">
            <h2>Later in {monthName}</h2>
            {month.length ? <ul className="list">{month.map((b) => <BirthdayRow key={b.id} b={b} today={today} />)}</ul> : <p className="muted">No more birthdays this month.</p>}
          </section>
        </>
      )}
      <PoweredBy />
    </div>
  );
}

/** A class teacher's home (10A): their class's register, this week's birthdays and their messages. */
export function TeacherHome({ org }: { org: Organization }) {
  const h = useHopePage(org);
  const { profile } = useAuth();
  const { days } = useHopeDays(org.id);
  const { list: birthdays, today } = useBirthdays(org);
  const [rooms, setRooms] = useState<PhotoList | null>(null);
  useEffect(() => { listPhotoReports(org.id).then(setRooms).catch(() => setRooms(null)); }, [org.id]);
  const tz = org.timeZone || 'Africa/Nairobi';
  const mine = profile?.hopeClassIds ?? [];
  const marks = days.find((d) => d.date === h.today)?.marks ?? {};
  const progress = classProgress(h.children.filter(isCurrentChild), marks, h.today).filter((p) => (mine as string[]).includes(p.id));
  const total = progress.reduce((n, p) => n + p.total, 0);
  const marked = progress.reduce((n, p) => n + p.marked, 0);
  const week = birthdays.filter((b) => b.ahead >= -3 && b.ahead <= 3);
  const requests = (rooms?.reports ?? []).filter((r) => isRequestKind(r.kind));
  const open = requests.filter((r) => r.status !== 'resolved' && r.status !== 'sent');
  const unseen = (rooms?.reports ?? []).filter((r) => r.lastAt && profile && (!r.seen?.[profile.uid] || r.seen[profile.uid]! < r.lastAt)).length;
  const classes = classNamesOf(mine) || 'class';
  const stone = HOPE_CLASSES.find((c) => c.id === mine[0]);
  return (
    <div className="page narrow hp-home">
      <h1 className="hp-greet">{timeGreeting(tz)}{firstNameOf(profile?.displayName) ? `, ${firstNameOf(profile?.displayName)}` : ''} 👋</h1>
      <p className="tc-role">{stone && <Stone c={stone} size={22} />}{teacherLabel(mine)}</p>
      <Link to="/hope/register?d=today" className="hp-big">
        <span className="hp-ico" aria-hidden="true">✅</span>
        <span><b>Mark the {classes} register</b><span>{h.loading ? '…' : total === 0 ? 'No children in your class yet' : marked === total ? `All ${total} marked. Well done!` : `${marked} of ${total} marked today`}</span></span>
      </Link>
      <Link to="/hope/birthdays" className="hp-big hp-small">
        <span className="hp-ico" aria-hidden="true">🎂</span>
        <span><b>Birthdays</b><span>{week.length ? week.slice(0, 3).map((b) => `${b.first}${b.turning ? ` (${b.turning})` : ''}`).join(', ') + (week.length > 3 ? ` and ${week.length - 3} more` : '') + ' this week' : 'None this week'}</span></span>
      </Link>
      <Link to="/hope/photos" className="hp-big hp-small">
        <span className="hp-ico" aria-hidden="true">💬</span>
        <span><b>Teachers' room</b><span>{unseen ? `${unseen} new ${unseen === 1 ? 'message' : 'messages'}` : open.length ? `${open.length} ${open.length === 1 ? 'request' : 'requests'} waiting for an answer` : 'Leave a note or ask for anything here'}</span></span>
      </Link>
      <Link to="/hope/photos?new=1" className="btn btn-quiet align-start">✍️ New note or request</Link>
      {today && <p className="small muted">Marks can be fixed until the end of the day. After that, ask Diana in the Teachers' room.</p>}
      <PoweredBy />
    </div>
  );
}

/** Diana's card (4A): how far each class's register is today, and who marked it. Live, nothing to approve. */
export function ClassesMarkedCard({ org }: { org: Organization }) {
  const h = useHopePage(org);
  const { days } = useHopeDays(org.id);
  const marks = days.find((d) => d.date === h.today)?.marks ?? {};
  const rows = classProgress(h.children.filter(isCurrentChild), marks, h.today);
  if (h.loading || !rows.length || !Object.keys(marks).length) return null;
  const done = rows.filter((r) => r.marked === r.total).length;
  return (
    <section className="card tc-progress">
      <h2>Classes marked {done} of {rows.length}</h2>
      <ul className="list">
        {rows.map((r) => {
          const c = HOPE_CLASSES.find((k) => k.id === r.id)!;
          return (
            <li key={r.id} className="row">
              <Stone c={c} size={20} />
              <span className="row-main">
                <span className="row-title">{r.name} {r.marked === r.total ? '✅' : ''}</span>
                <span className="row-sub">{r.marked} of {r.total} marked{r.by.length ? ` · by ${r.by.join(', ')}` : ''}</span>
              </span>
            </li>
          );
        })}
      </ul>
      <Link to="/hope/register?d=today" className="small">Open the register</Link>
    </section>
  );
}
