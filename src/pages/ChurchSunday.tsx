import { collection, query, where } from 'firebase/firestore';
import { Link } from 'react-router-dom';
import { db } from '../firebase';
import { useAuth } from '../state/AuthContext';
import { usePeople, type Person } from '../state/PeopleContext';
import { useDayAttendance, useEvents } from '../state/useAttendance';
import { useGiftsBetween } from '../state/useGiving';
import { useLiveQuery } from '../lib/useQuery';
import type { Organization } from '../state/OrgContext';
import { attended, headcountTotal } from '../../functions/src/shared/attendance';
import { formatMoney } from '../../functions/src/shared/giving';
import { birthdayLabel, upcomingBirthdays } from '../../functions/src/shared/people';
import { formatDateKey, localDateKey, zonedParts } from '../../functions/src/shared/datetime';

const DAY = 86_400_000;
const keyDaysAgo = (todayKey: string, n: number) => new Date(Date.parse(`${todayKey}T00:00:00Z`) - n * DAY).toISOString().slice(0, 10);

/** Today's date key and, on Sunday or Monday, the Sunday the card is about. */
export function sundayFor(tz: string, now = new Date()): { today: string; sunday: string | null; isSunday: boolean } {
  const today = localDateKey(now, tz);
  const weekday = zonedParts(now, tz).weekday; // 7 = Sunday
  if (weekday === 7) return { today, sunday: today, isSunday: true };
  if (weekday === 1) return { today, sunday: keyDaysAgo(today, 1), isSunday: false };
  return { today, sunday: null, isSunday: false };
}

interface PipelineRow { personId: string; status: string; deletedAt?: unknown }

/**
 * Sunday mode and the Sunday summary in one card (Andy, 2026-10-31, 4A 5A). On Sunday it sits above the jobs with
 * the live count and a big Check in; on Monday it shows yesterday's figures. Either day, one tap sends the summary
 * to the leaders on WhatsApp from the user's own phone (nothing is sent automatically).
 */
export function SundayCard({ org }: { org: Organization }) {
  const { can } = useAuth();
  const { people } = usePeople();
  const tz = org.timeZone || 'Africa/Nairobi';
  const { sunday, isSunday } = sundayFor(tz);
  const day = sunday ?? '';
  const seeNames = can('people.read') || can('attendance.write');
  const seeGiving = can('giving.person.read');
  const seePastoral = can('pastoral.read');

  const { events } = useEvents(day ? org.id : '', day);
  const { marks } = useDayAttendance(org.id, day, !!day && seeNames);
  const { gifts } = useGiftsBetween(org.id, day, day, !!day && seeGiving);
  const salvations = useLiveQuery<PipelineRow>(
    () => (day && seePastoral
      ? query(collection(db, 'organizations', org.id, 'pipeline'), where('stageId', '==', 'salvation'), where('date', '==', day))
      : null),
    [org.id, day, seePastoral],
  ).rows.filter((r) => !r.deletedAt && r.status === 'completed');

  if (!day) return null;

  // Each service counts its headcount, or the people checked in when no headcount was typed (as in the reports).
  const services = events.filter((e) => e.date === day && e.type === 'service' && !e.programId && !e.groupId);
  const checkedIn = new Map<string, number>();
  for (const m of marks) if (attended(m.status)) checkedIn.set(m.eventId, (checkedIn.get(m.eventId) ?? 0) + 1);
  const came = services.reduce((sum, e) => sum + (headcountTotal(e.headcounts, 'service') || checkedIn.get(e.id) || 0), 0);
  const firstTimers = people.filter((p) => p.orgId === org.id && p.firstVisitDate === day).length;
  const givingCents = gifts.filter((g) => g.status !== 'void').reduce((s, g) => s + g.amountCents, 0);

  const figures: [string, string][] = [[isSunday ? 'Came so far' : 'Came', String(came)], ['First-timers', String(firstTimers)]];
  if (seePastoral) figures.push(['Salvations', String(salvations.length)]);
  if (seeGiving) figures.push(['Giving', formatMoney(givingCents)]);

  const text = [
    `${org.name}, Sunday ${formatDateKey(day)}`,
    ...figures.map(([k, v]) => `${k === 'Came so far' ? 'Came' : k}: ${v}`),
    'Sent from Insight-IQ',
  ].join('\n');

  return (
    <section className={`card sunday-card${isSunday ? ' sunday-live' : ''}`} aria-label="Sunday">
      <div className="sunday-head">
        <h2>{isSunday ? "Today's service" : "Yesterday's service"}</h2>
        {isSunday && <span className="sunday-dot">Live</span>}
      </div>
      <dl className="sunday-figs">
        {figures.map(([k, v]) => <div key={k}><dd>{v}</dd><dt>{k}</dt></div>)}
      </dl>
      <div className="sunday-actions">
        {isSunday && (can('attendance.write') || can('people.read')) && <Link className="btn btn-primary" to="/attendance">Check in</Link>}
        <a className="btn" href={`https://wa.me/?text=${encodeURIComponent(text)}`} target="_blank" rel="noopener noreferrer">Send to leaders on WhatsApp</a>
      </div>
    </section>
  );
}

/** Birthdays this week with a greeting the user sends from their own WhatsApp (Andy, 2026-10-31, 2A). */
export function BirthdaysCard({ org }: { org: Organization }) {
  const { can } = useAuth();
  const { people, byId } = usePeople();
  if (!can('people.read')) return null;
  const tz = org.timeZone || 'Africa/Nairobi';
  const today = localDateKey(new Date(), tz);
  const found = upcomingBirthdays(people.filter((p) => p.orgId === org.id && p.status !== 'inactive'), today);
  if (!found.length) return null;

  const when = (n: number, p: Person) => (n === 0 ? 'Today' : n === 1 ? 'Tomorrow' : birthdayLabel(p.birthday!));
  const phoneFor = (p: Person) => {
    const to = p.status === 'child' && p.guardianId ? byId(p.guardianId) ?? p : p;
    return to.whatsappConsent?.stoppedAt ? null : (to.whatsapp || null);
  };
  const greeting = (p: Person) => p.status === 'child'
    ? `Happy birthday to ${p.firstName}! The ${org.name} family is celebrating with you today. God bless!`
    : `Happy birthday, ${p.firstName}! The ${org.name} family is celebrating you today. May God bless you richly this new year.`;

  return (
    <section className="card birthdays-card" aria-label="Birthdays this week">
      <h2>Birthdays this week</h2>
      <ul className="row-list">
        {found.map(({ person: p, daysAway }) => {
          const wa = phoneFor(p);
          return (
            <li key={p.id} className="birthday-row">
              <Link to={`/people/${p.orgId}/${p.id}`}><b>{p.fullName}</b> <span className="muted small">{when(daysAway, p)}</span></Link>
              {wa && <a className="btn btn-small" href={`https://wa.me/${wa.replace(/\D/g, '')}?text=${encodeURIComponent(greeting(p))}`} target="_blank" rel="noopener noreferrer">WhatsApp greeting</a>}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
