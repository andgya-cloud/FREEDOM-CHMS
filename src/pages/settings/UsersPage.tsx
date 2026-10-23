import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { collection, onSnapshot, Timestamp } from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import { db, functions } from '../../firebase';
import { useAuth, type Profile } from '../../state/AuthContext';
import { useRoles } from '../../state/useRoles';
import { formatDateTime } from '../../../functions/src/shared/datetime';
import { PETTY_TITLES } from '../../../functions/src/shared/permissions';
import { useToast } from '../../state/ToastContext';
import { friendlyError } from '../../lib/errors';

/**
 * One person, one account (Andy, 2026-10-23): the pastor sets the name and signing title used on every
 * record, and can fold an extra account of theirs into this one.
 */
function MyAccountCard({ users }: { users: Profile[] }) {
  const { user, profile } = useAuth();
  const toast = useToast();
  const [name, setName] = useState(profile?.displayName ?? '');
  const [title, setTitle] = useState(profile?.pettyTitle || 'Director');
  const [fromUid, setFromUid] = useState('');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState('');
  const others = users.filter((u) => u.uid !== user?.uid && u.active);
  const from = others.find((u) => u.uid === fromUid);
  async function go() {
    setBusy(true);
    setResult('');
    try {
      const { data } = await httpsCallable<object, { changed: number; folded: string | null; conflicts: string[] }>(functions, 'mergeMyAccount')({ name: name.trim(), title, fromUid: fromUid || null });
      setResult(`Done. ${data.changed} record${data.changed === 1 ? '' : 's'} now show ${name.trim()} (${title}).`
        + (data.folded ? ` ${data.folded}'s account was folded in and switched off; you can delete it from the list below.` : '')
        + (data.conflicts.length ? ` Please check: ${data.conflicts.join('; ')}. Each of these needs another stakeholder's signature to be properly approved.` : ''));
      setFromUid('');
      toast.show('Your account and records are updated. Refresh to see your new name everywhere.');
    } catch (err) {
      const e = err as { code?: string; message?: string };
      toast.show(e?.code?.startsWith('functions/') && e.message ? e.message.replace(/\s*\[\d+\]$/, '') : friendlyError(err));
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="card stack">
      <h2>Your name on records</h2>
      <p className="small muted">Used for your account and on every requisition, voucher, top-up and bin record you raised or signed, old and new.</p>
      <div className="field-row">
        <label className="field"><span>Your full name</span><input value={name} maxLength={80} onChange={(e) => setName(e.target.value)} disabled={busy} /></label>
        <label className="field"><span>Title under your signature</span>
          <select value={title} onChange={(e) => setTitle(e.target.value)} disabled={busy}>
            {PETTY_TITLES.filter((t) => t !== 'Accountant').map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
        </label>
      </div>
      <label className="field"><span>Is another account in the list also you? (optional)</span>
        <select value={fromUid} onChange={(e) => setFromUid(e.target.value)} disabled={busy}>
          <option value="">No, only this account</option>
          {others.map((u) => <option key={u.uid} value={u.uid}>{u.displayName} · {u.email}</option>)}
        </select>
      </label>
      {from && <p className="small notice">Everything {from.displayName} raised or signed becomes yours, and that account is switched off. Only choose it if it is really you.</p>}
      <div className="row-actions">
        <button type="button" className="btn btn-primary" disabled={busy || name.trim().length < 2} onClick={() => void go()}>{busy ? 'Updating…' : 'Update my name everywhere'}</button>
      </div>
      {result && <p className="small">{result}</p>}
    </section>
  );
}

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
      {!teamOnly && users && users.length > 0 && <MyAccountCard users={users} />}
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
