import { useState, type CSSProperties } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../../state/AuthContext';
import { useToast } from '../../state/ToastContext';
import type { Organization } from '../../state/OrgContext';
import { orgColour, orgShort, type CalItem } from '../../state/useCalendar';
import { answerInvite, deleteEvent, type Scope } from '../../lib/calendarWrites';
import { friendlyError } from '../../lib/errors';
import { EVENT_TYPE_INFO, reminderLabel, repeatLabel, whenLabel, type CalendarEvent } from '../../../functions/src/shared/calendar';

/** One event, opened: when, where, who is coming, my answer, and Change or Delete for those who may. */
export function EventSheet({ item, org, all, canEdit, onClose, onEdit }: {
  item: CalItem; org: Organization | undefined; all: CalendarEvent[]; canEdit: boolean; onClose: () => void; onEdit: (it: CalItem) => void;
}) {
  const { profile } = useAuth();
  const toast = useToast();
  const [asking, setAsking] = useState(false);
  const e = item.event;
  const info = EVENT_TYPE_INFO[item.type] ?? EVENT_TYPE_INFO.other;
  const when = whenLabel({ allDay: item.allDay, start: item.start, end: item.end }, { date: item.date, endDate: item.endDate });
  const uid = profile?.uid ?? '';
  const invited = e?.invited ?? [];
  const mine = e?.responses?.[uid];
  const yes = invited.filter((u) => e?.responses?.[u] === 'yes');
  const no = invited.filter((u) => e?.responses?.[u] === 'no');
  const waiting = invited.filter((u) => !e?.responses?.[u]);
  const name = (u: string) => e?.invitedNames?.[u] || 'Someone';

  function answer(a: 'yes' | 'no') {
    if (!e) return;
    answerInvite(e, a).catch((err) => toast.show(friendlyError(err)));
    toast.show(a === 'yes' ? 'Thank you. They know you are coming.' : 'Thank you for letting them know.');
  }

  function remove(scope: Scope) {
    if (!e) return;
    deleteEvent(e, item.date, scope, all).catch((err) => toast.show(friendlyError(err)));
    toast.show(scope === 'one' ? 'That day is taken out.' : 'Deleted.');
    onClose();
  }

  return (
    <div className="sheet-backdrop" role="presentation" onClick={onClose}>
      <div className="sheet cal-sheet" role="dialog" aria-modal="true" aria-labelledby="cal-ev-h" onClick={(x) => x.stopPropagation()} style={{ '--ev': info.colour, '--org': orgColour(org) } as CSSProperties}>
        <div className="cal-sheet-band" aria-hidden="true" />
        <div className="cal-sheet-tags">
          <span className="cal-type">{info.icon} {info.label}</span>
          {org && <span className="cal-place-tag"><i aria-hidden="true" />{orgShort(org)}</span>}
          {item.auto && <span className="cal-type cal-type-auto">From the app</span>}
        </div>
        <h2 id="cal-ev-h">{item.title}</h2>
        <p className="cal-when">{when}</p>
        {e && e.repeat !== 'none' && <p className="small muted">🔁 {repeatLabel(e)}</p>}
        {item.place && <p>📍 {item.place}</p>}
        {e?.inCharge && <p>🙋 In charge: {e.inCharge}</p>}
        {e?.notes && <p className="cal-notes">{e.notes}</p>}
        {item.auto?.detail && <p className="small">{item.auto.detail}</p>}

        {e && invited.includes(uid) && (
          <div className="cal-rsvp">
            <b>{mine ? `You said ${mine === 'yes' ? 'Yes' : 'No'}.` : 'Are you coming?'}</b>
            <div className="btn-line">
              <button type="button" className={`btn ${mine === 'yes' ? 'btn-primary' : 'btn-quiet'}`} onClick={() => answer('yes')}>✓ Yes</button>
              <button type="button" className={`btn ${mine === 'no' ? 'btn-danger' : 'btn-quiet'}`} onClick={() => answer('no')}>✗ No</button>
            </div>
          </div>
        )}

        {e && invited.length > 0 && (
          <details className="cal-guests" open={invited.length <= 8}>
            <summary>{invited.length} invited · {yes.length} yes · {no.length} no · {waiting.length} not answered</summary>
            <ul>
              {[...yes, ...no, ...waiting].map((u) => (
                <li key={u}><span className={`cal-ans cal-ans-${e.responses?.[u] ?? 'wait'}`}>{e.responses?.[u] === 'yes' ? '✓' : e.responses?.[u] === 'no' ? '✗' : '…'}</span> {name(u)}</li>
              ))}
            </ul>
          </details>
        )}

        {e && (
          <p className="small muted">
            🔔 {e.reminders.length ? e.reminders.map((m) => reminderLabel(m, e.allDay)).join(', ') : 'No reminders'}
            {e.remindAll ? ` · to everyone at ${orgShort(org)}` : ''}
            {e.createdByName ? ` · Added by ${e.createdByName}` : ''}
          </p>
        )}

        {asking && e ? (
          <div className="cal-scope">
            {e.repeat === 'none' ? <>
              <b>Delete this event?</b>
              <button type="button" className="btn btn-danger" onClick={() => remove('all')}>Delete it</button>
            </> : <>
              <b>It repeats. Delete which?</b>
              <button type="button" className="btn btn-quiet" onClick={() => remove('one')}>Only this day</button>
              <button type="button" className="btn btn-quiet" onClick={() => remove('following')}>This day and after</button>
              <button type="button" className="btn btn-danger" onClick={() => remove('all')}>Every day of it</button>
            </>}
            <button type="button" className="btn btn-quiet" onClick={() => setAsking(false)}>Keep it</button>
          </div>
        ) : (
          <div className="sheet-actions btn-line">
            {item.auto?.link && <Link to={item.auto.link} className="btn btn-quiet" onClick={onClose}>Open</Link>}
            {e && canEdit && <button type="button" className="btn btn-quiet" onClick={() => onEdit(item)}>✏️ Change</button>}
            {e && canEdit && <button type="button" className="btn btn-quiet" onClick={() => setAsking(true)}>🗑 Delete</button>}
            <button type="button" className="btn btn-primary" onClick={onClose}>Close</button>
          </div>
        )}
      </div>
    </div>
  );
}
