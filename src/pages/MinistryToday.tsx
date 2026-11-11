import { useAuth } from '../state/AuthContext';
import { useFollowUpCounts } from '../state/useFollowUps';
import { useLatestReport } from '../state/useReports';
import { SceneVideo } from '../components/SceneVideo';
import { firstNameOf, timeGreeting } from '../components/Greeting';
import { FirstRunChecklist } from '../components/FirstRunChecklist';
import { HopeToday } from './hope/HopeToday';
import { PoweredBy } from '../components/PoweredBy';
import { CelebrationsCard, SundayCard } from './ChurchSunday';
import { NeedsTodayCard } from '../components/NeedsToday';
import type { Organization } from '../state/OrgContext';

/**
 * Freedom Church's Today (Andy, 2026-11-11, 3A): a slim greeting, Getting started until it is done, then one short
 * "Needs you today" list, the Sunday card and one Celebrations card. Freedom Hope Center has its own Today.
 */
export function MinistryToday({ org, hope }: { org: Organization; hope: boolean }) {
  const { profile, can } = useAuth();
  const tz = org.timeZone || 'Africa/Nairobi';
  const counts = useFollowUpCounts(can('followups.manage') ? org.id : '', tz);
  if (hope) return <HopeToday org={org} />;
  const first = firstNameOf(profile?.displayName);
  const greet = `${timeGreeting(tz)}${first ? `, ${first}` : ''}`;
  const due = !can('followups.manage') ? '' : counts.due === 0 ? 'Nobody is due a follow-up today.' : `${counts.due} ${counts.due === 1 ? 'follow-up is' : 'follow-ups are'} due today.`;
  return (
    <div className="page lav-today church-today">
      <section className="card lav-hero lav-hero-slim">
        <div className="lav-hero-text">
          <span className="lav-eyebrow"><i aria-hidden="true" />{new Intl.DateTimeFormat('en-GB', { weekday: 'long', day: 'numeric', month: 'long', timeZone: tz }).format(new Date())}</span>
          <h1 className="lav-greet">{greet}</h1>
          <p className="lav-org"><em>{org.name}</em></p>
          <p><ChurchSummary orgId={org.id} due={due} /></p>
        </div>
        <div className="lav-scene lav-scene-slim"><SceneVideo name="church-scene" /></div>
      </section>
      <FirstRunChecklist />
      <NeedsTodayCard org={org} />
      <SundayCard org={org} />
      <CelebrationsCard org={org} />
      <PoweredBy />
    </div>
  );
}

/** "45 came on average last week. 3 follow-ups are due today." from the latest weekly report. */
function ChurchSummary({ orgId, due }: { orgId: string; due: string }) {
  const { report } = useLatestReport(orgId);
  const n = report?.headlines.current.attendance;
  return <>{n != null ? `${Math.round(n)} came to the service last week. ` : 'Take attendance on Sunday to start the weekly figures. '}{due}</>;
}
