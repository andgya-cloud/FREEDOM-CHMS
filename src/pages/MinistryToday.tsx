import { Link } from 'react-router-dom';
import { useAuth } from '../state/AuthContext';
import { useFollowUpCounts } from '../state/useFollowUps';
import { useLatestReport } from '../state/useReports';
import { useChildren } from '../state/useHope';
import { SceneVideo } from '../components/SceneVideo';
import { firstNameOf, timeGreeting } from '../components/Greeting';
import { FirstRunChecklist } from '../components/FirstRunChecklist';
import { HopeAlerts } from '../components/HopeAlerts';
import { AdiaIcon, type AdiaIconName } from '../components/icons';
import { PoweredBy } from '../components/PoweredBy';
import { BirthdaysCard, SundayCard, sundayFor } from './ChurchSunday';
import type { Organization } from '../state/OrgContext';
import type { ReactNode } from 'react';

/**
 * Freedom Church's and Freedom Hope Center's Today, laid out like ADIA's (Andy, 2026-10-31, 1C 2A 3A 4A 5A 6B):
 * the greeting with the place's name under it in its own gradient, a short summary, Freedom Church's animated
 * logo or Hope's OneChild video (2026-10-31) with Getting started on it, the four jobs, and the figures folded away.
 */
export function MinistryToday({ org, hope, figures }: { org: Organization; hope: boolean; figures: ReactNode }) {
  const { profile, can } = useAuth();
  const tz = org.timeZone || 'Africa/Nairobi';
  const counts = useFollowUpCounts(org.id, tz);
  const first = firstNameOf(profile?.displayName);
  const greet = `${timeGreeting(tz)}${first ? `, ${first}` : ''}`;
  const due = counts.due === 0 ? 'Nobody is due a follow-up today.' : `${counts.due} ${counts.due === 1 ? 'follow-up is' : 'follow-ups are'} due today.`;

  // On Sunday the service card above carries Check in, so the tile is not repeated (4A).
  const sundayNow = !hope && sundayFor(tz).isSunday;
  const jobs: { to: string; icon: AdiaIconName; label: string; sub: string; show: boolean }[] = [
    { to: '/attendance', icon: 'checkIn', label: 'Check in', sub: hope ? 'Who came to the activity' : 'Who came to the service', show: can('attendance.write') || can('people.read') },
    hope
      ? { to: '/hope/children/new', icon: 'addStudent', label: 'Register child', sub: 'A new child in the programme', show: can('people.write') }
      : { to: '/visitors/new', icon: 'addStudent', label: 'Add visitor', sub: 'A first-time guest', show: can('people.write') },
    { to: '/giving/new', icon: 'gift', label: 'Record Giving', sub: 'M-Pesa, cash or bank', show: can('gifts.write') },
    { to: '/follow-ups', icon: 'chat', label: 'Follow-ups', sub: counts.due === 0 ? 'Nobody due today' : `${counts.due} due today`, show: can('followups.manage') },
  ];

  return (
    <div className="page lav-today">
      <HopeAlerts />
      <section className="card lav-hero">
        <div className="lav-hero-text">
          <span className="lav-eyebrow"><i aria-hidden="true" />{new Intl.DateTimeFormat('en-GB', { weekday: 'long', day: 'numeric', month: 'long', timeZone: tz }).format(new Date())}</span>
          <h1 className="lav-greet">{greet}</h1>
          <p className="lav-org"><em>{org.name}</em></p>
          <p>{hope ? <HopeSummary orgId={org.id} due={due} /> : <ChurchSummary orgId={org.id} due={due} />}</p>
        </div>
        <div className="lav-scene">
          <SceneVideo name={hope ? 'hope-intro' : 'church-scene'} />
          <FirstRunChecklist variant="scene" />
        </div>
      </section>

      {!hope && <SundayCard org={org} />}

      <section className="lav-jobs" aria-label="What do you want to do?">
        <h2>What do you want to do?</h2>
        <div className="lav-jobs-grid">
          {jobs.filter((j) => j.show && !(sundayNow && j.to === '/attendance')).map((j, i) => (
            <Link key={j.to} to={j.to} className="card lav-job">
              <span className={`lav-ico i${(i % 4) + 1}`}><AdiaIcon name={j.icon} /></span>
              <b>{j.label}</b>
              <span className="lav-sub">{j.sub}</span>
            </Link>
          ))}
        </div>
      </section>

      {!hope && <BirthdaysCard org={org} />}

      {figures && (
        <details className="lav-figs">
          <summary><span className="lav-ico small i5"><AdiaIcon name="trend" /></span><b>See figures</b><span className="lav-sub">{hope ? 'Scorecard, giving and reports' : 'Scorecard, attendance, giving and reports'}</span>
            <svg className="lav-caret" viewBox="0 0 24 24" aria-hidden="true"><path d="m9 6 6 6-6 6" /></svg></summary>
          <div className="lav-figs-body">{figures}</div>
        </details>
      )}

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

/** "120 children are registered. 3 follow-ups are due today." */
function HopeSummary({ orgId, due }: { orgId: string; due: string }) {
  const { children, loading } = useChildren(orgId);
  const active = children.filter((c) => c.status !== 'exited').length;
  if (loading) return <>{due}</>;
  return <>{active ? `${active} ${active === 1 ? 'child is' : 'children are'} registered. ` : 'Register the first child to start. '}{due}</>;
}
