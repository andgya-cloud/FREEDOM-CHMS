import { Fragment, useEffect, useRef, useState, type ChangeEvent } from 'react';
import { AdiaDate } from '../../components/AdiaDate';
import { Link } from 'react-router-dom';
import { useAuth } from '../../state/AuthContext';
import { useToast } from '../../state/ToastContext';
import { friendlyError } from '../../lib/errors';
import { useExamCohorts, useExamSettings } from '../../state/useExams';
import { useAttachments, type AttachmentRow } from '../../state/useAttachments';
import { downloadAttachmentFile, printAttachmentFile, saveAttachment, uploadAttachmentFile } from '../../lib/attachmentWrites';
import { attachmentPdf, attachmentWorkbook, type AttachmentLine } from '../../lib/attachmentReport';
import { downloadFile } from '../../lib/givingPdf';
import { orderCohorts, cohortLabel } from '../../../functions/src/shared/examCohorts';
import { formatDateKey } from '../../../functions/src/shared/datetime';
import { isAttachmentKeeper } from '../../../functions/src/shared/permissions';
import {
  ATTACHMENT_FILE_LABELS, ATTACHMENT_STATUSES, ATTACHMENT_STATUS_LABELS, attachmentCounts, attachmentLine, cleanPhone, markProblem, statusHint,
  type Attachment, type AttachmentFileKind, type AttachmentStatus,
} from '../../../functions/src/shared/attachment';
import { SchoolGate, SchoolTitle, useSchoolPage } from './common';
import type { Organization } from '../../state/OrgContext';

export function AttachmentPage() {
  return <SchoolGate title="Attachment">{(org) => <AttachmentBoard org={org} />}</SchoolGate>;
}

const STATUS_TONE: Record<AttachmentStatus, string> = { not_placed: 'badge-warn', placed: 'badge-member', ongoing: 'badge-visitor', completed: 'badge-regular' };

/**
 * Industrial attachment (Andy, 2026-11-19, 1A-10A + Doreen): every student of the chosen cohort, with the
 * log book, where they stand and the assessment as dropdowns. A name opens the company, supervisor, dates,
 * the log book and assessment form copies and the mark, which goes on the transcript.
 */
function AttachmentBoard({ org }: { org: Organization }) {
  const s = useSchoolPage(org);
  const { profile } = useAuth();
  const toast = useToast();
  const keeper = isAttachmentKeeper(profile);
  const { settings } = useExamSettings(org.id);
  const { byName: classes } = useExamCohorts(org.id);
  const order = orderCohorts([...new Set(s.intakes.map((i) => i.name))], s.intakes, classes);
  const choices = [...order.current, ...order.past];
  const [picked, setPicked] = useState('');
  const cohort = choices.some((c) => c.name === picked) ? picked : choices[0]?.name ?? '';
  const [dept, setDept] = useState('');
  const [open, setOpen] = useState('');
  const [busy, setBusy] = useState<'' | 'xlsx' | 'pdf'>('');
  const { byStudent, filesOf } = useAttachments(org.id);

  const inCohort = s.students.filter((st) => !st.deletedAt && st.status !== 'withdrawn' && st.status !== 'applicant' && s.intakeName(st.intakeId) === cohort);
  const depts = [...new Set(inCohort.map((st) => st.courseId))].map((id) => ({ id, name: s.courseName(id) || 'No department' })).sort((a, b) => a.name.localeCompare(b.name));
  const dep = depts.some((d) => d.id === dept) ? dept : '';
  const people = inCohort.filter((st) => !dep || st.courseId === dep)
    .map((st) => ({ st, name: s.nameOf(st.id), a: byStudent[st.id] as AttachmentRow | undefined }))
    .sort((a, b) => (a.st.admissionNo ?? '').localeCompare(b.st.admissionNo ?? '') || a.name.localeCompare(b.name));
  const counts = attachmentCounts(people.map((p) => p.st.id), byStudent);
  useEffect(() => setOpen(''), [cohort, dep]);

  function save(studentId: string, changes: Partial<Attachment>) {
    saveAttachment(org.id, studentId, cohort, !!byStudent[studentId], changes).catch((err) => toast.show(friendlyError(err)));
  }

  const lines = (): AttachmentLine[] => people.map(({ st, name, a }) => ({
    admissionNo: st.admissionNo ?? '', name, department: s.courseName(st.courseId),
    logBook: a?.logBook ? `Issued${a.logBookOn ? ` ${formatDateKey(a.logBookOn)}` : ''}` : 'Not issued',
    status: ATTACHMENT_STATUS_LABELS[a?.status ?? 'not_placed'],
    assessment: a?.assessed ? `Assessed${a.mark != null ? ` · ${attachmentLine(a, settings)}` : ''}` : 'Not assessed',
    company: a?.company ?? '', location: a?.location ?? '', supervisor: a?.supervisor ?? '', phone: a?.supervisorPhone ?? '',
    from: a?.from ? formatDateKey(a.from) : '', to: a?.to ? formatDateKey(a.to) : '',
  }));
  async function download(kind: 'xlsx' | 'pdf') {
    setBusy(kind);
    try {
      const info = { cohort, department: dep ? s.courseName(dep) : '', today: formatDateKey(s.today),
        counts: `${people.length} students · Placed ${counts.placed} · Not placed ${counts.notPlaced} · Ongoing ${counts.ongoing} · Completed ${counts.completed} · Log books ${counts.logBooks} · Assessed ${counts.assessed}` };
      downloadFile(kind === 'xlsx' ? await attachmentWorkbook(info, lines()) : await attachmentPdf(info, lines()));
    } catch (err) { toast.show(friendlyError(err)); } finally { setBusy(''); }
  }

  const tiles: [string, number, boolean][] = [
    ['Placed', counts.placed, false], ['Not placed', counts.notPlaced, counts.notPlaced > 0], ['Ongoing', counts.ongoing, false],
    ['Completed', counts.completed, false], ['Log books issued', counts.logBooks, false], ['Assessed', counts.assessed, false],
  ];

  return (
    <div className="page">
      <SchoolTitle feesAllowed={s.feesAllowed} />
      <div className="field-row att-filters">
        <label className="field"><span>Cohort</span>
          <select value={cohort} onChange={(e) => setPicked(e.target.value)}>
            {order.current.length > 0 && <optgroup label="Current">{order.current.map((c) => <option key={c.name} value={c.name}>{cohortLabel(c)}</option>)}</optgroup>}
            {order.past.length > 0 && <optgroup label="Graduated">{order.past.map((c) => <option key={c.name} value={c.name}>{cohortLabel(c)}</option>)}</optgroup>}
          </select>
        </label>
        <label className="field"><span>Department</span>
          <select value={dep} onChange={(e) => setDept(e.target.value)}>
            <option value="">All departments</option>
            {depts.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
          </select>
        </label>
      </div>

      <ul className="tiles att-tiles">
        {tiles.map(([label, n, alert]) => <li key={label} className={`tile${alert ? ' att-alert' : ''}`}><span className="tile-label">{label}</span><span className="tile-value">{n}</span></li>)}
      </ul>

      <section className="card stack">
        <div className="card-head"><h2>Industrial attachment · {cohort || 'no cohort yet'}</h2></div>
        <p className="muted small">Click a name for the company, supervisor, dates, log book and assessment.{keeper ? ' Changes save as you go.' : ''}</p>
        {people.length === 0 ? <p className="muted">No students in {cohort || 'this cohort'}{dep ? ` in ${s.courseName(dep)}` : ''}.</p> : (
          <div className="table-scroll">
            <table className="table att-table">
              <thead><tr><th>Admission no.</th><th>Name</th><th>Department</th><th>Log book</th><th>Student status</th><th>Assessment &amp; evaluation</th></tr></thead>
              <tbody>
                {people.map(({ st, name, a }) => {
                  const status = a?.status ?? 'not_placed';
                  const hint = statusHint(a, s.today);
                  const isOpen = open === st.id;
                  return (
                    <Fragment key={st.id}>
                      <tr className={isOpen ? 'att-open' : undefined}>
                        <td className="att-adm">{st.admissionNo || <span className="muted">–</span>}</td>
                        <td>
                          <button type="button" className="att-name" aria-expanded={isOpen} onClick={() => setOpen(isOpen ? '' : st.id)}>{name}</button>
                          {a?.company && <div className="muted small">{a.company}</div>}
                        </td>
                        <td>{s.courseName(st.courseId) || <span className="muted">–</span>}</td>
                        <td>
                          <select aria-label={`Log book for ${name}`} className={`badge-select ${a?.logBook ? 'badge-regular' : 'badge-inactive'}`} disabled={!keeper} value={a?.logBook ? 'yes' : 'no'}
                            onChange={(e) => save(st.id, e.target.value === 'yes' ? { logBook: true, logBookOn: s.today } : { logBook: false, logBookOn: null })}>
                            <option value="no">Not issued</option><option value="yes">Issued</option>
                          </select>
                          {a?.logBook && a.logBookOn && <div className="muted small">{formatDateKey(a.logBookOn)}</div>}
                        </td>
                        <td>
                          <select aria-label={`Status of ${name}`} className={`badge-select ${STATUS_TONE[status]}`} disabled={!keeper} value={status} onChange={(e) => save(st.id, { status: e.target.value as AttachmentStatus })}>
                            {ATTACHMENT_STATUSES.map((k) => <option key={k} value={k}>{ATTACHMENT_STATUS_LABELS[k]}</option>)}
                          </select>
                          {hint && <div className="att-hint small">Due to be {ATTACHMENT_STATUS_LABELS[hint]}{keeper && <> · <button type="button" className="link-button" onClick={() => { save(st.id, { status: hint }); toast.show(`${name} is now ${ATTACHMENT_STATUS_LABELS[hint]}`); }}>set it</button></>}</div>}
                        </td>
                        <td>
                          <select aria-label={`Assessment of ${name}`} className={`badge-select ${a?.assessed ? 'badge-regular' : 'badge-inactive'}`} disabled={!keeper} value={a?.assessed ? 'yes' : 'no'}
                            onChange={(e) => {
                              const yes = e.target.value === 'yes';
                              save(st.id, { assessed: yes });
                              if (yes) { setOpen(st.id); toast.show('Type the mark and upload the assessment form'); }
                            }}>
                            <option value="no">Not assessed</option><option value="yes">Assessed</option>
                          </select>
                          {a?.assessed && a.mark != null && <div className="muted small">{a.mark}/100 · {attachmentLine(a, settings).split(' · ')[1]}</div>}
                        </td>
                      </tr>
                      {isOpen && (
                        <tr className="att-detail"><td colSpan={6}>
                          <Details org={org} studentId={st.id} a={a} keeper={keeper} files={filesOf[st.id]} save={(c) => save(st.id, c)} />
                        </td></tr>
                      )}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        {people.length > 0 && (
          <div className="row-actions att-downloads">
            <button type="button" className="btn btn-quiet" disabled={!!busy} onClick={() => void download('xlsx')}>{busy === 'xlsx' ? 'Preparing…' : 'Download Excel'}</button>
            <button type="button" className="btn btn-quiet" disabled={!!busy} onClick={() => void download('pdf')}>{busy === 'pdf' ? 'Preparing…' : 'Download PDF'}</button>
          </div>
        )}
      </section>
      <p className="muted small">The assessment mark shows on the student's transcript as "Industrial attachment". Students whose attachment is not completed and assessed get a reminder in the <Link to="/school/graduation">Graduation</Link> list.</p>
    </div>
  );
}

/** 5A-7A: the placement details, the log book copy, the mark and the assessment form. */
function Details({ org, studentId, a, keeper, files, save }: {
  org: Organization; studentId: string; a: AttachmentRow | undefined; keeper: boolean; files: { logbook?: unknown; form?: unknown } | undefined; save: (c: Partial<Attachment>) => void;
}) {
  return (
    <div className="att-grid">
      <Text label="Company" value={a?.company ?? ''} max={120} placeholder="Company name" disabled={!keeper} onSave={(v) => save({ company: v })} />
      <Text label="Location" value={a?.location ?? ''} max={120} placeholder="Town or area" disabled={!keeper} onSave={(v) => save({ location: v })} />
      <Text label="Supervisor" value={a?.supervisor ?? ''} max={120} placeholder="Name" disabled={!keeper} onSave={(v) => save({ supervisor: v })} />
      <Text label="Supervisor's phone" value={a?.supervisorPhone ?? ''} max={20} placeholder="07…" inputMode="tel" disabled={!keeper} onSave={(v) => save({ supervisorPhone: cleanPhone(v) })} />
      <label className="field"><span>Start date</span><AdiaDate type="date" value={a?.from ?? ''} disabled={!keeper} onChange={(e) => save({ from: e.target.value || null })} /></label>
      <label className="field"><span>End date</span><AdiaDate type="date" value={a?.to ?? ''} min={a?.from ?? undefined} disabled={!keeper} onChange={(e) => save({ to: e.target.value || null })} /></label>
      <FileBox org={org} studentId={studentId} kind="logbook" has={!!files?.logbook} keeper={keeper} />
      <Text label="Assessment mark (out of 100)" value={a?.mark == null ? '' : String(a.mark)} max={5} placeholder={a?.assessed ? 'e.g. 72' : 'Choose Assessed first'} inputMode="decimal"
        disabled={!keeper || !a?.assessed} check={markProblem} onSave={(v) => save({ mark: v.trim() ? Number(v) : null })} />
      <FileBox org={org} studentId={studentId} kind="form" has={!!files?.form} keeper={keeper} />
    </div>
  );
}

/** A text box that saves when you leave it (or press Enter). */
function Text({ label, value, onSave, max, placeholder, disabled, check, inputMode }: {
  label: string; value: string; onSave: (v: string) => void; max: number; placeholder?: string; disabled?: boolean; check?: (v: string) => string | null; inputMode?: 'tel' | 'decimal';
}) {
  const [v, setV] = useState(value);
  useEffect(() => setV(value), [value]);
  const bad = check?.(v) ?? null;
  const commit = () => { const t = v.trim(); if (t !== value && !bad) onSave(t); };
  return (
    <label className="field"><span>{label}</span>
      <input value={v} maxLength={max} placeholder={placeholder} disabled={disabled} inputMode={inputMode} onChange={(e) => setV(e.target.value)} onBlur={commit}
        onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }} />
      {bad && <span className="up-bad small">{bad}</span>}
    </label>
  );
}

/** The log book or assessment form copy: Upload (a PDF or a photo), Print, Download, Replace. */
function FileBox({ org, studentId, kind, has, keeper }: { org: Organization; studentId: string; kind: AttachmentFileKind; has: boolean; keeper: boolean }) {
  const toast = useToast();
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState('');
  async function run(what: string, job: () => Promise<unknown>, done?: string) {
    setBusy(what);
    try { await job(); if (done) toast.show(done); } catch (err) { toast.show(friendlyError(err)); } finally { setBusy(''); }
  }
  function chosen(e: ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    e.target.value = '';
    if (f) void run('upload', () => uploadAttachmentFile(org.id, studentId, kind, f), `${ATTACHMENT_FILE_LABELS[kind]} saved`);
  }
  return (
    <div className="field att-file">
      <span>{ATTACHMENT_FILE_LABELS[kind]} copy</span>
      <div className="row-actions">
        {has ? <span className="small">📄 Kept</span> : <span className="muted small">None yet</span>}
        {has && <button type="button" className="btn btn-quiet btn-small" disabled={!!busy} onClick={() => void run('print', () => printAttachmentFile(org.id, studentId, kind))}>{busy === 'print' ? 'Opening…' : 'Print'}</button>}
        {has && <button type="button" className="btn btn-quiet btn-small" disabled={!!busy} onClick={() => void run('download', () => downloadAttachmentFile(org.id, studentId, kind))}>{busy === 'download' ? 'Downloading…' : 'Download'}</button>}
        {keeper && <button type="button" className={`btn btn-small${has ? ' btn-quiet' : ''}`} disabled={!!busy} onClick={() => input.current?.click()}>{busy === 'upload' ? 'Uploading…' : has ? 'Replace' : 'Upload PDF or photo'}</button>}
      </div>
      <input ref={input} type="file" accept="application/pdf,.pdf,image/jpeg,image/png,image/webp" hidden onChange={chosen} />
    </div>
  );
}
