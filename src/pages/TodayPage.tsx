import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../state/AuthContext';
import { useOrg } from '../state/OrgContext';
import { usePeople } from '../state/PeopleContext';
import { formatDate } from '../../functions/src/shared/datetime';
import { matchesSearch } from '../../functions/src/shared/people';
import { FirstRunChecklist } from '../components/FirstRunChecklist';
import { OrgButtons } from '../components/OrgButtons';
import { HopeAlerts } from '../components/HopeAlerts';
import { PersonRow } from '../components/PersonRow';
import { useFollowUpCounts } from '../state/useFollowUps';
import { requestReport, useLatestReport, useReportPart } from '../state/useReports';
import { Scorecard } from '../components/Scorecard';
import { lastCompletePeriod } from '../../functions/src/shared/metrics';
import { localDateKey } from '../../functions/src/shared/datetime';
import type { GivingPart } from '../../functions/src/shared/reports';
import type { Organization } from '../state/OrgContext';
import { lookFor } from '../lib/look';

/**
 * The home screen: search first, then the four big actions.
 * Follow-ups shows how many people are due a message today.
 */
const ACTIONS = [
  { label: 'Check in', to: '/attendance', icon: 'M9 12l2 2 4-4M4 12a8 8 0 1 0 16 0 8 8 0 0 0-16 0' },
  { label: 'Add visitor', to: '/visitors/new', icon: 'M15 19a6 6 0 0 0-12 0M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8M19 8v6M22 11h-6' },
  { label: 'Record gift', to: '/giving/new', icon: 'M12 3v18M17 7H9.5a2.5 2.5 0 0 0 0 5h5a2.5 2.5 0 0 1 0 5H6' },
  { label: 'Follow-ups', to: '/follow-ups', icon: 'M21 12a8 8 0 0 1-11.8 7L3 21l2-6A8 8 0 1 1 21 12Z' },
] as const;

const NAV_ICON = 'M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8Zm8.9 5.2-1.9-.4a7 7 0 0 1-.7 1.7l1.1 1.6-1.6 1.6-1.6-1.1a7 7 0 0 1-1.7.7l-.4 1.9h-2.2l-.4-1.9a7 7 0 0 1-1.7-.7l-1.6 1.1-1.6-1.6 1.1-1.6a7 7 0 0 1-.7-1.7l-1.9-.4v-2.2l1.9-.4a7 7 0 0 1 .7-1.7L5.600 6.500l1.600-1.600 1.600 1.100a7 7 0 0 1 1.700-.7l.4-1.900h2.200l.4 1.900a7 7 0 0 1 1.700.7l1.600-1.100 1.600 1.600-1.100 1.600a7 7 0 0 1 .7 1.700l1.900.4z';

export function TodayPage() {
  const { profile, can } = useAuth();
  const { current, isCombined, organizations, loading } = useOrg();
  const { people } = usePeople();
  const counts = useFollowUpCounts(current?.id ?? '', current?.timeZone ?? 'Africa/Nairobi');
  const navigate = useNavigate();
  const [query, setQuery] = useState('');
  const firstName = profile?.displayName.split(' ')[0] ?? '';
  const cockpit = lookFor(current) === 'cockpit';
  const allowedTo = (to: string) => (to === '/visitors/new' ? can('people.write')
    : to === '/attendance' ? can('attendance.write') || can('people.read')
    : to === '/giving/new' ? can('gifts.write')
    : to === '/follow-ups' ? can('followups.manage')
    : true);
  const results = useMemo(() => (query.trim().length >= 2 ? people.filter((p) => matchesSearch(p, query)).slice(0, 8) : []), [people, query]);

  return (
    <div className={`page${cockpit ? ' cockpit-today' : ''}`}>
      <p className="muted">{formatDate(new Date())}</p>
      <h1>Hello{firstName ? `, ${firstName}` : ''}</h1>
      {!loading && organizations.length > 0 && (
        <p className="lead">{isCombined ? 'All organizations' : current?.name}</p>
      )}

      <OrgButtons />

      {can('people.read') && organizations.length > 0 && (
        <form role="search" onSubmit={(e) => { e.preventDefault(); navigate(`/people?q=${encodeURIComponent(query)}`); }}>
          <input
            type="search"
            className="search"
            placeholder="Find anyone by name or phone"
            aria-label="Find a person"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </form>
      )}
      {results.length > 0 && <ul className="row-list">{results.map((p) => <PersonRow key={`${p.orgId}/${p.id}`} person={p} />)}</ul>}
      {query.trim().length >= 2 && results.length === 0 && (
        <p className="muted">Nobody matches. <Link to="/visitors/new">Add as a visitor</Link></p>
      )}

      <HopeAlerts />
      <FirstRunChecklist />

      {cockpit && (
        <nav className="cockpit-dock" aria-label="Quick actions">
          {ACTIONS.map((a) => {
            const ready = organizations.length > 0 && allowedTo(a.to);
            const inner = (
              <>
                <svg viewBox="0 0 24 24" aria-hidden="true"><path d={a.icon} /></svg>
                <span className="dock-label">{a.label}</span>
                {a.to === '/follow-ups' && current && counts.due > 0 && <span className="dock-count">{counts.due} due</span>}
              </>
            );
            return ready
              ? <Link key={a.label} to={a.to} className="dock-btn">{inner}</Link>
              : <button key={a.label} type="button" className="dock-btn" disabled>{inner}</button>;
          })}
          <Link to="/settings" className="dock-btn">
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d={NAV_ICON} /></svg>
            <span className="dock-label">Nav</span>
          </Link>
        </nav>
      )}

      <div className="big-actions">
        {!cockpit && ACTIONS.map((a) => {
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

      {current && can('people.read') && <HomeScorecard org={current} />}

      {organizations.length > 0 && (can('gifts.write') || can('finance.reports') || can('giving.person.read')) && (
        <ul className="link-list">
          <li>
            <Link to="/giving">
              <span className="link-title">Giving</span>
              <span className="link-detail">Import the M-Pesa statement, Unassigned payments, receipts and reports</span>
            </Link>
          </li>
        </ul>
      )}

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
        <Link to="/reports" className="btn btn-quiet">All reports</Link>
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
