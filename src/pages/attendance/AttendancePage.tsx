import { useSchool } from '../../state/useSchool';
import { useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../../state/AuthContext';
import { useOrg } from '../../state/OrgContext';
import { useToast } from '../../state/ToastContext';
import { useClassEvents, useEvents } from '../../state/useAttendance';
import { createEvent } from '../../lib/attendanceWrites';
import { friendlyError } from '../../lib/errors';
import { formatDateKey, localDateKey } from '../../../functions/src/shared/datetime';
import { PRINCIPAL_ROLE_ID, TRAINER_ROLE_ID } from '../../../functions/src/shared/permissions';
import {
  EVENT_TYPE_LABELS,
  eventChoices,
  eventIdFor,
  eventTypeFor,
  headcountTotal,
} from '../../../functions/src/shared/attendance';

const RECENT_DAYS = 56;
/** ADIA's registers go back to 1 August 2025, and only the pastor, Admin and the Principal fill in past days (Andy, 2026-10-26, 2A and 3B). */
const ADIA_FIRST_DAY = '2025-08-01';
const BACKDATE_ROLES = ['pastor', 'admin', PRINCIPAL_ROLE_ID];
const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

/** "2025-08" to the month before `today`'s, newest first. */
function monthsSince(first: string, today: string): string[] {
  const out: string[] = [];
  let [y, m] = today.slice(0, 7).split('-').map(Number);
  const [fy, fm] = first.slice(0, 7).split('-').map(Number);
  while (y > fy || (y === fy && m >= fm)) {
    out.push(`${y}-${String(m).padStart(2, '0')}`);
    if (--m === 0) { m = 12; y--; }
  }
  return out;
}
const monthLabel = (ym: string) => `${MONTH_NAMES[Number(ym.slice(5, 7)) - 1]} ${ym.slice(0, 4)}`;

/**
 * Attendance home: open today's service, class or session in one tap, or
 * pick up one already open. Works offline; everything syncs later.
 */
export function AttendancePage() {
  const { can, profile } = useAuth();
  const { current, isCombined, organizations, select } = useOrg();
  const toast = useToast();
  const navigate = useNavigate();
  const orgId = current?.id ?? '';
  const tz = current?.timeZone;
  const today = localDateKey(new Date(), tz);
  const [date, setDate] = useState(today);
  const [otherName, setOtherName] = useState('');
  const [month, setMonth] = useState('');
  const recentStart = localDateKey(new Date(Date.now() - RECENT_DAYS * 86_400_000), tz);
  const since = [recentStart, date, month ? `${month}-01` : recentStart].sort()[0];
  // A trainer sees and marks only their department's classes, today or yesterday (Andy, 2026-10-26 and 2026-10-28, 4B).
  // They may read only those classes, so each is asked for by name.
  const trainer = profile?.roleId === TRAINER_ROLE_ID;
  const myClasses = profile?.registerClasses ?? [];
  const all = useEvents(trainer ? '' : orgId, since);
  const mine = useClassEvents(trainer ? orgId : '', myClasses);
  const loaded = trainer ? mine.events : all.events;
  const loading = trainer ? mine.loading : all.loading;
  const events = loaded.filter((e) => (month ? e.date.startsWith(month) : e.date >= recentStart) && (!trainer || (e.type === 'class' && myClasses.includes(e.name))));
  const canRecord = can('attendance.write') || (trainer && myClasses.length > 0);
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
  const choices = trainer ? myClasses : [...new Set([...school.courses.filter((c) => c.active !== false).map((c) => c.name), ...eventChoices(org)])];
  const todays = loaded.filter((e) => e.date === date);
  const adia = org.type === 'college';
  const canBackdate = !trainer && (!adia || BACKDATE_ROLES.includes(profile?.roleId ?? ''));
  const firstDay = adia ? ADIA_FIRST_DAY : undefined;
  const yesterday = localDateKey(new Date(Date.now() - 86_400_000), tz);
  const noun = org.type === 'church_campus' ? 'service' : org.type === 'college' ? 'class' : 'session';

  function open(name: string) {
    const clean = name.trim().replace(/\s+/g, ' ');
    if (!clean) return;
    const id = eventIdFor(date, clean);
    if (!loaded.some((e) => e.id === id)) {
      try {
        const { synced } = createEvent(org.id, { date, type: trainer ? 'class' : eventTypeFor(org.type, clean), name: clean, activity: org.type === 'church_campus' ? null : clean });
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
          {adia ? (
            <>
              <h2>Take attendance</h2>
              {canBackdate ? (
                <div className="which-day" role="group" aria-label="Which day?">
                  <span className="which-day-label">Which day?</span>
                  <button type="button" className={`chip${date === today ? ' chip-on' : ''}`} aria-pressed={date === today} onClick={() => setDate(today)}>Today</button>
                  <button type="button" className={`chip${date === yesterday ? ' chip-on' : ''}`} aria-pressed={date === yesterday} onClick={() => setDate(yesterday)}>Yesterday</button>
                  <label className="which-day-pick">
                    <span className="visually-hidden">Another day</span>
                    <input type="date" value={date} min={firstDay} max={today} onChange={(e) => setDate(e.target.value && (!firstDay || e.target.value >= firstDay) && e.target.value <= today ? e.target.value : today)} />
                  </label>
                </div>
              ) : trainer ? (
                <div className="which-day" role="group" aria-label="Which day?">
                  <span className="which-day-label">Which day?</span>
                  <button type="button" className={`chip${date === today ? ' chip-on' : ''}`} aria-pressed={date === today} onClick={() => setDate(today)}>Today</button>
                  <button type="button" className={`chip${date === yesterday ? ' chip-on' : ''}`} aria-pressed={date === yesterday} onClick={() => setDate(yesterday)}>Yesterday</button>
                </div>
              ) : <p className="muted small">For today, {formatDateKey(today)}.</p>}
            </>
          ) : (
            <div className="card-head">
              <h2>Take attendance</h2>
              <label className="date-pick">
                <span className="visually-hidden">Date</span>
                <input type="date" value={date} max={today} onChange={(e) => setDate(e.target.value || today)} />
              </label>
            </div>
          )}
          {date !== today && <p className="which-day-note">Filling in the register for <strong>{formatDateKey(date)}</strong>, not today.</p>}
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
          {!trainer && <>
          <form className="input-with-button" onSubmit={openOther}>
            <input placeholder={`Another ${noun}, for example ${org.type === 'church_campus' ? 'Youth night' : org.type === 'college' ? 'ICT make-up class' : 'Holiday club'}`} value={otherName} onChange={(e) => setOtherName(e.target.value)} aria-label={`Name of another ${noun}`} />
            <button type="submit" className="btn" disabled={!otherName.trim()}>Start</button>
          </form>
          {org.type === 'church_campus' && <p className="hint">Service times come from <Link to={`/settings/organizations/${org.id}`}>the organization settings</Link>.</p>}
          {org.type !== 'church_campus' && <p className="hint">The programme list is in <Link to={`/settings/organizations/${org.id}`}>the organization settings</Link>.</p>}
          </>}
        </section>
      )}

      <section>
        {adia && !trainer ? (
          <div className="card-head">
            <h2>{month ? monthLabel(month) : 'Last 8 weeks'}</h2>
            <label className="field past-month">
              <span className="visually-hidden">Show registers for</span>
              <select value={month} onChange={(e) => setMonth(e.target.value)}>
                <option value="">Last 8 weeks</option>
                {monthsSince(ADIA_FIRST_DAY, today).map((m) => <option key={m} value={m}>{monthLabel(m)}</option>)}
              </select>
            </label>
          </div>
        ) : <h2>{trainer ? 'Your class, last 8 weeks' : 'Last 8 weeks'}</h2>}
        {loading && events.length === 0 ? <p className="muted">Loading…</p> : events.length === 0 ? (
          <p className="muted">{month ? `Nothing recorded in ${monthLabel(month)}.` : 'Nothing recorded yet.'}</p>
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
