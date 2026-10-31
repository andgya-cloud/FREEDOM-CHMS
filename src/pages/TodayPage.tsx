import { useState } from 'react';
import { Link, Navigate } from 'react-router-dom';
import { useAuth } from '../state/AuthContext';
import { useOrg } from '../state/OrgContext';
import { formatDate } from '../../functions/src/shared/datetime';
import { FirstRunChecklist } from '../components/FirstRunChecklist';
import { OrgButtons } from '../components/OrgButtons';
import { HopeAlerts } from '../components/HopeAlerts';
import { QuickSearch } from '../components/QuickSearch';
import { useFollowUpCounts } from '../state/useFollowUps';
import { requestReport, useLatestReport, useReportPart } from '../state/useReports';
import { Scorecard } from '../components/Scorecard';
import { lastCompletePeriod } from '../../functions/src/shared/metrics';
import { localDateKey } from '../../functions/src/shared/datetime';
import type { GivingPart } from '../../functions/src/shared/reports';
import type { Organization } from '../state/OrgContext';
import { lookFor } from '../lib/look';
import { AdiaIcon } from '../components/icons';
import { AdiaToday } from './school/AdiaToday';
import { MinistryToday } from './MinistryToday';
import { SIGNATORY_ROLE_ID } from '../../functions/src/shared/permissions';
import { PETTY_CASH_ORG_TYPES, pettyCashBase } from '../../functions/src/shared/pettyCash';

/**
 * The home screen: search first, then the four big actions.
 * Follow-ups shows how many people are due a message today.
 */
const ACTIONS = [
  { label: 'Check in', to: '/attendance', icon: 'M9 12l2 2 4-4M4 12a8 8 0 1 0 16 0 8 8 0 0 0-16 0' },
  { label: 'Add visitor', to: '/visitors/new', icon: 'M15 19a6 6 0 0 0-12 0M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8M19 8v6M22 11h-6' },
  { label: 'Record Giving', to: '/giving/new', icon: 'M12 3v18M17 7H9.5a2.5 2.5 0 0 0 0 5h5a2.5 2.5 0 0 1 0 5H6' },
  { label: 'Follow-ups', to: '/follow-ups', icon: 'M21 12a8 8 0 0 1-11.8 7L3 21l2-6A8 8 0 1 1 21 12Z' },
] as const;

/** ADIA Training Centre's four tiles. */
const GLASS_ACTIONS = [
  { label: 'Class register', to: '/attendance', icon: '', adia: 'register' },
  { label: 'Add student', to: '/school/students/new', icon: '', adia: 'addStudent' },
  { label: 'Record fees', to: '/school/fees', icon: '', adia: 'fees' },
  { label: 'Exam Records', to: '/school/exams', icon: '', adia: 'exams' },
] as const;

/** Freedom Church's four tiles. An empty icon shows "Ksh." instead. */
const CHURCH_ACTIONS = [ACTIONS[0], ACTIONS[1], { label: 'Record Giving', to: '/giving/new', icon: '' }, ACTIONS[3]] as const;

/** Freedom Hope Center's four tiles. */
const HOPE_ACTIONS = [
  { label: 'Check in', to: '/attendance', icon: ACTIONS[0].icon },
  { label: 'Register child', to: '/hope/children/new', icon: ACTIONS[1].icon },
  { label: 'Record Giving', to: '/giving/new', icon: '' },
  { label: 'Follow-ups', to: '/follow-ups', icon: ACTIONS[3].icon },
] as const;

export function TodayPage() {
  const { profile, can } = useAuth();
  const { current, isCombined, organizations, loading } = useOrg();
  const counts = useFollowUpCounts(current?.id ?? '', current?.timeZone ?? 'Africa/Nairobi');
  const firstName = profile?.displayName.split(' ')[0] ?? '';
  const look = lookFor(current);
  const cockpit = look === 'cockpit';
  const glass = look === 'glass';
  const aurora = look === 'aurora';
  // ADIA, Freedom Church and Hope Center share the side-panel layout; the page underneath is the same.
  const sided = glass || cockpit || aurora;
  const tileActions = aurora ? HOPE_ACTIONS : cockpit ? CHURCH_ACTIONS : GLASS_ACTIONS;
  const allowedTo = (to: string) => (to === '/visitors/new' || to === '/school/students/new' || to === '/hope/children/new' ? can('people.write')
    : to === '/school/fees' ? can('gifts.write') || can('finance.reports') || can('giving.person.read')
    : to === '/attendance' ? can('attendance.write') || can('people.read')
    : to === '/giving/new' ? can('gifts.write')
    : to === '/follow-ups' ? can('followups.manage')
    : to === '/school/exams' ? can('exams.mark') || can('exams.manage') || can('users.manage')
    : true);
  // The principal has no fees access, so ADIA's fees tile is left out rather than greyed.
  const tiles = (tileActions as readonly (typeof tileActions)[number][]).filter((a) => a.to !== '/school/fees' || allowedTo(a.to));

  // The petty cash signatories work in Petty Cash only, so it is their first page.
  if (profile?.roleId === SIGNATORY_ROLE_ID && current && (PETTY_CASH_ORG_TYPES as readonly string[]).includes(current.type)) {
    return <Navigate to={pettyCashBase(current.type)} replace />;
  }

  // ADIA's own Today, from Andy's design (2026-10-26).
  if (glass && current?.type === 'college' && can('people.read')) return <AdiaToday org={current} />;

  // Freedom Church's and Hope's Today, laid out like ADIA's (Andy, 2026-10-31).
  const givingAllowed = can('gifts.write') || can('finance.reports') || can('giving.person.read');
  if ((cockpit || aurora) && current && !isCombined) {
    const figures = can('people.read') || givingAllowed ? (
      <>
        {can('people.read') && <HomeScorecard org={current} />}
        {givingAllowed && <GivingLink />}
      </>
    ) : null;
    return <MinistryToday org={current} hope={aurora} figures={figures} />;
  }

  return (
    <div className={`page${sided ? ' glass-today' : ''}`}>
      <p className="muted">{formatDate(new Date())}</p>
      <h1>{sided ? 'Insight-IQ' : `Hello${firstName ? `, ${firstName}` : ''}`}</h1>
      {!loading && organizations.length > 0 && (
        <p className="lead">{isCombined ? 'All organizations' : current?.name}</p>
      )}

      <OrgButtons />

      {!sided && can('people.read') && organizations.length > 0 && <QuickSearch />}

      <HopeAlerts />
      <FirstRunChecklist />

      {sided && (
        <div className={`glass-tiles${tiles.length === 3 ? ' three' : ''}`}>
          {tiles.map((a) => {
            const ready = organizations.length > 0 && allowedTo(a.to);
            const inner = (
              <>
                {'adia' in a ? <AdiaIcon name={a.adia} /> : a.icon ? <svg viewBox="0 0 24 24" aria-hidden="true"><path d={a.icon} /></svg> : <span className="tile-dollar" aria-hidden="true">Ksh.</span>}
                <span className="tile-text">
                  <span className="tile-label">{a.label}</span>
                  {a.to === '/school/exams' && <span className="tile-sub">Marks and result slips</span>}
                  {a.to === '/follow-ups' && current && <span className="tile-sub">{counts.due === 0 ? 'Nobody due today' : `${counts.due} due today`}</span>}
                </span>
              </>
            );
            return ready
              ? <Link key={a.label} to={a.to} className="glass-tile">{inner}</Link>
              : <button key={a.label} type="button" className="glass-tile" disabled>{inner}</button>;
          })}
        </div>
      )}

      <div className="big-actions">
        {!sided && ACTIONS.map((a) => {
          const allowed = allowedTo(a.to);
          const ready = organizations.length > 0 && allowed;
          return ready ? (
            <Link key={a.label} to={a.to} className="big-action">
              <svg viewBox="0 0 24 24" aria-hidden="true"><path d={a.icon} /></svg>
              <span className="big-action-label">{a.label}</span>
              {a.to === '/follow-ups' && current && (
                <span className="big-action-soon">
                  {counts.due === 0 ? 'Nobody due today' : `${counts.due} due today`}
                  {counts.escalated > 0 && can('users.manage') ? ` · ${counts.escalated} with you` : ''}
                </span>
              )}
            </Link>
          ) : (
            <button key={a.label} type="button" className="big-action" disabled aria-describedby={`soon-${a.to.slice(1).replace('/', '-')}`}>
              <svg viewBox="0 0 24 24" aria-hidden="true"><path d={a.icon} /></svg>
              <span className="big-action-label">{a.label}</span>
              <span id={`soon-${a.to.slice(1).replace('/', '-')}`} className="big-action-soon">{organizations.length === 0 ? 'Add an organization first' : 'Not part of your access'}</span>
            </button>
          );
        })}
      </div>

      {current?.type === 'college' && can('people.read') ? <AdiaToday org={current} />
        : current && can('people.read') && <HomeScorecard org={current} />}

      {current?.type !== 'college' && organizations.length > 0 && givingAllowed && <GivingLink />}

      {!loading && organizations.length === 0 && (
        <div className="notice">
          <p>No organizations are set up for your account yet.</p>
          {profile?.permissions.includes('settings.manage') && profile.allOrgs
            ? <Link className="btn btn-primary" to="/settings/organizations/new">Add an organization</Link>
            : <p className="muted">Ask the pastor to give you access.</p>}
        </div>
      )}
    </div>
  );
}

function GivingLink() {
  return (
    <ul className="link-list">
      <li>
        <Link to="/giving">
          <span className="link-title">Giving</span>
          <span className="link-detail">Import the M-Pesa statement, Unassigned payments, receipts and reports</span>
        </Link>
      </li>
    </ul>
  );
}

/** Last week's numbers from the latest weekly report, each opening the records behind it. */
function HomeScorecard({ org }: { org: Organization }) {
  const { user, can } = useAuth();
  const { report, loading } = useLatestReport(org.id);
  const giving = useReportPart<GivingPart>(org.id, report?.id ?? '', 'giving', can('finance.reports'), report?.generatedAt?.toMillis());
  const [asked, setAsked] = useState(false);
  if (loading) return null;
  return (
    <section className="stack">
      <div className="page-head">
        <h2>{report ? report.label : 'Scorecard'}</h2>
        <span className="row-actions">
          {report && <Link to="/dashboard" className="btn btn-primary">Dashboard</Link>}
          <Link to="/reports" className="btn btn-quiet">All reports</Link>
        </span>
      </div>
      {report ? <Scorecard report={report} giving={giving} base={`/reports/${org.id}/${report.id}`} /> : (
        <div className="card stack">
          <p>The scorecard appears here after the first weekly report, made every Monday at 07:00.</p>
          <button
            type="button"
            className="btn btn-primary align-start"
            disabled={asked || !user}
            onClick={() => { setAsked(true); requestReport(org.id, user!.uid, 'weekly', lastCompletePeriod('weekly', localDateKey(new Date(), org.timeZone)).from); }}
          >
            {asked ? 'Making it…' : "Make last week's report now"}
          </button>
        </div>
      )}
    </section>
  );
}
