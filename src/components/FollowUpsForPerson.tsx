import { useState } from 'react';
import { useAuth } from '../state/AuthContext';
import { useToast } from '../state/ToastContext';
import type { Organization } from '../state/OrgContext';
import type { Person } from '../state/PeopleContext';
import { useFollowUpsForPerson, useMessagesForPerson, useStaff } from '../state/useFollowUps';
import { addFollowUp } from '../lib/followUpWrites';
import { friendlyError } from '../lib/errors';
import { useSavedMessage } from '../lib/useSavedMessage';
import { FollowUpCard } from './FollowUpCard';
import { WhatsAppSheet } from './WhatsAppSheet';
import { formatDateTime, localDateKey } from '../../functions/src/shared/datetime';

/** A person's follow-ups, the WhatsApp messages sent to them, and a way to send one. */
export function FollowUpsForPerson({ org, person }: { org: Organization; person: Person }) {
  const { can } = useAuth();
  const toast = useToast();
  const saved = useSavedMessage();
  const { open, done } = useFollowUpsForPerson(org.id, person.id);
  const messages = useMessagesForPerson(org.id, person.id);
  const staff = useStaff(org.id);
  const [sending, setSending] = useState(false);
  const [adding, setAdding] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const today = localDateKey(new Date(), org.timeZone);
  const [form, setForm] = useState({ note: '', dueDate: today, assignee: '' });
  const manage = can('followups.manage');

  function add() {
    if (form.note.trim().length < 2) return;
    addFollowUp(org.id, person, { note: form.note, dueDate: form.dueDate, timeZone: org.timeZone, assignee: staff.find((s) => s.id === form.assignee) ?? null })
      .synced.catch((err) => toast.show(friendlyError(err)));
    toast.show(saved('Follow-up added'));
    setForm({ note: '', dueDate: today, assignee: '' });
    setAdding(false);
  }

  return (
    <section className="card stack" aria-labelledby="fu-h">
      <div className="card-head">
        <h2 id="fu-h">Follow-up</h2>
        {manage && <button type="button" className="btn btn-quiet" onClick={() => setSending(true)}>Message on WhatsApp</button>}
      </div>

      {open.length > 0 && (
        <ul className="plain stack">
          {open.map((t) => <FollowUpCard key={t.id} org={org} task={t} staff={staff} showPerson={false} />)}
        </ul>
      )}
      {open.length === 0 && <p className="muted small">No follow-up is open.</p>}

      {manage && (adding ? (
        <form className="form" onSubmit={(e) => { e.preventDefault(); add(); }}>
          <label className="field"><span>What needs doing?</span><input autoFocus value={form.note} maxLength={1000} onChange={(e) => setForm({ ...form, note: e.target.value })} placeholder="For example: call about the hospital visit" /></label>
          <div className="field-row">
            <label className="field"><span>By</span><input type="date" value={form.dueDate} min={today} onChange={(e) => e.target.value && setForm({ ...form, dueDate: e.target.value })} /></label>
            <label className="field">
              <span>Who</span>
              <select value={form.assignee} onChange={(e) => setForm({ ...form, assignee: e.target.value })}>
                <option value="">Not assigned</option>
                {staff.map((s) => <option key={s.id} value={s.id}>{s.displayName}</option>)}
              </select>
            </label>
          </div>
          <div className="dialog-actions">
            <button type="button" className="btn btn-quiet" onClick={() => setAdding(false)}>Cancel</button>
            <button type="submit" className="btn btn-primary" disabled={form.note.trim().length < 2}>Add follow-up</button>
          </div>
        </form>
      ) : (
        <button type="button" className="btn btn-quiet align-start" onClick={() => setAdding(true)}>Add a follow-up</button>
      ))}

      {(done.length > 0 || messages.length > 0) && (
        <>
          <button type="button" className="btn btn-quiet align-start" aria-expanded={showHistory} onClick={() => setShowHistory(!showHistory)}>
            {showHistory ? 'Hide history' : `History (${messages.length} ${messages.length === 1 ? 'message' : 'messages'}, ${done.length} done)`}
          </button>
          {showHistory && (
            <>
              {messages.length > 0 && (
                <ul className="note-list" aria-label="Messages sent">
                  {messages.map((m) => (
                    <li key={m.id}>
                      <p>WhatsApp: {m.templateName}{m.viaGuardian ? ` (to ${m.toName}, parent or guardian)` : ''}</p>
                      <span className="muted small">{m.senderName}{m.createdAt ? `, ${formatDateTime(m.createdAt.toDate(), org.timeZone)}` : ', waiting to sync'}</span>
                    </li>
                  ))}
                </ul>
              )}
              {done.length > 0 && (
                <ul className="plain stack">
                  {done.slice(0, 10).map((t) => <FollowUpCard key={t.id} org={org} task={t} staff={staff} showPerson={false} />)}
                </ul>
              )}
            </>
          )}
        </>
      )}

      {sending && <WhatsAppSheet org={org} person={person} templateId={open[0]?.templateId ?? 'checkin_48h'} followUp={null} onClose={() => setSending(false)} />}
    </section>
  );
}
