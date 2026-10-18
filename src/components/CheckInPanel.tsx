import { useMemo, useRef, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../state/AuthContext';
import { usePeople, type Person } from '../state/PeopleContext';
import { useToast } from '../state/ToastContext';
import type { AttendanceMark, ChurchEvent } from '../state/useAttendance';
import type { Organization } from '../state/OrgContext';
import { markAttendance, undoAttendance } from '../lib/attendanceWrites';
import { addPerson } from '../lib/peopleWrites';
import { friendlyError } from '../lib/errors';
import { attended, type CheckInMethod } from '../../functions/src/shared/attendance';
import { formatTime, localDateKey } from '../../functions/src/shared/datetime';
import { matchesSearch, PERSON_STATUS_LABELS, tidyName } from '../../functions/src/shared/people';
import { formatPhone, normalizePhone } from '../../functions/src/shared/phone';

interface Props {
  org: Organization;
  event: ChurchEvent;
  byPerson: Map<string, AttendanceMark>;
  canRecord: boolean;
}

/** Name-by-name check-in: search, tap, done. Each tap saves on the device at once. */
export function CheckInPanel({ org, event, byPerson, canRecord }: Props) {
  const { people, byId } = usePeople();
  const toast = useToast();
  const [query, setQuery] = useState('');
  const searchRef = useRef<HTMLInputElement>(null);
  const present = useMemo(
    () => [...byPerson.values()].filter((m) => !m.deletedAt && attended(m.status))
      .sort((a, b) => (b.checkedInAt?.toMillis() ?? 0) - (a.checkedInAt?.toMillis() ?? 0)),
    [byPerson],
  );
  const results = useMemo(
    () => (query.trim().length >= 2 ? people.filter((p) => p.orgId === org.id && matchesSearch(p, query)).slice(0, 8) : []),
    [people, query, org.id],
  );

  function checkIn(person: Person, method: CheckInMethod = 'staff') {
    const existing = byPerson.get(person.id);
    markAttendance(org.id, event, person.id, 'present', method, existing).catch((err) => toast.show(friendlyError(err)));
    toast.show(`${person.fullName} checked in.`, {
      label: 'Undo',
      onAction: () => { undoAttendance(org.id, event.id, person.id).catch((err) => toast.show(friendlyError(err))); },
    });
    setQuery('');
    searchRef.current?.focus();
  }

  function undo(mark: AttendanceMark) {
    const name = byId(mark.personId)?.fullName ?? 'Check-in';
    undoAttendance(org.id, event.id, mark.personId).catch((err) => toast.show(friendlyError(err)));
    toast.show(`${name} taken off the list.`, {
      label: 'Undo',
      onAction: () => { markAttendance(org.id, event, mark.personId, 'present', mark.method, { ...mark, deletedAt: 'removed' }).catch((err) => toast.show(friendlyError(err))); },
    });
  }

  return (
    <>
      {canRecord && (
        <section className="card">
          <h2>Check people in</h2>
          <input
            ref={searchRef}
            type="search"
            className="search"
            placeholder="Type a name or phone number"
            aria-label="Find a person to check in"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          {results.length > 0 && (
            <ul className="row-list">
              {results.map((p) => {
                const mark = byPerson.get(p.id);
                const isIn = !!mark && !mark.deletedAt && attended(mark.status);
                return (
                  <li key={p.id} className="row">
                    <span className="row-main">
                      <span className="row-title">{p.fullName}<span className={`badge badge-${p.status}`}>{PERSON_STATUS_LABELS[p.status]}</span></span>
                      <span className="row-detail">{formatPhone(p.phone) || 'No phone'}</span>
                    </span>
                    {isIn
                      ? <span className="checked-in" aria-label={`${p.fullName} is checked in`}>✓ In</span>
                      : <button type="button" className="btn btn-primary" onClick={() => checkIn(p)}>Check in</button>}
                  </li>
                );
              })}
            </ul>
          )}
          {query.trim().length >= 2 && results.length === 0 && (
            org.type === 'church_campus'
              ? <QuickVisitor org={org} initialName={query} onAdded={(p) => checkIn(p)} onDone={() => setQuery('')} />
              : <p className="muted">Nobody matches. <Link to="/people/new">Add them in People</Link> first.</p>
          )}
        </section>
      )}

      <section className="card">
        <div className="card-head">
          <h2>Checked in</h2>
          <strong className="big-number">{present.length}</strong>
        </div>
        {present.length === 0 ? <p className="muted">Nobody yet.</p> : (
          <ul className="row-list">
            {present.map((m) => {
              const p = byId(m.personId);
              return (
                <li key={m.id} className="row">
                  <Link to={`/people/${org.id}/${m.personId}`} className="row-main">
                    <span className="row-title">{p?.fullName ?? 'Someone not on this device yet'}</span>
                    <span className="row-detail">
                      {m.checkedInAt ? formatTime(m.checkedInAt.toDate(), org.timeZone) : ''}
                      {m.method === 'door' ? ' · at the door' : ''}
                    </span>
                  </Link>
                  {canRecord && <button type="button" className="btn btn-quiet" onClick={() => undo(m)}>Undo</button>}
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </>
  );
}

/** For someone not in the system yet: name and phone, saved as a visitor and checked in together. */
function QuickVisitor({ org, initialName, onAdded, onDone }: { org: Organization; initialName: string; onAdded: (p: Person) => void; onDone: () => void }) {
  const { profile, can } = useAuth();
  const toast = useToast();
  const looksLikePhone = /^[\d\s+()-]+$/.test(initialName.trim());
  const [name, setName] = useState(looksLikePhone ? '' : initialName);
  const [phone, setPhone] = useState(looksLikePhone ? initialName : '');
  const [consent, setConsent] = useState(false);
  const [error, setError] = useState('');

  if (!can('people.write')) return <p className="muted">Nobody matches.</p>;

  function submit(e: FormEvent) {
    e.preventDefault();
    const normalized = normalizePhone(phone);
    if (!name.trim()) return setError('Enter their name.');
    if (!normalized) return setError('Enter a phone number we can reach them on, for example 0712 345 678.');
    const fullName = tidyName(name);
    const today = localDateKey(new Date(), org.timeZone);
    try {
      const input = {
        fullName, phone: normalized, whatsapp: normalized,
        whatsappConsent: { given: consent, date: today, recordedBy: profile?.uid ?? null, stoppedAt: null },
        status: 'visitor' as const, firstVisitDate: today, howHeard: null, invitedBy: null, invitedById: null, serviceAttended: null,
      };
      const { ref, synced } = addPerson(org.id, input, { recordVisitorStage: true });
      synced.catch((err) => toast.show(friendlyError(err)));
      onAdded({ id: ref.id, orgId: org.id, firstName: fullName.split(' ')[0] ?? '', deletedAt: null, ...input });
      onDone();
    } catch (err) {
      setError(friendlyError(err));
    }
  }

  return (
    <form className="form quick-visitor" onSubmit={submit} noValidate>
      <p><strong>Nobody matches.</strong> First time here? Add them as a visitor and check them in.</p>
      <label className="field"><span>Name</span><input autoCapitalize="words" value={name} onChange={(e) => setName(e.target.value)} /></label>
      <label className="field"><span>Phone (WhatsApp)</span><input type="tel" inputMode="tel" placeholder="0712 345 678" value={phone} onChange={(e) => setPhone(e.target.value)} /></label>
      <label className="check consent">
        <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} />
        <span><strong>They agreed</strong> to receive WhatsApp messages from us</span>
      </label>
      {error && <p className="error" role="alert">{error}</p>}
      <button type="submit" className="btn btn-primary btn-block">Add visitor and check in</button>
    </form>
  );
}
