import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../../state/AuthContext';
import type { Organization } from '../../state/OrgContext';
import { usePeople } from '../../state/PeopleContext';
import { useOpenFollowUps, useStaff, type FollowUp } from '../../state/useFollowUps';
import { OrgGate } from '../../components/OrgGate';
import { FollowUpCard } from '../../components/FollowUpCard';
import { isEscalated } from '../../../functions/src/shared/followups';
import { localDateKey } from '../../../functions/src/shared/datetime';

const VIEWS = [
  { id: 'due', label: 'Due now' },
  { id: 'mine', label: 'Mine' },
  { id: 'unassigned', label: 'Not assigned' },
  { id: 'escalated', label: 'With the pastor' },
  { id: 'all', label: 'All open' },
] as const;
type View = (typeof VIEWS)[number]['id'];

/** The daily Follow-ups queue: who to contact, why, and since when. */
export function FollowUpsPage() {
  return <OrgGate title="Follow-ups">{(org) => <Queue org={org} />}</OrgGate>;
}

function Queue({ org }: { org: Organization }) {
  const { user, can } = useAuth();
  const { open, loading, error } = useOpenFollowUps(org.id);
  const { byId } = usePeople();
  const staff = useStaff(org.id);
  const [view, setView] = useState<View>('due');
  const now = new Date();
  const today = localDateKey(now, org.timeZone);

  // People removed from the system have nothing left to follow up.
  const live = useMemo(() => open.filter((t) => { const p = byId(t.personId); return !p || !p.deletedAt; }), [open, byId]);
  const escalated = (t: FollowUp) => isEscalated(t.dueAt?.toDate(), now);
  const dueNow = (t: FollowUp) => !!t.dueAt && localDateKey(t.dueAt.toDate(), org.timeZone) <= today;
  const lists: Record<View, FollowUp[]> = {
    due: live.filter(dueNow),
    mine: live.filter((t) => t.assignedTo === user?.uid),
    unassigned: live.filter((t) => !t.assignedTo),
    escalated: live.filter(escalated),
    all: live,
  };
  // Escalated ones first, then the soonest due.
  const shown = [...lists[view]].sort((a, b) => Number(escalated(b)) - Number(escalated(a)));

  return (
    <div className="page narrow">
      <div className="page-head">
        <h1>Follow-ups</h1>
        <Link to="/follow-ups/reminders" className="btn btn-quiet">Programme reminders</Link>
      </div>
      <p className="muted small">New visitors, salvations and regulars missing for 3 weeks appear here by themselves. A follow-up still open 3 days after it was due goes to the pastor.</p>

      <label className="filter-select">
        <span className="visually-hidden">Show</span>
        <select value={view} onChange={(e) => setView(e.target.value as View)} aria-label="Show">
          {VIEWS.filter((v) => v.id !== 'escalated' || can('users.manage') || lists.escalated.length > 0).map((v) => (
            <option key={v.id} value={v.id}>{v.label} ({lists[v.id].length})</option>
          ))}
        </select>
      </label>

      {error ? <p className="error">The follow-ups could not be loaded ({error}).</p>
        : loading ? <p className="muted">Loading…</p>
        : shown.length === 0 ? (
          <div className="card"><p>{view === 'due' ? 'Nobody to contact right now. Well done!' : 'Nothing here.'}</p></div>
        ) : (
          <ul className="plain stack">
            {shown.map((t) => <FollowUpCard key={t.id} org={org} task={t} staff={staff} />)}
          </ul>
        )}
    </div>
  );
}
