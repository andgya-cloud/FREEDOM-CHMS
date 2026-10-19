import { useSchool } from '../../state/useSchool';
import { useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../../state/AuthContext';
import { useOrg } from '../../state/OrgContext';
import { useToast } from '../../state/ToastContext';
import { useEvents } from '../../state/useAttendance';
import { createEvent } from '../../lib/attendanceWrites';
import { friendlyError } from '../../lib/errors';
import { formatDateKey, localDateKey } from '../../../functions/src/shared/datetime';
import {
  EVENT_TYPE_LABELS,
  eventChoices,
  eventIdFor,
  eventTypeFor,
  headcountTotal,
} from '../../../functions/src/shared/attendance';

const RECENT_DAYS = 56;

/**
 * Attendance home: open today's service, class or session in one tap, or
 * pick up one already open. Works offline; everything syncs later.
 */
export function AttendancePage() {
  const { can } = useAuth();
  const { current, isCombined, organizations, select } = useOrg();
  const toast = useToast();
  const navigate = useNavigate();
  const orgId = current?.id ?? '';
  const tz = current?.timeZone;
  const today = localDateKey(new Date(), tz);
  const [date, setDate] = useState(today);
  const [otherName, setOtherName] = useState('');
  const { events, loading } = useEvents(orgId, localDateKey(new Date(Date.now() - RECENT_DAYS * 86_400_000), tz));
  const canRecord = can('attendance.write');
  // ADIA classes are the programmes set up under School, so the register lists that programme's students.
  const school = useSchool(current?.type === 'college' ? current.id : '');

  if (isCombined || !current) {
    return (
      <div className="page narrow">
        <h1>Attendance</h1>
        {organizations.length === 0 ? (
          <p className="muted">Add an organization in Settings first.</p>
        ) : (
          <div className="card">
            <p>Attendance is taken for one organization at a time. Which one?</p>
            <div className="chips">
              {organizations.map((o) => <button key={o.id} type="button" className="chip" onClick={() => select(o.id)}>{o.name}</button>)}
            </div>
          </div>
        )}
      </div>
    );
  }

  const org = current;
  const choices = [...new Set([...school.courses.filter((c) => c.active !== false).map((c) => c.name), ...eventChoices(org)])];
  const todays = events.filter((e) => e.date === date);
  const noun = org.type === 'church_campus' ? 'service' : org.type === 'college' ? 'class' : 'session';

  function open(name: string) {
    const clean = name.trim().replace(/\s+/g, ' ');
    if (!clean) return;
    const id = eventIdFor(date, clean);
    if (!events.some((e) => e.id === id)) {
      try {
        const { synced } = createEvent(org.id, { date, type: eventTypeFor(org.type, clean), name: clean, activity: org.type === 'church_campus' ? null : clean });
        synced.catch((err) => toast.show(friendlyError(err)));
      } catch (err) {
        toast.show(friendlyError(err));
        return;
      }
    }
    navigate(`/attendance/${org.id}/${id}`);
  }

  function openOther(e: FormEvent) {
    e.preventDefault();
    open(otherName);
    setOtherName('');
  }

  return (
    <div className="page narrow">
      <h1>Attendance</h1>

      {canRecord && (
        <section className="card">
          <div className="card-head">
            <h2>Take attendance</h2>
            <label className="date-pick">
              <span className="visually-hidden">Date</span>
              <input type="date" value={date} max={today} onChange={(e) => setDate(e.target.value || today)} />
            </label>
          </div>
          {date !== today && <p className="muted small">For {formatDateKey(date)}, not today.</p>}
          <div className="start-grid">
            {choices.map((name) => {
              const already = todays.some((e) => e.id === eventIdFor(date, name));
              return (
                <button key={name} type="button" className="start-tile" onClick={() => open(name)}>
                  <span className="start-name">{name}</span>
                  <span className="start-hint">{already ? 'Open, carry on' : 'Start'}</span>
                </button>
              );
            })}
          </div>
          <form className="input-with-button" onSubmit={openOther}>
            <input placeholder={`Another ${noun}, for example ${org.type === 'church_campus' ? 'Youth night' : org.type === 'college' ? 'ICT make-up class' : 'Holiday club'}`} value={otherName} onChange={(e) => setOtherName(e.target.value)} aria-label={`Name of another ${noun}`} />
            <button type="submit" className="btn" disabled={!otherName.trim()}>Start</button>
          </form>
          {org.type === 'church_campus' && <p className="hint">Service times come from <Link to={`/settings/organizations/${org.id}`}>the organization settings</Link>.</p>}
          {org.type !== 'church_campus' && <p className="hint">The programme list is in <Link to={`/settings/organizations/${org.id}`}>the organization settings</Link>.</p>}
        </section>
      )}

      <section>
        <h2>Last 8 weeks</h2>
        {loading && events.length === 0 ? <p className="muted">Loading…</p> : events.length === 0 ? (
          <p className="muted">Nothing recorded yet.</p>
        ) : (
          <ul className="link-list">
            {events.map((e) => {
              const counted = headcountTotal(e.headcounts, e.type);
              return (
                <li key={e.id}>
                  <Link to={`/attendance/${org.id}/${e.id}`}>
                    <span className="link-title">{e.name}</span>
                    <span className="link-detail">
                      {formatDateKey(e.date)} · {EVENT_TYPE_LABELS[e.type]}{counted ? ` · ${counted} counted` : ''}
                    </span>
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}
