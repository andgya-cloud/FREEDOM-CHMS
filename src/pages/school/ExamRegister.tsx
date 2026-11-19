import { useEffect, useMemo, useState } from 'react';
import { useToast } from '../../state/ToastContext';
import { friendlyError } from '../../lib/errors';
import { useCohortTranscripts, useExamAccess, useExamRegisters, useExamResults, useExamSettings, type ExamSheetRow } from '../../state/useExams';
import { fillRegister, issueTranscripts, lockRegister, saveRegisterEntry, startExamRegister, type NewTranscript } from '../../lib/examRegisterWrites';
import { registerPdf, registerWorkbook, type RegisterLine } from '../../lib/examRegisterFiles';
import { transcriptsPdf, type Transcript } from '../../lib/examPdf';
import { downloadFile } from '../../lib/givingPdf';
import { printFile } from '../../lib/printFile';
import { logExam } from '../../lib/examWrites';
import { buildRows, type Row } from './ExamResults';
import { gradeFor, type ExamSettings, type ExamStudent } from '../../../functions/src/shared/exams';
import {
  NITA_GRADES, NITA_RESULT_LABELS, SITS_LABELS, cleanIndexNo, nitaLineFor, orderSittings, registerCounts, sittingName, suggestSitting, transcriptFingerprint,
  typedPointsProblem, verifyUrl, type ExamRegister, type NitaResult, type RegisterEntry, type RegisterSits,
} from '../../../functions/src/shared/examRegister';
import { formatDateKey } from '../../../functions/src/shared/datetime';
import type { Organization } from '../../state/OrgContext';
import { useAttachments } from '../../state/useAttachments';
import { attachmentLine } from '../../../functions/src/shared/attachment';

interface Common {
  org: Organization; cohort: string; label: string; students: ExamStudent[]; sheets: ExamSheetRow[]; courseName: (id: string) => string;
  attendance: Record<string, number | null>; today: string;
}

/** Each student's semesters and final, the same figures as the Results page. */
function useCohortRows({ org, cohort, students, sheets, courseName }: Common) {
  const { settings } = useExamSettings(org.id);
  const { results } = useExamResults(org.id, cohort);
  const rows = useMemo(() => buildRows(cohort, students, results, sheets, settings, courseName), [cohort, students, results, sheets, settings, courseName]);
  return { rows, settings };
}

/** The internal result the register shows: the final once both semesters are in, else the latest semester so far. */
function computedResult(r: Row | undefined, settings: ExamSettings): { points: number; grade: string; note: string } | null {
  if (!r) return null;
  if (r.final.final != null) return { points: r.final.final, grade: r.final.grade, note: 'final' };
  for (const s of [...r.sems].reverse()) {
    const p = s.points ?? s.partial;
    if (p != null) return { points: p, grade: gradeFor(p, settings).grade, note: `${s.label}${s.points == null ? ', so far' : ''}` };
  }
  return null;
}

/**
 * The exam register (Andy, 2026-11-19, 2A 3A 4A 5A+B): pick the cohort at the top and the exam sitting here;
 * every student of the cohort sits NITA, the internal college exam or neither. "Fill in from results" suggests
 * NITA for those who passed every course so far with enough attendance; the principal can change any of them,
 * then locks the register. For ADIA's own records, with Excel and PDF copies.
 */
export function ExamRegisterView(p: Common) {
  const { org, cohort, students, attendance, today } = p;
  const toast = useToast();
  const a = useExamAccess();
  const { rows, settings } = useCohortRows(p);
  const { registers, loading } = useExamRegisters(org.id, cohort);
  const sittings = useMemo(() => orderSittings(registers.map((r) => r.sitting)), [registers]);
  const [pick, setPick] = useState('');
  const [adding, setAdding] = useState(false);
  const now = new Date(`${today}T12:00:00`);
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [year, setYear] = useState(now.getFullYear());
  const sitting = sittings.includes(pick) ? pick : sittings[0] ?? '';
  const reg = registers.find((r) => r.sitting === sitting);
  useEffect(() => { setPick(''); setAdding(false); }, [cohort]);

  const byId = useMemo(() => new Map(rows.map((r) => [r.key, r])), [rows]);
  const list = useMemo(() => [...students].sort((x, y) => x.name.localeCompare(y.name)), [students]);
  const suggest = (id: string) => {
    const r = byId.get(id);
    return suggestSitting({
      semesters: r ? r.sems.map((s) => ({ points: s.courses.length ? null : s.points, courses: s.courses })) : [],
      attendance: attendance[id] ?? null, passMark: reg?.rules.passMark ?? settings.passMark, minAttendance: reg?.rules.minAttendance ?? settings.minAttendance ?? null,
    });
  };
  const entries = reg?.entries ?? {};
  const counts = registerCounts(list.map((s) => s.id), entries);
  const locked = !!reg?.locked;

  function start() {
    const name = sittingName(month, year);
    if (sittings.includes(name)) { setPick(name); setAdding(false); return; }
    startExamRegister(org.id, cohort, name, { passMark: settings.passMark, minAttendance: settings.minAttendance ?? null });
    void logExam(org.id, { action: 'register', cohort, sheetId: null, detail: `Exam register started: ${name}`, byName: a.myName });
    setPick(name);
    setAdding(false);
    toast.show(`${name} started for ${cohort}`);
  }
  const save = (id: string, changes: Partial<RegisterEntry>) => {
    if (!reg) return;
    saveRegisterEntry(org.id, reg.id, id, changes).catch((err) => toast.show(friendlyError(err)));
  };
  const blank = (st: ExamStudent, sits: RegisterSits | null): RegisterEntry => ({
    sits, trade: entries[st.id]?.trade ?? st.courseName ?? '', grade: entries[st.id]?.grade ?? NITA_GRADES[0], indexNo: entries[st.id]?.indexNo ?? '',
    feePaid: entries[st.id]?.feePaid ?? false, nitaResult: entries[st.id]?.nitaResult ?? 'pending', typedPoints: entries[st.id]?.typedPoints ?? null,
  });
  function fill() {
    if (!reg) return;
    if (locked) { toast.show('Unlock the register first.'); return; }
    const picks = Object.fromEntries(list.filter((st) => !entries[st.id]?.sits).map((st) => [st.id, blank(st, suggest(st.id).nita ? 'nita' : 'internal')]));
    const n = Object.keys(picks).length;
    if (!n) { toast.show('Every student already has a choice.'); return; }
    fillRegister(org.id, reg.id, picks).catch((err) => toast.show(friendlyError(err)));
    toast.show(`${n} ${n === 1 ? 'student' : 'students'} filled in from results. Check them and change any you need to.`);
  }
  function lock(on: boolean) {
    if (!reg) return;
    if (on && counts.notPicked) { toast.show(`Pick NITA, Internal or Not sitting for every student first (${counts.notPicked} left).`); return; }
    lockRegister(org.id, reg.id, on, today, a.myName).catch((err) => toast.show(friendlyError(err)));
    void logExam(org.id, { action: 'register', cohort, sheetId: null, detail: `${reg.sitting} ${on ? 'locked' : 'unlocked'}`, byName: a.myName });
    toast.show(on ? 'Register locked' : 'Register unlocked');
  }

  const resultText = (st: ExamStudent, e: RegisterEntry | undefined) => {
    if (e?.sits === 'nita') return NITA_RESULT_LABELS[e.nitaResult ?? 'pending'];
    if (e?.sits !== 'internal') return '';
    const c = computedResult(byId.get(st.id), settings);
    if (c) return `${c.grade} · ${c.points}`;
    return e.typedPoints != null ? `${gradeFor(e.typedPoints, settings).grade} · ${e.typedPoints}` : '';
  };
  const lines = (): RegisterLine[] => list.map((st) => {
    const e = entries[st.id];
    const nita = e?.sits === 'nita';
    return {
      name: st.name, admissionNo: st.admissionNo, programme: st.courseName, sits: e?.sits ? SITS_LABELS[e.sits] : 'Not picked', trade: nita ? e?.trade ?? '' : '', grade: nita ? e?.grade ?? '' : '',
      indexNo: nita ? e?.indexNo ?? '' : '', feePaid: nita ? (e?.feePaid ? 'Yes' : 'No') : '', result: resultText(st, e),
    };
  });
  const info = () => ({
    cohort, sitting, locked: reg?.locked ? `Locked ${formatDateKey(reg.lockedOn ?? today)} by ${reg.lockedByName ?? ''}` : '',
    counts: `NITA ${counts.nita} · Internal ${counts.internal} · Not sitting ${counts.none}${counts.notPicked ? ` · Not picked ${counts.notPicked}` : ''}`,
  });
  async function download(kind: 'xlsx' | 'pdf') {
    try { downloadFile(kind === 'xlsx' ? await registerWorkbook(info(), lines()) : await registerPdf(info(), lines())); } catch (err) { toast.show(friendlyError(err)); }
  }

  const years = [now.getFullYear() - 1, now.getFullYear(), now.getFullYear() + 1, now.getFullYear() + 2];
  const newForm = (
    <div className="field-row exam-reg-new">
      <label className="field"><span>Month</span>
        <select value={month} onChange={(e) => setMonth(Number(e.target.value))}>{['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'].map((m, i) => <option key={m} value={i + 1}>{m}</option>)}</select>
      </label>
      <label className="field"><span>Year</span><select value={year} onChange={(e) => setYear(Number(e.target.value))}>{years.map((y) => <option key={y} value={y}>{y}</option>)}</select></label>
      <button type="button" className="btn btn-primary align-end" onClick={start}>Start {sittingName(month, year).replace('NITA & college exams · ', '')}</button>
      {sittings.length > 0 && <button type="button" className="btn btn-quiet align-end" onClick={() => setAdding(false)}>Cancel</button>}
    </div>
  );

  return (
    <section className="card stack exam-register">
      <div className="card-head"><h2>Exam register · {cohort}</h2><span className="muted small">{list.length} students</span></div>
      <p className="muted small">ADIA's own record of who sits which exams. Each cohort has its own register for each exam sitting, so later cohorts work the same way.</p>
      {loading ? <p className="muted">Loading…</p> : sittings.length === 0 || adding ? (
        <>{sittings.length === 0 && <p>Start the register for this cohort's next exam sitting.</p>}{newForm}</>
      ) : (
        <>
          <div className="field-row">
            <label className="field"><span>Exam sitting</span>
              <select value={sitting} onChange={(e) => (e.target.value === '+' ? setAdding(true) : setPick(e.target.value))}>
                {sittings.map((x) => <option key={x} value={x}>{x}</option>)}
                <option value="+">+ Start a new sitting…</option>
              </select>
            </label>
            {!locked && <button type="button" className="btn btn-gold align-end" onClick={fill}>Fill in from results</button>}
          </div>
          <p className="exam-reg-counts">
            <span className="badge badge-member">NITA {counts.nita}</span> <span className="badge badge-visitor">Internal {counts.internal}</span> <span className="badge badge-muted">Not sitting {counts.none}</span>
            {counts.notPicked > 0 && <> <span className="badge badge-warn">Not picked yet {counts.notPicked}</span></>}
          </p>
          {locked && <p className="notice small">🔒 Locked on {formatDateKey(reg!.lockedOn ?? today)}{reg!.lockedByName ? ` by ${reg!.lockedByName}` : ''}. NITA index numbers and results can still be filled in.</p>}
          {list.length === 0 ? <p className="muted">No students in {cohort} yet.</p> : (
            <div className="table-scroll">
              <table className="table exam-reg-table">
                <thead><tr><th>Student</th><th>Suggestion</th><th>Sits</th><th>NITA trade</th><th>Grade</th><th>Index no.</th><th>Fee paid</th><th>Result</th></tr></thead>
                <tbody>
                  {list.map((st) => {
                    const e = entries[st.id];
                    const sg = suggest(st.id);
                    const nita = e?.sits === 'nita';
                    const internal = e?.sits === 'internal';
                    const c = internal ? computedResult(byId.get(st.id), settings) : null;
                    return (
                      <tr key={st.id}>
                        <td>{st.name}<div className="muted small">{st.admissionNo}{st.courseName ? ` · ${st.courseName}` : ''}</div></td>
                        <td><span className={`badge ${sg.nita ? 'badge-member' : 'badge-visitor'}`}>{sg.nita ? 'NITA' : 'Internal'}</span><div className="muted small">{sg.why}</div></td>
                        <td>
                          <select aria-label={`What ${st.name} sits`} value={e?.sits ?? ''} disabled={locked} onChange={(ev) => save(st.id, ev.target.value ? { ...blank(st, ev.target.value as RegisterSits) } : { sits: null })}>
                            <option value="">Pick…</option>
                            {(Object.keys(SITS_LABELS) as RegisterSits[]).map((k) => <option key={k} value={k}>{SITS_LABELS[k]}</option>)}
                          </select>
                        </td>
                        <td>{nita ? <TextCell value={e?.trade ?? ''} disabled={locked} label="NITA trade" onSave={(v) => save(st.id, { trade: v.slice(0, 80) })} /> : <span className="muted">–</span>}</td>
                        <td>{nita ? <select aria-label="NITA grade" value={e?.grade ?? NITA_GRADES[0]} disabled={locked} onChange={(ev) => save(st.id, { grade: ev.target.value })}>{NITA_GRADES.map((g) => <option key={g}>{g}</option>)}</select> : <span className="muted">–</span>}</td>
                        <td>{nita ? <TextCell value={e?.indexNo ?? ''} placeholder="NITA index" label="NITA index number" onSave={(v) => save(st.id, { indexNo: cleanIndexNo(v) })} /> : <span className="muted">–</span>}</td>
                        <td>{nita ? <input type="checkbox" aria-label="Fee paid" checked={!!e?.feePaid} disabled={locked} onChange={(ev) => save(st.id, { feePaid: ev.target.checked })} /> : <span className="muted">–</span>}</td>
                        <td>
                          {nita && <select aria-label="NITA result" value={e?.nitaResult ?? 'pending'} onChange={(ev) => save(st.id, { nitaResult: ev.target.value as NitaResult })}>{(Object.keys(NITA_RESULT_LABELS) as NitaResult[]).map((k) => <option key={k} value={k}>{NITA_RESULT_LABELS[k]}</option>)}</select>}
                          {internal && (c
                            ? <><span className="badge badge-regular">{c.grade} · {c.points}</span><div className="muted small">from marks sheets ({c.note})</div></>
                            : <><TextCell value={e?.typedPoints == null ? '' : String(e.typedPoints)} placeholder="Type mark" label="Internal mark" check={typedPointsProblem}
                                onSave={(v) => save(st.id, { typedPoints: v.trim() ? Math.round(Number(v) * 100) / 100 : null })} />
                              {e?.typedPoints != null && <div className="muted small">{gradeFor(e.typedPoints, settings).grade}</div>}</>)}
                          {!nita && !internal && <span className="muted">–</span>}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
          <div className="row-actions">
            <button type="button" className="btn btn-quiet" onClick={() => void download('xlsx')}>Download Excel</button>
            <button type="button" className="btn btn-quiet" onClick={() => void download('pdf')}>Download PDF</button>
            <button type="button" className="btn btn-primary" onClick={() => lock(!locked)}>{locked ? 'Unlock' : 'Lock the register'}</button>
          </div>
          <details className="fold-card">
            <summary>How the suggestion works</summary>
            <p className="small muted">A student is suggested for NITA when they have passed every course so far ({reg?.rules.passMark ?? settings.passMark} or more){(reg?.rules.minAttendance ?? settings.minAttendance) != null ? ` and their attendance is at least ${reg?.rules.minAttendance ?? settings.minAttendance}%` : ''}. Everyone else is suggested for the internal college exam. The rules are kept with each register, so a later change in Setup never rewrites an old one. Internal results come from the marks sheets; where there is none, type the mark in.</p>
          </details>
        </>
      )}
    </section>
  );
}

/** A text box that saves when you leave it (or press Enter), so typing stays smooth. */
function TextCell({ value, onSave, placeholder, label, disabled, check }: { value: string; onSave: (v: string) => void; placeholder?: string; label: string; disabled?: boolean; check?: (v: string) => string | null }) {
  const [v, setV] = useState(value);
  useEffect(() => setV(value), [value]);
  const bad = check?.(v) ?? null;
  const commit = () => { if (v !== value && !bad) onSave(v); };
  return (
    <>
      <input className="exam-reg-input" aria-label={label} value={v} placeholder={placeholder} disabled={disabled} onChange={(e) => setV(e.target.value)} onBlur={commit} onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }} />
      {bad && <div className="up-bad small">{bad}</div>}
    </>
  );
}

// ---- Students transcripts ----------------------------------------------------------------------

/**
 * Students transcripts (Andy, 2026-11-19, 6A-9A): one student or the whole cohort, with Print and Download.
 * Each printed transcript gets a serial number and a QR code for the public check page, and reads
 * PROVISIONAL until the principal approves every result.
 */
export function TranscriptsView(p: Common & { dates: string; pick: string; onPick: (id: string) => void }) {
  const { org, cohort, label, attendance, today, dates, pick, onPick } = p;
  const toast = useToast();
  const a = useExamAccess();
  const { rows, settings } = useCohortRows(p);
  const { registers } = useExamRegisters(org.id, cohort);
  const { transcripts: issued } = useCohortTranscripts(org.id, cohort);
  const { byStudent: attachments } = useAttachments(org.id);
  const [busy, setBusy] = useState<'' | 'print' | 'download'>('');
  const chosen = pick === 'all' ? null : rows.find((r) => r.key === pick) ?? rows[0] ?? null;
  const shown = chosen ?? rows[0] ?? null;
  const year = Number(today.slice(0, 4));

  const base = (r: Row): Transcript => {
    const provisional = r.sems.some((s) => s.provisional) || !r.final.complete;
    return {
      name: r.name, admissionNo: r.admissionNo, programme: r.programme, cohort: label, semesters: r.sems, final: r.final, printed: r.printed, notes: r.notes,
      attendance: attendance[r.key] ?? null, nita: nitaLineFor(r.key, registers as ExamRegister[]), dates, provisional, issuedOn: formatDateKey(today),
      attachment: attachmentLine(attachments[r.key], settings),
    };
  };
  const print = (r: Row, t: Transcript) => transcriptFingerprint({
    semesters: r.sems.map((s) => ({ points: s.points, partial: s.partial, courses: s.courses.map((c) => ({ courseName: c.courseName, total: c.total })) })),
    finalPoints: r.final.final, finalGrade: r.final.grade, provisional: !!t.provisional, nita: t.nita ?? '', attendance: t.attendance ?? null, attachment: t.attachment,
  });

  /** The serial numbers: an unchanged result keeps the one it was given before, a changed one gets the next. */
  async function withSerials(list: Row[]): Promise<Transcript[]> {
    const ts = list.map(base);
    const fps = list.map((r, i) => print(r, ts[i]!));
    const known = new Map(issued.map((x) => [`${x.studentId}|${x.fingerprint}`, x]));
    const need = list.map((r, i) => (known.has(`${r.key}|${fps[i]}`) ? null : i)).filter((i): i is number => i != null);
    const fresh = await issueTranscripts(org.id, need.map((i): NewTranscript => {
      const r = list[i]!;
      return { studentId: r.key, cohort, name: r.name, admissionNo: r.admissionNo, programme: r.programme, finalPoints: r.final.final, finalGrade: r.final.grade, provisional: !!ts[i]!.provisional, fingerprint: fps[i]!.slice(0, 6000), issuedOn: today, issuedByName: a.myName.slice(0, 120) };
    }), year);
    const got = new Map(need.map((i, k) => [i, fresh[k]!]));
    return ts.map((t, i) => {
      const old = known.get(`${list[i]!.key}|${fps[i]}`);
      const s = old ? { token: old.id, serial: old.serial } : got.get(i)!;
      return { ...t, serial: s.serial, verify: verifyUrl(window.location.origin, org.id, s.token), issuedOn: old ? formatDateKey(old.issuedOn) : t.issuedOn };
    });
  }
  async function run(kind: 'print' | 'download') {
    const list = pick === 'all' ? rows : chosen ? [chosen] : [];
    if (!list.length) return;
    setBusy(kind);
    try {
      const file = await transcriptsPdf({ transcripts: await withSerials(list), settings, title: pick === 'all' ? `${cohort} transcripts` : list[0]!.name });
      if (kind === 'print') printFile(file); else downloadFile(file);
    } catch (err) { toast.show(friendlyError(err)); } finally { setBusy(''); }
  }

  return (
    <section className="stack">
      <section className="card stack">
        <div className="card-head"><h2>Students transcripts · {cohort}</h2></div>
        {rows.length === 0 ? <p className="muted">No students or results for {cohort} yet.</p> : (
          <div className="field-row exam-tr-pick">
            <label className="field"><span>Student</span>
              <select value={pick === 'all' ? 'all' : chosen?.key ?? ''} onChange={(e) => onPick(e.target.value)}>
                {rows.map((r) => <option key={r.key} value={r.key}>{r.name}{r.admissionNo ? ` · ${r.admissionNo}` : ''}</option>)}
                <option value="all">Whole cohort ({rows.length} students)</option>
              </select>
            </label>
            <button type="button" className="btn btn-quiet align-end" disabled={!!busy} onClick={() => void run('print')}>{busy === 'print' ? 'Preparing…' : 'Print'}</button>
            <button type="button" className="btn btn-gold align-end" disabled={!!busy} onClick={() => void run('download')}>{busy === 'download' ? 'Preparing…' : 'Download PDF'}</button>
          </div>
        )}
        <p className="muted small">Each transcript gets a serial number and a QR code that an employer can scan to check it is genuine. It reads PROVISIONAL until every result is approved and both semesters are in.{pick === 'all' && rows.length ? ` The PDF has one page for each of the ${rows.length} students.` : ''}</p>
      </section>
      {shown && <TranscriptPaper t={base(shown)} settings={settings} serial={issued.filter((x) => x.studentId === shown.key).sort((x, y) => y.n - x.n)[0]?.serial} />}
    </section>
  );
}

/** The transcript on screen, as it will print. */
function TranscriptPaper({ t, settings, serial }: { t: Transcript; settings: ExamSettings; serial?: string }) {
  return (
    <article className="transcript-paper" aria-label={`Transcript for ${t.name}`}>
      {t.provisional && <div className="transcript-wm" aria-hidden>PROVISIONAL</div>}
      <header className="transcript-head">
        <img src="/org/adia-crest.png" alt="" className="transcript-crest" onError={(e) => { (e.target as HTMLImageElement).style.visibility = 'hidden'; }} />
        <div><strong>ADIA Training Centre</strong><span>ACADEMIC TRANSCRIPT</span></div>
        <div className="transcript-no">{serial ? `No. ${serial}` : 'Serial number given when printed'}<br />{t.issuedOn}</div>
      </header>
      <dl className="transcript-facts">
        <div><dt>Name</dt><dd>{t.name}</dd></div>
        <div><dt>Admission no.</dt><dd>{t.admissionNo || '–'}</dd></div>
        <div><dt>Programme</dt><dd>{t.programme || '–'}</dd></div>
        <div><dt>Cohort</dt><dd>{t.cohort}{t.dates ? ` · ${t.dates}` : ''}</dd></div>
      </dl>
      {t.semesters.map((s) => (
        <div key={s.label} className="transcript-sem">
          <h3>{s.label} · {s.points != null ? `${s.points} (${s.grade})` : s.partial != null ? `(${s.partial}) so far` : 'not yet available'}</h3>
          {s.courses.length > 0 && (
            <table>
              <thead><tr><th>Course</th><th className="num">Mark %</th><th>Grade</th></tr></thead>
              <tbody>{s.courses.map((c) => <tr key={c.sheetId}><td>{c.courseName}</td><td className="num">{c.total ?? (c.partial != null ? `(${c.partial})` : '–')}</td><td>{c.total == null ? '–' : gradeFor(c.total, settings).grade}</td></tr>)}</tbody>
            </table>
          )}
          {!s.courses.length && s.source && <p className="muted small">{s.source}</p>}
        </div>
      ))}
      <div className="transcript-sum">
        <span>Final points <strong>{t.final.final ?? '–'}</strong></span>
        <span>Classification <strong>{t.final.grade || '–'}</strong></span>
        {t.attendance != null && <span>Attendance <strong>{Math.round(t.attendance)}%</strong></span>}
        {t.nita && <span>NITA <strong>{t.nita}</strong></span>}
        {t.attachment && <span>Industrial attachment <strong>{t.attachment}</strong></span>}
      </div>
      <div className="transcript-sign">
        <div>{settings.principalName}<br /><span>{settings.principalTitle}</span></div>
        <div className="transcript-stamp">College stamp</div>
        <div>{settings.directorName}<br /><span>{settings.directorTitle}</span></div>
      </div>
      <p className="transcript-foot">QR code and check details are printed on the PDF · Powered by <strong>Insight-IQ</strong></p>
    </article>
  );
}

