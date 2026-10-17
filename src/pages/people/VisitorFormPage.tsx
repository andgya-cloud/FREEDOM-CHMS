import { useMemo, useRef, useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../../state/AuthContext';
import { useOrg } from '../../state/OrgContext';
import { usePeople } from '../../state/PeopleContext';
import { useToast } from '../../state/ToastContext';
import { addPerson } from '../../lib/peopleWrites';
import { friendlyError } from '../../lib/errors';
import { useSavedMessage } from '../../lib/useSavedMessage';
import { PersonPicker } from '../../components/PersonPicker';
import { DuplicateNotice } from '../../components/DuplicateNotice';
import { OrgPicker } from '../../components/OrgPicker';
import { findDuplicatesByPhone, HOW_HEARD_OPTIONS, tidyName } from '../../../functions/src/shared/people';
import { normalizePhone } from '../../../functions/src/shared/phone';
import { localDateKey } from '../../../functions/src/shared/datetime';

interface Saved {
  orgId: string;
  personId: string;
  name: string;
}

/**
 * The quick visitor form: name and phone are all that is needed.
 * Everything else is optional and tucked under "More details".
 */
export function VisitorFormPage() {
  const { profile } = useAuth();
  const { current, isCombined, organizations } = useOrg();
  const { people } = usePeople();
  const toast = useToast();
  const savedMessage = useSavedMessage();
  const navigate = useNavigate();
  const nameRef = useRef<HTMLInputElement>(null);

  // Organizations load after the page on a fresh start, so derive this rather than freeze it.
  const [chosenOrgId, setOrgId] = useState('');
  const orgId = isCombined ? chosenOrgId : current?.id ?? '';
  const org = organizations.find((o) => o.id === orgId);
  const [fullName, setFullName] = useState('');
  const [phone, setPhone] = useState('');
  const [sameWhatsApp, setSameWhatsApp] = useState(true);
  const [whatsapp, setWhatsapp] = useState('');
  const [consent, setConsent] = useState(false);
  const [howHeard, setHowHeard] = useState('');
  const [invitedBy, setInvitedBy] = useState<{ id: string | null; name: string }>({ id: null, name: '' });
  const [service, setService] = useState('');
  const [visitDate, setVisitDate] = useState(() => localDateKey(new Date(), current?.timeZone));
  const [prayer, setPrayer] = useState('');
  const [errors, setErrors] = useState<string[]>([]);
  const [saved, setSaved] = useState<Saved | null>(null);

  const normalized = normalizePhone(phone);
  const duplicates = useMemo(
    () => (normalized ? findDuplicatesByPhone(normalized, people.filter((p) => !orgId || p.orgId === orgId)) : []),
    [normalized, people, orgId],
  );
  const serviceTimes = org?.serviceTimes?.length ? org.serviceTimes : [];
  const isChurch = org?.type === 'church_campus';

  function reset() {
    setFullName(''); setPhone(''); setSameWhatsApp(true); setWhatsapp(''); setConsent(false);
    setHowHeard(''); setInvitedBy({ id: null, name: '' }); setService(''); setPrayer(''); setErrors([]);
    setSaved(null);
    window.setTimeout(() => nameRef.current?.focus(), 0);
  }

  function submit(e: FormEvent) {
    e.preventDefault();
    const problems: string[] = [];
    if (!orgId) problems.push('Choose the organization.');
    if (!fullName.trim()) problems.push('Enter their name.');
    if (!normalized) problems.push('Enter a phone number we can reach them on, for example 0712 345 678.');
    const wa = sameWhatsApp ? normalized : normalizePhone(whatsapp);
    if (!sameWhatsApp && whatsapp && !wa) problems.push('The WhatsApp number does not look right.');
    setErrors(problems);
    if (problems.length) return;

    const name = tidyName(fullName);
    try {
      const { ref, synced } = addPerson(orgId, {
        fullName: name,
        phone: normalized,
        whatsapp: wa ?? null,
        whatsappConsent: { given: consent, date: localDateKey(new Date(), org?.timeZone), recordedBy: profile?.uid ?? null, stoppedAt: null },
        status: 'visitor',
        firstVisitDate: visitDate || localDateKey(new Date(), org?.timeZone),
        howHeard: howHeard || null,
        invitedBy: invitedBy.name.trim() || null,
        invitedById: invitedBy.id,
        serviceAttended: service || null,
      }, { prayerNeed: prayer, recordVisitorStage: isChurch });
      synced.catch((err) => toast.show(friendlyError(err)));
      setSaved({ orgId, personId: ref.id, name });
      toast.show(savedMessage(`${name} added`));
    } catch (err) {
      setErrors([friendlyError(err)]);
    }
  }

  if (saved) {
    return (
      <div className="page narrow">
        <div className="success-panel" role="status">
          <span className="success-tick" aria-hidden="true">✓</span>
          <h1>{saved.name} added</h1>
          <p>A welcome follow-up has been created for today.</p>
        </div>
        <button type="button" className="btn btn-primary btn-block btn-lg" onClick={reset}>Add another visitor</button>
        <button type="button" className="btn btn-block" onClick={() => navigate(`/people/${saved.orgId}/${saved.personId}`)}>Open {saved.name.split(' ')[0]}’s record</button>
        <Link to="/" className="btn btn-quiet btn-block">Back to Today</Link>
      </div>
    );
  }

  return (
    <div className="page narrow">
      <p><Link to="/">← Today</Link></p>
      <h1>Add visitor</h1>
      <form className="form" onSubmit={submit} noValidate>
        {isCombined && <OrgPicker value={orgId} onChange={setOrgId} />}
        <label className="field">
          <span>Name</span>
          <input ref={nameRef} autoFocus autoCapitalize="words" autoComplete="off" value={fullName} onChange={(e) => setFullName(e.target.value)} />
        </label>
        <label className="field">
          <span>Phone</span>
          <input type="tel" inputMode="tel" autoComplete="off" placeholder="0712 345 678" value={phone} onChange={(e) => setPhone(e.target.value)} />
        </label>
        <DuplicateNotice matches={duplicates} />
        <label className="check">
          <input type="checkbox" checked={sameWhatsApp} onChange={(e) => setSameWhatsApp(e.target.checked)} />
          <span>This number is on WhatsApp</span>
        </label>
        {!sameWhatsApp && (
          <label className="field">
            <span>WhatsApp number (optional)</span>
            <input type="tel" inputMode="tel" value={whatsapp} onChange={(e) => setWhatsapp(e.target.value)} />
          </label>
        )}
        <label className="check consent">
          <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} />
          <span><strong>They agreed</strong> to receive WhatsApp messages from us</span>
        </label>

        <details className="more">
          <summary>More details (optional)</summary>
          <div className="form">
            <fieldset className="field">
              <legend>How did they hear about us?</legend>
              <div className="chips">
                {HOW_HEARD_OPTIONS.map((o) => (
                  <button key={o} type="button" className={`chip ${howHeard === o ? 'chip-on' : ''}`} aria-pressed={howHeard === o} onClick={() => setHowHeard(howHeard === o ? '' : o)}>{o}</button>
                ))}
              </div>
            </fieldset>
            <PersonPicker label="Who invited them?" value={invitedBy} onChange={setInvitedBy} allowFreeText orgId={orgId || undefined} hint="Type a name. Pick them if they are already in the system." />
            {serviceTimes.length > 0 && (
              <fieldset className="field">
                <legend>Service attended</legend>
                <div className="chips">
                  {serviceTimes.map((s) => (
                    <button key={s} type="button" className={`chip ${service === s ? 'chip-on' : ''}`} aria-pressed={service === s} onClick={() => setService(service === s ? '' : s)}>{s}</button>
                  ))}
                </div>
              </fieldset>
            )}
            <label className="field">
              <span>First visit</span>
              <input type="date" value={visitDate} onChange={(e) => setVisitDate(e.target.value)} />
            </label>
            <label className="field">
              <span>Prayer need</span>
              <textarea rows={3} value={prayer} onChange={(e) => setPrayer(e.target.value)} />
              <small className="hint">Only staff with pastoral access can read this.</small>
            </label>
          </div>
        </details>

        {errors.length > 0 && <ul className="error" role="alert">{errors.map((p) => <li key={p}>{p}</li>)}</ul>}
        <button type="submit" className="btn btn-primary btn-block btn-lg">Save visitor</button>
      </form>
    </div>
  );
}
