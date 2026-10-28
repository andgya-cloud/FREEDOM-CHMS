import { useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../../state/AuthContext';
import { useToast } from '../../state/ToastContext';
import { PersonPicker } from '../../components/PersonPicker';
import { friendlyError } from '../../lib/errors';
import { enrolStudent } from '../../lib/schoolWrites';
import { useSavedMessage } from '../../lib/useSavedMessage';
import type { Sponsor } from '../../state/useSchool';
import { localDateKey } from '../../../functions/src/shared/datetime';
import { normalizePhone } from '../../../functions/src/shared/phone';
import { capacityOf } from '../../../functions/src/shared/school';
import { SchoolGate, useSchoolPage } from './common';
import type { Organization } from '../../state/OrgContext';

export function EnrolPage() {
  return <SchoolGate title="Enrol a student">{(org) => <Enrol org={org} />}</SchoolGate>;
}

const blankSponsor = (): Sponsor => ({ name: '', phone: '', relation: '', whatsapp: false });

function Enrol({ org }: { org: Organization }) {
  const s = useSchoolPage(org);
  const { profile } = useAuth();
  const toast = useToast();
  const saved = useSavedMessage();
  const navigate = useNavigate();
  const today = localDateKey(new Date(), org.timeZone);
  const [who, setWho] = useState<{ id: string | null; name: string }>({ id: null, name: '' });
  const [phone, setPhone] = useState('');
  const [consent, setConsent] = useState(false);
  const [courseId, setCourseId] = useState('');
  const [intakeId, setIntakeId] = useState('');
  const [level, setLevel] = useState('');
  const [status, setStatus] = useState<'enrolled' | 'applicant'>('enrolled');
  const [enrolledOn, setEnrolledOn] = useState(today);
  const [sponsors, setSponsors] = useState<Sponsor[]>([blankSponsor()]);
  const [error, setError] = useState('');

  const course = s.courses.find((c) => c.id === courseId);
  const intakes = s.intakes.filter((i) => i.courseId === courseId && i.active !== false);
  const intake = intakes.find((i) => i.id === intakeId);
  const cap = intake ? capacityOf(intake, s.students) : null;
  const setSponsor = (i: number, patch: Partial<Sponsor>) => setSponsors((list) => list.map((x, n) => (n === i ? { ...x, ...patch } : x)));

  function submit(e: FormEvent) {
    e.preventDefault();
    setError('');
    const name = who.name.trim();
    if (name.length < 2) return setError('Enter the student\'s name.');
    if (!courseId || !intakeId) return setError('Choose the programme and the intake.');
    if (who.id && s.students.some((x) => x.id === who.id)) return setError('This person is already a student.');
    if (cap?.full && !window.confirm(`${intake?.name} is full (${intake?.capacity} places). Enrol anyway?`)) return;
    const cleaned: Sponsor[] = [];
    for (const sp of sponsors) {
      if (!sp.name.trim() && !sp.phone.trim()) continue;
      const p = normalizePhone(sp.phone);
      if (!sp.name.trim() || !p) return setError('Each sponsor or guardian needs a name and a valid phone number.');
      cleaned.push({ name: sp.name.trim().slice(0, 80), phone: p, relation: (sp.relation ?? '').trim().slice(0, 40), whatsapp: !!sp.whatsapp });
    }
    let target: Parameters<typeof enrolStudent>[1];
    if (who.id) target = { personId: who.id };
    else {
      const p = phone.trim() ? normalizePhone(phone) : null;
      if (phone.trim() && !p) return setError('That phone number does not look right.');
      target = { person: { fullName: name, phone: p, whatsapp: consent && p ? p : null, whatsappConsent: { given: consent && !!p, date: today, recordedBy: profile?.uid ?? null, stoppedAt: null } } };
    }
    try {
      const { id, synced } = enrolStudent(org.id, target, { courseId, intakeId, level, status, sponsors: cleaned, enrolledOn: status === 'enrolled' ? enrolledOn : null });
      synced.catch((err) => toast.show(friendlyError(err)));
      toast.show(saved(`${name} enrolled`));
      navigate(`/school/students/${id}`);
    } catch (err) {
      toast.show(friendlyError(err));
    }
  }

  return (
    <div className="page narrow">
      <p><Link to="/school/students">← Students</Link></p>
      <h1>Enrol a student</h1>
      {s.courses.length === 0 && <p className="notice notice-warn">Add the programmes in <Link to="/school/courses">Settings → Programmes</Link> first.</p>}
      <form className="form" onSubmit={submit} noValidate>
        <PersonPicker label="Student's name" value={who} onChange={setWho} allowFreeText orgId={org.id}
          hint="Pick someone already in the system, or type a new name." />
        {!who.id && (
          <>
            <label className="field"><span>Student's phone (optional)</span><input inputMode="tel" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="0712 345 678" /></label>
            {phone.trim() && <label className="check"><input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} /><span>The student agreed to receive WhatsApp messages</span></label>}
          </>
        )}
        <label className="field"><span>Programme</span>
          <select value={courseId} onChange={(e) => { setCourseId(e.target.value); setIntakeId(''); setLevel(''); }}>
            <option value="">Choose…</option>
            {s.courses.filter((c) => c.active !== false).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </label>
        {course && (
          <>
            <label className="field"><span>Intake</span>
              <select value={intakeId} onChange={(e) => setIntakeId(e.target.value)}>
                <option value="">Choose…</option>
                {intakes.map((i) => { const c = capacityOf(i, s.students); return <option key={i.id} value={i.id}>{i.name}{i.capacity != null ? ` (${c.taken} of ${i.capacity} taken)` : ''}</option>; })}
              </select>
              {intakes.length === 0 && <small className="hint">No intake yet for this programme. Add one in <Link to="/school/courses">Settings → Programmes</Link>.</small>}
              {cap?.full && <small className="hint danger-text">This intake is full.</small>}
            </label>
            {course.levels.length > 0 && (
              <label className="field"><span>Level</span>
                <select value={level} onChange={(e) => setLevel(e.target.value)}>
                  <option value="">Choose…</option>
                  {course.levels.map((l) => <option key={l} value={l}>{l}</option>)}
                </select>
              </label>
            )}
          </>
        )}
        <div className="field-row">
          <label className="field"><span>Status</span>
            <select value={status} onChange={(e) => setStatus(e.target.value as 'enrolled' | 'applicant')}>
              <option value="enrolled">Enrolled</option><option value="applicant">Applicant</option>
            </select>
          </label>
          {status === 'enrolled' && <label className="field"><span>Started</span><input type="date" value={enrolledOn} onChange={(e) => setEnrolledOn(e.target.value)} /></label>}
        </div>
        <h2>Sponsor or guardian</h2>
        <p className="small muted">Fee reminders go here. Tick WhatsApp only if they agreed to get messages that way.</p>
        {sponsors.map((sp, i) => (
          <div key={i} className="card stack">
            <label className="field"><span>Name</span><input value={sp.name} onChange={(e) => setSponsor(i, { name: e.target.value })} /></label>
            <div className="field-row">
              <label className="field"><span>Phone</span><input inputMode="tel" value={sp.phone} onChange={(e) => setSponsor(i, { phone: e.target.value })} /></label>
              <label className="field"><span>Relation</span><input value={sp.relation ?? ''} onChange={(e) => setSponsor(i, { relation: e.target.value })} placeholder="Mother, employer…" /></label>
            </div>
            <label className="check"><input type="checkbox" checked={!!sp.whatsapp} onChange={(e) => setSponsor(i, { whatsapp: e.target.checked })} /><span>Agreed to WhatsApp messages</span></label>
          </div>
        ))}
        {sponsors.length < 4 && <button type="button" className="btn btn-quiet align-start" onClick={() => setSponsors((l) => [...l, blankSponsor()])}>Add another</button>}
        {error && <p className="error" role="alert">{error}</p>}
        <button type="submit" className="btn btn-primary btn-block">Enrol student</button>
      </form>
    </div>
  );
}
