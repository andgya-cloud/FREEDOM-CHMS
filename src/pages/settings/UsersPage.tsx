import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { collection, onSnapshot, Timestamp } from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import { db, functions } from '../../firebase';
import { useAuth, type Profile } from '../../state/AuthContext';
import { useRoles } from '../../state/useRoles';
import { formatDateTime } from '../../../functions/src/shared/datetime';

export function UsersPage() {
  const [users, setUsers] = useState<Profile[] | null>(null);
  const roles = useRoles();
  const { can } = useAuth();
  // The pastor sees every account. An organization head sees only the Staff of their own organization.
  const teamOnly = !can('users.manage');
  useEffect(() => {
    const byName = (list: Profile[]) => list.sort((a, b) => a.displayName.localeCompare(b.displayName));
    if (!teamOnly) {
      return onSnapshot(collection(db, 'users'), (snap) => {
        setUsers(byName(snap.docs.map((d) => ({ uid: d.id, ...d.data() }) as Profile)));
      }, () => setUsers([]));
    }
    let live = true;
    httpsCallable<unknown, { users: (Omit<Profile, 'lastSignInAt'> & { lastSignInAt: number | null })[] }>(functions, 'listTeam')()
      .then(({ data }) => {
        if (!live) return;
        setUsers(byName(data.users.map((u) => ({ ...u, lastSignInAt: u.lastSignInAt ? Timestamp.fromMillis(u.lastSignInAt) : undefined }) as Profile)));
      })
      .catch(() => { if (live) setUsers([]); });
    return () => { live = false; };
  }, [teamOnly]);
  const roleName = (id: string) => roles.find((r) => r.id === id)?.name ?? id;

  return (
    <div className="page">
      <p><Link to="/settings">← Settings</Link></p>
      <div className="page-head">
        <h1>{teamOnly ? 'Your staff' : 'Staff accounts'}</h1>
        <Link className="btn btn-primary" to="/settings/users/new">Add</Link>
      </div>
      {teamOnly && <p className="muted">Staff you add can work in your organization only and never see money.</p>}
      {users === null ? <p>Loading…</p> : users.length === 0 ? <p className="muted">No staff accounts yet.</p> : (
        <ul className="row-list">
          {users.map((u) => (
            <li key={u.uid} className="row">
              <Link to={`/settings/users/${u.uid}`} className="row-main">
                <span className="row-title">{u.displayName}{!u.active && <span className="badge badge-muted">Off</span>}</span>
                <span className="row-detail">
                  {roleName(u.roleId)}{u.pettyTitle ? ` (${u.pettyTitle})` : ''} · {u.email}
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
