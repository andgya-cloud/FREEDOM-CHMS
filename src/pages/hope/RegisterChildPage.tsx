import { useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../../state/AuthContext';
import { useToast } from '../../state/ToastContext';
import { PersonPicker } from '../../components/PersonPicker';
import { friendlyError } from '../../lib/errors';
import { registerChild, type PersonInput } from '../../lib/hopeWrites';
import { useSavedMessage } from '../../lib/useSavedMessage';
import { normalizePhone } from '../../../functions/src/shared/phone';
import { NO_CONSENT, SCHOOL_STATUSES, SCHOOL_STATUS_LABELS, type ChildProgramme, type Consent, type SchoolStatus } from '../../../functions/src/shared/hope';
import { HopeGate, HopeNav, useHopePage } from './common';
import { ConsentField, ProgrammeFields } from './fields';
import type { Organization } from '../../state/OrgContext';

export function RegisterChildPage() {
  return <HopeGate title="Register a child">{(org) => <Register org={org} />}</HopeGate>;
}

function Register({ org }: { org: Organization }) {
  const h = useHopePage(org);
  const { profile } = useAuth();
  const toast = useToast();
  const saved = useSavedMessage();
  const navigate = useNavigate();
  const [who, setWho] = useState<{ id: string | null; name: string }>({ id: null, name: '' });
  const [gender, setGender] = useState('');
  const [dob, setDob] = useState('');
  const [school, setSchool] = useState('');
  const [schoolStatus, setSchoolStatus] = useState<SchoolStatus>('unknown');
  const [enrolledOn, setEnrolledOn] = useState(h.today);
  const [programmes, setProgrammes] = useState<ChildProgramme[]>([]);
  const [guardian, setGuardian] = useState<{ id: string | null; name: string }>({ id: null, name: '' });
  const [gPhone, setGPhone] = useState('');
  const [gConsent, setGConsent] = useState(false);
  const [photoConsent, setPhotoConsent] = useState<Consent>(NO_CONSENT);
  const [guardianConsent, setGuardianConsent] = useState<Consent>(NO_CONSENT);
  const [error, setError] = useState('');

  function submit(e: FormEvent) {
    e.preventDefault();
    setError('');
    const name = who.name.trim();
    if (name.length < 2) return setError('Enter the child\'s name.');
    if (who.id && h.children.some((c) => c.id === who.id)) return setError('This child is already on the register.');
    if (dob && dob > h.today) return setError('The date of birth is in the future.');
    let guardianTarget: { personId: string } | { person: PersonInput } | null = null;
    if (guardian.id) guardianTarget = { personId: guardian.id };
    else if (guardian.name.trim()) {
      const phone = gPhone.trim() ? normalizePhone(gPhone) : null;
      if (gPhone.trim() && !phone) return setError('The guardian\'s phone number does not look right.');
      guardianTarget = { person: { fullName: guardian.name.trim(), phone, whatsapp: gConsent && phone ? phone : null, whatsappConsent: { given: gConsent && !!phone, date: h.today, recordedBy: profile?.uid ?? null, stoppedAt: null } } };
    }
    try {
      const { id, synced } = registerChild(
        org.id,
        who.id ? { personId: who.id } : { person: { fullName: name, phone: null, whatsapp: null, whatsappConsent: { given: false, date: null, recordedBy: null, stoppedAt: null }, gender: gender || null } },
        guardianTarget,
        { dateOfBirth: dob || null, school: school.trim().slice(0, 120), schoolStatus, enrolledOn: enrolledOn || null, programmes, photoConsent, guardianConsent },
      );
      synced.catch((err) => toast.show(friendlyError(err)));
      toast.show(saved(`${name} registered`));
      navigate(`/hope/children/${id}`);
    } catch (err) {
      toast.show(friendlyError(err));
    }
  }

  return (
    <div className="page narrow">
      <p><Link to="/hope/children">← Children</Link></p>
      <h1>Register a child</h1>
      <HopeNav />
      <form className="form" onSubmit={submit} noValidate>
        <PersonPicker label="Child's name" value={who} onChange={setWho} allowFreeText orgId={org.id} hint="Type a new name, or pick a child already in the system." />
        <div className="field-row">
          {!who.id && (
            <label className="field"><span>Gender</span>
              <select value={gender} onChange={(e) => setGender(e.target.value)}><option value="">Not recorded</option><option>Female</option><option>Male</option></select>
            </label>
          )}
          <label className="field"><span>Date of birth</span><input type="date" value={dob} max={h.today} onChange={(e) => setDob(e.target.value)} /></label>
        </div>
        <div className="field-row">
          <label className="field"><span>School (optional)</span><input value={school} maxLength={120} onChange={(e) => setSchool(e.target.value)} /></label>
          <label className="field"><span>In school?</span>
            <select value={schoolStatus} onChange={(e) => setSchoolStatus(e.target.value as SchoolStatus)}>
              {SCHOOL_STATUSES.map((v) => <option key={v} value={v}>{SCHOOL_STATUS_LABELS[v]}</option>)}
            </select>
          </label>
        </div>
        <label className="field"><span>Joined on</span><input type="date" value={enrolledOn} max={h.today} onChange={(e) => setEnrolledOn(e.target.value)} /></label>
        <ProgrammeFields programmes={h.programmes} value={programmes} onChange={setProgrammes} />

        <h2>Guardian or caregiver</h2>
        <p className="small muted">Messages about a child always go to the guardian, never to the child.</p>
        <PersonPicker label="Guardian's name" value={guardian} onChange={setGuardian} allowFreeText orgId={org.id} excludeId={who.id ?? undefined} hint="Type a new name, or pick someone already in the system." />
        {!guardian.id && guardian.name.trim() && (
          <>
            <label className="field"><span>Guardian's phone</span><input inputMode="tel" value={gPhone} onChange={(e) => setGPhone(e.target.value)} placeholder="0712 345 678" /></label>
            {gPhone.trim() && <label className="check"><input type="checkbox" checked={gConsent} onChange={(e) => setGConsent(e.target.checked)} /><span>The guardian agreed to receive WhatsApp messages</span></label>}
          </>
        )}
        {!guardian.name.trim() && <p className="notice notice-warn small">No guardian yet. You can save now and add one later, but nobody can be contacted if the child stops coming.</p>}

        <h2>Consent</h2>
        <p className="small muted">Ask the guardian to agree to the Hope Center keeping the child's details. You can save without it; the child will show "Consent missing" until it is recorded. No photos are kept in this system.</p>
        <ConsentField label="Guardian consent to keep this child's details" value={guardianConsent} onChange={setGuardianConsent} today={h.today} />
        <ConsentField label="Consent to take photos at events" value={photoConsent} onChange={setPhotoConsent} today={h.today} />

        {error && <p className="error" role="alert">{error}</p>}
        <button type="submit" className="btn btn-primary btn-block">Register child</button>
      </form>
    </div>
  );
}
