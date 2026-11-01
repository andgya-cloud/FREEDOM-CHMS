import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../state/AuthContext';
import { usePeople, type Person } from '../state/PeopleContext';
import { useToast } from '../state/ToastContext';
import { addToFamily, removeFromFamily, renameFamily, setFamilyRole, useHouseholds } from '../state/useFamilies';
import { friendlyError } from '../lib/errors';
import { PersonPicker } from './PersonPicker';
import { familyName, FAMILY_ROLE_LABELS, FAMILY_ROLES, roleOf, sortFamily, type FamilyRole } from '../../functions/src/shared/families';

/**
 * The Family box on a person's page (Andy, 2026-11-01, 3A 5A): the family's name (change it here), each member
 * with their role, and Add or Remove.
 */
export function FamilyBox({ person }: { person: Person }) {
  const { can } = useAuth();
  const { people } = usePeople();
  const toast = useToast();
  const households = useHouseholds(person.orgId);
  const canWrite = can('people.write');
  const [pick, setPick] = useState<{ id: string | null; name: string }>({ id: null, name: '' });
  const [role, setRole] = useState<FamilyRole>('child');
  const [adding, setAdding] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [newName, setNewName] = useState('');
  const fail = (err: unknown) => toast.show(friendlyError(err));

  const hid = person.householdId;
  const members = hid ? sortFamily(people.filter((p) => p.householdId === hid)) : [person];
  const inFamily = members.length > 1;
  const stored = hid ? households.names.get(hid) : undefined;
  const title = familyName(members, stored);
  const chosen = pick.id ? people.find((p) => p.id === pick.id) : undefined;

  if (!inFamily && !canWrite) return null;

  function add() {
    if (!chosen) return;
    addToFamily(person, chosen, role).catch(fail);
    toast.show(`${chosen.firstName} added to the family.`);
    setPick({ id: null, name: '' });
    setAdding(false);
  }

  function remove(p: Person) {
    removeFromFamily(p).catch(fail);
    toast.show(`${p.firstName} taken out of the family.`, {
      label: 'Undo',
      onAction: () => { addToFamily(person.id === p.id ? members.find((m) => m.id !== p.id)! : person, p, roleOf(p)).catch(fail); },
    });
  }

  function saveName() {
    const id = person.householdId ?? person.id;
    renameFamily(person.orgId, id, households.existing.has(id), newName).catch(fail);
    setRenaming(false);
  }

  return (
    <section className="card family-box">
      <div className="card-head">
        <h2>{inFamily ? title : 'Family'}</h2>
        {canWrite && inFamily && !renaming && <button type="button" className="btn btn-quiet btn-small" onClick={() => { setNewName(stored ?? title); setRenaming(true); }}>Change name</button>}
      </div>
      {renaming && (
        <form className="input-with-button" onSubmit={(e) => { e.preventDefault(); saveName(); }}>
          <input autoFocus value={newName} maxLength={100} onChange={(e) => setNewName(e.target.value)} aria-label="Family name" placeholder="For example Andrew and Doreen Guya" />
          <button type="submit" className="btn btn-primary">Save</button>
        </form>
      )}
      {inFamily ? (
        <ul className="plain family-list">
          {members.map((p) => (
            <li key={p.id} className="family-line">
              {p.id === person.id ? <b>{p.fullName}</b> : <Link to={`/people/${p.orgId}/${p.id}`}>{p.fullName}</Link>}
              {canWrite ? (
                <select className="family-role-select" value={roleOf(p)} aria-label={`${p.fullName}'s role`} onChange={(e) => setFamilyRole(p, e.target.value as FamilyRole).catch(fail)}>
                  {FAMILY_ROLES.map((r) => <option key={r} value={r}>{FAMILY_ROLE_LABELS[r]}</option>)}
                </select>
              ) : <span className="muted small">{FAMILY_ROLE_LABELS[roleOf(p)]}</span>}
              {canWrite && <button type="button" className="btn btn-quiet btn-small" onClick={() => remove(p)} aria-label={`Take ${p.fullName} out of the family`}>Remove</button>}
            </li>
          ))}
        </ul>
      ) : <p className="muted small">Not in a family yet.</p>}
      {canWrite && !adding && <button type="button" className="btn btn-small align-start" onClick={() => setAdding(true)}>Add a family member</button>}
      {canWrite && adding && (
        <div className="stack family-add">
          <PersonPicker label="Who?" value={pick} onChange={setPick} excludeId={person.id} orgId={person.orgId} hint="Type their name or phone number." />
          <label className="field"><span>As</span>
            <select value={role} onChange={(e) => setRole(e.target.value as FamilyRole)}>
              {FAMILY_ROLES.map((r) => <option key={r} value={r}>{FAMILY_ROLE_LABELS[r]}</option>)}
            </select>
          </label>
          <div className="dialog-actions">
            <button type="button" className="btn btn-quiet" onClick={() => setAdding(false)}>Cancel</button>
            <button type="button" className="btn btn-primary" disabled={!chosen} onClick={add}>Add to family</button>
          </div>
        </div>
      )}
    </section>
  );
}
