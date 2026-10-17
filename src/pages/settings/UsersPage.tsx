import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { collection, onSnapshot } from 'firebase/firestore';
import { db } from '../../firebase';
import type { Profile } from '../../state/AuthContext';
import { useRoles } from '../../state/useRoles';
import { formatDateTime } from '../../../functions/src/shared/datetime';

export function UsersPage() {
  const [users, setUsers] = useState<Profile[] | null>(null);
  const roles = useRoles();
  useEffect(() => onSnapshot(collection(db, 'users'), (snap) => {
    setUsers(snap.docs.map((d) => ({ uid: d.id, ...d.data() }) as Profile).sort((a, b) => a.displayName.localeCompare(b.displayName)));
  }, () => setUsers([])), []);
  const roleName = (id: string) => roles.find((r) => r.id === id)?.name ?? id;

  return (
    <div className="page">
      <p><Link to="/settings">← Settings</Link></p>
      <div className="page-head">
        <h1>Staff accounts</h1>
        <Link className="btn btn-primary" to="/settings/users/new">Add</Link>
      </div>
      {users === null ? <p>Loading…</p> : (
        <ul className="row-list">
          {users.map((u) => (
            <li key={u.uid} className="row">
              <Link to={`/settings/users/${u.uid}`} className="row-main">
                <span className="row-title">{u.displayName}{!u.active && <span className="badge badge-muted">Off</span>}</span>
                <span className="row-detail">
                  {roleName(u.roleId)} · {u.email}
                  {u.lastSignInAt ? ` · Last in ${formatDateTime(u.lastSignInAt.toDate())}` : ' · Never signed in'}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
      <p className="muted small">Account changes need an internet connection.</p>
    </div>
  );
}
