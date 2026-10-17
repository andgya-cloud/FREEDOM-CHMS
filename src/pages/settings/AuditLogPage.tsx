import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  collection, getDocs, limit, orderBy, query, startAfter, where,
  type QueryDocumentSnapshot, type Timestamp,
} from 'firebase/firestore';
import { db } from '../../firebase';
import { useOrg } from '../../state/OrgContext';
import { friendlyError } from '../../lib/errors';
import { formatDateTime } from '../../../functions/src/shared/datetime';

interface Entry {
  id: string;
  at: Timestamp | null;
  actorEmail: string | null;
  action: string;
  collection: string;
  docId: string;
  orgId: string | null;
  changedFields: string[];
  note: string | null;
}

const ACTION_LABELS: Record<string, string> = {
  create: 'Added', update: 'Changed', delete: 'Deleted', restore: 'Restored', purge: 'Removed for good',
  sign_in: 'Signed in', password_reset: 'Reset password', password_change: 'Changed own password',
  export: 'Exported', bootstrap: 'Set up the system',
};

const COLLECTION_LABELS: Record<string, string> = {
  organizations: 'organization', users: 'staff account', roles: 'role', settings: 'settings',
};

const PAGE = 50;

export function AuditLogPage() {
  const { currentId, isCombined, organizations } = useOrg();
  const [scope, setScope] = useState<'org' | 'all'>('all');
  const [entries, setEntries] = useState<Entry[]>([]);
  const [cursor, setCursor] = useState<QueryDocumentSnapshot | null>(null);
  const [done, setDone] = useState(false);
  const [error, setError] = useState('');
  const orgFilter = scope === 'org' && !isCombined ? currentId : null;

  async function load(after: QueryDocumentSnapshot | null) {
    setError('');
    try {
      const base = collection(db, 'auditLog');
      const parts = [
        ...(orgFilter ? [where('orgId', '==', orgFilter)] : []),
        orderBy('at', 'desc'),
        ...(after ? [startAfter(after)] : []),
        limit(PAGE),
      ];
      const snap = await getDocs(query(base, ...parts));
      const rows = snap.docs.map((d) => ({ id: d.id, ...d.data() }) as Entry);
      setEntries((prev) => (after ? [...prev, ...rows] : rows));
      setCursor(snap.docs[snap.docs.length - 1] ?? null);
      setDone(snap.size < PAGE);
    } catch (err) {
      setError(friendlyError(err));
    }
  }

  useEffect(() => { void load(null); }, [orgFilter]);

  const orgName = (id: string | null) => (id ? organizations.find((o) => o.id === id)?.name ?? 'Deleted organization' : '');

  return (
    <div className="page">
      <p><Link to="/settings">← Settings</Link></p>
      <h1>Audit log</h1>
      <p className="muted">Every addition, change, deletion and sign-in. Values are not stored here, only which fields changed.</p>
      {!isCombined && (
        <div className="segmented" role="group" aria-label="Show">
          <button type="button" className={scope === 'all' ? 'on' : ''} onClick={() => setScope('all')}>Everything</button>
          <button type="button" className={scope === 'org' ? 'on' : ''} onClick={() => setScope('org')}>This organization only</button>
        </div>
      )}
      {error && <p className="error" role="alert">{error}</p>}
      <ul className="audit-list">
        {entries.map((e) => (
          <li key={e.id}>
            <div className="audit-when">{e.at ? formatDateTime(e.at.toDate()) : 'Just now'}</div>
            <div>
              <strong>{e.actorEmail ?? 'Unknown'}</strong> · {ACTION_LABELS[e.action] ?? e.action}{' '}
              <span className="muted">
                {COLLECTION_LABELS[e.collection] ?? e.collection}
                {e.collection === 'organizations' ? `: ${orgName(e.orgId)}` : e.orgId ? ` in ${orgName(e.orgId)}` : ''}
              </span>
              {e.action !== 'purge' && e.changedFields?.length > 0 && <div className="small muted">Fields: {e.changedFields.join(', ')}</div>}
              {e.note && <div className="small">{e.note}</div>}
            </div>
          </li>
        ))}
      </ul>
      {entries.length === 0 && !error && <p className="muted">Nothing recorded yet.</p>}
      {!done && entries.length > 0 && (
        <button type="button" className="btn" onClick={() => void load(cursor)}>Show older</button>
      )}
    </div>
  );
}
