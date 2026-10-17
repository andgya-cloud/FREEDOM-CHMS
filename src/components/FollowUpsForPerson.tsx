import { collection, query, where, type Timestamp } from 'firebase/firestore';
import { db } from '../firebase';
import { useLiveQuery } from '../lib/useQuery';
import { formatDateTime } from '../../functions/src/shared/datetime';

interface FollowUp {
  id: string;
  reason: string;
  status: string;
  dueAt?: Timestamp;
  deletedAt?: Timestamp | null;
}

const REASONS: Record<string, string> = {
  first_visit: 'Welcome message after first visit',
};

/** Open follow-ups for this person. The full Follow-ups queue arrives in Stage 6. */
export function FollowUpsForPerson({ orgId, personId }: { orgId: string; personId: string }) {
  const { rows } = useLiveQuery<FollowUp>(() => query(collection(db, 'organizations', orgId, 'followUps'), where('personId', '==', personId)), [orgId, personId]);
  const open = rows.filter((r) => r.status === 'open' && !r.deletedAt);
  if (open.length === 0) return null;
  return (
    <section className="card" aria-labelledby="fu-h">
      <h2 id="fu-h">Follow-up</h2>
      <ul className="plain">
        {open.map((f) => (
          <li key={f.id}>
            {REASONS[f.reason] ?? f.reason}
            {f.dueAt && <span className="muted small"> · due {formatDateTime(f.dueAt.toDate())}</span>}
          </li>
        ))}
      </ul>
    </section>
  );
}
