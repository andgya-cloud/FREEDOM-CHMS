/**
 * NITA results (Andy, 2026-11-20: 1A-8A, 9B, 10A-13A). Each cohort's results are grouped by the date NITA
 * released them (a "release", tied to the sitting). Each student keeps one NITA result: the trade, the grade
 * level, the index number, a Theory and a Practical result, the overall result and the certificate number.
 * The principal, Admin, the pastor and Doreen keep them.
 */
import { cohortKey } from './examCohorts.js';
import { cleanIndexNo, NITA_GRADES } from './examRegister.js';
import { formatDateKey } from './datetime.js';

export const NITA_PAPER_RESULTS = ['pending', 'pass', 'fail', 'absent'] as const;
export type NitaPaperResult = (typeof NITA_PAPER_RESULTS)[number];
export const NITA_PAPER_LABELS: Record<NitaPaperResult, string> = { pending: 'Pending', pass: 'Pass', fail: 'Fail', absent: 'Absent' };

export interface NitaRelease {
  orgId: string;
  cohort: string;
  /** The day NITA released the results; null while they are awaited. */
  releasedOn: string | null;
  /** The sitting, e.g. "Nov 2026". */
  sitting: string;
}

export interface NitaResultRecord {
  orgId: string;
  studentId: string;
  cohort: string;
  releaseId: string;
  trade: string;
  grade: string;
  indexNo: string;
  theory: NitaPaperResult;
  practical: NitaPaperResult;
  overall: NitaPaperResult;
  /** True once someone picks the overall result by hand; then the papers no longer change it. */
  overallSet: boolean;
  certificateNo: string;
  /** The NITA certificate handed to the student, and when (10A). */
  issued: boolean;
  issuedOn: string | null;
}

/** 4A: the overall result from the two papers. Pass when both pass, Absent when one was missed, else Fail. */
export function overallFrom(theory: NitaPaperResult, practical: NitaPaperResult): NitaPaperResult {
  if (theory === 'pending' || practical === 'pending') return theory === 'fail' || practical === 'fail' ? 'fail' : 'pending';
  if (theory === 'absent' || practical === 'absent') return 'absent';
  return theory === 'pass' && practical === 'pass' ? 'pass' : 'fail';
}

export const nitaReleaseId = (cohort: string, sitting: string, releasedOn: string | null) =>
  `${cohortKey(cohort)}__${sitting.replace(/[^A-Za-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 30) || 'x'}__${releasedOn ?? 'awaited'}`;

/** "20 Mar 2026 · Dec 2025 sitting", or "Not released yet · Nov 2026 sitting". */
export const releaseLabel = (r: Pick<NitaRelease, 'releasedOn' | 'sitting'>) => `${r.releasedOn ? formatDateKey(r.releasedOn) : 'Not released yet'} · ${r.sitting} sitting`;
/** Newest first; awaited ones on top. */
export const orderReleases = <T extends Pick<NitaRelease, 'releasedOn' | 'sitting'>>(list: readonly T[]) =>
  [...list].sort((a, b) => (b.releasedOn ?? '9999').localeCompare(a.releasedOn ?? '9999') || b.sitting.localeCompare(a.sitting));

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
/** "Nov 2026" from a month and a year. */
export const sittingText = (month: number, year: number) => `${MONTHS[month - 1] ?? ''} ${year}`.trim();

export interface NitaCounts { sat: number; passed: number; failed: number; absent: number; pending: number }
/** 11A: the counts at the top. */
export function nitaCounts(overall: readonly NitaPaperResult[]): NitaCounts {
  const n = (k: NitaPaperResult) => overall.filter((v) => v === k).length;
  return { sat: overall.length - n('absent'), passed: n('pass'), failed: n('fail'), absent: n('absent'), pending: n('pending') };
}

/** Pass rate in whole percent among those with a result (passed or failed); null when none yet. */
export const passRate = (c: Pick<NitaCounts, 'passed' | 'failed'>) => (c.passed + c.failed ? Math.round((c.passed / (c.passed + c.failed)) * 100) : null);

/** 11A: the pass rate for each trade. */
export function tradeRates(rows: readonly { trade: string; overall: NitaPaperResult }[]): { trade: string; passed: number; decided: number; rate: number }[] {
  const by = new Map<string, { passed: number; decided: number }>();
  for (const r of rows) {
    if (r.overall !== 'pass' && r.overall !== 'fail') continue;
    const k = r.trade.trim() || 'No trade';
    const v = by.get(k) ?? { passed: 0, decided: 0 };
    v.decided++;
    if (r.overall === 'pass') v.passed++;
    by.set(k, v);
  }
  return [...by.entries()].map(([trade, v]) => ({ trade, ...v, rate: Math.round((v.passed / v.decided) * 100) })).sort((a, b) => a.trade.localeCompare(b.trade));
}

/** 7A: the NITA line on the transcript, e.g. "Fashion Design Grade III: Pass (Dec 2025)". Empty while pending. */
export function nitaTranscriptLine(r: Pick<NitaResultRecord, 'trade' | 'grade' | 'overall'> | null | undefined, sitting: string): string {
  if (!r || r.overall === 'pending') return '';
  const what = [r.trade, r.grade].filter(Boolean).join(' ');
  return `${what ? `${what}: ` : ''}${NITA_PAPER_LABELS[r.overall]}${sitting ? ` (${sitting})` : ''}`;
}

/** A blank result for a student, from what the Exam register already knows. */
export const blankNitaResult = (orgId: string, studentId: string, cohort: string, releaseId: string, from?: { trade?: string; grade?: string; indexNo?: string }): NitaResultRecord => ({
  orgId, studentId, cohort, releaseId, trade: from?.trade ?? '', grade: from?.grade ?? NITA_GRADES[0], indexNo: from?.indexNo ?? '',
  theory: 'pending', practical: 'pending', overall: 'pending', overallSet: false, certificateNo: '', issued: false, issuedOn: null,
});

export const cleanCertificateNo = (s: string) => s.replace(/[^A-Za-z0-9/\- ]/g, '').replace(/\s+/g, ' ').trim().slice(0, 40);

// ---- 6A: NITA's Excel list --------------------------------------------------------------------

type Cell = string | number | boolean | Date | null | undefined;
export interface NitaUploadRow { line: number; indexNo: string; admissionNo: string; name: string; trade: string; grade: string; theory: NitaPaperResult | null; practical: NitaPaperResult | null; overall: NitaPaperResult | null; certificateNo: string }

/** "Pass", "P", "Competent" → pass; "Fail", "NYC", "Not yet competent" → fail; "Abs" → absent. */
export function paperResult(v: Cell): NitaPaperResult | null {
  const t = String(v ?? '').trim().toLowerCase().replace(/[^a-z ]/g, '');
  if (!t) return null;
  if (/^(pend|awaited|withheld)/.test(t)) return 'pending';
  if (/^(abs|absent|ab|x|missed)\b/.test(t) || t.startsWith('absent')) return 'absent';
  if (/^(fail|failed|f|nyc|not yet|not competent|referred|ref)\b/.test(t)) return 'fail';
  if (/^(pass|passed|p|competent|c|credit|distinction|merit)\b/.test(t)) return 'pass';
  return null;
}

const COLS: [keyof Omit<NitaUploadRow, 'line'>, RegExp][] = [
  ['indexNo', /index|candidate\s*no|reg(istration)?\s*no|entry\s*no/i],
  ['admissionNo', /adm/i],
  ['name', /name/i],
  ['trade', /trade|course|occupation|programme/i],
  ['grade', /grade|level/i],
  ['theory', /theory|written/i],
  ['practical', /practical/i],
  ['certificateNo', /cert/i],
  ['overall', /result|overall|remark|status/i],
];

/** Reads NITA's results list: finds the heading row, then one row per candidate. */
export function parseNitaSheet(rows: readonly (readonly Cell[])[]): { rows: NitaUploadRow[]; problem: string | null } {
  let head = -1;
  let map: Partial<Record<keyof Omit<NitaUploadRow, 'line'>, number>> = {};
  for (let i = 0; i < Math.min(rows.length, 30); i++) {
    const m: typeof map = {};
    (rows[i] ?? []).forEach((c, j) => {
      const t = String(c ?? '').trim();
      if (!t) return;
      // Each heading goes to the first column kind it names ("Certificate No" is not an index number).
      const hit = COLS.find(([k, re]) => m[k] == null && re.test(t) && !(k === 'indexNo' && /cert/i.test(t)) && !(k === 'grade' && /result/i.test(t)));
      if (hit) m[hit[0]] = j;
    });
    if ((m.indexNo != null || m.admissionNo != null || m.name != null) && (m.theory != null || m.practical != null || m.overall != null)) { head = i; map = m; break; }
  }
  if (head < 0) return { rows: [], problem: 'No heading row was found. The list needs an Index number or Name column, and a Theory, Practical or Result column.' };
  const get = (r: readonly Cell[], k: keyof typeof map) => (map[k] == null ? '' : String(r[map[k]!] ?? '').trim());
  const out: NitaUploadRow[] = [];
  for (let i = head + 1; i < rows.length; i++) {
    const r = rows[i] ?? [];
    const row: NitaUploadRow = {
      line: i + 1, indexNo: cleanIndexNo(get(r, 'indexNo')), admissionNo: get(r, 'admissionNo').slice(0, 40), name: get(r, 'name').replace(/\s+/g, ' ').slice(0, 120),
      trade: get(r, 'trade').slice(0, 80), grade: normaliseGrade(get(r, 'grade')),
      theory: paperResult(get(r, 'theory')), practical: paperResult(get(r, 'practical')), overall: paperResult(get(r, 'overall')), certificateNo: cleanCertificateNo(get(r, 'certificateNo')),
    };
    if (!row.indexNo && !row.admissionNo && !row.name) continue;
    if (!row.theory && !row.practical && !row.overall && !row.certificateNo) continue;
    out.push(row);
  }
  return { rows: out, problem: out.length ? null : 'The list has a heading row but no results under it.' };
}

/** "III", "Grade 3", "G3" → "Grade III". Anything else is kept out. */
export function normaliseGrade(v: string): string {
  const t = v.toUpperCase().replace(/GRADE|GR|G|\s|\./g, '');
  const n = ({ I: 'I', '1': 'I', II: 'II', '2': 'II', III: 'III', '3': 'III' } as Record<string, string>)[t];
  return n ? `Grade ${n}` : '';
}

export interface NitaStudent { id: string; name: string; admissionNo: string }
export type NitaMatch = { row: NitaUploadRow; studentId: string | null; how: 'index' | 'admission' | 'name' | null };

const squash = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');
const nameKey = (s: string) => s.toLowerCase().replace(/[^a-z ]/g, ' ').split(/\s+/).filter(Boolean).sort().join(' ');

/** Matches each row to a student: by index number, then admission number, then the same name. */
export function matchNitaRows(rows: readonly NitaUploadRow[], students: readonly NitaStudent[], indexOf: Record<string, string>): NitaMatch[] {
  const byIndex = new Map<string, string>();
  for (const [id, ix] of Object.entries(indexOf)) if (ix) byIndex.set(squash(ix), id);
  const byAdm = new Map(students.filter((s) => s.admissionNo).map((s) => [squash(s.admissionNo), s.id]));
  const byName = new Map<string, string | null>();
  for (const s of students) { const k = nameKey(s.name); byName.set(k, byName.has(k) ? null : s.id); }
  const used = new Set<string>();
  return rows.map((row) => {
    const tries: [NitaMatch['how'], string | null | undefined][] = [
      ['index', row.indexNo ? byIndex.get(squash(row.indexNo)) : null],
      ['admission', row.admissionNo ? byAdm.get(squash(row.admissionNo)) : null],
      ['name', row.name ? byName.get(nameKey(row.name)) : null],
    ];
    for (const [how, id] of tries) if (id && !used.has(id)) { used.add(id); return { row, studentId: id, how }; }
    return { row, studentId: null, how: null };
  });
}

/** The fields a result keeps, without the stamps a saved copy carries. */
export function resultFields(r: NitaResultRecord): Omit<NitaResultRecord, 'orgId' | 'studentId'> {
  const { cohort, releaseId, trade, grade, indexNo, theory, practical, overall, overallSet, certificateNo, issued, issuedOn } = r;
  return { cohort, releaseId, trade, grade, indexNo, theory, practical, overall, overallSet, certificateNo, issued, issuedOn };
}

/** What an uploaded row changes on a student's result. Empty cells keep what is there. */
export function applyUploadRow(cur: NitaResultRecord, row: NitaUploadRow): NitaResultRecord {
  const theory = row.theory ?? cur.theory;
  const practical = row.practical ?? cur.practical;
  const fromPapers = overallFrom(theory, practical);
  const overall = row.overall ?? (row.theory || row.practical ? fromPapers : cur.overall);
  return {
    ...cur, theory, practical, overall, overallSet: !!row.overall && row.overall !== fromPapers,
    indexNo: row.indexNo || cur.indexNo, trade: row.trade || cur.trade, grade: row.grade || cur.grade, certificateNo: row.certificateNo || cur.certificateNo,
  };
}
