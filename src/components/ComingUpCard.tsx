import { useEffect, useMemo, type CSSProperties } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../state/AuthContext';
import type { Organization } from '../state/OrgContext';
import { expandEvents, orgColour, useCalendarEvents } from '../state/useCalendar';
import { refreshPush } from '../lib/push';
import { localDateKey } from '../../functions/src/shared/datetime';
import { addDays, dayLabel, EVENT_TYPE_INFO } from '../../functions/src/shared/calendar';
import '../pages/calendar/calendar.css';

/**
 * "Coming up" on Today (Andy, 2026-11-14): this place's events in the next seven days, and invitations waiting for
 * an answer. Hidden when there is nothing, apart from a quiet link to the calendar.
 */
export function ComingUpCard({ org }: { org: Organization }) {
  const { profile } = useAuth();
  const ids = useMemo(() => [org.id], [org.id]);
  const { events } = useCalendarEvents(ids);
  const today = localDateKey(new Date(), org.timeZone || 'Africa/Nairobi');
  useEffect(() => { refreshPush(profile?.uid); }, [profile?.uid]);
  const items = expandEvents(events, today, addDays(today, 6)).slice(0, 5);
  const uid = profile?.uid ?? '';
  const invites = events.filter((e) => e.invited?.includes(uid) && !e.responses?.[uid] && e.endsOn >= today).length;

  if (!items.length && !invites) {
    return <p className="small muted cal-today-link"><Link to="/calendar">📅 Calendar</Link> · nothing in the next seven days.</p>;
  }
  return (
    <section className="card cal-today-card stack" aria-label="Coming up">
      <div className="card-head">
        <h2>📅 Coming up</h2>
        <Link to="/calendar" className="btn btn-quiet">Open calendar</Link>
      </div>
      {invites > 0 && <p className="small"><b>✉️ {invites === 1 ? '1 invitation' : `${invites} invitations`} to answer.</b> Open {invites === 1 ? 'it' : 'them'} in the calendar.</p>}
      <ul>
        {items.map((it) => (
          <li key={it.key}>
            <Link to={`/calendar?event=${it.event?.id ?? ''}&day=${it.date}`} className="cal-row" style={{ '--ev': EVENT_TYPE_INFO[it.type].colour, '--org': orgColour(org) } as CSSProperties}>
              <span className="cal-row-time">{it.date === today ? 'Today' : it.date === addDays(today, 1) ? 'Tomorrow' : dayLabel(it.date, false).slice(0, 3)}</span>
              <span className="cal-row-main">
                <b>{EVENT_TYPE_INFO[it.type].icon} {it.title}</b>
                <small>{[it.allDay ? 'All day' : it.start, it.place].filter(Boolean).join(' · ')}</small>
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
