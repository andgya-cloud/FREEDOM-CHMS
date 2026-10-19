import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../state/AuthContext';
import { usePeople } from '../state/PeopleContext';
import { useToast } from '../state/ToastContext';
import { dueLabel, type FollowUp, type StaffMember } from '../state/useFollowUps';
import type { Organization } from '../state/OrgContext';
import { assign, markDone, reopen, setNote, stopWhatsApp } from '../lib/followUpWrites';
import { friendlyError } from '../lib/errors';
import { useSavedMessage } from '../lib/useSavedMessage';
import { WhatsAppSheet } from './WhatsAppSheet';
import { FOLLOW_UP_OUTCOMES, FOLLOW_UP_REASON_LABELS, type FollowUpOutcome } from '../../functions/src/shared/followups';
import { formatDate, formatDateKey, localDateKey } from '../../functions/src/shared/datetime';

interface Props {
  org: Organization;
  task: FollowUp;
  staff: StaffMember[];
  /** On a person's own page the name is already at the top. */
  showPerson?: boolean;
}

/** One follow-up: why, since when, who has it, and the buttons to work it. */
export function FollowUpCard({ org, task, staff, showPerson = true }: Props) {
  const { can, user } = useAuth();
  const { byId } = usePeople();
  const toast = useToast();
  const saved = useSavedMessage();
  const person = byId(task.personId);
  const guardian = person?.guardianId ? byId(person.guardianId) : undefined;
  const [mode, setMode] = useState<'' | 'whatsapp' | 'done' | 'note'>('');
  const [outcome, setOutcome] = useState<FollowUpOutcome>('Reached');
  const [note, setNoteText] = useState(task.note ?? '');
  const due = dueLabel(task, org.timeZone);
  const callPhone = person?.status === 'child' ? guardian?.phone : person?.phone;
  const since = task.reason === 'care_absent' && task.absentSince
    ? `Last at church ${formatDateKey(task.absentSince)}`
    : task.reason === 'child_absent' && task.absentSince
    ? `Missed since ${formatDateKey(task.absentSince)}`
    : task.createdAt ? `Since ${formatDate(task.createdAt.toDate(), org.timeZone)}` : '';
  const fail = (err: unknown) => toast.show(friendlyError(err));

  function done() {
    markDone(task, outcome, note).catch(fail);
    if (outcome === 'Asked us to stop' && person) stopWhatsApp(person, localDateKey(new Date(), org.timeZone)).catch(fail);
    toast.show(saved(outcome === 'Asked us to stop' ? `Done. ${person?.firstName ?? 'They'} won't be sent WhatsApp messages from the app` : `${task.personName}: done`), {
      label: 'Undo', onAction: () => { reopen(task).catch(fail); },
    });
    setMode('');
  }

  function assignTo(id: string) {
    const member = staff.find((s) => s.id === id) ?? null;
    assign(task, member).catch(fail);
    toast.show(saved(member ? `Given to ${member.displayName}` : 'Not assigned'));
  }

  return (
    <li className={`card stack follow-up${due.tone ? ` follow-up-${due.tone}` : ''}`}>
      <div className="card-head">
        <div>
          {showPerson && <h3 className="follow-up-name">{person ? <Link to={`/people/${org.id}/${task.personId}`}>{person.fullName}</Link> : task.personName}</h3>}
          <p className="follow-up-reason">{FOLLOW_UP_REASON_LABELS[task.reason] ?? 'Follow-up'}</p>
        </div>
        {task.status === 'done'
          ? <span className="badge badge-regular">Done</span>
          : due.text && <span className={`badge ${due.tone === 'danger' ? 'badge-warn' : due.tone === 'warn' ? 'badge-visitor' : 'badge-member'}`}>{due.text}</span>}
      </div>
      <p className="muted small">
        {since}
        {task.assignedTo ? ` · ${task.assignedTo === user?.uid ? 'Yours' : `With ${task.assignedName ?? 'staff'}`}` : ' · Not assigned'}
        {task.lastMessageAt && ` · Messaged ${formatDate(task.lastMessageAt.toDate(), org.timeZone)}`}
      </p>
      {task.note && mode !== 'note' && <p className="follow-up-note">{task.note}</p>}
      {task.status === 'done' && <p className="small">{task.outcome}{task.doneAt ? `, ${formatDate(task.doneAt.toDate(), org.timeZone)}` : ''}</p>}
      {!person && <p className="muted small">This person's record is not on this device or was removed.</p>}

      {task.status === 'open' && person && mode === '' && (
        <div className="sheet-actions">
          <button type="button" className="btn btn-primary" onClick={() => setMode('whatsapp')}>WhatsApp</button>
          {callPhone && <a className="btn" href={`tel:${callPhone}`}>Call</a>}
          <button type="button" className="btn" onClick={() => setMode('done')}>Done</button>
          <button type="button" className="btn btn-quiet" onClick={() => setMode('note')}>{task.note ? 'Change note' : 'Add note'}</button>
        </div>
      )}
      {task.status === 'done' && (
        <button type="button" className="btn btn-quiet align-start" onClick={() => { reopen(task).catch(fail); }}>Open it again</button>
      )}

      {mode === 'done' && (
        <form className="form" onSubmit={(e) => { e.preventDefault(); done(); }}>
          <label className="field">
            <span>What happened?</span>
            <select value={outcome} onChange={(e) => setOutcome(e.target.value as FollowUpOutcome)}>
              {FOLLOW_UP_OUTCOMES.map((o) => <option key={o}>{o}</option>)}
            </select>
          </label>
          {outcome === 'Asked us to stop' && <p className="small">Their record will say they asked us to stop, and the app won't open WhatsApp for them again.</p>}
          <label className="field"><span>Note (optional)</span><input value={note} onChange={(e) => setNoteText(e.target.value)} maxLength={1000} /></label>
          <div className="dialog-actions">
            <button type="button" className="btn btn-quiet" onClick={() => setMode('')}>Cancel</button>
            <button type="submit" className="btn btn-primary">Mark done</button>
          </div>
        </form>
      )}

      {mode === 'note' && (
        <form className="form" onSubmit={(e) => { e.preventDefault(); setNote(task, note).catch(fail); setMode(''); }}>
          <label className="field"><span>Note</span><input autoFocus value={note} onChange={(e) => setNoteText(e.target.value)} maxLength={1000} /></label>
          <div className="dialog-actions">
            <button type="button" className="btn btn-quiet" onClick={() => setMode('')}>Cancel</button>
            <button type="submit" className="btn btn-primary">Save note</button>
          </div>
        </form>
      )}

      {task.status === 'open' && can('followups.manage') && staff.length > 0 && (
        <label className="field follow-up-assign">
          <span className="visually-hidden">Assign to</span>
          <select value={task.assignedTo ?? ''} onChange={(e) => assignTo(e.target.value)} aria-label={`Assign ${task.personName}'s follow-up`}>
            <option value="">Not assigned</option>
            {staff.map((s) => <option key={s.id} value={s.id}>{s.id === user?.uid ? `Me (${s.displayName})` : s.displayName}</option>)}
          </select>
        </label>
      )}

      {mode === 'whatsapp' && person && (
        <WhatsAppSheet org={org} person={person} templateId={task.templateId ?? 'checkin_48h'} followUp={task} onClose={() => setMode('')} />
      )}
    </li>
  );
}
