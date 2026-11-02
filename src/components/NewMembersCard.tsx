import { Link } from 'react-router-dom';
import { usePeople } from '../state/PeopleContext';
import type { Organization } from '../state/OrgContext';
import { newMembersByMonth } from '../../functions/src/shared/people';
import { localDateKey } from '../../functions/src/shared/datetime';

const monthName = (key: string) => new Date(`${key}-01T12:00:00Z`).toLocaleDateString('en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' });

/** New members each month, from the day each became a Member (Andy, 2026-11-02, 5A). */
export function NewMembersCard({ org }: { org: Organization }) {
  const { people } = usePeople();
  const today = localDateKey(new Date(), org.timeZone || 'Africa/Nairobi');
  const months = newMembersByMonth(people.filter((p) => p.orgId === org.id), today);
  const [thisMonth] = months;
  return (
    <section className="card new-members" aria-label="New members">
      <h2>New members</h2>
      <ul className="new-members-months">
        {months.map((m) => <li key={m.month}><b>{m.people.length}</b> <span className="muted small">{monthName(m.month).split(' ')[0]}</span></li>)}
      </ul>
      {thisMonth && thisMonth.people.length > 0
        ? <p className="small">This month: {thisMonth.people.map((p, i) => <span key={p.id}>{i ? ', ' : ''}<Link to={`/people/${p.orgId}/${p.id}`}>{p.fullName}</Link></span>)}</p>
        : <p className="muted small">Nobody has become a member yet this month.</p>}
    </section>
  );
}
