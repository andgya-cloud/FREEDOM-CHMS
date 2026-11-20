import { useEffect, useMemo, useRef, useState, type ChangeEvent } from 'react';
import { useToast } from '../../state/ToastContext';
import { friendlyError } from '../../lib/errors';
import { useAuth } from '../../state/AuthContext';
import { useExamCohorts, useExamRegisters } from '../../state/useExams';
import { useNita, useNitaKeeper, type NitaResultRow } from '../../state/useNita';
import { useAttachments } from '../../state/useAttachments';
import { addNitaRelease, saveNitaRelease, saveNitaResult } from '../../lib/nitaWrites';
import { downloadAttachmentFile, printAttachmentFile, uploadAttachmentFile } from '../../lib/attachmentWrites';
import { nitaPdf, nitaWorkbook, type NitaLine } from '../../lib/nitaReport';
import { readSpreadsheetSheets } from '../../lib/statementFile';
import { downloadFile } from '../../lib/givingPdf';
import { printFile } from '../../lib/printFile';
import { orderCohorts, cohortLabel } from '../../../functions/src/shared/examCohorts';
import { formatDateKey } from '../../../functions/src/shared/datetime';
import { NITA_GRADES, cleanIndexNo } from '../../../functions/src/shared/examRegister';
import {
  NITA_PAPER_LABELS, NITA_PAPER_RESULTS, applyUploadRow, blankNitaResult, cleanCertificateNo, matchNitaRows, nitaCounts, orderReleases, overallFrom,
  parseNitaSheet, passRate, releaseLabel, resultFields, sittingText, tradeRates, type NitaMatch, type NitaPaperResult, type NitaResultRecord,
} from '../../../functions/src/shared/nita';
import { SchoolGate, SchoolTitle, useSchoolPage } from './common';
import type { Organization } from '../../state/OrgContext';

/** School › NITA results: the same board as in Exam Records, for the keepers who don't use Exam Records. */
export function NitaPage() {
  return <SchoolGate title="NITA results">{(org) => <NitaScreen org={org} />}</SchoolGate>;
}

function NitaScreen({ org }: { org: Organization }) {
  const s = useSchoolPage(org);
  const { can } = useAuth();
  const keeper = useNitaKeeper();
  const { byName: classes } = useExamCohorts(org.id);
  const order = orderCohorts([...new Set(s.intakes.map((i) => i.name))], s.intakes, classes);
  const choices = [...order.current, ...order.past];
  const [picked, setPicked] = useState('');
  const cohort = choices.some((c) => c.name === picked) ? picked : choices[0]?.name ?? '';
  return (
    <div className="page nita-page">
      {can('people.read') ? <SchoolTitle feesAllowed={s.feesAllowed} /> : <div className="page-head"><h1>NITA results</h1></div>}
      {!keeper ? <p className="muted">NITA results are kept by the principal, Admin and Mr Andrew.</p> : (
        <>
          <label className="field tt-cohort"><span>Cohort</span>
            <select value={cohort} onChange={(e) => setPicked(e.target.value)}>
              {order.current.length > 0 && <optgroup label="Current">{order.current.map((c) => <option key={c.name} value={c.name}>{cohortLabel(c)}</option>)}</optgroup>}
              {order.past.length > 0 && <optgroup label="Past cohorts">{order.past.map((c) => <option key={c.name} value={c.name}>{cohortLabel(c)}</option>)}</optgroup>}
            </select>
          </label>
          {cohort && <NitaBoard org={org} cohort={cohort} />}
        </>
      )}
    </div>
  );
}

const TONE: Record<NitaPaperResult, string> = { pass: 'badge-regular', fail: 'badge-warn', absent: 'badge-muted', pending: 'badge-visitor' };
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

interface Student { id: string; name: string; admissionNo: string; department: string }

/**
 * NITA results (Andy, 2026-11-20, 1A-8A 9B 10A-13A): one cohort's results as NITA released them on a day.
 * The students marked NITA in the Exam register are listed; each keeps one result, with Theory, Practical,
 * the overall result, the certificate number and the certificate copy, handed over or not.
 */
export function NitaBoard({ org, cohort }: { org: Organization; cohort: string }) {
  const s = useSchoolPage(org);
  const toast = useToast();
  const keeper = useNitaKeeper();
  const { releases: allReleases, byStudent } = useNita(org.id);
  const { registers } = useExamRegisters(org.id, cohort);
  const { filesOf } = useAttachments(org.id);
  const releases = useMemo(() => orderReleases(allReleases.filter((r) => r.cohort === cohort)), [allReleases, cohort]);
  const [pick, setPick] = useState('');
  useEffect(() => setPick(''), [cohort]);
  const rel = releases.find((r) => r.id === pick) ?? releases[0];
  const fail = (err: unknown) => toast.show(friendlyError(err));

  const students: Student[] = useMemo(() => s.students
    .filter((st) => !st.deletedAt && (st.status === 'enrolled' || st.status === 'graduated') && s.intakeName(st.intakeId) === cohort)
    .map((st) => ({ id: st.id, name: s.nameOf(st.id), admissionNo: st.admissionNo ?? '', department: s.courseName(st.courseId) }))
    .sort((a, b) => a.name.localeCompare(b.name)), [s.students, s.intakes, s.courses, s.peopleLoading, cohort]); // eslint-disable-line react-hooks/exhaustive-deps

  // What the Exam register knows: the latest sitting where each student sits NITA.
  const fromRegister = useMemo(() => {
    const out: Record<string, { trade: string; grade: string; indexNo: string }> = {};
    for (const r of [...registers].sort((a, b) => a.sitting.localeCompare(b.sitting))) {
      for (const [id, e] of Object.entries(r.entries)) if (e?.sits === 'nita') out[id] = { trade: e.trade ?? '', grade: e.grade ?? NITA_GRADES[0], indexNo: e.indexNo ?? '' };
    }
    return out;
  }, [registers]);

  const [added, setAdded] = useState<string[]>([]);
  useEffect(() => setAdded([]), [rel?.id]);
  const elsewhere = rel ? students.filter((st) => byStudent[st.id] && byStudent[st.id]!.releaseId !== rel.id) : [];
  const shown = rel ? students.filter((st) => (byStudent[st.id] ? byStudent[st.id]!.releaseId === rel.id : !!fromRegister[st.id] || added.includes(st.id))) : [];
  const addable = students.filter((st) => !byStudent[st.id] && !fromRegister[st.id] && !added.includes(st.id));
  const recordOf = (st: Student): NitaResultRecord => byStudent[st.id] ?? blankNitaResult(org.id, st.id, cohort, rel?.id ?? '', fromRegister[st.id]);

  function save(st: Student, changes: Partial<NitaResultRecord>) {
    if (!rel) return;
    saveNitaResult(org.id, byStudent[st.id], { studentId: st.id, cohort, releaseId: rel.id, ...fromRegister[st.id] }, changes).catch(fail);
  }
  function setPaper(st: Student, k: 'theory' | 'practical', v: NitaPaperResult) {
    const r = recordOf(st);
    const next = { ...r, [k]: v };
    save(st, { [k]: v, ...(r.overallSet ? {} : { overall: overallFrom(next.theory, next.practical) }) });
  }

  const rows = shown.map((st) => ({ st, r: recordOf(st) }));
  const counts = nitaCounts(rows.map((x) => x.r.overall));
  const rates = tradeRates(rows.map((x) => ({ trade: x.r.trade || x.st.department, overall: x.r.overall })));
  const cohortNames = [...new Set([...allReleases.map((r) => r.cohort), ...Object.values(byStudent).map((r) => r.cohort)])]
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  const compare = cohortNames.map((c) => ({ cohort: c, ...nitaCounts(Object.values(byStudent).filter((r) => r.cohort === c).map((r) => r.overall)) }));

  const lines = (): NitaLine[] => rows.map(({ st, r }) => ({
    admissionNo: st.admissionNo, name: st.name, trade: r.trade || st.department, grade: r.grade, indexNo: r.indexNo,
    theory: NITA_PAPER_LABELS[r.theory], practical: NITA_PAPER_LABELS[r.practical], overall: NITA_PAPER_LABELS[r.overall], certificateNo: r.certificateNo,
    issued: r.overall !== 'pass' ? '' : r.issued ? `Issued${r.issuedOn ? ` ${formatDateKey(r.issuedOn)}` : ''}` : 'Not issued',
  }));
  const [busy, setBusy] = useState('');
  async function download(kind: 'print' | 'xlsx' | 'pdf') {
    if (!rel) return;
    setBusy(kind);
    const info = { cohort, release: releaseLabel(rel), counts: `Sat ${counts.sat} · Passed ${counts.passed} · Failed ${counts.failed} · Absent ${counts.absent} · Pending ${counts.pending}`, today: formatDateKey(s.today) };
    try {
      const f = kind === 'xlsx' ? await nitaWorkbook(info, lines()) : await nitaPdf(info, lines());
      if (kind === 'print') printFile(f); else downloadFile(f);
    } catch (err) { fail(err); } finally { setBusy(''); }
  }

  return (
    <section className="stack nita-board">
      <div className="field-row tt-pickers">
        {releases.length > 0 && (
          <label className="field"><span>Results released</span>
            <select value={rel?.id ?? ''} onChange={(e) => setPick(e.target.value)}>{releases.map((r) => <option key={r.id} value={r.id}>{releaseLabel(r)}</option>)}</select>
          </label>
        )}
        {rel && keeper && <UploadButton students={students} indexOf={{ ...Object.fromEntries(Object.entries(fromRegister).map(([k, v]) => [k, v.indexNo])), ...Object.fromEntries(Object.values(byStudent).map((r) => [r.studentId, r.indexNo])) }}
          onSave={async (matches) => {
            for (const m of matches) {
              const st = students.find((x) => x.id === m.studentId)!;
              const next = applyUploadRow({ ...recordOf(st), releaseId: rel.id, cohort }, m.row);
              await saveNitaResult(org.id, byStudent[st.id], { studentId: st.id, cohort, releaseId: rel.id, ...fromRegister[st.id] }, resultFields(next));
            }
          }} />}
      </div>
      {!rel ? (
        <div className="card stack">
          <h2>NITA results · {cohort}</h2>
          <p className="muted">No NITA results for {cohort} yet. Add the day NITA released them (or the sitting you are waiting for); the students marked NITA in the Exam register then show here.</p>
          {keeper && <NewRelease org={org} cohort={cohort} onAdded={setPick} />}
        </div>
      ) : (
        <>
          <p className="muted small">Students marked "NITA" in {cohort}'s Exam register are listed. Each student keeps one NITA result. A saved result also shows in the Exam register and on the transcript.</p>
          <div className="nita-stats">
            <div className="nita-stat"><b>{counts.sat}</b><span>Sat</span></div>
            <div className="nita-stat ok"><b>{counts.passed}</b><span>Passed</span></div>
            <div className={`nita-stat${counts.failed ? ' bad' : ''}`}><b>{counts.failed}</b><span>Failed</span></div>
            <div className="nita-stat"><b>{counts.absent}</b><span>Absent</span></div>
            <div className="nita-stat"><b>{counts.pending}</b><span>Pending</span></div>
          </div>
          <div className="card">
            <div className="card-head"><h2>NITA results · {cohort} · {rel.sitting} sitting · {rel.releasedOn ? `released ${formatDateKey(rel.releasedOn)}` : 'not released yet'}</h2></div>
            {rows.length === 0 ? <p className="muted">Nobody is listed yet. Mark students "NITA" in the Exam register, upload NITA's list, or add a student below.</p> : (
              <div className="table-scroll">
                <table className="table nita-table">
                  <thead><tr><th>Admission no</th><th>Name</th><th>Trade</th><th>Grade</th><th>Index no</th><th>Theory</th><th>Practical</th><th>Overall</th><th>Certificate no</th><th>NITA certificate</th></tr></thead>
                  <tbody>
                    {rows.map(({ st, r }) => (
                      <tr key={st.id}>
                        <td className="nowrap">{st.admissionNo || '–'}</td>
                        <td className="nowrap">{st.name}</td>
                        <td><Cell value={r.trade} placeholder={st.department || 'Trade'} label="Trade" disabled={!keeper} onSave={(v) => save(st, { trade: v.replace(/\s+/g, ' ').trim().slice(0, 80) })} /></td>
                        <td><select aria-label="Grade" value={r.grade} disabled={!keeper} onChange={(e) => save(st, { grade: e.target.value })}>{NITA_GRADES.map((g) => <option key={g}>{g}</option>)}</select></td>
                        <td><Cell value={r.indexNo} placeholder="Index no" label="Index number" disabled={!keeper} onSave={(v) => save(st, { indexNo: cleanIndexNo(v) })} /></td>
                        <td><Paper value={r.theory} label="Theory" disabled={!keeper} onChange={(v) => setPaper(st, 'theory', v)} /></td>
                        <td><Paper value={r.practical} label="Practical" disabled={!keeper} onChange={(v) => setPaper(st, 'practical', v)} /></td>
                        <td>
                          <select aria-label="Overall" className={`nita-overall ${TONE[r.overall]}`} value={r.overall} disabled={!keeper}
                            onChange={(e) => { const v = e.target.value as NitaPaperResult; save(st, { overall: v, overallSet: v !== overallFrom(r.theory, r.practical) }); }}>
                            {NITA_PAPER_RESULTS.map((k) => <option key={k} value={k}>{NITA_PAPER_LABELS[k]}</option>)}
                          </select>
                        </td>
                        <td><Cell value={r.certificateNo} placeholder="–" label="Certificate number" disabled={!keeper} onSave={(v) => save(st, { certificateNo: cleanCertificateNo(v) })} /></td>
                        <td>{r.overall !== 'pass' ? <span className="muted">–</span>
                          : <Certificate org={org} studentId={st.id} has={!!filesOf[st.id]?.nita} keeper={keeper} issued={r.issued} issuedOn={r.issuedOn}
                              onIssued={(on) => save(st, { issued: on, issuedOn: on ? s.today : null })} />}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            <p className="muted small">Overall fills itself in: Pass when both papers pass, Fail when either fails, Absent when the student missed a paper. You can still change it.</p>
            {keeper && addable.length > 0 && (
              <label className="field nita-add"><span>Add a student</span>
                <select value="" onChange={(e) => e.target.value && setAdded((a) => [...a, e.target.value])}>
                  <option value="">Choose a student of {cohort}…</option>
                  {addable.map((st) => <option key={st.id} value={st.id}>{st.name}{st.admissionNo ? ` · ${st.admissionNo}` : ''}</option>)}
                </select>
              </label>
            )}
            {elsewhere.length > 0 && <p className="muted small">{elsewhere.length} {elsewhere.length === 1 ? 'student has a' : 'students have their'} result under another release date.</p>}
            {rows.length > 0 && (
              <div className="row-actions tt-downloads no-print">
                <button type="button" className="btn btn-quiet" disabled={!!busy} onClick={() => void download('print')}>{busy === 'print' ? 'Opening…' : 'Print'}</button>
                <button type="button" className="btn btn-quiet" disabled={!!busy} onClick={() => void download('xlsx')}>{busy === 'xlsx' ? 'Preparing…' : 'Download Excel'}</button>
                <button type="button" className="btn btn-quiet" disabled={!!busy} onClick={() => void download('pdf')}>{busy === 'pdf' ? 'Preparing…' : 'Download PDF'}</button>
              </div>
            )}
          </div>
          <div className="nita-two">
            <div className="card">
              <h2>Pass rate by trade</h2>
              {rates.length === 0 ? <p className="muted small">Shown once results are in.</p> : rates.map((t) => (
                <div key={t.trade} className="nita-bar"><span>{t.trade}</span><i><b style={{ width: `${t.rate}%` }} /></i><span>{t.rate}%</span></div>
              ))}
            </div>
            <div className="card">
              <h2>Cohorts compared</h2>
              <table className="table">
                <thead><tr><th>Cohort</th><th>Sat</th><th>Passed</th><th>Pass rate</th></tr></thead>
                <tbody>{compare.map((c) => { const p = passRate(c); return (
                  <tr key={c.cohort} className={c.cohort === cohort ? 'strong' : ''}><td>{c.cohort}</td><td>{c.sat || '–'}</td><td>{c.passed + c.failed ? c.passed : '–'}</td><td>{p == null ? 'Waiting' : `${p}%`}</td></tr>
                ); })}</tbody>
              </table>
            </div>
          </div>
          {keeper && (
            <div className="card stack">
              <details><summary>Add results released on a new date</summary><NewRelease org={org} cohort={cohort} onAdded={setPick} /></details>
              <details key={rel.id}><summary>Change this release's date or sitting</summary><EditRelease org={org} id={rel.id} releasedOn={rel.releasedOn} sitting={rel.sitting} /></details>
              <details><summary>Past cohorts: upload old NITA results</summary>
                <p className="muted small">Pick the cohort at the top, add the day NITA released its results, then use "Upload NITA results (Excel)". Rows are matched by index number, then admission number or name, and you check the matches before anything is saved. Any student of the cohort can be matched, even one who is not in an Exam register.</p>
              </details>
            </div>
          )}
        </>
      )}
    </section>
  );
}

function Paper({ value, label, disabled, onChange }: { value: NitaPaperResult; label: string; disabled: boolean; onChange: (v: NitaPaperResult) => void }) {
  return <select aria-label={label} value={value} disabled={disabled} onChange={(e) => onChange(e.target.value as NitaPaperResult)}>{NITA_PAPER_RESULTS.map((k) => <option key={k} value={k}>{NITA_PAPER_LABELS[k]}</option>)}</select>;
}

function Cell({ value, placeholder, label, disabled, onSave }: { value: string; placeholder: string; label: string; disabled: boolean; onSave: (v: string) => void }) {
  const [v, setV] = useState(value);
  useEffect(() => setV(value), [value]);
  return <input className="nita-cell" value={v} aria-label={label} placeholder={placeholder} maxLength={80} disabled={disabled} onChange={(e) => setV(e.target.value)}
    onBlur={() => { if (v.trim() !== value) onSave(v); }} onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }} />;
}

/** 10A: the certificate copy and whether it was handed over, like Graduation. */
function Certificate({ org, studentId, has, keeper, issued, issuedOn, onIssued }: { org: Organization; studentId: string; has: boolean; keeper: boolean; issued: boolean; issuedOn: string | null; onIssued: (on: boolean) => void }) {
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
    if (f) void run('upload', () => uploadAttachmentFile(org.id, studentId, 'nita', f), 'NITA certificate saved');
  }
  return (
    <div className="nita-cert">
      <select aria-label="Certificate handed over" className={issued ? 'badge-regular' : 'badge-visitor'} value={issued ? 'yes' : 'no'} disabled={!keeper} onChange={(e) => onIssued(e.target.value === 'yes')}>
        <option value="no">Not issued</option><option value="yes">{issued && issuedOn ? `Issued ${formatDateKey(issuedOn)}` : 'Issued'}</option>
      </select>
      {has && <button type="button" className="link-button small" disabled={!!busy} onClick={() => void run('view', () => printAttachmentFile(org.id, studentId, 'nita'))}>{busy === 'view' ? 'Opening…' : 'View'}</button>}
      {has && <button type="button" className="link-button small" disabled={!!busy} onClick={() => void run('dl', () => downloadAttachmentFile(org.id, studentId, 'nita'))}>{busy === 'dl' ? '…' : 'Download'}</button>}
      {keeper && <button type="button" className="link-button small" disabled={!!busy} onClick={() => input.current?.click()}>{busy === 'upload' ? 'Uploading…' : has ? 'Replace' : 'Upload copy'}</button>}
      <input ref={input} type="file" accept="application/pdf,.pdf,image/jpeg,image/png,image/webp" hidden onChange={chosen} />
    </div>
  );
}

function SittingPicker({ month, year, onMonth, onYear }: { month: number; year: number; onMonth: (m: number) => void; onYear: (y: number) => void }) {
  const now = new Date().getFullYear();
  const years = Array.from({ length: now - 2019 + 2 }, (_, i) => now + 1 - i);
  return (
    <>
      <label className="field"><span>Sitting month</span><select value={month} onChange={(e) => onMonth(Number(e.target.value))}>{MONTHS.map((m, i) => <option key={m} value={i + 1}>{m}</option>)}</select></label>
      <label className="field"><span>Sitting year</span><select value={year} onChange={(e) => onYear(Number(e.target.value))}>{years.map((y) => <option key={y}>{y}</option>)}</select></label>
    </>
  );
}

function NewRelease({ org, cohort, onAdded }: { org: Organization; cohort: string; onAdded: (id: string) => void }) {
  const toast = useToast();
  const [date, setDate] = useState('');
  const [month, setMonth] = useState(new Date().getMonth() + 1);
  const [year, setYear] = useState(new Date().getFullYear());
  function add() {
    const { id, done } = addNitaRelease(org.id, { cohort, releasedOn: date || null, sitting: sittingText(month, year) });
    done.then(() => toast.show('Added'), (err) => toast.show(friendlyError(err)));
    onAdded(id);
  }
  return (
    <div className="field-row nita-new">
      <label className="field"><span>Day NITA released the results</span><input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></label>
      <SittingPicker month={month} year={year} onMonth={setMonth} onYear={setYear} />
      <button type="button" className="btn btn-primary align-end" onClick={add}>{date ? 'Add' : 'Add (not released yet)'}</button>
    </div>
  );
}

function EditRelease({ org, id, releasedOn, sitting }: { org: Organization; id: string; releasedOn: string | null; sitting: string }) {
  const toast = useToast();
  const [date, setDate] = useState(releasedOn ?? '');
  const m = MONTHS.indexOf(sitting.slice(0, 3));
  const [month, setMonth] = useState(m >= 0 ? m + 1 : 1);
  const [year, setYear] = useState(Number(sitting.slice(-4)) || new Date().getFullYear());
  return (
    <div className="field-row nita-new">
      <label className="field"><span>Day NITA released the results</span><input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></label>
      <SittingPicker month={month} year={year} onMonth={setMonth} onYear={setYear} />
      <button type="button" className="btn btn-primary align-end" onClick={() => saveNitaRelease(org.id, id, { releasedOn: date || null, sitting: sittingText(month, year) }).then(() => toast.show('Saved'), (err) => toast.show(friendlyError(err)))}>Save</button>
    </div>
  );
}

/** 6A: NITA's Excel list, matched to students; the keeper checks the matches before saving. */
function UploadButton({ students, indexOf, onSave }: { students: Student[]; indexOf: Record<string, string>; onSave: (m: (NitaMatch & { studentId: string })[]) => Promise<void> }) {
  const toast = useToast();
  const input = useRef<HTMLInputElement>(null);
  const [found, setFound] = useState<NitaMatch[] | null>(null);
  const [busy, setBusy] = useState(false);
  const nameOf = (id: string | null) => students.find((s) => s.id === id)?.name ?? '';
  async function chosen(e: ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    e.target.value = '';
    if (!f) return;
    try {
      if (/\.pdf$/i.test(f.name)) throw new Error('A PDF list cannot be read. Open it in Excel (or ask NITA for the Excel copy), save it as .xlsx, then choose it again.');
      const sheets = await readSpreadsheetSheets(f);
      const best = sheets.map((sh) => parseNitaSheet(sh.rows)).find((p) => p.rows.length) ?? parseNitaSheet(sheets[0]?.rows ?? []);
      if (best.problem) throw new Error(best.problem);
      setFound(matchNitaRows(best.rows, students, indexOf));
    } catch (err) { toast.show(friendlyError(err)); }
  }
  const ok = (found ?? []).filter((m): m is NitaMatch & { studentId: string } => !!m.studentId);
  return (
    <>
      <button type="button" className="btn btn-gold align-end" onClick={() => input.current?.click()}>Upload NITA results (Excel)</button>
      <input ref={input} type="file" accept=".xlsx,.csv,.pdf" hidden onChange={(e) => void chosen(e)} />
      {found && (
        <div className="card stack nita-upload">
          <h2>Check the matches</h2>
          <p className="small">{ok.length} of {found.length} rows matched to students.{found.length > ok.length ? ' Rows not matched are left out.' : ''}</p>
          <div className="table-scroll">
            <table className="table">
              <thead><tr><th>Row</th><th>In the list</th><th>Index no</th><th>Theory</th><th>Practical</th><th>Result</th><th>Matched to</th></tr></thead>
              <tbody>{found.map((m) => (
                <tr key={m.row.line} className={m.studentId ? '' : 'muted'}>
                  <td>{m.row.line}</td><td>{m.row.name || m.row.admissionNo || '–'}</td><td>{m.row.indexNo || '–'}</td>
                  <td>{m.row.theory ? NITA_PAPER_LABELS[m.row.theory] : '–'}</td><td>{m.row.practical ? NITA_PAPER_LABELS[m.row.practical] : '–'}</td><td>{m.row.overall ? NITA_PAPER_LABELS[m.row.overall] : '–'}</td>
                  <td>{m.studentId ? <>{nameOf(m.studentId)} <span className="muted small">(by {m.how === 'index' ? 'index number' : m.how === 'admission' ? 'admission number' : 'name'})</span></> : <span className="up-bad">Not matched</span>}</td>
                </tr>
              ))}</tbody>
            </table>
          </div>
          <div className="row-actions">
            <button type="button" className="btn btn-primary" disabled={busy || !ok.length} onClick={() => { setBusy(true); onSave(ok).then(() => { toast.show(`Saved ${ok.length} results`); setFound(null); }, (err) => toast.show(friendlyError(err))).finally(() => setBusy(false)); }}>
              {busy ? 'Saving…' : `Save ${ok.length} ${ok.length === 1 ? 'result' : 'results'}`}
            </button>
            <button type="button" className="btn btn-quiet" onClick={() => setFound(null)}>Cancel</button>
          </div>
        </div>
      )}
    </>
  );
}

export type { NitaResultRow };
