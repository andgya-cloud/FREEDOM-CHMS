import { useAuth } from '../state/AuthContext';
import { useOrg } from '../state/OrgContext';
import { useToast } from '../state/ToastContext';
import type { Person } from '../state/PeopleContext';
import { changeStatus, restoreStatus } from '../lib/peopleWrites';
import { friendlyError } from '../lib/errors';
import { canKeepAccounts } from '../../functions/src/shared/permissions';
import { localDateKey } from '../../functions/src/shared/datetime';
import { PERSON_STATUS_LABELS, statusesFor, type PersonStatus } from '../../functions/src/shared/people';
import { confirmedStatus, SIGNUP_CLAIM_LABELS } from '../../functions/src/shared/familySignup';

/** Whether this user may change statuses here: Andrew and Doreen, at Freedom Church (Andy, 2026-11-02, 3). */
export function useCanChangeStatus(): boolean {
  const { profile } = useAuth();
  const { current } = useOrg();
  return current?.type === 'church_campus' && canKeepAccounts(profile);
}

/** The statuses offered for one person: the church's list, plus their own if it isn't on it (e.g. Child). */
export function statusOptions(orgType: string | undefined, current?: PersonStatus): PersonStatus[] {
  const list = [...statusesFor(orgType)];
  return current && !list.includes(current) ? [...list, current] : list;
}

/** Changes the status of one or more people with an Undo that puts each back as it was. */
export function useStatusChanger() {
  const toast = useToast();
  const { current } = useOrg();
  return (people: Person[], next: PersonStatus) => {
    const today = localDateKey(new Date(), current?.timeZone || 'Africa/Nairobi');
    const changing = people.filter((p) => p.status !== next || p.signup);
    if (!changing.length) return;
    const fail = (err: unknown) => toast.show(friendlyError(err));
    for (const p of changing) changeStatus(p, next, today).catch(fail);
    const label = PERSON_STATUS_LABELS[next];
    const text = changing.length === 1
      ? `${changing[0]!.firstName || changing[0]!.fullName} is now ${label === 'Inactive' ? 'inactive' : `a${/^[AEIOU]/.test(label) ? 'n' : ''} ${label}`}.`
      : `${changing.length} people changed to ${label}.`;
    toast.show(text, {
      label: 'Undo',
      onAction: () => { for (const p of changing) restoreStatus(p).catch(fail); },
    });
  };
}

/** The status badge as a small dropdown (1A); everyone else sees the plain badge. */
export function StatusPicker({ person }: { person: Person }) {
  const { current } = useOrg();
  const change = useStatusChanger();
  return (
    <select
      className={`badge badge-select badge-${person.status}`}
      value={person.status}
      aria-label={`Status of ${person.fullName}`}
      onChange={(e) => change([person], e.target.value as PersonStatus)}
    >
      {statusOptions(current?.type, person.status).map((s) => <option key={s} value={s}>{PERSON_STATUS_LABELS[s]}</option>)}
    </select>
  );
}

/**
 * "New sign-up · Says: Member" on someone from the family sign-up form, with Confirm for Andrew and Doreen
 * (Andy, 2026-11-02, 2A 4A).
 */
export function SignupBadge({ person }: { person: Person }) {
  const edit = useCanChangeStatus();
  const change = useStatusChanger();
  if (!person.signup) return null;
  const claim = person.signup.claimed;
  return (
    <span className="signup-badge">
      <span className="badge badge-signup">New sign-up · Says: {SIGNUP_CLAIM_LABELS[claim]}</span>
      {edit && <button type="button" className="btn btn-small signup-confirm" onClick={() => change([person], confirmedStatus(claim))}>Confirm</button>}
    </span>
  );
}
