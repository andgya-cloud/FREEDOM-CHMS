import { Link } from 'react-router-dom';
import { useAuth } from '../state/AuthContext';
import type { Organization } from '../state/OrgContext';
import { useClassTimetables } from '../state/useTimetables';
import { classesOn, clock } from '../../functions/src/shared/timetable';
import { localDateKey } from '../../functions/src/shared/datetime';

/** 13A: "Your classes today" on a lecturer's Today page, from the published class timetables. Nothing when none. */
export function MyClassesToday({ org }: { org: Organization }) {
  const { user } = useAuth();
  const { rows } = useClassTimetables(org.id);
  const today = localDateKey(new Date(), org.timeZone);
  const list = user ? classesOn(today, user.uid, rows.map((r) => ({ ...r, departmentName: '' }))) : [];
  if (!list.length) return null;
  return (
    <section className="card tt-today" aria-label="Your classes today">
      <div className="card-head"><h2>Your classes today</h2><Link to="/school/timetable" className="small">Timetable</Link></div>
      <ul>
        {list.map((c) => <li key={`${c.cohort}|${c.start}|${c.course}`}><b>{clock(c.start)} – {clock(c.end)}</b> {c.course} · {c.cohort}{c.room ? ` · ${c.room}` : ''}</li>)}
      </ul>
    </section>
  );
}
