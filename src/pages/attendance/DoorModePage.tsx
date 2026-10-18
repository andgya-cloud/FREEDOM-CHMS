import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useAuth } from '../../state/AuthContext';
import { useOrg } from '../../state/OrgContext';
import { usePeople, type Person } from '../../state/PeopleContext';
import { useToast } from '../../state/ToastContext';
import { useEvent, useEventAttendance } from '../../state/useAttendance';
import { markAttendance, undoAttendance } from '../../lib/attendanceWrites';
import { addPerson } from '../../lib/peopleWrites';
import { friendlyError } from '../../lib/errors';
import { ConfirmDialog } from '../../components/ConfirmDialog';
import { SyncBadge } from '../../components/SyncBadge';
import { attended, doorName, phoneHint } from '../../../functions/src/shared/attendance';
import { localDateKey } from '../../../functions/src/shared/datetime';
import { firstName, matchesSearch, tidyName } from '../../../functions/src/shared/people';
import { normalizePhone } from '../../../functions/src/shared/phone';

const WELCOME_MS = 4000;

type Screen =
  | { kind: 'search' }
  | { kind: 'new' }
  | { kind: 'welcome'; personId: string; name: string; already: boolean; isNew: boolean };

/**
 * The tablet at the door. Full screen, big buttons, and only first names
 * with an initial, since anyone walking past can see it. Staff sign in, open
 * a service, then hand it over. Works with no internet.
 */
export function DoorModePage() {
  const { orgId = '', eventId = '' } = useParams();
  const { can, profile } = useAuth();
  const { organizations, currentId, select } = useOrg();
  const { people } = usePeople();
  const toast = useToast();
  const navigate = useNavigate();
  const { event, missing } = useEvent(orgId, eventId);
  const { byPerson } = useEventAttendance(orgId, eventId);
  const [query, setQuery] = useState('');
  const [screen, setScreen] = useState<Screen>({ kind: 'search' });
  const [confirmExit, setConfirmExit] = useState(false);
  const searchRef = useRef<HTMLInputElement>(null);
  const org = organizations.find((o) => o.id === orgId);

  useEffect(() => { if (org && currentId !== orgId) select(orgId); }, [org?.id, currentId]);

  // Back to the search box by itself, ready for the next person.
  useEffect(() => {
    if (screen.kind !== 'welcome') return;
    const t = window.setTimeout(() => setScreen({ kind: 'search' }), WELCOME_MS);
    return () => window.clearTimeout(t);
  }, [screen]);
  useEffect(() => { if (screen.kind === 'search') searchRef.current?.focus(); }, [screen.kind]);

  // At least three letters, so nobody can scroll through the whole church list.
  const results = useMemo(
    () => (query.trim().length >= 3 ? people.filter((p) => p.orgId === orgId && p.status !== 'inactive' && matchesSearch(p, query)).slice(0, 6) : []),
    [people, query, orgId],
  );
  const count = [...byPerson.values()].filter((m) => !m.deletedAt && attended(m.status)).length;

  if (!can('attendance.write')) {
    return <div className="door"><p>You need permission to record attendance.</p><button className="btn" type="button" onClick={() => navigate('/')}>Back</button></div>;
  }
  if (!org || !event || event.deletedAt) {
    return (
      <div className="door">
        <p>{missing ? 'This service was not found.' : 'Loading…'}</p>
        <button className="btn" type="button" onClick={() => navigate('/attendance')}>Back to attendance</button>
      </div>
    );
  }

  function checkIn(p: Person) {
    const mark = byPerson.get(p.id);
    const already = !!mark && !mark.deletedAt && attended(mark.status);
    if (!already) markAttendance(org!.id, event!, p.id, 'present', 'door', mark).catch((err) => toast.show(friendlyError(err)));
    setQuery('');
    setScreen({ kind: 'welcome', personId: p.id, name: p.firstName || firstName(p.fullName), already, isNew: false });
  }

  function notMe(personId: string) {
    undoAttendance(org!.id, event!.id, personId).catch((err) => toast.show(friendlyError(err)));
    setScreen({ kind: 'search' });
  }

  return (
    <div className="door">
      <header className="door-head">
        <div>
          <strong>{event.name}</strong>
          <span className="muted"> · {org.name}</span>
        </div>
        <div className="door-head-right">
          <span className="door-count" aria-label={`${count} checked in`}>{count} in</span>
          <SyncBadge />
          <button type="button" className="btn btn-quiet" onClick={() => setConfirmExit(true)}>Exit</button>
        </div>
      </header>

      {screen.kind === 'search' && (
        <main className="door-main">
          <h1>Welcome! Please check in.</h1>
          <input
            ref={searchRef}
            className="door-search"
            type="search"
            autoComplete="off"
            placeholder="Type your name or phone number"
            aria-label="Your name or phone number"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          {query.trim().length > 0 && query.trim().length < 3 && <p className="muted">Keep typing…</p>}
          <div className="door-results">
            {results.map((p) => {
              const mark = byPerson.get(p.id);
              const isIn = !!mark && !mark.deletedAt && attended(mark.status);
              return (
                <button key={p.id} type="button" className={`door-person ${isIn ? 'is-in' : ''}`} onClick={() => checkIn(p)}>
                  <span className="door-person-name">{doorName(p.fullName)}</span>
                  <span className="door-person-hint">{isIn ? 'Already checked in' : phoneHint(p.phone)}</span>
                </button>
              );
            })}
          </div>
          {query.trim().length >= 3 && results.length === 0 && <p className="lead">We could not find you.</p>}
          {org.type === 'church_campus' && can('people.write') && (
            <button type="button" className="btn btn-lg door-new" onClick={() => { setScreen({ kind: 'new' }); }}>First time here?</button>
          )}
        </main>
      )}

      {screen.kind === 'new' && (
        <NewHere
          orgName={org.name}
          initial={query}
          onCancel={() => setScreen({ kind: 'search' })}
          onSave={(input) => {
            const today = localDateKey(new Date(), org.timeZone);
            try {
              const { ref, synced } = addPerson(org.id, {
                fullName: input.name, phone: input.phone, whatsapp: input.phone,
                whatsappConsent: { given: input.consent, date: today, recordedBy: profile?.uid ?? null, stoppedAt: null },
                status: 'visitor', firstVisitDate: today, howHeard: null, invitedBy: null, invitedById: null,
                serviceAttended: event.name,
              }, { recordVisitorStage: true });
              synced.catch((err) => toast.show(friendlyError(err)));
              markAttendance(org.id, event, ref.id, 'present', 'door', undefined).catch((err) => toast.show(friendlyError(err)));
              setQuery('');
              setScreen({ kind: 'welcome', personId: ref.id, name: firstName(input.name), already: false, isNew: true });
            } catch (err) {
              toast.show(friendlyError(err));
            }
          }}
        />
      )}

      {screen.kind === 'welcome' && (
        <main className="door-main door-welcome" onClick={() => setScreen({ kind: 'search' })}>
          <span className="success-tick" aria-hidden="true">✓</span>
          <h1>{screen.isNew ? `Welcome to ${org.name}, ${screen.name}!` : screen.already ? `You're already checked in, ${screen.name}.` : `Welcome, ${screen.name}!`}</h1>
          {screen.isNew && <p className="lead">We're glad you're here. Someone from the team will say hello.</p>}
          {!screen.already && !screen.isNew && (
            <button type="button" className="btn btn-quiet" onClick={(e) => { e.stopPropagation(); notMe(screen.personId); }}>Not you? Tap here</button>
          )}
          <p className="muted">Tap anywhere to continue</p>
        </main>
      )}

      <ConfirmDialog
        open={confirmExit}
        title="Leave door mode?"
        body="Hand the tablet back to a staff member before leaving door mode."
        confirmLabel="Leave door mode"
        onConfirm={() => navigate(`/attendance/${orgId}/${eventId}`)}
        onCancel={() => setConfirmExit(false)}
      />
    </div>
  );
}

interface NewHereInput { name: string; phone: string; consent: boolean }

function NewHere({ orgName, initial, onCancel, onSave }: { orgName: string; initial: string; onCancel: () => void; onSave: (v: NewHereInput) => void }) {
  const looksLikePhone = /^[\d\s+()-]+$/.test(initial.trim()) && initial.trim().length > 0;
  const [name, setName] = useState(looksLikePhone ? '' : initial);
  const [phone, setPhone] = useState(looksLikePhone ? initial : '');
  const [consent, setConsent] = useState(false);
  const [error, setError] = useState('');

  function submit(e: FormEvent) {
    e.preventDefault();
    const normalized = normalizePhone(phone);
    if (!name.trim()) return setError('Please type your name.');
    if (!normalized) return setError('Please type a phone number, for example 0712 345 678.');
    onSave({ name: tidyName(name), phone: normalized, consent });
  }

  return (
    <main className="door-main">
      <h1>Welcome to {orgName}!</h1>
      <form className="form door-form" onSubmit={submit} noValidate>
        <label className="field"><span>Your name</span><input autoFocus autoCapitalize="words" autoComplete="off" value={name} onChange={(e) => setName(e.target.value)} /></label>
        <label className="field"><span>Your phone number (WhatsApp)</span><input type="tel" inputMode="tel" autoComplete="off" placeholder="0712 345 678" value={phone} onChange={(e) => setPhone(e.target.value)} /></label>
        <label className="check consent">
          <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} />
          <span>You may send me WhatsApp messages</span>
        </label>
        {error && <p className="error" role="alert">{error}</p>}
        <button type="submit" className="btn btn-primary btn-lg btn-block">Check me in</button>
        <button type="button" className="btn btn-quiet btn-block" onClick={onCancel}>Back</button>
      </form>
    </main>
  );
}
