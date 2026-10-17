import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { doc } from 'firebase/firestore';
import { db } from '../../firebase';
import { useAuth } from '../../state/AuthContext';
import { useOrg } from '../../state/OrgContext';
import { usePeople } from '../../state/PeopleContext';
import { useCustomFields } from '../../state/useSettingsDoc';
import { useToast } from '../../state/ToastContext';
import { restoreRecord, softDelete } from '../../lib/records';
import { updatePerson } from '../../lib/peopleWrites';
import { friendlyError } from '../../lib/errors';
import { ConfirmDialog } from '../../components/ConfirmDialog';
import { PipelineTimeline } from '../../components/PipelineTimeline';
import { PastoralSection } from '../../components/PastoralSection';
import { FollowUpsForPerson } from '../../components/FollowUpsForPerson';
import { PERSON_STATUS_LABELS } from '../../../functions/src/shared/people';
import { formatPhone } from '../../../functions/src/shared/phone';
import { formatDateKey, localDateKey } from '../../../functions/src/shared/datetime';

export function PersonPage() {
  const { orgId = '', personId = '' } = useParams();
  const { can } = useAuth();
  const { organizations } = useOrg();
  const { byId, people, loading } = usePeople();
  const customFields = useCustomFields();
  const toast = useToast();
  const navigate = useNavigate();
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [confirmStop, setConfirmStop] = useState(false);
  const person = byId(personId);
  const org = organizations.find((o) => o.id === orgId);

  if (!person) {
    return (
      <div className="page">
        <p><Link to="/people">← People</Link></p>
        <p>{loading ? 'Loading…' : 'This person is not in the selected organization. Switch organization at the top, or search again.'}</p>
      </div>
    );
  }

  const ref = doc(db, 'organizations', orgId, 'people', personId);
  const household = person.householdId ? people.filter((p) => p.householdId === person.householdId && p.id !== person.id) : [];
  const guardian = person.guardianId ? byId(person.guardianId) : undefined;
  const children = people.filter((p) => p.guardianId === person.id);
  const duplicates = (person.possibleDuplicateIds ?? []).map((id) => byId(id)).filter((p) => p && !p.deletedAt);
  const consent = person.whatsappConsent;
  const canWrite = can('people.write');

  function remove() {
    setConfirmDelete(false);
    softDelete(ref).catch((e) => toast.show(friendlyError(e)));
    toast.show(`${person!.fullName} moved to the bin.`, {
      label: 'Undo',
      onAction: () => { restoreRecord(ref).catch((e) => toast.show(friendlyError(e))); },
    });
    navigate('/people');
  }

  function stopMessages() {
    setConfirmStop(false);
    updatePerson(orgId, personId, {
      whatsappConsent: { ...consent, given: false, stoppedAt: localDateKey(new Date(), org?.timeZone) },
    }).catch((e) => toast.show(friendlyError(e)));
    toast.show('WhatsApp messages stopped for this person.');
  }

  const details: [string, React.ReactNode][] = [
    ['Phone', person.phone ? <a href={`tel:${person.phone}`}>{formatPhone(person.phone)}</a> : 'None'],
    ['WhatsApp', person.whatsapp ? formatPhone(person.whatsapp) : 'Not on WhatsApp'],
    ['WhatsApp messages', consent?.stoppedAt
      ? `Asked us to stop on ${formatDateKey(consent.stoppedAt)}`
      : consent?.given ? `Agreed${consent.date ? ` on ${formatDateKey(consent.date)}` : ''}` : 'Not agreed'],
  ];
  if (person.email) details.push(['Email', <a href={`mailto:${person.email}`}>{person.email}</a>]);
  if (person.firstVisitDate) details.push(['First visit', formatDateKey(person.firstVisitDate)]);
  if (person.serviceAttended) details.push(['Service attended', person.serviceAttended]);
  if (person.howHeard) details.push(['Heard about us', person.howHeard]);
  if (person.invitedBy) {
    const inviter = person.invitedById ? byId(person.invitedById) : undefined;
    details.push(['Invited by', inviter ? <Link to={`/people/${inviter.orgId}/${inviter.id}`}>{inviter.fullName}</Link> : person.invitedBy]);
  }
  if (person.gender) details.push(['Gender', person.gender]);
  if (guardian) details.push(['Parent or guardian', <Link to={`/people/${guardian.orgId}/${guardian.id}`}>{guardian.fullName}</Link>]);
  for (const f of customFields.filter((c) => c.active)) {
    const v = person.customFields?.[f.id];
    if (v === undefined || v === null || v === '') continue;
    details.push([f.label, f.type === 'yesno' ? (v ? 'Yes' : 'No') : f.type === 'date' ? formatDateKey(String(v)) : String(v)]);
  }

  return (
    <div className="page narrow">
      <p><Link to="/people">← People</Link></p>
      <div className="person-head">
        <div>
          <h1>{person.fullName}</h1>
          <span className={`badge badge-${person.status}`}>{PERSON_STATUS_LABELS[person.status]}</span>
          {org && organizations.length > 1 && <span className="muted small"> · {org.name}</span>}
        </div>
        {canWrite && <Link className="btn" to={`/people/${orgId}/${personId}/edit`}>Edit</Link>}
      </div>

      {duplicates.length > 0 && (
        <div className="notice notice-warn">
          <strong>Possible duplicate.</strong> The same phone number is used by{' '}
          {duplicates.map((d, i) => (
            <span key={d!.id}>{i > 0 && ', '}<Link to={`/people/${d!.orgId}/${d!.id}`}>{d!.fullName}</Link></span>
          ))}.
          {canWrite && (
            <button type="button" className="btn btn-quiet" onClick={() => {
              updatePerson(orgId, personId, { possibleDuplicateIds: [] }).catch((e) => toast.show(friendlyError(e)));
            }}>Not a duplicate</button>
          )}
        </div>
      )}

      <section className="card">
        <dl className="details">
          {details.map(([k, v]) => (
            <div key={k}><dt>{k}</dt><dd>{v}</dd></div>
          ))}
        </dl>
        {canWrite && consent?.given && !consent.stoppedAt && (
          <button type="button" className="btn btn-quiet align-start" onClick={() => setConfirmStop(true)}>They asked us to stop WhatsApp messages</button>
        )}
      </section>

      {(household.length > 0 || children.length > 0) && (
        <section className="card">
          <h2>Family</h2>
          <ul className="plain">
            {[...household, ...children.filter((c) => !household.includes(c))].map((p) => (
              <li key={p.id}><Link to={`/people/${p.orgId}/${p.id}`}>{p.fullName}</Link> <span className="muted small">{PERSON_STATUS_LABELS[p.status]}</span></li>
            ))}
          </ul>
        </section>
      )}

      {can('followups.manage') && <FollowUpsForPerson orgId={orgId} personId={personId} />}
      {org?.type === 'church_campus' && <PipelineTimeline orgId={orgId} personId={personId} />}
      {can('pastoral.read') && <PastoralSection orgId={orgId} personId={personId} />}

      {canWrite && (
        <button type="button" className="btn btn-quiet danger-text align-start" onClick={() => setConfirmDelete(true)}>Delete {person.firstName || person.fullName}</button>
      )}

      <ConfirmDialog
        open={confirmDelete}
        title={`Delete ${person.fullName}?`}
        body="They will be moved to the bin. You can undo straight away, and the pastor can restore them for 30 days."
        confirmLabel="Delete"
        danger
        onConfirm={remove}
        onCancel={() => setConfirmDelete(false)}
      />
      <ConfirmDialog
        open={confirmStop}
        title="Stop WhatsApp messages?"
        body={`${person.firstName} will not be sent any more WhatsApp messages from the church. You can record new agreement later if they ask.`}
        confirmLabel="Stop messages"
        onConfirm={stopMessages}
        onCancel={() => setConfirmStop(false)}
      />
    </div>
  );
}
