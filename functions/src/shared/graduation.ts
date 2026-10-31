/**
 * The graduation list (Andy, 2026-10-25): an Excel sheet like ADIA's "Final graduation list", with a
 * heading row (Student name, Adm No., Points, Grade) under each department's name. Students who
 * passed graduate; a Fail stays on the list for the record but does not graduate.
 */
import type { Cell } from './examResults.js';

export interface GraduationRow { row: number; department: string; name: string; admissionNo: string; points: number | null; grade: string; passed: boolean }
export interface GraduationList { rows: GraduationRow[]; problems: string[] }

const key = (v: unknown) => String(v ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');
const text = (v: Cell) => (v instanceof Date ? '' : String(v ?? '').replace(/\s+/g, ' ').trim());
const NAME = ['studentname', 'name', 'fullname', 'student', 'names'];
const ADM = ['admno', 'admissionno', 'admissionnumber', 'regno', 'registrationno', 'studentno', 'adm'];
const POINTS = ['points', 'finalpoints', 'score', 'average', 'marks'];
const GRADE = ['grade', 'finalgrade'];
const find = (ks: string[], names: string[]) => { for (const n of names) { const i = ks.indexOf(n); if (i >= 0) return i; } return -1; };
const tidyGrade = (g: string) => (g ? g[0]!.toUpperCase() + g.slice(1).toLowerCase() : '');

/** Reads every sheet; a row with just one filled cell before or between tables names the department. */
export function parseGraduationList(sheets: { name: string; rows: Cell[][] }[], passMark = 39): GraduationList {
  const rows: GraduationRow[] = [];
  const problems: string[] = [];
  for (const sh of sheets) {
    let department = '';
    let cols: { name: number; adm: number; points: number; grade: number } | null = null;
    sh.rows.forEach((r, i) => {
      const cells = r.map(text);
      const filled = cells.filter(Boolean);
      const ks = r.map(key);
      const name = find(ks, NAME), adm = find(ks, ADM);
      if (name >= 0 && adm >= 0) { cols = { name, adm, points: find(ks, POINTS), grade: find(ks, GRADE) }; return; }
      if (filled.length === 1 && !/^\d/.test(filled[0]!)) {
        // "IT DEPARTMENT", "Hospitality"; the summary table at the end stops the list.
        if (/^summary$/i.test(filled[0]!)) { cols = null; return; }
        department = filled[0]!.replace(/\s*department\s*$/i, '').trim();
        return;
      }
      if (!cols) return;
      const n = cells[cols.name] ?? '', a = (cells[cols.adm] ?? '').replace(/\s+/g, '');
      if (!n && !a) return;
      const pText = cols.points >= 0 ? (cells[cols.points] ?? '').replace(/,/g, '') : '';
      const points = /^\d+(\.\d+)?$/.test(pText) ? Number(pText) : null;
      if (pText && points == null) problems.push(`Row ${i + 1} (${n}): "${pText}" is not a number of points.`);
      const given = tidyGrade(cols.grade >= 0 ? cells[cols.grade] ?? '' : '');
      const passed = given ? given !== 'Fail' : points != null && points >= passMark;
      rows.push({ row: i + 1, department, name: n, admissionNo: a, points, grade: given, passed });
    });
  }
  if (!rows.length) problems.push('No students found. The sheet needs a heading row with Student name and Adm No. (and Points and Grade).');
  return { rows, problems };
}
