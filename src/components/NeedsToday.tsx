import { useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../state/AuthContext';
import type { Organization } from '../state/OrgContext';
import { useFollowUpCounts } from '../state/useFollowUps';
import { usePeople } from '../state/PeopleContext';
import { useWaitingSignups } from '../pages/people/SignupsPage';
import { ReachCard } from '../pages/followups/FollowUpsPage';
import { canKeepAccounts } from '../../functions/src/shared/permissions';
import { useCircleNeeds } from './CircleNeedsYou';
import { useAiToday } from './useAiToday';
import { AI_MARK } from './Ai';
import { useReviewerNotes } from '../lib/reviewerNotes';

interface Row { key: string; icon: string; count?: number; label: string; to?: string; tone: 'red' | 'gold' | 'blue' | 'violet' | 'ai' }

/**
 * Freedom Church's "Needs you today" (Andy, 2026-11-11, 3A): one short list at the top of Today, each line a count
 * you tap. Urgent conversations, new messages, payments to match, sign-ups to approve and people to reach, only the
 * ones your role sees. People to reach opens right here; the others open their page.
 */
export function NeedsTodayCard({ org }: { org: Organization }) {
  const { can, profile } = useAuth();
  const needs = useCircleNeeds(org);
  const ai = useAiToday(org);
  const keeper = canKeepAccounts(profile);
  const { rows: signups } = useWaitingSignups(org.id, keeper);
  const { people } = usePeople();
  const olderSignups = keeper ? people.filter((p) => p.orgId === org.id && p.signup && !p.deletedAt).length : 0;
  const reach = can('followups.manage');
  const counts = useFollowUpCounts(reach ? org.id : '', org.timeZone || 'Africa/Nairobi');
  const [reachOpen, setReachOpen] = useState(false);
  const reviews = useReviewerNotes(can('users.manage')).rows.filter((n) => n.status === 'new').length;

  const rows: Row[] = [];
  if (needs?.reader) {
    const c = needs.circle;
    if (needs.urgent.length) rows.push({ key: 'urgent', icon: '🔴', count: needs.urgent.length, label: needs.urgent.length === 1 ? `urgent conversation about ${needs.urgent[0]!.who}` : 'urgent conversations', to: needs.urgent.length === 1 && needs.urgent[0]!.many === 1 ? `${c.chatsPath}/${needs.urgent[0]!.id}` : c.vaultPath, tone: 'red' });
    if (needs.unread) rows.push({ key: 'unread', icon: '🔒', count: needs.unread, label: 'private conversations with new messages', to: c.vaultPath, tone: 'violet' });
    if (needs.fresh.length) rows.push({ key: 'fresh', icon: '📷', count: needs.fresh.length, label: 'photos and wins with new messages', to: c.photosPath, tone: 'blue' });
    if (needs.incidents) rows.push({ key: 'incidents', icon: '⚠️', count: needs.incidents, label: needs.incidents === 1 ? 'incident not resolved yet' : 'incidents not resolved yet', to: c.photosPath, tone: 'gold' });
  }
  if (signups.length) rows.push({ key: 'signups', icon: '📝', count: signups.length, label: signups.length === 1 ? 'family sign-up to approve' : 'family sign-ups to approve', to: '/people/signups', tone: 'red' });
  else if (olderSignups) rows.push({ key: 'older', icon: '📝', count: olderSignups, label: olderSignups === 1 ? 'new sign-up to check' : 'new sign-ups to check', to: '/people?status=signup', tone: 'blue' });
  if (reviews) rows.push({ key: 'reviews', icon: '✍️', count: reviews, label: reviews === 1 ? 'new review from a reviewer' : 'new reviews from reviewers', to: '/reviews', tone: 'gold' });
  ai.forEach((a) => rows.push({ key: a.to, icon: AI_MARK, label: a.text, to: a.to, tone: 'ai' }));

  const staffSend = needs && !needs.reader && needs.sends;
  if (!needs && !reach && !rows.length) return null;
  const nothing = rows.length === 0 && (!reach || counts.due === 0);

  return (
    <section className="card needs-today" aria-label="Needs you today">
      <div className="card-head">
        <h2>Needs you today</h2>
        {needs?.reader && (
          <span className="nt-pills">
            <Link className="nu-pill" to={`${needs.circle.photosPath}?new=1`}>📷 New report</Link>
            <Link className="nu-pill" to={needs.circle.vaultPath}>🔒 Conversations</Link>
          </span>
        )}
      </div>
      {nothing ? (
        <p className="nt-done">✅ Nothing needs you right now. Well done!</p>
      ) : (
        <ul className="nt-list">
          {reach && counts.due > 0 && (
            <li>
              <button type="button" className="nt-row nt-blue" aria-expanded={reachOpen} onClick={() => setReachOpen((o) => !o)}>
                <NtLine icon="📞" count={counts.due} label={counts.due === 1 ? 'person to reach today' : 'people to reach today'} go={reachOpen ? '▾' : '›'} />
              </button>
              {reachOpen && <div className="nt-reach"><ReachCard org={org} /></div>}
            </li>
          )}
          {rows.map((r) => (
            <li key={r.key}>
              <Link className={`nt-row nt-${r.tone}`} to={r.to!}><NtLine icon={r.icon} count={r.count} label={r.label} /></Link>
            </li>
          ))}
        </ul>
      )}
      {staffSend && <Link to={`${needs.circle.photosPath}?new=1`} className="btn align-start">📷 Send a report or good news</Link>}
    </section>
  );
}

function NtLine({ icon, count, label, go = '›' }: { icon: string; count?: number; label: ReactNode; go?: string }) {
  return (
    <>
      <span className="nt-icon" aria-hidden="true">{icon}</span>
      {count != null && <b className="nt-count">{count}</b>}
      <span className="nt-label">{label}</span>
      <span className="nt-go" aria-hidden="true">{go}</span>
    </>
  );
}
