import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useAuth } from '../../state/AuthContext';
import { useOrg } from '../../state/OrgContext';
import { usePeople, type Person } from '../../state/PeopleContext';
import { useCustomFields, type CustomField } from '../../state/useSettingsDoc';
import { useToast } from '../../state/ToastContext';
import { addPerson, updatePerson } from '../../lib/peopleWrites';
import { friendlyError } from '../../lib/errors';
import { useSavedMessage } from '../../lib/useSavedMessage';
import { PersonPicker } from '../../components/PersonPicker';
import { DuplicateNotice } from '../../components/DuplicateNotice';
import { OrgPicker } from '../../components/OrgPicker';
import { findDuplicatesByPhone, HOW_HEARD_OPTIONS, PERSON_STATUS_LABELS, statusesFor, tidyName, type PersonStatus } from '../../../functions/src/shared/people';
import { formatPhone, normalizePhone } from '../../../functions/src/shared/phone';
import { localDateKey } from '../../../functions/src/shared/datetime';

interface FormState {
  fullName: string;
  phone: string;
  sameWhatsApp: boolean;
  whatsapp: string;
  consent: boolean;
  email: string;
  status: PersonStatus;
  firstVisitDate: string;
  gender: string;
  birthday: string;
  household: { id: string | null; name: string };
  guardian: { id: string | null; name: string };
  howHeard: string;
  invitedBy: { id: string | null; name: string };
  serviceAttended: string;
  customFields: Record<string, unknown>;
}

function fromPerson(p: Person, byId: (id: string) => Person | undefined): FormState {
  const householdPeer = p.householdId ? byId(p.householdId === p.id ? '' : p.householdId) : undefined;
  return {
    fullName: p.fullName,
    phone: formatPhone(p.phone),
    sameWhatsApp: !!p.phone && p.whatsapp === p.phone,
    whatsapp: p.whatsapp && p.whatsapp !== p.phone ? formatPhone(p.whatsapp) : '',
    consent: !!p.whatsappConsent?.given,
    email: p.email ?? '',
    status: p.status,
    firstVisitDate: p.firstVisitDate ?? '',
    gender: p.gender ?? '',
    birthday: p.birthday ?? '',
    household: { id: householdPeer?.id ?? null, name: householdPeer?.fullName ?? '' },
    guardian: { id: p.guardianId ?? null, name: p.guardianId ? byId(p.guardianId)?.fullName ?? '' : '' },
    howHeard: p.howHeard ?? '',
    invitedBy: { id: p.invitedById ?? null, name: p.invitedBy ?? '' },
    serviceAttended: p.serviceAttended ?? '',
    customFields: p.customFields ?? {},
  };
}

const EMPTY: FormState = {
  fullName: '', phone: '', sameWhatsApp: true, whatsapp: '', consent: false, email: '', status: 'regular',
  firstVisitDate: '', gender: '', birthday: '', household: { id: null, name: '' }, guardian: { id: null, name: '' },
  howHeard: '', invitedBy: { id: null, name: '' }, serviceAttended: '', customFields: {},
};

/**
 * Add or edit a person. "Add visitor" on Today opens this same form with Visitor already chosen and the first visit
 * set to today (Andy, 2026-10-31, 2A: one form instead of two); a visitor also gets a prayer need and "Add another".
 */
export function PersonFormPage({ visitor = false }: { visitor?: boolean } = {}) {
  const { orgId: routeOrgId, personId } = useParams();
  const isNew = !personId;
  const { profile } = useAuth();
  const { current, isCombined, organizations } = useOrg();
  const { people, byId } = usePeople();
  const customFields = useCustomFields().filter((f) => f.active);
  const toast = useToast();
  const saved = useSavedMessage();
  const navigate = useNavigate();
  const existing = personId ? byId(personId) : undefined;
  // Organizations load after the page on a fresh start, so derive this rather than freeze it.
  const [chosenOrgId, setOrgId] = useState('');
  const orgId = routeOrgId ?? (isCombined ? chosenOrgId : current?.id ?? '');
  const org = organizations.find((o) => o.id === orgId);
  const blank = (): FormState => (visitor ? { ...EMPTY, status: 'visitor', firstVisitDate: localDateKey(new Date(), current?.timeZone) } : EMPTY);
  const [form, setForm] = useState<FormState>(blank);
  const [prayer, setPrayer] = useState('');
  const [added, setAdded] = useState<{ orgId: string; personId: string; name: string } | null>(null);
  const [loaded, setLoaded] = useState(isNew);
  const [errors, setErrors] = useState<string[]>([]);

  useEffect(() => {
    if (existing && !loaded) {
      setForm(fromPerson(existing, byId));
      setLoaded(true);
    }
  }, [existing, loaded, byId]);

  const set = <K extends keyof FormState>(k: K, v: FormState[K]) => setForm((f) => ({ ...f, [k]: v }));
  const normalized = normalizePhone(form.phone);
  const duplicates = useMemo(
    () => (normalized ? findDuplicatesByPhone(normalized, people.filter((p) => p.orgId === orgId), personId) : []),
    [normalized, people, orgId, personId],
  );

  if (!isNew && !existing) return <div className="page"><p><Link to="/people">← People</Link></p><p>Loading…</p></div>;

  function submit(e: FormEvent) {
    e.preventDefault();
    const problems: string[] = [];
    if (!orgId) problems.push('Choose the organization.');
    if (!form.fullName.trim()) problems.push('Enter their name.');
    if (form.phone.trim() && !normalized) problems.push('The phone number does not look right.');
    if (form.status === 'visitor' && !normalized) problems.push('A visitor needs a phone number so we can follow up.');
    const wa = form.sameWhatsApp ? normalized : normalizePhone(form.whatsapp);
    if (!form.sameWhatsApp && form.whatsapp.trim() && !wa) problems.push('The WhatsApp number does not look right.');
    if (form.email.trim() && !/^\S+@\S+\.\S+$/.test(form.email.trim())) problems.push('The email does not look right.');
    setErrors(problems);
    if (problems.length) return;

    // Household: join the picked person's household, starting one if they have none.
    let householdId: string | null = existing?.householdId ?? null;
    const peer = form.household.id ? byId(form.household.id) : undefined;
    if (peer) {
      householdId = peer.householdId ?? peer.id;
      if (!peer.householdId) updatePerson(peer.orgId, peer.id, { householdId }).catch((err) => toast.show(friendlyError(err)));
    } else if (!form.household.name.trim()) {
      householdId = existing?.householdId === existing?.id ? existing?.householdId ?? null : null;
    }

    const prevConsent = existing?.whatsappConsent;
    const consentChanged = !prevConsent || prevConsent.given !== form.consent;
    const data = {
      fullName: tidyName(form.fullName),
      phone: normalized,
      whatsapp: wa ?? null,
      whatsappConsent: consentChanged
        ? { given: form.consent, date: localDateKey(new Date(), org?.timeZone), recordedBy: profile?.uid ?? null, stoppedAt: form.consent ? null : prevConsent?.stoppedAt ?? null }
        : prevConsent,
      email: form.email.trim() || null,
      status: form.status,
      firstVisitDate: form.firstVisitDate || null,
      gender: form.gender || null,
      birthday: form.birthday || null,
      householdId,
      guardianId: form.guardian.id,
      howHeard: form.howHeard || null,
      invitedBy: form.invitedBy.name.trim() || null,
      invitedById: form.invitedBy.id,
      serviceAttended: form.serviceAttended || null,
      customFields: form.customFields,
    };

    try {
      if (existing) {
        const previous = Object.fromEntries(Object.keys(data).map((k) => [k, (existing as unknown as Record<string, unknown>)[k] ?? null]));
        updatePerson(orgId, existing.id, data).catch((err) => toast.show(friendlyError(err)));
        toast.show(saved(`${data.fullName} saved`), {
          label: 'Undo',
          onAction: () => { updatePerson(orgId, existing.id, previous).catch((err) => toast.show(friendlyError(err))); },
        });
        navigate(`/people/${orgId}/${existing.id}`);
      } else {
        const isVisitor = data.status === 'visitor';
        const { ref, synced } = addPerson(orgId, data, { recordVisitorStage: isVisitor && org?.type === 'church_campus', prayerNeed: isVisitor ? prayer : undefined });
        synced.catch((err) => toast.show(friendlyError(err)));
        toast.show(saved(`${data.fullName} added`));
        if (isVisitor) setAdded({ orgId, personId: ref.id, name: data.fullName });
        else navigate(`/people/${orgId}/${ref.id}`, { replace: true });
      }
    } catch (err) {
      setErrors([friendlyError(err)]);
    }
  }

  function addAnother() {
    setForm(blank()); setPrayer(''); setErrors([]); setAdded(null);
  }

  if (added) {
    return (
      <div className="page narrow">
        <div className="success-panel" role="status">
          <span className="success-tick" aria-hidden="true">✓</span>
          <h1>{added.name} added</h1>
          <p>A welcome follow-up has been created for today.</p>
        </div>
        <button type="button" className="btn btn-primary btn-block btn-lg" onClick={addAnother}>Add another visitor</button>
        <button type="button" className="btn btn-block" onClick={() => navigate(`/people/${added.orgId}/${added.personId}`)}>Open {added.name.split(' ')[0]}’s record</button>
        <Link to="/" className="btn btn-quiet btn-block">Back to Today</Link>
      </div>
    );
  }

  return (
    <div className="page narrow">
      <p><Link to={existing ? `/people/${orgId}/${existing.id}` : visitor ? '/' : '/people'}>← {existing ? existing.fullName : visitor ? 'Today' : 'People'}</Link></p>
      <h1>{existing ? 'Edit details' : 'Add person'}</h1>
      {isNew && visitor && org?.type === 'church_campus' && (
        <p className="notice">Visitors can fill in their own card on their phone. <Link to="/visitors/qr">Show the QR poster</Link></p>
      )}
      <form className="form" onSubmit={submit} noValidate>
        {isNew && isCombined && <OrgPicker value={orgId} onChange={setOrgId} />}
        <label className="field">
          <span>Name</span>
          <input autoCapitalize="words" autoFocus={isNew} value={form.fullName} onChange={(e) => set('fullName', e.target.value)} />
        </label>
        <label className="field">
          <span>Phone</span>
          <input type="tel" inputMode="tel" placeholder="0712 345 678" value={form.phone} onChange={(e) => set('phone', e.target.value)} />
        </label>
        <DuplicateNotice matches={duplicates} />
        <label className="check">
          <input type="checkbox" checked={form.sameWhatsApp} onChange={(e) => set('sameWhatsApp', e.target.checked)} />
          <span>This number is on WhatsApp</span>
        </label>
        {!form.sameWhatsApp && (
          <label className="field">
            <span>WhatsApp number (optional)</span>
            <input type="tel" inputMode="tel" value={form.whatsapp} onChange={(e) => set('whatsapp', e.target.value)} />
          </label>
        )}
        <label className="check consent">
          <input type="checkbox" checked={form.consent} onChange={(e) => set('consent', e.target.checked)} />
          <span><strong>They agreed</strong> to receive WhatsApp messages from us</span>
        </label>
        <fieldset className="field">
          <legend>Status</legend>
          <div className="chips">
            {statusesFor(org?.type).concat(existing && !statusesFor(org?.type).includes(existing.status) ? [existing.status] : []).map((s) => (
              <button key={s} type="button" className={`chip ${form.status === s ? 'chip-on' : ''}`} aria-pressed={form.status === s} onClick={() => set('status', s)}>{PERSON_STATUS_LABELS[s]}</button>
            ))}
          </div>
        </fieldset>
        {(form.status === 'child' || form.status === 'student') && (
          <PersonPicker label="Parent or guardian" value={form.guardian} onChange={(v) => set('guardian', v)} excludeId={personId} hint="Messages go to the guardian, never to a child." />
        )}

        <details className="more" open={!isNew}>
          <summary>More details</summary>
          <div className="form">
            <label className="field">
              <span>Email</span>
              <input type="email" inputMode="email" value={form.email} onChange={(e) => set('email', e.target.value)} />
            </label>
            <div className="field-row">
              <label className="field">
                <span>First visit</span>
                <input type="date" value={form.firstVisitDate} onChange={(e) => set('firstVisitDate', e.target.value)} />
              </label>
              <label className="field">
                <span>Gender</span>
                <select value={form.gender} onChange={(e) => set('gender', e.target.value)}>
                  <option value="">Not recorded</option>
                  <option>Female</option>
                  <option>Male</option>
                </select>
              </label>
            </div>
            <BirthdayField value={form.birthday} onChange={(v) => set('birthday', v)} />
            <PersonPicker label="Same household as" value={form.household} onChange={(v) => set('household', v)} excludeId={personId} hint="Pick a family member already in the system." />
            <label className="field">
              <span>How they heard about us</span>
              <select value={form.howHeard} onChange={(e) => set('howHeard', e.target.value)}>
                <option value="">Not recorded</option>
                {HOW_HEARD_OPTIONS.map((o) => <option key={o}>{o}</option>)}
              </select>
            </label>
            <PersonPicker label="Invited by" value={form.invitedBy} onChange={(v) => set('invitedBy', v)} allowFreeText excludeId={personId} />
            {(org?.serviceTimes?.length ?? 0) > 0 && (
              <label className="field">
                <span>Service attended</span>
                <select value={form.serviceAttended} onChange={(e) => set('serviceAttended', e.target.value)}>
                  <option value="">Not recorded</option>
                  {org!.serviceTimes!.map((s) => <option key={s}>{s}</option>)}
                </select>
              </label>
            )}
            {isNew && form.status === 'visitor' && (
              <label className="field">
                <span>Prayer need</span>
                <textarea rows={3} value={prayer} onChange={(e) => setPrayer(e.target.value)} />
                <small className="hint">Only staff with pastoral access can read this.</small>
              </label>
            )}
            {customFields.map((f) => (
              <CustomFieldInput key={f.id} field={f} value={form.customFields[f.id]} onChange={(v) => set('customFields', { ...form.customFields, [f.id]: v })} />
            ))}
          </div>
        </details>

        {errors.length > 0 && <ul className="error" role="alert">{errors.map((p) => <li key={p}>{p}</li>)}</ul>}
        <button type="submit" className="btn btn-primary btn-block btn-lg">Save</button>
      </form>
    </div>
  );
}

function CustomFieldInput({ field, value, onChange }: { field: CustomField; value: unknown; onChange: (v: unknown) => void }) {
  switch (field.type) {
    case 'yesno':
      return (
        <label className="check">
          <input type="checkbox" checked={value === true} onChange={(e) => onChange(e.target.checked)} />
          <span>{field.label}</span>
        </label>
      );
    case 'date':
      return (
        <label className="field">
          <span>{field.label}</span>
          <input type="date" value={String(value ?? '')} onChange={(e) => onChange(e.target.value || null)} />
        </label>
      );
    case 'choice':
      return (
        <label className="field">
          <span>{field.label}</span>
          <select value={String(value ?? '')} onChange={(e) => onChange(e.target.value || null)}>
            <option value="">Not recorded</option>
            {(field.options ?? []).map((o) => <option key={o}>{o}</option>)}
          </select>
        </label>
      );
    default:
      return (
        <label className="field">
          <span>{field.label}</span>
          <input value={String(value ?? '')} onChange={(e) => onChange(e.target.value || null)} />
        </label>
      );
  }
}

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

/** Day and month only: many people would rather not give the year (Andy, 2026-10-31, 2A). Saved as "MM-DD". */
function BirthdayField({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const [m, d] = value ? value.split('-') : ['', ''];
  const [month, setMonth] = useState(m);
  const [day, setDay] = useState(d);
  useEffect(() => { if (value) { setMonth(value.slice(0, 2)); setDay(value.slice(3)); } }, [value]);
  const pick = (nm: string, nd: string) => {
    setMonth(nm); setDay(nd);
    onChange(nm && nd ? `${nm}-${nd}` : '');
  };
  return (
    <fieldset className="field">
      <legend>Birthday</legend>
      <div className="field-row">
        <select aria-label="Birthday day" value={day} onChange={(e) => pick(month, e.target.value)}>
          <option value="">Day</option>
          {Array.from({ length: 31 }, (_, i) => String(i + 1).padStart(2, '0')).map((x) => <option key={x} value={x}>{Number(x)}</option>)}
        </select>
        <select aria-label="Birthday month" value={month} onChange={(e) => pick(e.target.value, day)}>
          <option value="">Month</option>
          {MONTHS.map((name, i) => <option key={name} value={String(i + 1).padStart(2, '0')}>{name}</option>)}
        </select>
      </div>
    </fieldset>
  );
}
