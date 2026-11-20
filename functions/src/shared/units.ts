/**
 * ADIA's units (Andy, 2026-11-20, 1A-15A): the SEMESTER UNITS list and the Cohort 2 transcripts set each
 * department's units per semester, with a code, Theory or Practical, a credit and hours. The units list is
 * the master; semester points are each unit's mark weighted by its credit; common units belong to one
 * semester each. Kept in examSettings.units once the principal saves it; until then ADIA_UNITS below.
 */
import { standardCourse } from './commonCourses.js';

export const UNIT_DEPTS = ['it', 'fashion', 'hospitality', 'cosmetology'] as const;
export type UnitDept = (typeof UNIT_DEPTS)[number];
/** The departments as the documents name them (Andy, 13A). */
export const UNIT_DEPT_NAMES: Record<UnitDept, string> = {
  it: 'Information Technology', fashion: 'Fashion & Design', hospitality: 'Hospitality', cosmetology: 'Cosmetology',
};

export const UNIT_KINDS = ['theory', 'practical', 'unit', 'attachment'] as const;
export type UnitKind = (typeof UNIT_KINDS)[number];
export const UNIT_KIND_LABELS: Record<UnitKind, string> = { theory: 'Theory', practical: 'Practical', unit: '–', attachment: 'Attachment' };

export interface UnitItem {
  code: string;
  name: string;
  kind: UnitKind;
  /** A department's own unit, or 'common' for a unit the departments share. */
  dept: UnitDept | 'common';
  semester: 1 | 2;
  /** Credit factor from the transcript; null until someone fills it in. */
  credit: number | null;
  hours: number | null;
  /** A common unit only these departments take (SBM 101: Hospitality). */
  only?: UnitDept[];
  /** A common unit these departments do not take (ICT 102: not IT). */
  skip?: UnitDept[];
}

const u = (code: string, name: string, kind: UnitKind, dept: UnitItem['dept'], semester: 1 | 2, credit: number | null, extra: Partial<UnitItem> = {}): UnitItem =>
  ({ code, name, kind, dept, semester, credit, hours: null, ...extra });

/** From the SEMESTER UNITS list, with credits from the Cohort 2 transcripts. */
export const ADIA_UNITS: UnitItem[] = [
  u('ICT 102', 'Information, Communication & Technology', 'unit', 'common', 1, 0.7, { skip: ['it'] }),
  u('COM 100', 'Communication Skills', 'unit', 'common', 1, 0.3),
  u('SBM 100', 'Simple Basic Mathematics I', 'unit', 'common', 1, 0.3),
  u('AFLT 100', 'Leadership Skills I', 'unit', 'common', 1, 0.3),
  u('BUS 100', 'Business Skills', 'unit', 'common', 2, 0.2),
  u('LIF 100', 'Life Skills', 'unit', 'common', 2, 0.2),
  u('CCT 100', 'Creative & Critical Thinking', 'unit', 'common', 2, 0.3),
  u('AFLT 101', 'Leadership Skills II', 'unit', 'common', 2, 0.3),
  u('SBM 101', 'Simple Basic Mathematics II', 'unit', 'common', 2, 0.3, { only: ['hospitality'] }),

  u('COP 101', 'Basic Computer Operation and File Management', 'unit', 'it', 1, null),
  u('COP 102', 'Word Processing', 'unit', 'it', 1, null),
  u('COP 103', 'Spreadsheets', 'unit', 'it', 1, null),
  u('COP 104', 'Presentation', 'unit', 'it', 1, null),
  u('COP 105', 'Operating System', 'unit', 'it', 1, null),
  u('COP 106', 'Fundamentals of Computing', 'unit', 'it', 1, null),
  u('COP 107', 'Database Management System', 'unit', 'it', 2, null),
  u('COP 108', 'Desktop Publishing / Graphic Design', 'unit', 'it', 2, null),
  u('COP 109', 'Internet and Web Design', 'unit', 'it', 2, null),
  u('COP 201', 'Multimedia Operations', 'unit', 'it', 2, null),
  u('ATT 100', 'Industrial Attachment', 'attachment', 'it', 2, 20, { hours: 250 }),

  u('DRS 100', 'Dress Making', 'theory', 'fashion', 1, 1.4),
  u('DRS 102', 'Dress Making', 'practical', 'fashion', 1, 12.1),
  u('DRS 103', 'Dress Making', 'theory', 'fashion', 2, 1.4),
  u('DRS 104', 'Dress Making', 'practical', 'fashion', 2, 12.1),
  u('TLF 101', 'Tailoring', 'theory', 'fashion', 2, null),
  u('TLF 102', 'Tailoring', 'practical', 'fashion', 2, null),
  u('DRS 101', 'Sample Work', 'unit', 'fashion', 2, 0.2),
  u('ATT 100', 'Industrial Attachment', 'attachment', 'fashion', 2, 20, { hours: 250 }),

  u('FBP 100', 'Food and Beverage Production', 'theory', 'hospitality', 1, 1.4),
  u('FBP 101', 'Food and Beverage Production', 'practical', 'hospitality', 1, 5.4),
  u('FBSS 103', 'Food and Beverage Sales & Service', 'theory', 'hospitality', 1, 0.9),
  u('FBSS 102', 'Food and Beverage Sales & Service', 'practical', 'hospitality', 1, 7.6),
  u('FBP 101', 'Food and Beverage Production', 'theory', 'hospitality', 2, 1.4),
  u('FBP 102', 'Food and Beverage Production', 'practical', 'hospitality', 2, 5.4),
  u('FBSS 101', 'Food and Beverage Sales & Service', 'theory', 'hospitality', 2, 0.9),
  u('FBSS 100', 'Food and Beverage Sales & Service', 'practical', 'hospitality', 2, 7.6),
  u('ATT 100', 'Industrial Attachment', 'attachment', 'hospitality', 2, 25, { hours: 250 }),
];

/** Semester hours from the Cohort 2 transcripts. */
export const ADIA_SEMESTER_HOURS: Record<UnitDept, { 1: number | null; 2: number | null }> = {
  it: { 1: 170, 2: 370 }, fashion: { 1: 145, 2: 345 }, hospitality: { 1: 334, 2: 335 }, cosmetology: { 1: null, 2: null },
};

/** The common course (on the timetable and attendance) each common unit is. */
const COMMON_COURSE_OF: Record<string, string> = {
  'ICT 102': 'ICT Skills', 'COM 100': 'Communication', 'SBM 100': 'Basic Mathematics', 'SBM 101': 'Basic Mathematics',
  'AFLT 100': 'Leadership', 'AFLT 101': 'Leadership', 'BUS 100': 'Business Skills', 'BUS 101': 'Business Skills',
  'LIF 100': 'Life Skills', 'CCT 100': 'Critical Thinking',
};
export const commonCourseOfUnit = (code: string) => COMMON_COURSE_OF[normCode(code)] ?? null;

/** "cop101", "COP-101" and "COP 101" are the same code. */
export function normCode(code: string): string {
  const m = /^([A-Za-z]{2,5})[\s\-_/]*(\d{2,4})$/.exec(code.trim());
  return m ? `${m[1]!.toUpperCase()} ${m[2]}` : code.trim().toUpperCase().replace(/\s+/g, ' ');
}
/** A unit's identity: the same code can be in both semesters (FBP 101 in Hospitality). */
export const unitKey = (x: Pick<UnitItem, 'dept' | 'semester' | 'code'>) => `${x.dept}|${x.semester}|${normCode(x.code)}`;

/** "Dress Making (Theory)", "Communication Skills". */
export const unitLabel = (x: Pick<UnitItem, 'name' | 'kind'>) => (x.kind === 'theory' || x.kind === 'practical' ? `${x.name} (${UNIT_KIND_LABELS[x.kind]})` : x.name);
/** "DRS 100 · Dress Making (Theory)". */
export const unitTitle = (x: Pick<UnitItem, 'code' | 'name' | 'kind'>) => `${x.code} · ${unitLabel(x)}`;

/** The saved units, or ADIA's units from the documents until the principal saves them. */
export function unitsWithDefaults(saved: unknown): UnitItem[] {
  if (!Array.isArray(saved) || !saved.length) return ADIA_UNITS;
  return saved.filter((x): x is UnitItem => !!x && typeof x === 'object' && typeof (x as UnitItem).code === 'string' && typeof (x as UnitItem).name === 'string');
}
export function semesterHoursWithDefaults(saved: unknown): Record<UnitDept, { 1: number | null; 2: number | null }> {
  const out = { ...ADIA_SEMESTER_HOURS };
  if (saved && typeof saved === 'object') {
    for (const d of UNIT_DEPTS) {
      const v = (saved as Record<string, { 1?: unknown; 2?: unknown }>)[d];
      if (v && typeof v === 'object') out[d] = { 1: typeof v[1] === 'number' ? v[1] : null, 2: typeof v[2] === 'number' ? v[2] : null };
    }
  }
  return out;
}

/** The units-list department an app department (course) is, by its name: "ICT" is Information Technology. */
export function guessUnitDept(courseName: string): UnitDept | null {
  const n = courseName.toLowerCase();
  if (/cosmet|beauty|hair/.test(n)) return 'cosmetology';
  if (/hospitality|food|catering|beverage|culinary|cook/.test(n)) return 'hospitality';
  if (/fashion|dress|tailor|garment/.test(n)) return 'fashion';
  if (/\b(it|ict|computer|computing|information)\b/.test(n)) return 'it';
  return null;
}
/** The principal's choice first (examSettings.unitDepartments), else the guess from the name. */
export function unitDeptOf(courseId: string | null | undefined, courseName: string, chosen?: Record<string, string> | null): UnitDept | null {
  if (!courseId) return null;
  const c = chosen?.[courseId];
  if (c === 'none') return null;
  if (c && (UNIT_DEPTS as readonly string[]).includes(c)) return c as UnitDept;
  return guessUnitDept(courseName);
}

/** Whether a department takes a unit. */
export function takesUnit(unit: UnitItem, dept: UnitDept | null): boolean {
  if (unit.dept !== 'common') return unit.dept === dept;
  if (dept && unit.only?.length && !unit.only.includes(dept)) return false;
  if (dept && unit.skip?.includes(dept)) return false;
  // A student whose department is not on the list takes the common units that everyone takes.
  if (!dept && unit.only?.length) return false;
  return true;
}

/** A department's units for a semester: its own first, then the common ones, as on the units list. */
export function unitsFor(units: readonly UnitItem[], dept: UnitDept | null, semester: 1 | 2): UnitItem[] {
  return [...units.filter((x) => x.dept !== 'common' && x.dept === dept && x.semester === semester), ...units.filter((x) => x.dept === 'common' && x.semester === semester && takesUnit(x, dept))];
}

const words = (s: string) => s.toLowerCase().replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, ' ').trim();
const CODE_IN_NAME = /\b([A-Za-z]{3,4})[\s-]?(\d{3})\b/;

export interface SheetForUnit { courseId: string | null; courseName: string; semester?: number | null; unitCode?: string | null }
export interface UnitMatch { unit: UnitItem; how: 'code' | 'name' }

/**
 * Which unit a marks sheet is: the unit chosen for it (unitCode), a code in its name ("COP 101 Word
 * Processing"), the common course it is ("Leadership" in Semester 2 is AFLT 101), or its name ("Dress
 * Making Theory"). A department sheet is looked for in its department; a common sheet among the common
 * units. Null when nothing fits, or more than one does.
 */
export function matchUnit(sheet: SheetForUnit, dept: UnitDept | null, units: readonly UnitItem[]): UnitMatch | null {
  const pool = sheet.courseId == null ? units.filter((x) => x.dept === 'common') : units.filter((x) => x.dept === dept);
  if (!pool.length) return null;
  const sem = sheet.semester === 1 || sheet.semester === 2 ? sheet.semester : null;
  const best = (list: UnitItem[]) => {
    if (list.length <= 1) return list[0] ?? null;
    const here = list.filter((x) => x.semester === sem);
    return here.length === 1 ? here[0]! : null;
  };
  const byCode = (code: string) => best(pool.filter((x) => normCode(x.code) === normCode(code)));
  if (sheet.unitCode) {
    const hit = byCode(sheet.unitCode);
    if (hit) return { unit: hit, how: 'code' };
  }
  const m = CODE_IN_NAME.exec(sheet.courseName);
  if (m) {
    const hit = byCode(`${m[1]} ${m[2]}`);
    if (hit) return { unit: hit, how: 'code' };
  }
  if (sheet.courseId == null) {
    const std = standardCourse(sheet.courseName)?.name;
    if (std) {
      const hit = best(pool.filter((x) => commonCourseOfUnit(x.code) === std));
      if (hit) return { unit: hit, how: 'name' };
    }
  }
  const name = words(sheet.courseName);
  const kind: UnitKind | null = /\btheory\b/.test(name) ? 'theory' : /\bpractical/.test(name) ? 'practical' : null;
  const bare = name.replace(/\b(theory|practicals?)\b/g, ' ').replace(/\s+/g, ' ').trim();
  const named = pool.filter((x) => words(x.name) === bare || words(unitLabel(x)) === name);
  const hit = best(kind ? named.filter((x) => x.kind === kind) : named);
  return hit ? { unit: hit, how: 'name' } : null;
}

/* ---------- semester points ---------- */

export interface CreditLine { value: number; credit: number | null }
/**
 * Credit-weighted points (Andy, 4A): Σ mark × credit ÷ Σ credit, to 2 decimals. While any unit has no
 * credit yet, the plain average, and `missing` says how many need one.
 */
export function creditPoints(lines: readonly CreditLine[]): { points: number | null; weighted: boolean; missing: number } {
  if (!lines.length) return { points: null, weighted: false, missing: 0 };
  const missing = lines.filter((l) => !(typeof l.credit === 'number' && l.credit > 0)).length;
  const r2 = (n: number) => Math.round(n * 100) / 100;
  if (missing) return { points: r2(lines.reduce((a, l) => a + l.value, 0) / lines.length), weighted: false, missing };
  const sum = lines.reduce((a, l) => a + l.credit!, 0);
  return { points: r2(lines.reduce((a, l) => a + l.value * l.credit!, 0) / sum), weighted: true, missing: 0 };
}

/**
 * What the marks pages need to know about units: the unit each sheet is for a student's department,
 * its credit, and whether it counts for that department (SBM 101 counts for Hospitality only).
 */
export interface UnitContext {
  unitOf(sheet: SheetForUnit, studentCourseId: string): UnitItem | null;
  creditOf(sheet: SheetForUnit, studentCourseId: string): number | null;
  counts(sheet: SheetForUnit, studentCourseId: string): boolean;
}
export function unitContext(units: readonly UnitItem[], deptOf: (courseId: string) => UnitDept | null): UnitContext {
  const cache = new Map<string, UnitItem | null>();
  const unitOf = (sheet: SheetForUnit, courseId: string) => {
    const dept = deptOf(sheet.courseId ?? courseId);
    const k = `${sheet.courseId ?? ''}|${sheet.courseName}|${sheet.semester ?? ''}|${sheet.unitCode ?? ''}|${dept ?? ''}`;
    if (!cache.has(k)) cache.set(k, matchUnit(sheet, dept, units)?.unit ?? null);
    return cache.get(k)!;
  };
  return {
    unitOf,
    creditOf: (sheet, courseId) => unitOf(sheet, courseId)?.credit ?? null,
    counts: (sheet, courseId) => {
      const unit = unitOf(sheet, courseId);
      // A sheet not on the units list still counts, as before; the Units page lists it.
      return !unit || takesUnit(unit, deptOf(courseId));
    },
  };
}

/* ---------- marks sheets that don't fit ---------- */

export type FitProblem =
  | { kind: 'unmatched' }
  | { kind: 'semester'; unit: UnitItem; to: 1 | 2 }
  | { kind: 'duplicate'; unit: UnitItem };
export interface FitSheet extends SheetForUnit { id: string; hasMarks: boolean; deletedAt?: unknown }

/**
 * A cohort's marks sheets against the units list (Andy, 6A): a common course in the wrong semester
 * (Business Skills in Semester 1 is BUS 100, Semester 2), the same unit twice (Communication in both
 * semesters), and sheets that are no unit at all. Names stay as they are: "Leadership" in Semester 1 is
 * Leadership Skills I by its semester, and documents print the unit's name.
 */
export function sheetsThatDontFit(sheets: readonly FitSheet[], units: readonly UnitItem[], deptOf: (courseId: string) => UnitDept | null): { sheet: FitSheet; problem: FitProblem }[] {
  const live = sheets.filter((s) => !s.deletedAt);
  const out: { sheet: FitSheet; problem: FitProblem }[] = [];
  const taken = new Map<string, FitSheet>();
  const matches = live.map((s) => {
    const dept = s.courseId == null ? null : deptOf(s.courseId);
    // A department not on the units list (Cosmetology until its units come) keeps its own courses.
    if (s.courseId != null && (!dept || !units.some((x) => x.dept === dept))) return { s, unit: null as UnitItem | null, skip: true };
    // Common sheets match with any semester; the unit says which one it belongs to.
    const unit = matchUnit(s, dept, units)?.unit ?? null;
    return { s, unit, skip: false };
  });
  // Sheets already in the right semester claim their unit first, so the stray copy is the one listed.
  const order = [...matches].sort((a, b) => Number(!!a.unit && a.unit.semester !== a.s.semester) - Number(!!b.unit && b.unit.semester !== b.s.semester) || Number(b.s.hasMarks) - Number(a.s.hasMarks));
  for (const m of order) {
    if (m.skip) continue;
    if (!m.unit) { out.push({ sheet: m.s, problem: { kind: 'unmatched' } }); continue; }
    const k = `${m.s.courseId ?? 'common'}|${unitKey(m.unit)}`;
    if (taken.has(k)) { out.push({ sheet: m.s, problem: { kind: 'duplicate', unit: m.unit } }); continue; }
    taken.set(k, m.s);
    if (m.s.semester !== m.unit.semester) out.push({ sheet: m.s, problem: { kind: 'semester', unit: m.unit, to: m.unit.semester } });
  }
  return out;
}

/** The units a cohort has no marks sheet for yet, per app department (and the common ones once). */
export function unitsMissing(sheets: readonly SheetForUnit[], units: readonly UnitItem[], departments: readonly { id: string; dept: UnitDept | null }[]): { courseId: string | null; unit: UnitItem }[] {
  const have = new Set<string>();
  for (const s of sheets as (SheetForUnit & { deletedAt?: unknown })[]) {
    if (s.deletedAt) continue;
    const dept = s.courseId == null ? null : departments.find((d) => d.id === s.courseId)?.dept ?? null;
    const hit = matchUnit(s, dept, units)?.unit;
    if (hit) have.add(`${s.courseId ?? 'common'}|${unitKey(hit)}`);
  }
  const out: { courseId: string | null; unit: UnitItem }[] = [];
  for (const d of departments) {
    if (!d.dept) continue;
    for (const x of units) if (x.dept === d.dept && !have.has(`${d.id}|${unitKey(x)}`)) out.push({ courseId: d.id, unit: x });
  }
  const anyDept = departments.some((d) => d.dept && units.some((x) => x.dept === d.dept));
  if (anyDept) for (const x of units) if (x.dept === 'common' && !have.has(`common|${unitKey(x)}`)) out.push({ courseId: null, unit: x });
  return out;
}

/** Why a unit can't be saved, or null. */
export function unitProblem(x: UnitItem, all: readonly UnitItem[]): string | null {
  if (!/^[A-Za-z]{2,5} ?\d{2,4}$/.test(x.code.trim())) return `"${x.code}" is not a unit code like COP 101.`;
  if (!x.name.trim()) return 'Type the unit name.';
  if (x.credit != null && !(x.credit > 0 && x.credit <= 100)) return `${x.code}: the credit must be more than 0 and at most 100.`;
  if (x.hours != null && !(x.hours >= 0 && x.hours <= 2000)) return `${x.code}: hours must be from 0 to 2000.`;
  if (all.filter((y) => unitKey(y) === unitKey(x)).length > 1) return `${x.code} is in ${x.dept === 'common' ? 'the common units' : UNIT_DEPT_NAMES[x.dept as UnitDept]} Semester ${x.semester} twice.`;
  return null;
}

/** The unit context from the exam settings, with each app department's name to guess its units-list department. */
export function settingsUnitContext(s: { units?: unknown; unitDepartments?: Record<string, string> | null }, courseName: (id: string) => string): UnitContext {
  const units = unitsWithDefaults(s.units);
  return unitContext(units, (id) => unitDeptOf(id, courseName(id), s.unitDepartments));
}
