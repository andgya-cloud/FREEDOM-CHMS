import { useState } from 'react';
import { Link } from 'react-router-dom';
import { doc } from 'firebase/firestore';
import { db } from '../../firebase';
import { useOrg, type Organization } from '../../state/OrgContext';
import { useAuth } from '../../state/AuthContext';
import { useToast } from '../../state/ToastContext';
import { restoreRecord, softDelete } from '../../lib/records';
import { friendlyError } from '../../lib/errors';
import { ConfirmDialog } from '../../components/ConfirmDialog';
import { ORGANIZATION_TYPE_LABELS } from '../../../functions/src/shared/organizations';
import { formatDate } from '../../../functions/src/shared/datetime';

export function OrganizationsPage() {
  const { organizations, allIncludingDeleted } = useOrg();
  const { profile } = useAuth();
  const toast = useToast();
  const [toDelete, setToDelete] = useState<Organization | null>(null);
  const binned = allIncludingDeleted.filter((o) => o.deletedAt);

  function restore(org: Organization) {
    restoreRecord(doc(db, 'organizations', org.id)).catch((e) => toast.show(friendlyError(e)));
    toast.show(`${org.name} restored.`);
  }

  function confirmDelete() {
    const org = toDelete;
    setToDelete(null);
    if (!org) return;
    softDelete(doc(db, 'organizations', org.id)).catch((e) => toast.show(friendlyError(e)));
    toast.show(`${org.name} moved to the bin.`, { label: 'Undo', onAction: () => restore(org) });
  }

  return (
    <div className="page">
      <p><Link to="/settings">← Settings</Link></p>
      <div className="page-head">
        <h1>Organizations</h1>
        {profile?.allOrgs && <Link className="btn btn-primary" to="/settings/organizations/new">Add</Link>}
      </div>
      {organizations.length === 0 ? (
        <p className="muted">No organizations yet. Add Freedom Church Nairobi first.</p>
      ) : (
        <ul className="row-list">
          {organizations.map((o) => (
            <li key={o.id} className="row">
              <Link to={`/settings/organizations/${o.id}`} className="row-main">
                <span className="row-title">{o.name}</span>
                <span className="row-detail">
                  {ORGANIZATION_TYPE_LABELS[o.type]} · Receipts {o.receiptPrefix}-… · {o.currency}
                  {!o.active && ' · Paused'}
                </span>
              </Link>
              <button type="button" className="btn btn-quiet" onClick={() => setToDelete(o)}>Delete</button>
            </li>
          ))}
        </ul>
      )}

      {binned.length > 0 && (
        <section className="bin">
          <h2>Bin</h2>
          <p className="muted small">Deleted organizations stay here for 30 days, then are removed with all their records.</p>
          <ul className="row-list">
            {binned.map((o) => (
              <li key={o.id} className="row">
                <span className="row-main">
                  <span className="row-title">{o.name}</span>
                  <span className="row-detail">Deleted {o.deletedAt ? formatDate(o.deletedAt.toDate()) : ''}</span>
                </span>
                <button type="button" className="btn btn-quiet" onClick={() => restore(o)}>Restore</button>
              </li>
            ))}
          </ul>
        </section>
      )}

      <ConfirmDialog
        open={!!toDelete}
        title={`Delete ${toDelete?.name ?? ''}?`}
        body="Staff will no longer see it. You can restore it from the bin for 30 days."
        confirmLabel="Delete"
        danger
        onConfirm={confirmDelete}
        onCancel={() => setToDelete(null)}
      />
    </div>
  );
}
