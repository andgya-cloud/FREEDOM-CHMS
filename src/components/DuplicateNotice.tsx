import { Link } from 'react-router-dom';
import type { Person } from '../state/PeopleContext';
import { PERSON_STATUS_LABELS } from '../../functions/src/shared/people';
import { formatPhone } from '../../functions/src/shared/phone';
import { formatDateKey } from '../../functions/src/shared/datetime';

/** Shown as soon as a phone number matches someone already in the system. */
export function DuplicateNotice({ matches }: { matches: Person[] }) {
  if (matches.length === 0) return null;
  return (
    <div className="notice notice-warn" role="status">
      <strong>{matches.length === 1 ? 'This number is already in the system:' : 'This number is already used by:'}</strong>
      <ul className="plain">
        {matches.map((p) => (
          <li key={p.id}>
            <Link to={`/people/${p.orgId}/${p.id}`}>{p.fullName}</Link>{' '}
            <span className="muted small">
              {formatPhone(p.phone)} · {PERSON_STATUS_LABELS[p.status]}
              {p.firstVisitDate ? ` · first visit ${formatDateKey(p.firstVisitDate)}` : ''}
            </span>
          </li>
        ))}
      </ul>
      <span className="small">If it is the same person, open their record instead. Otherwise you can still save.</span>
    </div>
  );
}
