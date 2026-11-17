import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import type { Organization } from '../state/OrgContext';
import { useHostManager, useHostSettings, useRota } from '../lib/serviceHosts';
import { localDateKey } from '../../functions/src/shared/datetime';
import { addDays, clock, dayLabel, plannedDates, TEAM_INFO, type RotaSlot, type Team } from '../../functions/src/shared/serviceHosts';
import '../pages/serviceHosts/serviceHosts.css';

/** The next two weeks of one team's schedule (Service hosts or Sunday prayer), for the church's Today (11A). */
function useComing(team: Team, org: Organization) {
  const manager = useHostManager();
  const tz = org.timeZone || 'Africa/Nairobi';
  const today = localDateKey(new Date(), tz);
  const to = addDays(today, 14);
  const church = org.type === 'church_campus';
  const settings = useHostSettings(team, church ? org.id : '', org.serviceTimes, manager);
  const rota = useRota(team, church ? org.id : '', today, to);
  return useMemo(() => {
    const byId = new Map(rota.map((r) => [r.id, r]));
    // A schedule nobody has started yet stays out of sight.
    const started = rota.length > 0;
    // Andy's leaders also see the empty dates; everyone else sees the dates that have someone.
    const dates = !started ? [] : manager
      ? plannedDates(settings, today, 2).map((d) => ({ ...d, slot: byId.get(d.id) as RotaSlot | undefined }))
      : rota.filter((r) => r.status === 'set').sort((a, b) => a.date.localeCompare(b.date) || a.time.localeCompare(b.time)).map((r) => ({ ...r, slot: r as RotaSlot | undefined }));
    return { manager, today, dates, rota, started };
  }, [manager, settings, rota, today]);
}

function TeamRows({ team, dates }: { team: Team; dates: ReturnType<typeof useComing>['dates'] }) {
  return (
    <ul>
      {dates.slice(0, 4).map((d) => {
        const s = d.slot?.status === 'set' ? d.slot : null;
        return (
          <li key={`${team}${d.id}`}>
            <span><strong>{dayLabel(d.date, false)}</strong> <span className="muted small">{d.serviceName}{d.time ? ` · ${clock(d.time)}` : ''}</span></span>
            <span>{s ? <>{s.hostName} {s.answer === 'yes' ? <span className="badge sh-yes">✓</span> : s.answer === 'no' ? <span className="badge sh-no">Can't</span> : <span className="badge sh-wait">Waiting</span>}</> : <span className="muted">Nobody yet</span>}</span>
          </li>
        );
      })}
    </ul>
  );
}

/** One card for both schedules: who hosts and who leads prayer in the next two weeks. */
export function ServiceHostCard({ org }: { org: Organization }) {
  const host = useComing('host', org);
  const prayer = useComing('prayer', org);
  const teams = ([['host', host], ['prayer', prayer]] as const).filter(([, c]) => c.dates.length);
  if (!teams.length) return null;
  return (
    <section className="card sh-today" aria-label="Sunday leaders">
      {teams.map(([team, c]) => (
        <div key={team}>
          <div className="card-head">
            <h2>{TEAM_INFO[team].icon} {TEAM_INFO[team].title}</h2>
            {c.manager && <Link className="btn btn-small" to={TEAM_INFO[team].page}>Plan</Link>}
          </div>
          <TeamRows team={team} dates={c.dates} />
        </div>
      ))}
    </section>
  );
}

type Need = { key: string; icon: string; count: number; label: string; tone: 'red' | 'gold' | 'blue'; to: string };

function needsOf(team: Team, c: ReturnType<typeof useComing>): Need[] {
  if (!c.manager || !c.started) return [];
  const t = TEAM_INFO[team];
  const who = team === 'prayer' ? 'prayer leader' : 'service host';
  const out: Need[] = [];
  const cant = c.rota.filter((r) => r.status === 'set' && r.answer === 'no' && r.date >= c.today).length;
  if (cant) out.push({ key: `${team}-cant`, icon: t.icon, count: cant, label: cant === 1 ? `${who} can't come. Choose another` : `${who}s can't come. Choose others`, tone: 'red', to: t.page });
  const empty = c.dates.filter((d) => (!d.slot || d.slot.status !== 'set') && d.date <= addDays(c.today, 7)).length;
  if (empty) out.push({ key: `${team}-empty`, icon: t.icon, count: empty, label: empty === 1 ? `date this week has no ${who} yet` : `dates this week have no ${who} yet`, tone: 'gold', to: t.page });
  const wa = c.rota.filter((r) => r.remindedOn === c.today && r.waOn !== c.today).length;
  if (wa) out.push({ key: `${team}-wa`, icon: '💬', count: wa, label: wa === 1 ? `${who} reminder to send on WhatsApp` : `${who} reminders to send on WhatsApp`, tone: 'blue', to: t.page });
  return out;
}

/** Lines for "Needs you today" (Andy's leaders only): someone can't come, dates with nobody, WhatsApp reminders to send. */
export function useHostNeeds(org: Organization): Need[] {
  const host = useComing('host', org);
  const prayer = useComing('prayer', org);
  if (org.type !== 'church_campus') return [];
  return [...needsOf('host', host), ...needsOf('prayer', prayer)];
}
