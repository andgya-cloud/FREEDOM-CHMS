import { useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../../state/AuthContext';
import { useToast } from '../../state/ToastContext';
import { PersonPicker } from '../../components/PersonPicker';
import { friendlyError } from '../../lib/errors';
import { registerChild, type PersonInput } from '../../lib/hopeWrites';
import { saveChildPhoto } from '../../lib/childPhoto';
import { ApprovePhoto } from '../../components/ApprovePhoto';
import { Avatar, shrinkPhoto } from './registerParts';
import { useSavedMessage } from '../../lib/useSavedMessage';
import { normalizePhone } from '../../../functions/src/shared/phone';
import { NO_CONSENT, SCHOOL_STATUSES, SCHOOL_STATUS_LABELS, type ChildProgramme, type Consent, type SchoolStatus } from '../../../functions/src/shared/hope';
import { HopeGate, useHopePage } from './common';
import { ConsentField } from './fields';
import { useClubs } from '../../state/useHope';
import { updateClub } from '../../lib/hopeWrites';
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
  const programmes: ChildProgramme[] = [];
  const [guardian, setGuardian] = useState<{ id: string | null; name: string }>({ id: null, name: '' });
  const [gPhone, setGPhone] = useState('');
  const [gConsent, setGConsent] = useState(false);
  const [photoConsent, setPhotoConsent] = useState<Consent>(NO_CONSENT);
  const [guardianConsent, setGuardianConsent] = useState<Consent>(NO_CONSENT);
  const [sponsorName, setSponsorName] = useState('');
  const [error, setError] = useState('');
  const clubs = useClubs(org.id);
  const [joinClubs, setJoinClubs] = useState<string[]>([]);
  const [photo, setPhoto] = useState<string | null>(null);
  const [photoOk, setPhotoOk] = useState(false);
  // A photo needs the Director's, Andy's or Doreen's password (Andy, 2026-11-05).
  const [asking, setAsking] = useState(false);

  async function pickPhoto(f: File | undefined) {
    if (!f) return;
    try { setPhoto(await shrinkPhoto(f)); } catch (err) { toast.show(friendlyError(err)); }
  }

  function submit(e?: FormEvent, proof?: string) {
    e?.preventDefault();
    setError('');
    const name = who.name.trim();
    if (name.length < 2) return setError('Enter the child\'s name.');
    if (who.id && h.children.some((c) => c.id === who.id)) return setError('This child is already on the register.');
    if (dob && dob > h.today) return setError('The date of birth is in the future.');
    if (photo && !photoOk) return setError('Tick that the parent agreed to photos, or remove the photo.');
    let guardianTarget: { personId: string } | { person: PersonInput } | null = null;
    if (guardian.id) guardianTarget = { personId: guardian.id };
    else if (guardian.name.trim()) {
      const phone = gPhone.trim() ? normalizePhone(gPhone) : null;
      if (gPhone.trim() && !phone) return setError('The guardian\'s phone number does not look right.');
      guardianTarget = { person: { fullName: guardian.name.trim(), phone, whatsapp: gConsent && phone ? phone : null, whatsappConsent: { given: gConsent && !!phone, date: h.today, recordedBy: profile?.uid ?? null, stoppedAt: null } } };
    }
    if (photo && photoOk && !proof) { setAsking(true); return; }
    try {
      const { id, synced } = registerChild(
        org.id,
        who.id ? { personId: who.id } : { person: { fullName: name, phone: null, whatsapp: null, whatsappConsent: { given: false, date: null, recordedBy: null, stoppedAt: null }, gender: gender || null } },
        guardianTarget,
        {
          dateOfBirth: dob || null, school: school.trim().slice(0, 120), schoolStatus, enrolledOn: enrolledOn || null, programmes,
          photoConsent: photo && photoOk && photoConsent.given !== true ? { given: true, date: h.today } : photoConsent, guardianConsent,
          sponsorName: sponsorName.trim().slice(0, 120),
          parentName: guardian.name.trim().slice(0, 120), parentPhone: (guardian.id ? h.byId(guardian.id)?.phone ?? '' : gPhone.trim()).slice(0, 30),
        },
      );
      synced.catch((err) => toast.show(friendlyError(err)));
      // The photo is saved once the child is on the server.
      if (photo && photoOk && proof) synced.then(() => saveChildPhoto(org.id, id, photo, proof)).catch((err: unknown) => toast.show(friendlyError(err)));
      for (const cid of joinClubs) {
        const club = clubs.clubs.find((x) => x.id === cid);
        if (club) updateClub(org.id, cid, { memberIds: [...club.memberIds, id] }).catch((err) => toast.show(friendlyError(err)));
      }
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
      <form className="form" onSubmit={submit} noValidate>
        <PersonPicker label="Child's name" value={who} onChange={setWho} allowFreeText orgId={org.id} hint="" />
        <div className="field-row">
          {!who.id && (
            <label className="field"><span>Gender</span>
              <select value={gender} onChange={(e) => setGender(e.target.value)}><option value="">Not recorded</option><option>Female</option><option>Male</option></select>
            </label>
          )}
          <label className="field"><span>Date of birth</span><input type="date" value={dob} max={h.today} onChange={(e) => setDob(e.target.value)} /></label>
        </div>
        <div className="field">
          <span>Photo (optional)</span>
          <div className="rc-photo">
            {photo ? <img src={photo} alt="" width={84} height={84} className="hr-avatar" /> : <Avatar name={who.name || '?'} size={84} />}
            <div className="chips">
              <label className="btn">📷 Take<input type="file" hidden accept="image/*" capture="environment" onChange={(e) => { void pickPhoto(e.target.files?.[0]); e.target.value = ''; }} /></label>
              <label className="btn">⬆︎ Choose<input type="file" hidden accept="image/*" onChange={(e) => { void pickPhoto(e.target.files?.[0]); e.target.value = ''; }} /></label>
              {photo && <button type="button" className="btn btn-quiet" onClick={() => { setPhoto(null); setPhotoOk(false); }}>✕ Remove</button>}
            </div>
          </div>
          {photo && <label className="check"><input type="checkbox" checked={photoOk} onChange={(e) => setPhotoOk(e.target.checked)} /><span>The parent agreed to photos</span></label>}
        </div>

        <details className="hr-fold rc-more">
          <summary><span>➕ Add more details</span><span className="small muted">School, clubs, sponsor, parent, consent</span></summary>
          <div className="stack">
        <div className="field-row">
          <label className="field"><span>School (optional)</span><input value={school} maxLength={120} onChange={(e) => setSchool(e.target.value)} /></label>
          <label className="field"><span>In school?</span>
            <select value={schoolStatus} onChange={(e) => setSchoolStatus(e.target.value as SchoolStatus)}>
              {SCHOOL_STATUSES.map((v) => <option key={v} value={v}>{SCHOOL_STATUS_LABELS[v]}</option>)}
            </select>
          </label>
        </div>
        <label className="field"><span>Joined on</span><input type="date" value={enrolledOn} max={h.today} onChange={(e) => setEnrolledOn(e.target.value)} /></label>
        {clubs.clubs.some((x) => x.status === 'active') && (
          <fieldset className="stack">
            <legend>Clubs (optional)</legend>
            <div className="chips">{clubs.clubs.filter((x) => x.status === 'active').map((x) => (
              <button key={x.id} type="button" className={`chip${joinClubs.includes(x.id) ? ' chip-on' : ''}`} aria-pressed={joinClubs.includes(x.id)}
                onClick={() => setJoinClubs(joinClubs.includes(x.id) ? joinClubs.filter((y) => y !== x.id) : [...joinClubs, x.id])}>{x.emoji} {x.name}</button>
            ))}</div>
          </fieldset>
        )}

        <h3>Sponsor</h3>
        <label className="field"><span>Sponsor's name (optional)</span><input value={sponsorName} maxLength={120} onChange={(e) => setSponsorName(e.target.value)} /></label>

        <h3>Parent or guardian</h3>
        <PersonPicker label="Parent's name" value={guardian} onChange={setGuardian} allowFreeText orgId={org.id} excludeId={who.id ?? undefined} hint="Type a new name, or pick someone already in the system." />
        {!guardian.id && guardian.name.trim() && (
          <>
            <label className="field"><span>Parent's contact</span><input inputMode="tel" value={gPhone} onChange={(e) => setGPhone(e.target.value)} placeholder="0712 345 678" /></label>
            {gPhone.trim() && <label className="check"><input type="checkbox" checked={gConsent} onChange={(e) => setGConsent(e.target.checked)} /><span>The guardian agreed to receive WhatsApp messages</span></label>}
          </>
        )}

        <h3>Consent</h3>
        <ConsentField label="Guardian consent to keep this child's details" value={guardianConsent} onChange={setGuardianConsent} today={h.today} />
        <ConsentField label="Consent to take and keep photos" value={photoConsent} onChange={setPhotoConsent} today={h.today} />

          </div>
        </details>

        {error && <p className="error" role="alert">{error}</p>}
        <button type="submit" className="btn btn-primary btn-block">Register child</button>
      </form>
      <ApprovePhoto open={asking} orgId={org.id} title="Approve the photo" confirmLabel="Approve and register" onCancel={() => setAsking(false)}
        onApproved={(proof) => { setAsking(false); submit(undefined, proof); }} />
    </div>
  );
}
