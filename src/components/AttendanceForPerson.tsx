import { Link } from 'react-router-dom';
import type { Organization } from '../state/OrgContext';
import { usePersonAttendance } from '../state/useAttendance';
import { ATTENDANCE_STATUS_LABELS, attendanceRate, weeksAttended } from '../../functions/src/shared/attendance';
import { formatDateKey } from '../../functions/src/shared/datetime';

/** On a person's record: how often they come, and their last few check-ins. */
export function AttendanceForPerson({ org, personId }: { org: Organization; personId: string }) {
  const { marks, loading } = usePersonAttendance(org.id, personId);
  if (loading && marks.length === 0) return null;
  const isCollege = org.type === 'college';
  const rate = attendanceRate(marks);
  const weeks = weeksAttended(marks, new Date(), 8, org.timeZone);

  return (
    <section className="card">
      <h2>Attendance</h2>
      {marks.length === 0 ? <p className="muted">No attendance recorded yet.</p> : (
        <>
          <p>
            {isCollege
              ? <>Attended <strong>{rate.attended} of {rate.recorded}</strong> classes recorded ({rate.percent}%).</>
              : <>Came in <strong>{weeks} of the last 8 weeks</strong>.</>}
          </p>
          <ul className="plain">
            {marks.slice(0, 5).map((m) => (
              <li key={m.id}>
                <Link to={`/attendance/${org.id}/${m.eventId}`}>{formatDateKey(m.date)}</Link>
                {isCollege && <span className="muted small"> · {ATTENDANCE_STATUS_LABELS[m.status]}</span>}
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}
