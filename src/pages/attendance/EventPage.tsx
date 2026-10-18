import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useAuth } from '../../state/AuthContext';
import { useOrg } from '../../state/OrgContext';
import { useToast } from '../../state/ToastContext';
import { useEvent, useEventAttendance } from '../../state/useAttendance';
import { deleteEvent, eventRef, saveEventNotes } from '../../lib/attendanceWrites';
import { restoreRecord } from '../../lib/records';
import { friendlyError } from '../../lib/errors';
import { ConfirmDialog } from '../../components/ConfirmDialog';
import { HeadcountEditor } from '../../components/HeadcountEditor';
import { CheckInPanel } from '../../components/CheckInPanel';
import { ClassRegister } from '../../components/ClassRegister';
import { EVENT_TYPE_LABELS } from '../../../functions/src/shared/attendance';
import { formatDateKey } from '../../../functions/src/shared/datetime';

/** One service, class or session: the headcount, who came, and the door tablet. */
export function EventPage() {
  const { orgId = '', eventId = '' } = useParams();
  const { can } = useAuth();
  const { organizations, currentId, select } = useOrg();
  const toast = useToast();
  const navigate = useNavigate();
  const { event, missing } = useEvent(orgId, eventId);
  const { byPerson } = useEventAttendance(orgId, eventId);
  const [notes, setNotes] = useState('');
  const [confirmDelete, setConfirmDelete] = useState(false);
  const org = organizations.find((o) => o.id === orgId);
  const canRecord = can('attendance.write');

  useEffect(() => { setNotes(event?.notes ?? ''); }, [event?.id, event?.notes]);

  // Names come from the selected organization's people on this device.
  if (org && currentId !== orgId) {
    return (
      <div className="page narrow">
        <p><Link to="/attendance">← Attendance</Link></p>
        <div className="notice">
          <p>This belongs to {org.name}.</p>
          <button type="button" className="btn btn-primary" onClick={() => select(orgId)}>Switch to {org.name}</button>
        </div>
      </div>
    );
  }
  if (!org || !event || event.deletedAt) {
    return (
      <div className="page narrow">
        <p><Link to="/attendance">← Attendance</Link></p>
        <p>{missing || event?.deletedAt ? 'This was not found. It may have been deleted.' : 'Loading…'}</p>
      </div>
    );
  }

  function remove() {
    setConfirmDelete(false);
    const ref = eventRef(orgId, eventId);
    deleteEvent(orgId, eventId).catch((err) => toast.show(friendlyError(err)));
    toast.show(`${event!.name} deleted.`, { label: 'Undo', onAction: () => { restoreRecord(ref).catch((err) => toast.show(friendlyError(err))); } });
    navigate('/attendance');
  }

  const isClass = event.type === 'class';
  return (
    <div className="page narrow">
      <p><Link to="/attendance">← Attendance</Link></p>
      <div className="person-head">
        <div>
          <h1>{event.name}</h1>
          <p className="muted">{formatDateKey(event.date)} · {EVENT_TYPE_LABELS[event.type]} · {org.name}</p>
        </div>
        {canRecord && !isClass && (
          <Link className="btn btn-gold" to={`/door/${orgId}/${eventId}`}>Door mode</Link>
        )}
      </div>

      <HeadcountEditor event={event} canEdit={canRecord} />
      {isClass
        ? <ClassRegister org={org} event={event} byPerson={byPerson} canRecord={canRecord} />
        : <CheckInPanel org={org} event={event} byPerson={byPerson} canRecord={canRecord} />}

      <section className="card">
        <label className="field">
          <span>Notes (optional)</span>
          <textarea
            rows={2}
            value={notes}
            disabled={!canRecord}
            placeholder={isClass ? 'Unit or topic covered, trainer' : 'Anything worth remembering about today'}
            onChange={(e) => setNotes(e.target.value)}
            onBlur={() => { if (notes !== (event.notes ?? '')) saveEventNotes(orgId, eventId, notes).catch((err) => toast.show(friendlyError(err))); }}
          />
        </label>
      </section>

      {canRecord && (
        <button type="button" className="btn btn-quiet danger-text align-start" onClick={() => setConfirmDelete(true)}>Delete this {EVENT_TYPE_LABELS[event.type].toLowerCase()}</button>
      )}
      <ConfirmDialog
        open={confirmDelete}
        title={`Delete ${event.name} on ${formatDateKey(event.date)}?`}
        body="It will be moved to the bin with its headcount. You can undo straight away, and the pastor can restore it for 30 days."
        confirmLabel="Delete"
        danger
        onConfirm={remove}
        onCancel={() => setConfirmDelete(false)}
      />
    </div>
  );
}
