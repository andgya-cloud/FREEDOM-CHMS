import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import type { Organization } from '../state/OrgContext';
import { useHostManager, useHostSettings, useRota } from '../lib/serviceHosts';
import { localDateKey } from '../../functions/src/shared/datetime';
import { addDays, clock, dayLabel, plannedDates, type RotaSlot } from '../../functions/src/shared/serviceHosts';
import '../pages/serviceHosts/serviceHosts.css';

/** The next two weeks of services and their hosts, for the church's Today (Andy, 2026-11-17, 11A). */
function useComingHosts(org: Organization) {
  const manager = useHostManager();
  const tz = org.timeZone || 'Africa/Nairobi';
  const today = localDateKey(new Date(), tz);
  const to = addDays(today, 14);
  const settings = useHostSettings(org.id, org.serviceTimes, manager);
  const rota = useRota(org.id, today, to);
  return useMemo(() => {
    const byId = new Map(rota.map((r) => [r.id, r]));
    // Everyone else sees the dates that have a host; Andy's leaders also see the empty ones.
    const dates = manager
      ? plannedDates(settings, today, 2).map((d) => ({ ...d, slot: byId.get(d.id) as RotaSlot | undefined }))
      : rota.filter((r) => r.status === 'set').sort((a, b) => a.date.localeCompare(b.date) || a.time.localeCompare(b.time)).map((r) => ({ ...r, slot: r as RotaSlot | undefined }));
    return { manager, today, dates, rota };
  }, [manager, settings, rota, today]);
}

export function ServiceHostCard({ org }: { org: Organization }) {
  const { manager, dates } = useComingHosts(org);
  if (!dates.length) return null;
  return (
    <section className="card sh-today" aria-label="Service hosts">
      <div className="card-head">
        <h2>🎤 Service hosts</h2>
        {manager && <Link className="btn btn-small" to="/service-hosts">Plan</Link>}
      </div>
      <ul>
        {dates.slice(0, 4).map((d) => {
          const s = d.slot?.status === 'set' ? d.slot : null;
          return (
            <li key={d.id}>
              <span><strong>{dayLabel(d.date, false)}</strong> <span className="muted small">{d.serviceName}{d.time ? ` · ${clock(d.time)}` : ''}</span></span>
              <span>{s ? <>{s.hostName} {s.answer === 'yes' ? <span className="badge sh-yes">✓</span> : s.answer === 'no' ? <span className="badge sh-no">Can't</span> : <span className="badge sh-wait">Waiting</span>}</> : <span className="muted">No host yet</span>}</span>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

/** Lines for "Needs you today" (Andy's leaders only): a host who can't come, dates with no host, WhatsApp reminders to send. */
export function useHostNeeds(org: Organization): { key: string; icon: string; count: number; label: string; tone: 'red' | 'gold' | 'blue' }[] {
  const { manager, today, dates, rota } = useComingHosts(org);
  if (!manager || org.type !== 'church_campus') return [];
  const out: { key: string; icon: string; count: number; label: string; tone: 'red' | 'gold' | 'blue' }[] = [];
  const cant = rota.filter((r) => r.status === 'set' && r.answer === 'no' && r.date >= today).length;
  if (cant) out.push({ key: 'host-cant', icon: '🎤', count: cant, label: cant === 1 ? "service host can't come. Choose another" : "service hosts can't come. Choose others", tone: 'red' });
  const noHost = dates.filter((d) => !d.slot || d.slot.status !== 'set').filter((d) => d.date <= addDays(today, 7)).length;
  if (noHost) out.push({ key: 'host-empty', icon: '🎤', count: noHost, label: noHost === 1 ? 'service this week has no host yet' : 'services this week have no host yet', tone: 'gold' });
  const wa = rota.filter((r) => r.remindedOn === today && r.waOn !== today).length;
  if (wa) out.push({ key: 'host-wa', icon: '💬', count: wa, label: wa === 1 ? 'host reminder to send on WhatsApp' : 'host reminders to send on WhatsApp', tone: 'blue' });
  return out;
}
