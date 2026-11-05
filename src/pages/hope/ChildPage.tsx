import { useEffect, useState } from 'react';
import { CleanupButton } from '../../components/CleanupDialog';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { useAuth } from '../../state/AuthContext';
import { useToast } from '../../state/ToastContext';
import { useChildPhoto, useClubs, useHopeDays } from '../../state/useHope';
import { memberRate, scheduleText } from '../../../functions/src/shared/hopeClubs';
import { ConfirmDialog } from '../../components/ConfirmDialog';
import { fillMessage, waLink } from '../../../functions/src/shared/hopeMessages';
import { ClassChip } from '../../components/Stone';
import { classOf, hasAllergy, NO_ALLERGIES } from '../../../functions/src/shared/hopeClasses';
import { NOT_ON_LIST } from '../../../functions/src/shared/hopeSponsorship';
import { isHopeDirector } from '../../../functions/src/shared/hopePhotos';
import { canKeepAccounts } from '../../../functions/src/shared/permissions';
import { friendlyError } from '../../lib/errors';
import { updateChild } from '../../lib/hopeWrites';
import { removeChildPhoto, saveChildPhoto } from '../../lib/childPhoto';
import { ApprovePhoto } from '../../components/ApprovePhoto';
import { daysToBirthday, KID_MARK_LABELS, kidHistory, rateFrom, streak, STREAK_SHOWN } from '../../../functions/src/shared/hopeRegister';
import { Avatar, PctBadge, shrinkPhoto } from './registerParts';
import { formatDateKey } from '../../../functions/src/shared/datetime';
import { formatPhone } from '../../../functions/src/shared/phone';
import {
  consentMissing, hasPayment, isCurrentChild, NO_PAYMENT, PAY_BY, PAY_BY_LABELS, paymentLine, SCHOOL_STATUSES, SCHOOL_STATUS_LABELS,
  type ChildPayment, type ChildProgramme, type Consent, type PayBy, type SchoolStatus,
} from '../../../functions/src/shared/hope';
import { ChildCare, FeesPaid, saveLeavingNote } from './ChildRecords';
import { canKeepFees, canReadNotes } from '../../../functions/src/shared/hopeRecords';
import { sponsorUpdatePdf } from '../../lib/sponsorUpdate';
import { shareOrDownload } from '../../lib/givingPdf';
import { sponsorPage } from './sponsorPages';
import { childWarning, WARNING_DOT, WARNING_LABEL } from '../../../functions/src/shared/hopeWarning';
import { childJourney } from '../../../functions/src/shared/hopeJourney';
import { feesOwing, listNotes } from '../../lib/hopeRecords';
import { HopeGate, useHopePage } from './common';
import { ConsentField } from './fields';
import type { Organization } from '../../state/OrgContext';

type Tab = 'about' | 'attendance' | 'fees' | 'care';
/** The child's page as 4 tabs (Andy, 2026-11-05, 1A): About, Attendance, Fees and Care. */
const TABS: [Tab, string][] = [['about', 'About'], ['attendance', 'Attendance'], ['fees', 'Fees'], ['care', 'Care']];

export function ChildPage() {
  return <HopeGate title="Child">{(org) => <ChildScreen org={org} />}</HopeGate>;
}

function ChildScreen({ org }: { org: Organization }) {
  const { childId = '' } = useParams();
  const h = useHopePage(org);
  const { can, profile } = useAuth();
  const toast = useToast();
  const child = h.children.find((c) => c.id === childId);
  const person = h.byId(childId);
  const guardian = person?.guardianId ? h.byId(person.guardianId) : undefined;
  const canEdit = can('people.write');
  const [params, setParams] = useSearchParams();
  const tab = (TABS.some(([k]) => k === params.get('tab')) ? params.get('tab') : 'about') as Tab;
  const setTab = (t: Tab) => setParams(t === 'about' ? {} : { tab: t }, { replace: true });
  // The Director captures allergies (Andy, 2026-11-05, 4A); Andy and Doreen may too.
  const canAllergies = canEdit && (isHopeDirector(profile, org.id) || canKeepAccounts(profile));
  const showFees = canEdit || canKeepFees(profile, org.id) || !!child?.payment;

  const [dob, setDob] = useState('');
  const [school, setSchool] = useState('');
  const [schoolClass, setSchoolClass] = useState('');
  const [schoolStatus, setSchoolStatus] = useState<SchoolStatus>('unknown');
  const [enrolledOn, setEnrolledOn] = useState('');
  const [programmes, setProgrammes] = useState<ChildProgramme[]>([]);
  const [photoConsent, setPhotoConsent] = useState<Consent>({ given: null, date: null });
  const [guardianConsent, setGuardianConsent] = useState<Consent>({ given: null, date: null });
  const [sponsorName, setSponsorName] = useState('');
  const [allergies, setAllergies] = useState('');
  const [askPhoto, setAskPhoto] = useState(false);
  // A new photo waits for the Director's, Andy's or Doreen's password (Andy, 2026-11-05).
  const [newPhoto, setNewPhoto] = useState<string | null>(null);
  const [parentName, setParentName] = useState('');
  const [parentPhone, setParentPhone] = useState('');
  const [leaveNote, setLeaveNote] = useState('');
  const [confirmExit, setConfirmExit] = useState<null | 'departing' | 'exited'>(null);
  const photo = useChildPhoto(org.id, childId);
  const { days } = useHopeDays(org.id);
  const clubs = useClubs(org.id);

  const [editing, setEditing] = useState(false);
  // The one-page Sponsor update (v182, 13A).
  const [sponsorAsk, setSponsorAsk] = useState(false);
  const [sponsorNote, setSponsorNote] = useState('');
  const [sponsorBusy, setSponsorBusy] = useState(false);
  // The early warning (14A) and the Journey strip (15A). Fees and home visits only for those allowed to see them.
  const keepsFees = canKeepFees(profile, org.id);
  const readsNotes = canReadNotes(profile, org.id);
  const [owing, setOwing] = useState(false);
  const [visits, setVisits] = useState<{ day: string; kind: string }[]>([]);
  useEffect(() => {
    if (!childId) return;
    if (keepsFees) feesOwing(org.id).then((r) => setOwing(r.owing.some((o) => o.childId === childId)), () => { /* the dot simply leaves fees out */ });
    if (readsNotes) listNotes(org.id, childId).then((r) => setVisits(r.notes.map((n) => ({ day: n.day, kind: n.kind }))), () => { /* the strip simply leaves visits out */ });
  }, [org.id, childId, keepsFees, readsNotes]);
  function reset() {
    if (!child) return;
    setDob(child.dateOfBirth ?? ''); setSchool(child.school ?? ''); setSchoolClass(child.schoolClass ?? ''); setSchoolStatus(child.schoolStatus); setEnrolledOn(child.enrolledOn ?? '');
    setProgrammes(child.programmes); setPhotoConsent(child.photoConsent); setGuardianConsent(child.guardianConsent);
    setSponsorName(child.sponsorName ?? ''); setAllergies(child.allergies ?? '');
    setParentName(child.parentName ?? ''); setParentPhone(child.parentPhone ?? ''); setLeaveNote(child.departingNote ?? '');
  }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { reset(); setEditing(false); }, [child?.id]);


  if (!child || (h.peopleLoading && !person)) {
    return <div className="page narrow"><p><Link to="/hope/children">← Children</Link></p><p>{h.loading ? 'Loading…' : 'This child was not found.'}</p></div>;
  }
  const name = h.nameOf(child.id);
  const age = h.ageOf(child);

  function save() {
    updateChild(org.id, child!.id, {
      dateOfBirth: dob || null, school: school.trim().slice(0, 120), schoolClass: schoolClass.trim().slice(0, 40), schoolStatus, enrolledOn: enrolledOn || null, programmes, photoConsent, guardianConsent,
      sponsorName: sponsorName.trim().slice(0, 120),
      ...(canAllergies ? { allergies: allergies.trim().slice(0, 300) || null } : {}),
      parentName: parentName.trim().slice(0, 120), parentPhone: parentPhone.trim().slice(0, 30),
    }).catch((err) => toast.show(friendlyError(err)));
    toast.show('Saved');
    setEditing(false);
  }
  function leave() {
    const to = confirmExit!;
    setConfirmExit(null);
    updateChild(org.id, child!.id, to === 'exited' ? { status: 'exited', exitedOn: h.today, departingNote: leaveNote.trim().slice(0, 500) } : { status: 'departing', departingNote: leaveNote.trim().slice(0, 500) })
      .catch((err) => toast.show(friendlyError(err)));
    // The leaving note goes to Records too (Andy, 2026-11-05, 4A), dated and signed.
    saveLeavingNote(org.id, child!.id, `${to === 'exited' ? 'Marked as departed (left for good)' : 'Marked as departing'}${leaveNote.trim() ? `: ${leaveNote.trim().slice(0, 500)}` : '.'}`)
      .catch(() => { /* offline: the child's own record still has the note */ });
    toast.show(to === 'exited' ? `${name} moved to Past children.` : `${name} is marked as departing.`);
  }
  async function sponsorPdf() {
    setSponsorBusy(true);
    try {
      const page = sponsorPage({ child: child!, name, age, today: h.today, days, clubs: clubs.clubs, wins: clubs.wins, photo, note: sponsorNote });
      await shareOrDownload(await sponsorUpdatePdf(org, [page], h.today.slice(0, 4)), `${name}: sponsor update`);
    } catch (err) { toast.show(friendlyError(err)); } finally { setSponsorBusy(false); }
  }
  async function takePhoto(f: File | undefined) {
    if (!f) return;
    try { setNewPhoto(await shrinkPhoto(f)); }
    catch (err) { toast.show(friendlyError(err)); }
  }

  const history = kidHistory(child.id, days);
  const myClubs = clubs.clubs.filter((x) => x.memberIds.includes(child.id));
  const rate = rateFrom(history.map((x) => x.entry));
  const fire = streak(child.id, days);
  const parentPhoneShown = child.parentPhone || guardian?.phone || '';
  const parentShown = child.parentName || guardian?.fullName || '';
  const born = child.dateOfBirth ? new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${child.dateOfBirth}T12:00:00Z`)) : null;
  const toBirthday = daysToBirthday(child.dateOfBirth, h.today);
  const klass = classOf(child.dateOfBirth, h.today);
  const allergic = hasAllergy(child.allergies);
  const sp = child.sponsorship;
  const registered = child.enrolledOn ?? sp?.registeredOn ?? null;
  const warning = isCurrentChild(child) ? childWarning(child, days, { urgent: h.openConcerns.some((c) => c.childId === child.id), owing }) : null;
  const journey = childJourney(child, { today: h.today, days, wins: clubs.wins, clubName: (id) => clubs.clubs.find((x) => x.id === id)?.name ?? '', visits: readsNotes ? visits : [] });

  return (
    <div className="page narrow">
      <p><Link to="/hope/children">← Children</Link></p>

      <section className={`card hc-profile${child.status !== 'active' ? ` s-${child.status}` : ''}`}>
        <div className="hc-profile-photo">
          <Avatar photo={child.photoConsent?.given ? photo : null} name={name} size={112} />
          {child.photoConsent?.given && canEdit && (
            <div className="hc-photo-btns">
              <label className="btn btn-quiet" title="Take a photo">📷<span className="sr-only">Take a photo</span><input type="file" hidden accept="image/*" capture="environment" onChange={(e) => { void takePhoto(e.target.files?.[0]); e.target.value = ''; }} /></label>
              <label className="btn btn-quiet" title="Upload a photo">⬆︎<span className="sr-only">Upload a photo</span><input type="file" hidden accept="image/*" onChange={(e) => { void takePhoto(e.target.files?.[0]); e.target.value = ''; }} /></label>
              {photo && <button type="button" className="btn btn-quiet" title="Remove photo" onClick={() => setAskPhoto(true)}>✕<span className="sr-only">Remove photo</span></button>}
            </div>
          )}
        </div>
        <div className="hc-profile-main">
          <div className="hc-profile-top">
            <h1>{name}</h1>
            <CleanupButton orgId={org.id} kind="person" id={child.id} back="/hope/children" hope label="Delete" title={`Do you want to delete ${name}?`} askPassword />
          </div>
          <p className="muted">{h.codeOf(child)}{person?.gender ? ` · ${person.gender}` : ''} <ClassChip c={klass} />
            {allergic && <span className="badge badge-warn">⚠️ Allergy: {child.allergies}</span>}
            {consentMissing(child) && <span className="badge badge-warn">Consent missing</span>}
            {child.status === 'departing' && <span className="badge badge-warn">Departing</span>}
            {child.status === 'exited' && <span className="badge badge-muted">Departed{child.exitedOn ? ` ${formatDateKey(child.exitedOn)}` : ''}</span>}
          </p>
          {parentPhoneShown && (
            <div className="chips">
              <a className="btn btn-primary" href={`tel:${parentPhoneShown}`}>📞 Call {parentShown ? parentShown.split(' ')[0] : 'the parent'}</a>
              <a className="btn" href={waLink(parentPhoneShown, fillMessage('Hello {parent}, ', { parentName: parentShown, children: [{ id: child.id, name }] }))} target="_blank" rel="noopener noreferrer">🟢 WhatsApp</a>
              <span className="small muted align-center">{formatPhone(parentPhoneShown) || parentPhoneShown}</span>
            </div>
          )}
          {warning && (
            <details className={`hc-warn w-bg-${warning.level}`}>
              <summary>{WARNING_DOT[warning.level]} <b>{WARNING_LABEL[warning.level]}</b>{warning.reasons.length ? `: ${warning.reasons[0]}${warning.reasons.length > 1 ? ` and ${warning.reasons.length - 1} more` : ''}` : ''}</summary>
              {warning.reasons.length > 1 && <ul>{warning.reasons.map((r) => <li key={r}>{r}</li>)}</ul>}
            </details>
          )}
          {!parentPhoneShown && !guardian && <p className="notice notice-warn small">No parent contact saved. Tap ✏️ Edit details below to add it, so the child can be followed up.</p>}
        </div>
      </section>

      {journey.length > 0 && (
        <section className="card hc-journey" aria-label="Journey at Hope">
          <h2>🧭 Journey at Hope</h2>
          <ol>
            {journey.map((j, i) => (
              <li key={`${j.date}-${i}`} className={j.private ? 'private' : undefined} title={j.private ? 'Only those who read care notes see this' : undefined}>
                <span className="hc-j-ico" aria-hidden="true">{j.icon}</span><b>{j.text}</b><span className="small muted">{formatDateKey(j.date)}</span>
              </li>
            ))}
          </ol>
        </section>
      )}

      <div className="segmented hc-tabs" role="tablist" aria-label="About this child">
        {TABS.filter(([k]) => k !== 'fees' || showFees).map(([k, label]) => (
          <button key={k} type="button" role="tab" aria-selected={tab === k} className={tab === k ? 'on' : ''} onClick={() => setTab(k)}>{label}</button>
        ))}
      </div>

      {tab === 'about' && !editing && (
        <section className="card stack">
          <dl className="hc-facts">
            <div><dt>Age</dt><dd>{age != null ? `${age} years` : 'Not known'}</dd></div>
            <div><dt>Birthday</dt><dd>{born ?? 'Not known'}{toBirthday != null && toBirthday <= 7 ? (toBirthday === 0 ? ' 🎈 today!' : ` 🎈 in ${toBirthday} ${toBirthday === 1 ? 'day' : 'days'}`) : ''}</dd></div>
            <div><dt>School</dt><dd>{child.school || 'Not known'}{child.schoolClass ? ` · ${child.schoolClass}` : ''}</dd></div>
            <div><dt>Child ID</dt><dd>{sp?.childId || (sp?.status === NOT_ON_LIST ? NOT_ON_LIST : 'Not on the list yet')}</dd></div>
            {sp?.listName && sp.listName.toLowerCase() !== name.toLowerCase() && <div><dt>Name on KE-014</dt><dd>{sp.listName}</dd></div>}
            <div><dt>Registration date</dt><dd>{registered ? formatDateKey(registered) : 'Not known'}</dd></div>
            <div><dt>Programme completion</dt><dd>{sp?.completesOn ? formatDateKey(sp.completesOn) : 'Not known'}</dd></div>
            <div><dt>Sponsorship status</dt><dd>{sp?.status || 'Not known'}</dd></div>
            <div><dt>Sponsor</dt><dd>{child.sponsorName || 'None yet'}</dd></div>
            <div><dt>Sponsor ID</dt><dd>{sp?.sponsorId || 'None'}</dd></div>
            <div><dt>Allergies</dt><dd>{child.allergies || 'Not recorded'}</dd></div>
            <div><dt>Parent</dt><dd>{guardian ? <Link to={`/people/${org.id}/${guardian.id}`}>{parentShown}</Link> : parentShown || 'Not saved'}</dd></div>
            <div><dt>Guardian consent</dt><dd>{consentText(child.guardianConsent)}</dd></div>
            <div><dt>Photo consent</dt><dd>{consentText(child.photoConsent)}</dd></div>
            <div><dt>In school?</dt><dd>{SCHOOL_STATUS_LABELS[child.schoolStatus]}</dd></div>
            <div><dt>Attendance</dt><dd><PctBadge pct={rate.pct} /> {fire >= STREAK_SHOWN && <span className="hr-delight hr-streak">🔥{fire} in a row</span>}</dd></div>
          </dl>
          <div className="chips">
            {canEdit && <button type="button" className="btn" onClick={() => setEditing(true)}>✏️ Edit details</button>}
            {(canEdit || canReadNotes(profile, org.id)) && <button type="button" className="btn" onClick={() => setSponsorAsk((v) => !v)}>📄 Sponsor update</button>}
          </div>
          {sponsorAsk && (
            <div className="stack ht-done">
              <label className="field"><span>A note from the Director (optional)</span>
                <textarea rows={3} maxLength={800} value={sponsorNote} onChange={(e) => setSponsorNote(e.target.value)} placeholder={`${person?.firstName ?? 'This child'} has grown in confidence this term…`} /></label>
              <button type="button" className="btn btn-primary align-start" disabled={sponsorBusy} onClick={() => void sponsorPdf()}>{sponsorBusy ? 'Making…' : 'Make the PDF'}</button>
            </div>
          )}
        </section>
      )}

      {tab === 'about' && editing && (
        <section className="card">
        <div className="stack">
        <div className="field-row">
          <label className="field"><span>Date of birth</span><input type="date" disabled={!canEdit} value={dob} max={h.today} onChange={(e) => setDob(e.target.value)} /></label>
          <label className="field"><span>Registration date</span><input type="date" disabled={!canEdit} value={enrolledOn} max={h.today} onChange={(e) => setEnrolledOn(e.target.value)} /></label>
        </div>
        <div className="field-row">
          <label className="field"><span>School</span><input disabled={!canEdit} value={school} maxLength={120} onChange={(e) => setSchool(e.target.value)} /></label>
          <label className="field"><span>Class</span><input disabled={!canEdit} value={schoolClass} maxLength={40} onChange={(e) => setSchoolClass(e.target.value)} placeholder="Grade 3" /></label>
        </div>
        <div className="field-row">
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
        <label className="field"><span>Allergies{canAllergies ? '' : ' (the Director records these)'}</span>
          <input disabled={!canAllergies} value={allergies} maxLength={300} onChange={(e) => setAllergies(e.target.value)} placeholder="e.g. Peanuts, milk" />
        </label>
        {canAllergies && !allergies && <button type="button" className="btn btn-quiet btn-small align-start" onClick={() => setAllergies(NO_ALLERGIES)}>None known</button>}
        <ConsentField label="Guardian consent to keep this child's details" value={guardianConsent} onChange={setGuardianConsent} today={h.today} disabled={!canEdit} />
        <ConsentField label="Consent to take and keep photos" value={photoConsent} onChange={setPhotoConsent} today={h.today} disabled={!canEdit} />
        <div className="chips">
          <button type="button" className="btn btn-primary" onClick={save}>Save changes</button>
          <button type="button" className="btn btn-quiet" onClick={() => { reset(); setEditing(false); }}>Cancel</button>
        </div>
        </div>
        </section>
      )}

      {tab === 'about' && !editing && (
        <>
          {canEdit && (
            <details className="card hr-fold">
              <summary><h2>Leaving the Hope Centre</h2><span className="small muted">Departing or departed</span></summary>
              <div className="stack">
          {child.status !== 'exited' && <label className="field"><span>Reason or note (optional)</span><input value={leaveNote} maxLength={500} onChange={(e) => setLeaveNote(e.target.value)} placeholder="Moving away, finished the programme…" /></label>}
          {child.departingNote && child.status !== 'active' && <p className="small muted">Note: {child.departingNote}</p>}
          <div className="chips">
            {child.status === 'active' && <button type="button" className="btn" onClick={() => setConfirmExit('departing')}>Mark as departing</button>}
            {child.status !== 'exited' && <button type="button" className="btn btn-quiet danger-text" onClick={() => setConfirmExit('exited')}>Mark as departed</button>}
            {child.status !== 'active' && <button type="button" className="btn btn-quiet" onClick={() => { updateChild(org.id, child.id, { status: 'active', exitedOn: null, departingNote: null }).catch((err) => toast.show(friendlyError(err))); saveLeavingNote(org.id, child.id, 'Returned to active.').catch(() => {}); }}>Return to active</button>}
          </div>
          <p className="small muted">Departing: in the process of leaving for good. Departed: has left for good and moves to Past children. Each change is kept as a dated note in Reports → Care.</p>
              </div>
            </details>
          )}
        </>
      )}

      {tab === 'attendance' && (
        <>
          <RegisterHistory history={history} rate={rate} />
          <section className="card stack">
            <h2>Clubs</h2>
          {myClubs.length > 0 && (
            <ul className="link-list">
              {myClubs.map((x) => { const r = memberRate(child.id, clubs.days.filter((d) => d.clubId === x.id)); return (
                <li key={x.id}><Link to={`/hope/clubs/${x.id}`} className="hr-who"><span className="cl-emoji" aria-hidden="true">{x.emoji}</span>
                  <span className="grow"><span className="link-title">{x.name}</span><span className="link-detail">{[x.levels[child.id], scheduleText(x)].filter(Boolean).join(' · ')}</span></span><PctBadge pct={r.pct} /></Link></li>
              ); })}
            </ul>
          )}
          {myClubs.length === 0 && <p className="small muted">Not in a club yet. Add children to a club from the club's Members tab.</p>}
          </section>
        </>
      )}

      {tab === 'fees' && showFees && (
        <>
          <SchoolFees orgId={org.id} childId={child.id} saved={child.payment ?? null} school={child.school ?? ''} canEdit={canEdit} />
          <FeesPaid orgId={org.id} childId={child.id} />
        </>
      )}

      {tab === 'care' && (
        <>
          <ChildCare org={org} childId={child.id} firstName={person?.firstName ?? 'this child'} today={h.today} />
        </>
      )}
      <ApprovePhoto open={askPhoto} orgId={org.id} title={`Do you want to delete ${name}'s photo?`} confirmLabel="Yes, delete" danger
        body="It goes to the Bin. The Director, Andrew Guya or Doreen approves with their password." onCancel={() => setAskPhoto(false)}
        onApproved={(proof) => { setAskPhoto(false); removeChildPhoto(org.id, child.id, proof).then(() => toast.show('Photo moved to the Bin'), (err: unknown) => toast.show(friendlyError(err))); }} />
      <ApprovePhoto open={!!newPhoto} orgId={org.id} title={`Save this photo of ${name}?`} confirmLabel="Save the photo" onCancel={() => setNewPhoto(null)}
        onApproved={(proof) => { const p = newPhoto!; setNewPhoto(null); saveChildPhoto(org.id, child.id, p, proof).then(() => toast.show('Photo saved'), (err: unknown) => toast.show(friendlyError(err))); }} />
      <ConfirmDialog open={!!confirmExit} title={confirmExit === 'exited' ? `Has ${name} left for good?` : `Mark ${name} as departing?`}
        body={confirmExit === 'exited' ? 'They move to Past children and leave the weekly register. Their records are kept, and you can return them to active at any time.' : 'They stay on the register, marked Departing, until they leave.'}
        confirmLabel={confirmExit === 'exited' ? 'Yes, departed' : 'Mark as departing'} danger={confirmExit === 'exited'} onConfirm={leave} onCancel={() => setConfirmExit(null)} />
    </div>
  );
}

/** The child's weekly register marks, newest first. */
function RegisterHistory({ history, rate }: { history: ReturnType<typeof kidHistory>; rate: ReturnType<typeof rateFrom> }) {
  if (!history.length) return null;
  return (
    <details className="card hr-fold" open>
      <summary><h2>Weekly register</h2><span className="small muted">{rate.present} present, {rate.absent} absent, {rate.excused} excused</span></summary>
      <div className="stack">
      <div className="hr-dots" aria-label="Latest weeks, oldest first">
        {history.slice(0, 16).reverse().map((x) => <span key={x.date} className={`hr-dot m-${x.entry.s}`} title={`${formatDateKey(x.date)}: ${KID_MARK_LABELS[x.entry.s]}`} />)}
      </div>
      <ul className="link-list">
        {history.slice(0, 8).map((x) => (
          <li key={x.date}><div><span className="link-title">{formatDateKey(x.date)} · {KID_MARK_LABELS[x.entry.s]}</span>
            {(x.entry.t || x.entry.r) && <span className="link-detail">{[x.entry.t && `Checked in ${x.entry.t}`, x.entry.r].filter(Boolean).join(' · ')}</span>}</div></li>
        ))}
      </ul>
      </div>
    </details>
  );
}

/**
 * How the school fees are paid (Andy, 2026-11-04, 8B): Paybill, Till, Send money or Cash, with the number and
 * account ready to copy into M-Pesa.
 */
function SchoolFees({ orgId, childId, saved, school, canEdit }: { orgId: string; childId: string; saved: ChildPayment | null; school: string; canEdit: boolean }) {
  const toast = useToast();
  const [p, setP] = useState<ChildPayment>(saved ?? NO_PAYMENT);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { setP(saved ?? NO_PAYMENT); }, [childId, JSON.stringify(saved)]);
  const set = (k: keyof ChildPayment, v: string) => setP((x) => ({ ...x, [k]: k === 'by' ? (v || null) : v }));
  function copy(text: string, what: string) {
    void navigator.clipboard?.writeText(text).then(() => toast.show(`${what} copied`), () => toast.show(text));
  }
  function save() {
    const clean: ChildPayment = {
      by: p.by, number: p.number.trim().slice(0, 40), account: p.by === 'paybill' ? p.account.trim().slice(0, 80) : '',
      payTo: p.payTo.trim().slice(0, 120), amount: p.amount.trim().slice(0, 80), note: p.note.trim().slice(0, 300),
    };
    updateChild(orgId, childId, { payment: hasPayment(clean) ? clean : null }).catch((err) => toast.show(friendlyError(err)));
    toast.show('Saved');
  }
  const s = saved;
  const numberLabel = p.by === 'send_money' ? 'Phone number' : p.by === 'till' ? 'Till number' : 'Paybill number';
  return (
    <details className="card hr-fold" open>
      <summary><h2>How fees are paid</h2><span className="small muted">{s && hasPayment(s) ? paymentLine(s) || 'Saved' : 'Not saved'}</span></summary>
      <div className="stack">
        {s && hasPayment(s) && s.by !== 'cash' && (s.number || s.account) && (
          <div className="fee-box">
            {s.number && <div><span className="small muted">{s.by === 'send_money' ? 'Send money to' : s.by === 'till' ? 'Till' : 'Paybill'}</span><b>{s.number}</b><button type="button" className="btn btn-quiet" onClick={() => copy(s.number.replace(/\s/g, ''), 'Number')}>📋 Copy</button></div>}
            {s.account && <div><span className="small muted">Account</span><b>{s.account}</b><button type="button" className="btn btn-quiet" onClick={() => copy(s.account, 'Account')}>📋 Copy</button></div>}
            {(s.payTo || s.amount) && <p className="small">{[s.payTo && `To ${s.payTo}`, s.amount].filter(Boolean).join(' · ')}</p>}
            {s.note && <p className="small muted">{s.note}</p>}
          </div>
        )}
        {s?.by === 'cash' && <p>💵 Paid in cash{s.payTo ? ` at ${s.payTo}` : ''}.{s.amount ? ` ${s.amount}.` : ''}{s.note ? ` ${s.note}` : ''}</p>}
        {canEdit && (
          <>
            <label className="field"><span>Pay by</span>
              <select value={p.by ?? ''} onChange={(e) => set('by', e.target.value as PayBy | '')}>
                <option value="">Choose…</option>
                {PAY_BY.map((v) => <option key={v} value={v}>{PAY_BY_LABELS[v]}</option>)}
              </select>
            </label>
            {p.by && p.by !== 'cash' && (
              <div className="field-row">
                <label className="field"><span>{numberLabel}</span><input inputMode="numeric" value={p.number} maxLength={40} onChange={(e) => set('number', e.target.value)} /></label>
                {p.by === 'paybill' && <label className="field"><span>Account</span><input value={p.account} maxLength={80} onChange={(e) => set('account', e.target.value)} placeholder="804212#Name" /></label>}
              </div>
            )}
            {p.by && (
              <div className="field-row">
                <label className="field"><span>{p.by === 'send_money' ? 'Name of the person' : 'Pay to'}</span><input value={p.payTo} maxLength={120} onChange={(e) => set('payTo', e.target.value)} placeholder={p.by === 'send_money' ? 'The teacher' : school} /></label>
                <label className="field"><span>Amount (optional)</span><input value={p.amount} maxLength={80} onChange={(e) => set('amount', e.target.value)} placeholder="KES 1,500" /></label>
              </div>
            )}
            {p.by && <label className="field"><span>Note (optional)</span><input value={p.note} maxLength={300} onChange={(e) => set('note', e.target.value)} /></label>}
            <button type="button" className="btn btn-primary align-start" onClick={save}>Save school fees</button>
          </>
        )}
        {!canEdit && !(s && hasPayment(s)) && <p className="muted">Not saved yet.</p>}
      </div>
    </details>
  );
}

function consentText(c: Consent): string {
  if (c.given == null) return 'Not on file yet';
  return `${c.given ? 'Yes, agreed' : 'No, declined'}${c.date ? ` (${formatDateKey(c.date)})` : ''}`;
}
