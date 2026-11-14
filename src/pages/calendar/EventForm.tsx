import { useMemo, useState, type CSSProperties } from 'react';
import { collection } from 'firebase/firestore';
import { db } from '../../firebase';
import { useAuth } from '../../state/AuthContext';
import { useToast } from '../../state/ToastContext';
import type { Organization } from '../../state/OrgContext';
import { useLiveQuery } from '../../lib/useQuery';
import { orgShort } from '../../state/useCalendar';
import { createEvent, saveEvent, type EventInput, type Scope } from '../../lib/calendarWrites';
import { friendlyError } from '../../lib/errors';
import {
  addDays, DEFAULT_ALL_DAY_REMINDERS, DEFAULT_REMINDERS, EVENT_TYPES, EVENT_TYPE_INFO, MAX_REMINDERS, REMINDER_CHOICES, REPEATS, reminderLabel, repeatLabel,
  type EventType, type Repeat,
} from '../../../functions/src/shared/calendar';
import type { Editing } from './CalendarBoard';

interface StaffRow { id: string; displayName: string; active: boolean; allOrgs?: boolean; orgIds?: string[] }

function plusHour(t: string): string {
  const h = Math.min(23, Number(t.slice(0, 2)) + 1);
  return `${String(h).padStart(2, '0')}:${t.slice(3, 5)}`;
}

/** Add or change an event. The rarely used parts (in charge, invite, notes) are folded away (simplicity is the policy). */
export function EventForm({ editing, orgs, onClose }: { editing: Editing; orgs: Organization[]; onClose: () => void }) {
  const { profile } = useAuth();
  const toast = useToast();
  const e = editing.item?.event;
  const day = editing.item?.date ?? editing.day;
  const [orgId, setOrgId] = useState(e?.orgId ?? editing.orgId);
  const [title, setTitle] = useState(e?.title ?? '');
  const [type, setType] = useState<EventType>(e?.type ?? 'meeting');
  const [allDay, setAllDay] = useState(e?.allDay ?? false);
  const [date, setDate] = useState(day);
  const [endDate, setEndDate] = useState(editing.item?.endDate ?? day);
  const [manyDays, setManyDays] = useState(!!editing.item && editing.item.endDate !== editing.item.date);
  const [start, setStart] = useState(e?.start ?? editing.start ?? '10:00');
  const [end, setEnd] = useState(e?.end ?? plusHour(editing.start ?? '10:00'));
  const [repeat, setRepeat] = useState<Repeat>(e?.repeat ?? 'none');
  const [until, setUntil] = useState(e?.repeatUntil ?? '');
  const [place, setPlace] = useState(e?.place ?? '');
  const [inCharge, setInCharge] = useState(e?.inCharge ?? '');
  const [notes, setNotes] = useState(e?.notes ?? '');
  const [reminders, setReminders] = useState<number[]>(e?.reminders ?? DEFAULT_REMINDERS);
  const [touchedReminders, setTouchedReminders] = useState(!!e);
  const [remindAll, setRemindAll] = useState(e?.remindAll ?? false);
  const [invited, setInvited] = useState<string[]>(e?.invited ?? []);
  const [find, setFind] = useState('');
  const [scopeAsk, setScopeAsk] = useState(false);
  const [problem, setProblem] = useState('');

  const { rows: staffRows } = useLiveQuery<StaffRow>(() => collection(db, 'staff'), []);
  const staff = useMemo(() => staffRows
    .filter((s) => s.active && s.id !== profile?.uid && (s.allOrgs || s.orgIds?.includes(orgId)))
    .sort((a, b) => a.displayName.localeCompare(b.displayName)), [staffRows, orgId, profile?.uid]);
  const names = useMemo(() => Object.fromEntries([...staffRows.map((s) => [s.id, s.displayName] as const), ...Object.entries(e?.invitedNames ?? {})]), [staffRows, e]);
  const org = orgs.find((o) => o.id === orgId);

  function setAllDayAndReminders(v: boolean) {
    setAllDay(v);
    if (!touchedReminders) setReminders(v ? DEFAULT_ALL_DAY_REMINDERS : DEFAULT_REMINDERS);
  }
  function changeDate(v: string) {
    const span = Math.max(0, Math.round((Date.parse(endDate) - Date.parse(date)) / 86_400_000));
    setDate(v);
    if (v) setEndDate(addDays(v, span));
  }

  function input(): EventInput | null {
    if (!title.trim()) { setProblem('Give the event a name.'); return null; }
    if (!date) { setProblem('Choose the day.'); return null; }
    const last = manyDays ? endDate : date;
    if (last < date) { setProblem('The last day is before the first day.'); return null; }
    if (!allDay && !manyDays && end && start && end <= start) { setProblem('It ends before it starts. Check the times.'); return null; }
    if (repeat !== 'none' && until && until < date) { setProblem('"Until" is before the first day.'); return null; }
    setProblem('');
    return {
      title, type, allDay, date, endDate: last, start: allDay ? null : start || null, end: allDay ? null : end || null, place, inCharge, notes,
      repeat, repeatUntil: repeat === 'none' ? null : until || null, reminders, remindAll, invited,
      invitedNames: Object.fromEntries(invited.map((u) => [u, names[u] ?? ''])),
    };
  }

  function save(scope?: Scope) {
    const data = input();
    if (!data) return;
    if (e && e.repeat !== 'none' && !scope) { setScopeAsk(true); return; }
    const done = e ? saveEvent(e, data, day, scope ?? 'all') : createEvent(orgId, data).synced;
    done.catch((err) => toast.show(friendlyError(err)));
    toast.show(e ? 'Saved.' : `Added to the ${orgShort(org)} calendar.`);
    onClose();
  }

  const reminderChoices = REMINDER_CHOICES.filter((m) => !allDay || [0, 1440, 2880, 10080].includes(m));

  return (
    <div className="sheet-backdrop" role="presentation" onClick={onClose}>
      <div className="sheet cal-form" role="dialog" aria-modal="true" aria-labelledby="cal-form-h" onClick={(x) => x.stopPropagation()}>
        <h2 id="cal-form-h">{e ? 'Change the event' : 'New event'}</h2>

        <label className="field"><span>Name</span>
          <input value={title} maxLength={120} autoFocus={!e} placeholder="e.g. Leaders' meeting" onChange={(x) => setTitle(x.target.value)} />
        </label>

        <div className="cal-types" role="radiogroup" aria-label="Kind of event">
          {EVENT_TYPES.map((t) => (
            <button key={t} type="button" role="radio" aria-checked={type === t} className={`cal-type-pick${type === t ? ' on' : ''}`} style={{ '--ev': EVENT_TYPE_INFO[t].colour } as CSSProperties} onClick={() => setType(t)}>
              {EVENT_TYPE_INFO[t].icon} {EVENT_TYPE_INFO[t].label}
            </button>
          ))}
        </div>

        {!e && orgs.length > 1 && (
          <label className="field"><span>Calendar</span>
            <select value={orgId} onChange={(x) => setOrgId(x.target.value)}>
              {orgs.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
            </select>
          </label>
        )}

        <div className="field-row">
          <label className="field"><span>{manyDays ? 'First day' : 'Day'}</span><input type="date" value={date} onChange={(x) => changeDate(x.target.value)} /></label>
          {manyDays && <label className="field"><span>Last day</span><input type="date" value={endDate} min={date} onChange={(x) => setEndDate(x.target.value)} /></label>}
        </div>
        {!allDay && (
          <div className="field-row">
            <label className="field"><span>Starts</span><input type="time" value={start} onChange={(x) => { const v = x.target.value; setStart(v); if (v && (!end || end <= v)) setEnd(plusHour(v)); }} /></label>
            <label className="field"><span>Ends</span><input type="time" value={end} onChange={(x) => setEnd(x.target.value)} /></label>
          </div>
        )}
        <div className="cal-inline-checks">
          <label className="check"><input type="checkbox" checked={allDay} onChange={(x) => setAllDayAndReminders(x.target.checked)} /> All day</label>
          <label className="check"><input type="checkbox" checked={manyDays} onChange={(x) => { setManyDays(x.target.checked); if (!x.target.checked) setEndDate(date); }} /> More than one day</label>
        </div>

        <div className="field-row">
          <label className="field"><span>Repeats</span>
            <select value={repeat} onChange={(x) => setRepeat(x.target.value as Repeat)}>
              {REPEATS.map((r) => <option key={r} value={r}>{repeatLabel({ date: date || day, repeat: r, repeatUntil: null })}</option>)}
            </select>
          </label>
          {repeat !== 'none' && <label className="field"><span>Until (optional)</span><input type="date" value={until} min={date} onChange={(x) => setUntil(x.target.value)} /></label>}
        </div>

        <label className="field"><span>Where</span><input value={place} maxLength={160} placeholder="e.g. Main hall, or Google Meet" onChange={(x) => setPlace(x.target.value)} /></label>

        <fieldset className="field">
          <legend>Reminders</legend>
          <div className="cal-reminders">
            {reminders.map((m, i) => (
              <div key={`${m}-${i}`} className="cal-reminder">
                <select value={m} onChange={(x) => { setTouchedReminders(true); setReminders(reminders.map((r, k) => (k === i ? Number(x.target.value) : r))); }}>
                  {[...new Set([m, ...reminderChoices])].map((c) => <option key={c} value={c}>{reminderLabel(c, allDay)}</option>)}
                </select>
                <button type="button" className="btn btn-quiet" aria-label="Remove this reminder" onClick={() => { setTouchedReminders(true); setReminders(reminders.filter((_, k) => k !== i)); }}>✕</button>
              </div>
            ))}
            {reminders.length < MAX_REMINDERS && (
              <button type="button" className="btn btn-quiet align-start" onClick={() => { setTouchedReminders(true); setReminders([...reminders, reminderChoices.find((c) => !reminders.includes(c)) ?? 60]); }}>＋ Add a reminder</button>
            )}
          </div>
          <p className="small muted">A pop-up on your phone or computer and an email, to you{invited.length ? ' and the people invited' : ''}{remindAll ? ` and everyone at ${orgShort(org)}` : ''}.</p>
        </fieldset>

        <details className="cal-more-details" open={!!(e && (e.inCharge || e.notes || e.invited?.length || e.remindAll))}>
          <summary>More: who is in charge, invite people, notes</summary>
          <label className="field"><span>Who is in charge</span><input value={inCharge} maxLength={120} placeholder="e.g. Pastor Doreen" onChange={(x) => setInCharge(x.target.value)} /></label>
          <fieldset className="field">
            <legend>Invite people (they answer Yes or No)</legend>
            {invited.length > 0 && (
              <div className="cal-invited">
                {invited.map((u) => <button key={u} type="button" className="chip chip-on" onClick={() => setInvited(invited.filter((x) => x !== u))}>{names[u] || 'Someone'} ✕</button>)}
              </div>
            )}
            <input value={find} placeholder="Type a name to find someone" onChange={(x) => setFind(x.target.value)} />
            {find.trim() && (
              <div className="cal-people">
                {staff.filter((s) => !invited.includes(s.id) && s.displayName.toLowerCase().includes(find.trim().toLowerCase())).slice(0, 8).map((s) => (
                  <button key={s.id} type="button" className="chip" onClick={() => { setInvited([...invited, s.id]); setFind(''); }}>＋ {s.displayName}</button>
                ))}
              </div>
            )}
            {!find.trim() && staff.length > 0 && (
              <button type="button" className="btn btn-quiet align-start" onClick={() => setInvited([...new Set([...invited, ...staff.map((s) => s.id)])])}>Invite everyone with an account at {orgShort(org)} ({staff.length})</button>
            )}
          </fieldset>
          <label className="check"><input type="checkbox" checked={remindAll} onChange={(x) => setRemindAll(x.target.checked)} /> Remind everyone at {orgShort(org)}, not only the people invited</label>
          <label className="field"><span>Notes</span><textarea rows={3} maxLength={3000} value={notes} onChange={(x) => setNotes(x.target.value)} /></label>
        </details>

        {problem && <p className="error">{problem}</p>}

        {scopeAsk ? (
          <div className="cal-scope">
            <b>It repeats. Change which?</b>
            <button type="button" className="btn btn-quiet" onClick={() => save('one')}>Only this day</button>
            <button type="button" className="btn btn-quiet" onClick={() => save('following')}>This day and after</button>
            <button type="button" className="btn btn-primary" onClick={() => save('all')}>Every day of it</button>
          </div>
        ) : (
          <div className="sheet-actions btn-line">
            <button type="button" className="btn btn-quiet" onClick={onClose}>Cancel</button>
            <button type="button" className="btn btn-primary" onClick={() => save()}>{e ? 'Save' : 'Add the event'}</button>
          </div>
        )}
      </div>
    </div>
  );
}
