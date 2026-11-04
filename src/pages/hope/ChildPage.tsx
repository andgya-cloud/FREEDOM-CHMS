import { useEffect, useMemo, useState } from 'react';
import { CleanupButton } from '../../components/CleanupDialog';
import { Link, useParams } from 'react-router-dom';
import { useAuth } from '../../state/AuthContext';
import { useToast } from '../../state/ToastContext';
import { useChildPhoto, useChildPrivate, useHopeDays } from '../../state/useHope';
import { ConfirmDialog } from '../../components/ConfirmDialog';
import { friendlyError } from '../../lib/errors';
import { addHomeVisit, addReferral, closeConcern, closeReferral, raiseConcern, removeChildPhoto, saveChildPhoto, saveChildPrivate, updateChild } from '../../lib/hopeWrites';
import { KID_MARK_LABELS, kidHistory, rateFrom } from '../../../functions/src/shared/hopeRegister';
import { Avatar, PctBadge, shrinkPhoto } from './registerParts';
import { formatDateKey } from '../../../functions/src/shared/datetime';
import { formatPhone } from '../../../functions/src/shared/phone';
import { ATTENDANCE_STATUS_LABELS } from '../../../functions/src/shared/attendance';
import {
  consentMissing, MEALS_PROGRAMME, missedInARow, programmeOf, SCHOOL_STATUSES, SCHOOL_STATUS_LABELS,
  type ChildProgramme, type Consent, type SchoolStatus,
} from '../../../functions/src/shared/hope';
import { HopeGate, HopeNav, useHopePage } from './common';
import { ConsentField, ProgrammeFields } from './fields';
import type { Organization } from '../../state/OrgContext';

export function ChildPage() {
  return <HopeGate title="Child">{(org) => <ChildScreen org={org} />}</HopeGate>;
}

function ChildScreen({ org }: { org: Organization }) {
  const { childId = '' } = useParams();
  const h = useHopePage(org);
  const { can } = useAuth();
  const toast = useToast();
  const child = h.children.find((c) => c.id === childId);
  const person = h.byId(childId);
  const guardian = person?.guardianId ? h.byId(person.guardianId) : undefined;
  const canEdit = can('people.write');

  const [dob, setDob] = useState('');
  const [school, setSchool] = useState('');
  const [schoolStatus, setSchoolStatus] = useState<SchoolStatus>('unknown');
  const [enrolledOn, setEnrolledOn] = useState('');
  const [programmes, setProgrammes] = useState<ChildProgramme[]>([]);
  const [photoConsent, setPhotoConsent] = useState<Consent>({ given: null, date: null });
  const [guardianConsent, setGuardianConsent] = useState<Consent>({ given: null, date: null });
  const [sponsorName, setSponsorName] = useState('');
  const [sponsorPhone, setSponsorPhone] = useState('');
  const [sponsorEmail, setSponsorEmail] = useState('');
  const [parentName, setParentName] = useState('');
  const [parentPhone, setParentPhone] = useState('');
  const [leaveNote, setLeaveNote] = useState('');
  const [confirmExit, setConfirmExit] = useState<null | 'departing' | 'exited'>(null);
  const photo = useChildPhoto(org.id, childId);
  const { days } = useHopeDays(org.id);
  const [concernOpen, setConcernOpen] = useState(false);
  const [concern, setConcern] = useState('');

  useEffect(() => {
    if (!child) return;
    setDob(child.dateOfBirth ?? ''); setSchool(child.school ?? ''); setSchoolStatus(child.schoolStatus); setEnrolledOn(child.enrolledOn ?? '');
    setProgrammes(child.programmes); setPhotoConsent(child.photoConsent); setGuardianConsent(child.guardianConsent);
    setSponsorName(child.sponsorName ?? ''); setSponsorPhone(child.sponsorPhone ?? ''); setSponsorEmail(child.sponsorEmail ?? '');
    setParentName(child.parentName ?? ''); setParentPhone(child.parentPhone ?? ''); setLeaveNote(child.departingNote ?? '');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [child?.id]);

  const recent = useMemo(() => {
    const byEvent = new Map(h.events.map((e) => [e.id, e]));
    return h.records.filter((r) => r.personId === childId).map((r) => ({ r, e: byEvent.get(r.eventId) })).filter((x) => x.e)
      .sort((a, b) => b.e!.date.localeCompare(a.e!.date)).slice(0, 8);
  }, [h.events, h.records, childId]);

  if (!child || (h.peopleLoading && !person)) {
    return <div className="page narrow"><p><Link to="/hope/children">← Children</Link></p><p>{h.loading ? 'Loading…' : 'This child was not found.'}</p></div>;
  }
  const name = h.nameOf(child.id);
  const age = h.ageOf(child);

  function save() {
    updateChild(org.id, child!.id, {
      dateOfBirth: dob || null, school: school.trim().slice(0, 120), schoolStatus, enrolledOn: enrolledOn || null, programmes, photoConsent, guardianConsent,
      sponsorName: sponsorName.trim().slice(0, 120), sponsorPhone: sponsorPhone.trim().slice(0, 30), sponsorEmail: sponsorEmail.trim().slice(0, 120),
      parentName: parentName.trim().slice(0, 120), parentPhone: parentPhone.trim().slice(0, 30),
    }).catch((err) => toast.show(friendlyError(err)));
    toast.show('Saved');
  }
  function leave() {
    const to = confirmExit!;
    setConfirmExit(null);
    updateChild(org.id, child!.id, to === 'exited' ? { status: 'exited', exitedOn: h.today, departingNote: leaveNote.trim().slice(0, 500) } : { status: 'departing', departingNote: leaveNote.trim().slice(0, 500) })
      .catch((err) => toast.show(friendlyError(err)));
    toast.show(to === 'exited' ? `${name} moved to Past children.` : `${name} is marked as departing.`);
  }
  async function takePhoto(f: File | undefined) {
    if (!f) return;
    try { saveChildPhoto(org.id, child!.id, await shrinkPhoto(f)).catch((err) => toast.show(friendlyError(err))); toast.show('Photo saved'); }
    catch (err) { toast.show(friendlyError(err)); }
  }
  function sendConcern() {
    if (!concern.trim()) return;
    raiseConcern(org.id, child!.id, concern).catch((err) => toast.show(friendlyError(err)));
    setConcern(''); setConcernOpen(false);
    toast.show('Concern sent to the pastor. Only the pastor can see it.');
  }

  return (
    <div className="page narrow">
      <p><Link to="/hope/children">← Children</Link></p>
      <div className="page-head">
        <div>
          <h1>{name}</h1>
          <p className="muted">{h.codeOf(child)}{age != null ? ` · ${age} years` : ''}{person?.gender ? ` · ${person.gender}` : ''}
            {consentMissing(child) && <span className="badge badge-warn">Consent missing</span>}
            {child.status === 'departing' && <span className="badge badge-warn">Departing</span>}
            {child.status === 'exited' && <span className="badge badge-muted">Departed{child.exitedOn ? ` ${formatDateKey(child.exitedOn)}` : ''}</span>}
          </p>
        </div>
        <CleanupButton orgId={org.id} kind="person" id={child.id} back="/hope/children" />
      </div>
      <HopeNav />

      <section className="card hr-photo">
        <Avatar photo={child.photoConsent?.given ? photo : null} name={name} size={96} />
        <div className="stack">
          {child.photoConsent?.given ? (canEdit && (
            <div className="chips">
              <label className="btn">Take a photo<input type="file" hidden accept="image/*" capture="environment" onChange={(e) => { void takePhoto(e.target.files?.[0]); e.target.value = ''; }} /></label>
              <label className="btn">Upload a photo<input type="file" hidden accept="image/*" onChange={(e) => { void takePhoto(e.target.files?.[0]); e.target.value = ''; }} /></label>
              {photo && <button type="button" className="btn btn-quiet" onClick={() => { removeChildPhoto(org.id, child.id).catch((err) => toast.show(friendlyError(err))); }}>Remove photo</button>}
            </div>
          )) : <p className="small muted">A photo can be added once the guardian's photo consent is "Yes, agreed" (below).</p>}
          {(() => { const r = rateFrom(kidHistory(child.id, days).map((x) => x.entry)); return <p className="small">Weekly register: <PctBadge pct={r.pct} /> {r.marked ? `${r.present} present, ${r.absent} absent, ${r.excused} excused` : 'not marked yet'}</p>; })()}
        </div>
      </section>

      <section className="card stack">
        <h2>Guardian or caregiver</h2>
        {guardian ? (
          <p>
            <Link to={`/people/${org.id}/${guardian.id}`}>{guardian.fullName}</Link>
            {guardian.phone && <> · <a href={`tel:${guardian.phone}`}>{formatPhone(guardian.phone)}</a></>}
            <span className="muted small"> · {guardian.whatsappConsent?.given && !guardian.whatsappConsent.stoppedAt ? 'agreed to WhatsApp' : 'call only'}</span>
          </p>
        ) : <p className="notice notice-warn small">No guardian saved. <Link to={`/people/${org.id}/${child.id}/edit`}>Add one on the person record</Link> so the child can be followed up.</p>}
      </section>

      <section className="card stack">
        <h2>Details</h2>
        <div className="field-row">
          <label className="field"><span>Date of birth</span><input type="date" disabled={!canEdit} value={dob} max={h.today} onChange={(e) => setDob(e.target.value)} /></label>
          <label className="field"><span>Joined on</span><input type="date" disabled={!canEdit} value={enrolledOn} max={h.today} onChange={(e) => setEnrolledOn(e.target.value)} /></label>
        </div>
        <div className="field-row">
          <label className="field"><span>School</span><input disabled={!canEdit} value={school} maxLength={120} onChange={(e) => setSchool(e.target.value)} /></label>
          <label className="field"><span>In school?</span>
            <select disabled={!canEdit} value={schoolStatus} onChange={(e) => setSchoolStatus(e.target.value as SchoolStatus)}>
              {SCHOOL_STATUSES.map((v) => <option key={v} value={v}>{SCHOOL_STATUS_LABELS[v]}</option>)}
            </select>
          </label>
        </div>
        <div className="field-row">
          <label className="field"><span>Parent's name</span><input disabled={!canEdit} value={parentName} maxLength={120} onChange={(e) => setParentName(e.target.value)} placeholder={guardian?.fullName ?? ''} /></label>
          <label className="field"><span>Parent's contact</span><input disabled={!canEdit} inputMode="tel" value={parentPhone} maxLength={30} onChange={(e) => setParentPhone(e.target.value)} placeholder={guardian?.phone ? formatPhone(guardian.phone) : '0712 345 678'} /></label>
        </div>
        <label className="field"><span>Sponsor's name</span><input disabled={!canEdit} value={sponsorName} maxLength={120} onChange={(e) => setSponsorName(e.target.value)} /></label>
        <div className="field-row">
          <label className="field"><span>Sponsor's phone (optional)</span><input disabled={!canEdit} inputMode="tel" value={sponsorPhone} maxLength={30} onChange={(e) => setSponsorPhone(e.target.value)} /></label>
          <label className="field"><span>Sponsor's email (optional)</span><input disabled={!canEdit} type="email" value={sponsorEmail} maxLength={120} onChange={(e) => setSponsorEmail(e.target.value)} /></label>
        </div>
        <ProgrammeFields programmes={h.programmes} value={programmes} onChange={setProgrammes} disabled={!canEdit} />
        <ConsentField label="Guardian consent to keep this child's details" value={guardianConsent} onChange={setGuardianConsent} today={h.today} disabled={!canEdit} />
        <ConsentField label="Consent to take and keep photos" value={photoConsent} onChange={setPhotoConsent} today={h.today} disabled={!canEdit} />
        {canEdit && <button type="button" className="btn btn-primary align-start" onClick={save}>Save changes</button>}
      </section>

      <RegisterHistory history={kidHistory(child.id, days)} />

      <section className="card stack">
        <h2>Programme sessions</h2>
        {child.programmes.filter((p) => p.name.toLowerCase() !== MEALS_PROGRAMME.toLowerCase()).map((p) => {
          const { missed } = missedInARow(child.id, p.name, h.programmes, h.events, h.records, child.enrolledOn, h.today);
          return <p key={p.name} className="small"><strong>{p.name}</strong>{p.group ? ` (${p.group})` : ''}{p.level ? ` · ${p.level}` : ''} · {missed === 0 ? 'came to the latest session' : `missed the last ${missed} ${missed === 1 ? 'session' : 'sessions'}`}</p>;
        })}
        {recent.length === 0 ? <p className="muted small">No sessions marked for this child yet.</p> : (
          <ul className="link-list">
            {recent.map(({ r, e }) => (
              <li key={r.eventId}><Link to={`/attendance/${org.id}/${e!.id}`}><span className="link-title">{e!.name}</span><span className="link-detail">{formatDateKey(e!.date)} · {ATTENDANCE_STATUS_LABELS[r.status as keyof typeof ATTENDANCE_STATUS_LABELS] ?? r.status} · {programmeOf(e!, h.programmes) ?? ''}</span></Link></li>
            ))}
          </ul>
        )}
      </section>

      {(can('people.write') || can('attendance.write')) && (
        <section className="card stack">
          <h2>Worried about {person?.firstName ?? 'this child'}?</h2>
          {concernOpen ? (
            <>
              <p className="small">Write what you saw or heard. <strong>Only the pastor will be told and can read this.</strong> Do not talk to others about it.</p>
              <label className="field"><span>What are you worried about?</span><textarea rows={4} maxLength={4000} value={concern} onChange={(e) => setConcern(e.target.value)} /></label>
              <div className="chips">
                <button type="button" className="btn btn-primary" disabled={!concern.trim()} onClick={sendConcern}>Send to the pastor</button>
                <button type="button" className="btn btn-quiet" onClick={() => setConcernOpen(false)}>Cancel</button>
              </div>
            </>
          ) : <button type="button" className="btn align-start" onClick={() => setConcernOpen(true)}>Raise a safeguarding concern</button>}
        </section>
      )}

      {h.pastoral && <PastorSection orgId={org.id} childId={child.id} today={h.today} />}

      {canEdit && (
        <section className="card stack">
          <h2>Leaving the Hope Centre</h2>
          {child.status !== 'exited' && <label className="field"><span>Reason or note (optional)</span><input value={leaveNote} maxLength={500} onChange={(e) => setLeaveNote(e.target.value)} placeholder="Moving away, finished the programme…" /></label>}
          {child.departingNote && child.status !== 'active' && <p className="small muted">Note: {child.departingNote}</p>}
          <div className="chips">
            {child.status === 'active' && <button type="button" className="btn" onClick={() => setConfirmExit('departing')}>Mark as departing</button>}
            {child.status !== 'exited' && <button type="button" className="btn btn-quiet danger-text" onClick={() => setConfirmExit('exited')}>Mark as departed</button>}
            {child.status !== 'active' && <button type="button" className="btn btn-quiet" onClick={() => { updateChild(org.id, child.id, { status: 'active', exitedOn: null, departingNote: null }).catch((err) => toast.show(friendlyError(err))); }}>Return to active</button>}
          </div>
          <p className="small muted">Departing: in the process of leaving for good. Departed: has left for good and moves to Past children.</p>
        </section>
      )}
      <ConfirmDialog open={!!confirmExit} title={confirmExit === 'exited' ? `Has ${name} left for good?` : `Mark ${name} as departing?`}
        body={confirmExit === 'exited' ? 'They move to Past children and leave the weekly register. Their records are kept, and you can return them to active at any time.' : 'They stay on the register, marked Departing, until they leave.'}
        confirmLabel={confirmExit === 'exited' ? 'Yes, departed' : 'Mark as departing'} danger={confirmExit === 'exited'} onConfirm={leave} onCancel={() => setConfirmExit(null)} />
    </div>
  );
}

/** The child's weekly register marks, newest first. */
function RegisterHistory({ history }: { history: ReturnType<typeof kidHistory> }) {
  if (!history.length) return null;
  return (
    <section className="card stack">
      <h2>Weekly register</h2>
      <div className="hr-dots" aria-label="Latest weeks, oldest first">
        {history.slice(0, 16).reverse().map((x) => <span key={x.date} className={`hr-dot m-${x.entry.s}`} title={`${formatDateKey(x.date)}: ${KID_MARK_LABELS[x.entry.s]}`} />)}
      </div>
      <ul className="link-list">
        {history.slice(0, 8).map((x) => (
          <li key={x.date}><div><span className="link-title">{formatDateKey(x.date)} · {KID_MARK_LABELS[x.entry.s]}</span>
            {(x.entry.t || x.entry.r) && <span className="link-detail">{[x.entry.t && `Checked in ${x.entry.t}`, x.entry.r].filter(Boolean).join(' · ')}</span>}</div></li>
        ))}
      </ul>
    </section>
  );
}

/** Welfare notes, home visits, referrals and safeguarding concerns. Only the pastor's account can read these. */
function PastorSection({ orgId, childId, today }: { orgId: string; childId: string; today: string }) {
  const toast = useToast();
  const p = useChildPrivate(orgId, childId);
  const [welfare, setWelfare] = useState('');
  const [health, setHealth] = useState('');
  const [home, setHome] = useState('');
  const [visitDate, setVisitDate] = useState(today);
  const [visitNote, setVisitNote] = useState('');
  const [refTo, setRefTo] = useState('');
  const [refReason, setRefReason] = useState('');
  const fail = (err: unknown) => toast.show(friendlyError(err));
  useEffect(() => {
    setWelfare(p.private?.welfare ?? ''); setHealth(p.private?.health ?? ''); setHome(p.private?.home ?? '');
  }, [p.private?.id, p.private?.welfare, p.private?.health, p.private?.home]);

  return (
    <>
      {p.concerns.length > 0 && (
        <section className="card stack">
          <h2>Safeguarding concerns</h2>
          <ul className="link-list">
            {p.concerns.map((c) => (
              <li key={c.id}>
                <div>
                  <span className="link-title">{c.status === 'open' ? 'Open' : 'Closed'}{c.createdAt ? ` · ${formatDateKey(c.createdAt.toDate().toISOString().slice(0, 10))}` : ''}</span>
                  <span className="link-detail">{c.summary}</span>
                  {c.closingNote && <span className="link-detail">Closed: {c.closingNote}</span>}
                  {c.status === 'open' && <button type="button" className="btn btn-quiet" onClick={() => {
                    const note = window.prompt('How was this dealt with? (kept private)') ?? '';
                    if (note.trim()) closeConcern(orgId, c.id, note).catch(fail);
                  }}>Close with a note</button>}
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="card stack">
        <h2>Welfare (pastor only)</h2>
        <p className="small muted">Other staff cannot see this section.</p>
        <label className="field"><span>Welfare notes</span><textarea rows={3} maxLength={4000} value={welfare} onChange={(e) => setWelfare(e.target.value)} /></label>
        <label className="field"><span>Dietary and health flags</span><textarea rows={2} maxLength={2000} value={health} onChange={(e) => setHealth(e.target.value)} /></label>
        <label className="field"><span>Home circumstances</span><textarea rows={2} maxLength={2000} value={home} onChange={(e) => setHome(e.target.value)} /></label>
        <button type="button" className="btn align-start" onClick={() => { saveChildPrivate(orgId, childId, { welfare: welfare.trim(), health: health.trim(), home: home.trim() }, !!p.private).catch(fail); toast.show('Saved'); }}>Save</button>
      </section>

      <section className="card stack">
        <h2>Home visits</h2>
        {p.visits.length > 0 && <ul className="link-list">{p.visits.map((v) => <li key={v.id}><div><span className="link-title">{formatDateKey(v.date)}</span><span className="link-detail">{v.note}</span></div></li>)}</ul>}
        <div className="field-row">
          <label className="field"><span>Date</span><input type="date" value={visitDate} max={today} onChange={(e) => setVisitDate(e.target.value)} /></label>
        </div>
        <label className="field"><span>What happened</span><textarea rows={2} maxLength={3000} value={visitNote} onChange={(e) => setVisitNote(e.target.value)} /></label>
        <button type="button" className="btn align-start" disabled={!visitNote.trim() || !visitDate} onClick={() => { addHomeVisit(orgId, childId, visitDate, visitNote).catch(fail); setVisitNote(''); toast.show('Visit logged'); }}>Log the visit</button>
      </section>

      <section className="card stack">
        <h2>Referrals</h2>
        {p.referrals.length > 0 && (
          <ul className="link-list">
            {p.referrals.map((r) => (
              <li key={r.id}>
                <div>
                  <span className="link-title">{r.to} · {formatDateKey(r.date)} · {r.status === 'open' ? 'open' : 'closed'}</span>
                  <span className="link-detail">{r.reason}{r.outcome ? ` · Outcome: ${r.outcome}` : ''}</span>
                  {r.status === 'open' && <button type="button" className="btn btn-quiet" onClick={() => { const o = window.prompt('What was the outcome?') ?? ''; if (o.trim()) closeReferral(orgId, r.id, o).catch(fail); }}>Close with the outcome</button>}
                </div>
              </li>
            ))}
          </ul>
        )}
        <label className="field"><span>Referred to</span><input value={refTo} maxLength={120} onChange={(e) => setRefTo(e.target.value)} placeholder="Clinic, children's office, school…" /></label>
        <label className="field"><span>Why</span><textarea rows={2} maxLength={1000} value={refReason} onChange={(e) => setRefReason(e.target.value)} /></label>
        <button type="button" className="btn align-start" disabled={!refTo.trim()} onClick={() => { addReferral(orgId, childId, { date: today, to: refTo, reason: refReason }).catch(fail); setRefTo(''); setRefReason(''); toast.show('Referral logged'); }}>Log the referral</button>
      </section>
    </>
  );
}
