import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { usePeople, type Person } from '../state/PeopleContext';
import { useToast } from '../state/ToastContext';
import type { AttendanceMark, ChurchEvent } from '../state/useAttendance';
import type { Organization } from '../state/OrgContext';
import { markAttendance, markMany } from '../lib/attendanceWrites';
import { friendlyError } from '../lib/errors';
import { useSavedMessage } from '../lib/useSavedMessage';
import { ATTENDANCE_STATUSES, ATTENDANCE_STATUS_LABELS, type AttendanceStatus } from '../../functions/src/shared/attendance';
import { matchesSearch } from '../../functions/src/shared/people';

interface Props {
  org: Organization;
  event: ChurchEvent;
  byPerson: Map<string, AttendanceMark>;
  canRecord: boolean;
}

/**
 * A class register for ADIA: every student on one screen, one tap each for
 * present, late, absent or excused. Works on a tablet with no internet.
 */
export function ClassRegister({ org, event, byPerson, canRecord }: Props) {
  const { people } = usePeople();
  const toast = useToast();
  const saved = useSavedMessage();
  const [filter, setFilter] = useState('');
  const [extraIds, setExtraIds] = useState<string[]>([]);

  // The class list: students, plus anyone already marked or added for this class.
  const roster = useMemo(() => {
    const ids = new Set([...byPerson.keys(), ...extraIds]);
    return people
      .filter((p) => p.orgId === org.id && (p.status === 'student' || ids.has(p.id)))
      .sort((a, b) => a.fullName.localeCompare(b.fullName));
  }, [people, byPerson, extraIds, org.id]);
  const shown = filter.trim().length >= 2 ? roster.filter((p) => matchesSearch(p, filter)) : roster;
  const others = filter.trim().length >= 2
    ? people.filter((p) => p.orgId === org.id && !roster.includes(p) && matchesSearch(p, filter)).slice(0, 5)
    : [];
  const statusOf = (p: Person): AttendanceStatus | null => {
    const m = byPerson.get(p.id);
    return m && !m.deletedAt ? m.status : null;
  };
  const unmarked = roster.filter((p) => !statusOf(p));
  const tally = ATTENDANCE_STATUSES.map((s) => [s, roster.filter((p) => statusOf(p) === s).length] as const);

  function mark(p: Person, status: AttendanceStatus) {
    markAttendance(org.id, event, p.id, status, 'register', byPerson.get(p.id)).catch((err) => toast.show(friendlyError(err)));
  }

  function markRest(status: AttendanceStatus) {
    if (!unmarked.length) return;
    markMany(org.id, event, unmarked.map((p) => ({ personId: p.id, existing: byPerson.get(p.id) })), status)
      .catch((err) => toast.show(friendlyError(err)));
    toast.show(saved(`${unmarked.length} marked ${ATTENDANCE_STATUS_LABELS[status].toLowerCase()}`));
  }

  return (
    <section className="card">
      <div className="card-head">
        <h2>Class register</h2>
        <span className="muted small">{roster.length} on the list</span>
      </div>
      <p className="tally">
        {tally.map(([s, n]) => <span key={s} className={`tally-item mark-${s}`}>{ATTENDANCE_STATUS_LABELS[s]} <strong>{n}</strong></span>)}
        <span className="tally-item">Not marked <strong>{unmarked.length}</strong></span>
      </p>
      <input type="search" className="search" placeholder="Find a student, or add someone not on the list" aria-label="Find a student" value={filter} onChange={(e) => setFilter(e.target.value)} />
      {roster.length === 0 && filter.trim().length < 2 && (
        <p className="muted">No students yet. Add people with the status Student in <Link to="/people/new">People</Link>, or search above to add someone to this class.</p>
      )}
      <ul className="row-list register">
        {shown.map((p) => {
          const current = statusOf(p);
          return (
            <li key={p.id} className="row register-row">
              <Link to={`/people/${org.id}/${p.id}`} className="row-main"><span className="row-title">{p.fullName}</span></Link>
              <div className="segmented marks" role="group" aria-label={`Mark ${p.fullName}`}>
                {ATTENDANCE_STATUSES.map((s) => (
                  <button key={s} type="button" disabled={!canRecord} className={`mark-${s} ${current === s ? 'on' : ''}`} aria-pressed={current === s} onClick={() => mark(p, s)}>
                    {ATTENDANCE_STATUS_LABELS[s]}
                  </button>
                ))}
              </div>
            </li>
          );
        })}
      </ul>
      {others.length > 0 && canRecord && (
        <div>
          <p className="muted small">Not on the class list:</p>
          <div className="chips">
            {others.map((p) => <button key={p.id} type="button" className="chip" onClick={() => { setExtraIds((ids) => [...ids, p.id]); setFilter(''); }}>Add {p.fullName}</button>)}
          </div>
        </div>
      )}
      {canRecord && unmarked.length > 0 && (
        <div className="register-actions">
          <button type="button" className="btn btn-primary" onClick={() => markRest('present')}>Mark the other {unmarked.length} present</button>
          <button type="button" className="btn" onClick={() => markRest('absent')}>Mark the other {unmarked.length} absent</button>
        </div>
      )}
    </section>
  );
}
