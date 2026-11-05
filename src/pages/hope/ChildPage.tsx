import { useEffect, useState } from 'react';
import { CleanupButton } from '../../components/CleanupDialog';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { useAuth } from '../../state/AuthContext';
import { useToast } from '../../state/ToastContext';
import { useChildPhoto, useClubs, useHopeDays } from '../../state/useHope';
import { memberRate, scheduleText } from '../../../functions/src/shared/hopeClubs';
import { ConfirmDialog } from '../../components/ConfirmDialog';
import { friendlyError } from '../../lib/errors';
import { removeChildPhoto, saveChildPhoto, updateChild } from '../../lib/hopeWrites';
import { daysToBirthday, KID_MARK_LABELS, kidHistory, rateFrom, streak, STREAK_SHOWN } from '../../../functions/src/shared/hopeRegister';
import { Avatar, PctBadge, shrinkPhoto } from './registerParts';
import { formatDateKey } from '../../../functions/src/shared/datetime';
import { formatPhone } from '../../../functions/src/shared/phone';
import {
  consentMissing, hasPayment, NO_PAYMENT, PAY_BY, PAY_BY_LABELS, paymentLine, SCHOOL_STATUSES, SCHOOL_STATUS_LABELS,
  type ChildPayment, type ChildProgramme, type Consent, type PayBy, type SchoolStatus,
} from '../../../functions/src/shared/hope';
import { ChildCare, FeesPaid, saveLeavingNote } from './ChildRecords';
import { canKeepFees } from '../../../functions/src/shared/hopeRecords';
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
  const [sponsorPhone, setSponsorPhone] = useState('');
  const [sponsorEmail, setSponsorEmail] = useState('');
  const [parentName, setParentName] = useState('');
  const [parentPhone, setParentPhone] = useState('');
  const [leaveNote, setLeaveNote] = useState('');
  const [confirmExit, setConfirmExit] = useState<null | 'departing' | 'exited'>(null);
  const photo = useChildPhoto(org.id, childId);
  const { days } = useHopeDays(org.id);
  const clubs = useClubs(org.id);

  useEffect(() => {
    if (!child) return;
    setDob(child.dateOfBirth ?? ''); setSchool(child.school ?? ''); setSchoolClass(child.schoolClass ?? ''); setSchoolStatus(child.schoolStatus); setEnrolledOn(child.enrolledOn ?? '');
    setProgrammes(child.programmes); setPhotoConsent(child.photoConsent); setGuardianConsent(child.guardianConsent);
    setSponsorName(child.sponsorName ?? ''); setSponsorPhone(child.sponsorPhone ?? ''); setSponsorEmail(child.sponsorEmail ?? '');
    setParentName(child.parentName ?? ''); setParentPhone(child.parentPhone ?? ''); setLeaveNote(child.departingNote ?? '');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [child?.id]);


  if (!child || (h.peopleLoading && !person)) {
    return <div className="page narrow"><p><Link to="/hope/children">← Children</Link></p><p>{h.loading ? 'Loading…' : 'This child was not found.'}</p></div>;
  }
  const name = h.nameOf(child.id);
  const age = h.ageOf(child);

  function save() {
    updateChild(org.id, child!.id, {
      dateOfBirth: dob || null, school: school.trim().slice(0, 120), schoolClass: schoolClass.trim().slice(0, 40), schoolStatus, enrolledOn: enrolledOn || null, programmes, photoConsent, guardianConsent,
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
    // The leaving note goes to Records too (Andy, 2026-11-05, 4A), dated and signed.
    saveLeavingNote(org.id, child!.id, `${to === 'exited' ? 'Marked as departed (left for good)' : 'Marked as departing'}${leaveNote.trim() ? `: ${leaveNote.trim().slice(0, 500)}` : '.'}`)
      .catch(() => { /* offline: the child's own record still has the note */ });
    toast.show(to === 'exited' ? `${name} moved to Past children.` : `${name} is marked as departing.`);
  }
  async function takePhoto(f: File | undefined) {
    if (!f) return;
    try { saveChildPhoto(org.id, child!.id, await shrinkPhoto(f)).catch((err) => toast.show(friendlyError(err))); toast.show('Photo saved'); }
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
              {photo && <button type="button" className="btn btn-quiet" title="Remove photo" onClick={() => { removeChildPhoto(org.id, child.id).catch((err) => toast.show(friendlyError(err))); }}>✕<span className="sr-only">Remove photo</span></button>}
            </div>
          )}
        </div>
        <div className="hc-profile-main">
          <div className="hc-profile-top">
            <h1>{name}</h1>
            <CleanupButton orgId={org.id} kind="person" id={child.id} back="/hope/children" hope />
          </div>
          <p className="muted">{h.codeOf(child)}{person?.gender ? ` · ${person.gender}` : ''}
            {consentMissing(child) && <span className="badge badge-warn">Consent missing</span>}
            {child.status === 'departing' && <span className="badge badge-warn">Departing</span>}
            {child.status === 'exited' && <span className="badge badge-muted">Departed{child.exitedOn ? ` ${formatDateKey(child.exitedOn)}` : ''}</span>}
          </p>
          <dl className="hc-facts">
            <div><dt>Age</dt><dd>{age != null ? `${age} years` : 'Not known'}</dd></div>
            <div><dt>Birthday</dt><dd>{born ?? 'Not known'}{toBirthday != null && toBirthday <= 7 ? (toBirthday === 0 ? ' 🎈 today!' : ` 🎈 in ${toBirthday} ${toBirthday === 1 ? 'day' : 'days'}`) : ''}</dd></div>
            <div><dt>School</dt><dd>{child.school || 'Not known'}{child.schoolClass ? ` · ${child.schoolClass}` : ''}</dd></div>
            <div><dt>Sponsor</dt><dd>{child.sponsorName || 'None yet'}{child.sponsorEmail && <> · <a href={`mailto:${child.sponsorEmail}`}>email</a></>}{child.sponsorPhone && <> · <a href={`tel:${child.sponsorPhone}`}>call</a></>}</dd></div>
            {child.sponsorship && <div><dt>Sponsorship</dt><dd>{child.sponsorship.status || 'On the list'} · {child.sponsorship.childId}</dd></div>}
            <div><dt>Parent</dt><dd>{guardian ? <Link to={`/people/${org.id}/${guardian.id}`}>{parentShown}</Link> : parentShown || 'Not saved'}</dd></div>
            <div><dt>Attendance</dt><dd><PctBadge pct={rate.pct} /> {fire >= STREAK_SHOWN && <span className="hr-delight hr-streak">🔥{fire} in a row</span>}</dd></div>
          </dl>
          {parentPhoneShown && (
            <div className="chips">
              <a className="btn btn-primary" href={`tel:${parentPhoneShown}`}>📞 Call {parentShown ? parentShown.split(' ')[0] : 'the parent'}</a>
              <span className="small muted align-center">{formatPhone(parentPhoneShown) || parentPhoneShown}</span>
            </div>
          )}
          {!parentPhoneShown && !guardian && <p className="notice notice-warn small">No parent contact saved. Add it under Details so the child can be followed up.</p>}
        </div>
      </section>

      <div className="segmented hc-tabs" role="tablist" aria-label="About this child">
        {TABS.filter(([k]) => k !== 'fees' || showFees).map(([k, label]) => (
          <button key={k} type="button" role="tab" aria-selected={tab === k} className={tab === k ? 'on' : ''} onClick={() => setTab(k)}>{label}</button>
        ))}
      </div>

      {tab === 'about' && (
        <section className="card">
        <div className="stack">
        <div className="field-row">
          <label className="field"><span>Date of birth</span><input type="date" disabled={!canEdit} value={dob} max={h.today} onChange={(e) => setDob(e.target.value)} /></label>
          <label className="field"><span>Joined on</span><input type="date" disabled={!canEdit} value={enrolledOn} max={h.today} onChange={(e) => setEnrolledOn(e.target.value)} /></label>
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
        <div className="field-row">
          <label className="field"><span>Sponsor's phone (optional)</span><input disabled={!canEdit} inputMode="tel" value={sponsorPhone} maxLength={30} onChange={(e) => setSponsorPhone(e.target.value)} /></label>
          <label className="field"><span>Sponsor's email (optional)</span><input disabled={!canEdit} type="email" value={sponsorEmail} maxLength={120} onChange={(e) => setSponsorEmail(e.target.value)} /></label>
        </div>
        {child.sponsorship && (
          <dl className="hc-facts hc-sponsorship" aria-label="From the sponsorship list">
            <div><dt>Child ID</dt><dd>{child.sponsorship.childId}</dd></div>
            <div><dt>Status</dt><dd>{child.sponsorship.status || 'Not given'}</dd></div>
            {child.sponsorship.sponsorId && <div><dt>Sponsor ID</dt><dd>{child.sponsorship.sponsorId}</dd></div>}
            {child.sponsorship.registeredOn && <div><dt>Registered</dt><dd>{formatDateKey(child.sponsorship.registeredOn)}</dd></div>}
            {child.sponsorship.completesOn && <div><dt>Completes</dt><dd>{formatDateKey(child.sponsorship.completesOn)}</dd></div>}
            {child.sponsorship.updatedOn && <div><dt>List of</dt><dd>{formatDateKey(child.sponsorship.updatedOn)}</dd></div>}
          </dl>
        )}
        <ConsentField label="Guardian consent to keep this child's details" value={guardianConsent} onChange={setGuardianConsent} today={h.today} disabled={!canEdit} />
        <ConsentField label="Consent to take and keep photos" value={photoConsent} onChange={setPhotoConsent} today={h.today} disabled={!canEdit} />
        {canEdit && <button type="button" className="btn btn-primary align-start" onClick={save}>Save changes</button>}
        </div>
        </section>
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
          {canEdit && (
            <section className="card stack">
              <h2>Leaving the Hope Centre</h2>
          {child.status !== 'exited' && <label className="field"><span>Reason or note (optional)</span><input value={leaveNote} maxLength={500} onChange={(e) => setLeaveNote(e.target.value)} placeholder="Moving away, finished the programme…" /></label>}
          {child.departingNote && child.status !== 'active' && <p className="small muted">Note: {child.departingNote}</p>}
          <div className="chips">
            {child.status === 'active' && <button type="button" className="btn" onClick={() => setConfirmExit('departing')}>Mark as departing</button>}
            {child.status !== 'exited' && <button type="button" className="btn btn-quiet danger-text" onClick={() => setConfirmExit('exited')}>Mark as departed</button>}
            {child.status !== 'active' && <button type="button" className="btn btn-quiet" onClick={() => { updateChild(org.id, child.id, { status: 'active', exitedOn: null, departingNote: null }).catch((err) => toast.show(friendlyError(err))); saveLeavingNote(org.id, child.id, 'Returned to active.').catch(() => {}); }}>Return to active</button>}
          </div>
          <p className="small muted">Departing: in the process of leaving for good. Departed: has left for good and moves to Past children. Each change is kept as a dated note in Reports → Records.</p>
            </section>
          )}
        </>
      )}
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
