import { useMemo, useState, type ReactNode } from 'react';
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

/** Who belongs on the list, for a programme class or a group meeting. */
export interface RosterSpec {
  ids: Set<string>;
  title: string;
  empty: ReactNode;
  /** A short note beside a name, such as "Needs this topic". */
  note?: (personId: string) => string | null;
  /** What happens when someone not on the list is added (for example, enrol them). */
  onAddOther?: (person: Person) => void;
  addLabel?: string;
  /** How a typed name or scanned code finds someone. Defaults to the usual people search. */
  search?: (person: Person, text: string) => boolean;
  /** Pressing Enter with exactly one match marks them present (a keyboard-style code scanner types the code and presses Enter). */
  checkInOnEnter?: boolean;
}

interface Props {
  org: Organization;
  event: ChurchEvent;
  byPerson: Map<string, AttendanceMark>;
  canRecord: boolean;
  /** Without a roster, the list is everyone with the status Student (ADIA classes). */
  roster?: RosterSpec;
  /** Only the people on the list, with no adding others and no links to their records (a trainer's register). */
  rosterOnly?: boolean;
}

/**
 * A class register for ADIA: every student on one screen, one tap each for
 * present, late, absent or excused. Works on a tablet with no internet.
 */
export function ClassRegister({ org, event, byPerson, canRecord, roster: spec, rosterOnly = false }: Props) {
  const { people } = usePeople();
  const toast = useToast();
  const saved = useSavedMessage();
  const [filter, setFilter] = useState('');
  const [extraIds, setExtraIds] = useState<string[]>([]);

  // The class list: students (or the roster given), plus anyone already marked or added here.
  const roster = useMemo(() => {
    const ids = new Set([...byPerson.keys(), ...extraIds, ...(spec?.ids ?? [])]);
    return people
      .filter((p) => p.orgId === org.id && ((!spec && !rosterOnly && p.status === 'student') || ids.has(p.id)))
      .sort((a, b) => a.fullName.localeCompare(b.fullName));
  }, [people, byPerson, extraIds, org.id, spec, rosterOnly]);
  const find = spec?.search ?? matchesSearch;
  const shown = filter.trim().length >= 2 ? roster.filter((p) => find(p, filter)) : roster;
  const others = !rosterOnly && filter.trim().length >= 2
    ? people.filter((p) => p.orgId === org.id && !roster.includes(p) && find(p, filter)).slice(0, 5)
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
        <h2>{spec?.title ?? 'Class register'}</h2>
        <span className="muted small">{roster.length} on the list</span>
      </div>
      <p className="tally">
        {tally.map(([s, n]) => <span key={s} className={`tally-item mark-${s}`}>{ATTENDANCE_STATUS_LABELS[s]} <strong>{n}</strong></span>)}
        <span className="tally-item">Not marked <strong>{unmarked.length}</strong></span>
      </p>
      <input type="search" className="search" placeholder={rosterOnly ? 'Find a student' : spec ? 'Find someone, or add someone not on the list' : 'Find a student, or add someone not on the list'} aria-label="Find someone" value={filter} onChange={(e) => setFilter(e.target.value)}
        onKeyDown={(e) => {
          if (e.key !== 'Enter' || !spec?.checkInOnEnter || !canRecord || filter.trim().length < 2) return;
          e.preventDefault();
          if (shown.length === 1) {
            mark(shown[0]!, 'present');
            toast.show(`${shown[0]!.fullName} marked present`);
            setFilter('');
          } else toast.show(shown.length === 0 ? 'Nobody with that name or code is on this list.' : 'More than one match. Tap the right name.');
        }} />
      {roster.length === 0 && filter.trim().length < 2 && (rosterOnly ? <p className="muted">No students are on this class list yet.</p> : spec ? <p className="muted">{spec.empty}</p> : (
        <p className="muted">No students yet. Add people with the status Student in <Link to="/people/new">People</Link>, or search above to add someone to this class.</p>
      ))}
      <ul className="row-list register">
        {shown.map((p) => {
          const current = statusOf(p);
          return (
            <li key={p.id} className="row register-row">
              {rosterOnly ? (
                <span className="row-main">
                  <span className="row-title">{p.fullName}</span>
                </span>
              ) : (
                <Link to={`/people/${org.id}/${p.id}`} className="row-main">
                  <span className="row-title">{p.fullName}</span>
                  {spec?.note?.(p.id) && <span className="row-detail">{spec.note(p.id)}</span>}
                </Link>
              )}
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
            {others.map((p) => (
              <button key={p.id} type="button" className="chip" onClick={() => { spec?.onAddOther?.(p); setExtraIds((ids) => [...ids, p.id]); setFilter(''); }}>
                {spec?.addLabel ?? 'Add'} {p.fullName}
              </button>
            ))}
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
