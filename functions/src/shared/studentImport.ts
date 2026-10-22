/**
 * Reading a class list from Excel or CSV: finds the header row, matches each column by its name,
 * and checks every student against the programmes, intakes and people already in ADIA, so the
 * preview can say exactly what will be added, what is new and what is skipped.
 */
import { normalizePhone } from './phone.js';

export type ImportCell = string | number | Date | null | undefined;

export const IMPORT_FIELDS = ['name', 'admissionNo', 'idNumber', 'phone', 'gender', 'programme', 'intake', 'level', 'status', 'startDate', 'sponsorName', 'sponsorPhone', 'sponsorRelation'] as const;
export type ImportField = (typeof IMPORT_FIELDS)[number];

/** The column titles in the template, in order. */
export const IMPORT_TEMPLATE_HEAD = ['Name', 'Admission no', 'Phone', 'Gender', 'Programme', 'Intake', 'Level', 'Status', 'Start date', 'Sponsor name', 'Sponsor phone', 'Sponsor relation'];

/** Other titles people commonly use for the same column (lower case, letters and digits only). */
const ALIASES: Record<ImportField, string[]> = {
  name: ['name', 'fullname', 'fullnames', 'studentname', 'student', 'names', 'nameofstudent', 'studentsname'],
  admissionNo: ['admissionno', 'admissionnumber', 'admno', 'adm', 'regno', 'registrationno', 'registrationnumber', 'studentno', 'studentnumber', 'indexno'],
  idNumber: ['id', 'idno', 'idnumber', 'nationalid', 'nationalidno', 'nationalidnumber', 'idpassport', 'birthcertificate', 'birthcertno'],
  phone: ['phone', 'phoneno', 'phonenumber', 'mobile', 'mobileno', 'telephone', 'tel', 'contact', 'contacts', 'studentphone'],
  gender: ['gender', 'sex'],
  programme: ['programme', 'program', 'course', 'faculty', 'department', 'trade', 'coursename', 'programmename'],
  intake: ['intake', 'cohort', 'class', 'intakename', 'stream', 'session'],
  level: ['level', 'year', 'stage', 'module'],
  status: ['status', 'studentstatus'],
  startDate: ['startdate', 'started', 'enrolledon', 'dateenrolled', 'admissiondate', 'dateofadmission', 'joined', 'datejoined'],
  sponsorName: ['sponsorname', 'sponsor', 'guardian', 'guardianname', 'parent', 'parentname', 'nextofkin'],
  sponsorPhone: ['sponsorphone', 'guardianphone', 'parentphone', 'sponsorcontact', 'guardiancontact', 'parentcontact', 'nextofkinphone'],
  sponsorRelation: ['sponsorrelation', 'relation', 'relationship', 'guardianrelation'],
};

const key = (v: unknown) => String(v ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');
const text = (v: ImportCell) => (v instanceof Date ? '' : String(v ?? '').replace(/\s+/g, ' ').trim());

/** Which column holds each field, from the first row (of the first ten) that has a Name column. */
const NAME_PARTS = ['firstname', 'firstnames', 'givenname', 'fname', 'middlename', 'middlenames', 'othernames', 'othername', 'secondname', 'surname', 'lastname', 'familyname', 'lname'];
const NOT_A_NAME = /sponsor|guardian|parent|kin|father|mother|course|programme|program|school|trainer|teacher|file|user/;

/**
 * Which column holds each field, from the first row (of the first ten) that has a name. A name split
 * over columns (First name, Other names, Surname) is joined, and any other title with "name" in it
 * (Names of student, Full names) counts when nothing matches exactly.
 */
export function findColumns(rows: readonly (readonly ImportCell[])[]): { headerRow: number; columns: Partial<Record<ImportField, number>>; nameParts: number[] } | null {
  for (let r = 0; r < Math.min(rows.length, 10); r++) {
    const columns: Partial<Record<ImportField, number>> = {};
    const nameParts: number[] = [];
    const cells = rows[r] ?? [];
    cells.forEach((cell, c) => {
      const k = key(cell);
      if (!k) return;
      if (NAME_PARTS.includes(k)) { nameParts.push(c); return; }
      for (const f of IMPORT_FIELDS) if (columns[f] == null && ALIASES[f].includes(k)) { columns[f] = c; break; }
    });
    if (columns.name == null && nameParts.length === 0) {
      const loose = cells.findIndex((cell) => { const k = key(cell); return k.includes('name') && !NOT_A_NAME.test(k); });
      if (loose >= 0) columns.name = loose;
    }
    if (columns.name != null || nameParts.length > 0) return { headerRow: r, columns, nameParts: columns.name != null ? [] : nameParts };
  }
  return null;
}

/** A date from Excel (a real date or a day number) or text such as 2026-09-01, 1/9/2026 or 01-09-2026 (day first). */
export function importDate(v: ImportCell): string | null {
  const iso = (y: number, m: number, d: number) => {
    const t = new Date(Date.UTC(y, m - 1, d));
    return t.getUTCFullYear() === y && t.getUTCMonth() === m - 1 && t.getUTCDate() === d ? t.toISOString().slice(0, 10) : null;
  };
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? null : iso(v.getUTCFullYear(), v.getUTCMonth() + 1, v.getUTCDate());
  if (typeof v === 'number') return v > 20000 && v < 80000 ? new Date(Date.UTC(1899, 11, 30) + v * 86400000).toISOString().slice(0, 10) : null;
  const s = text(v);
  let m = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/.exec(s);
  if (m) return iso(+m[1]!, +m[2]!, +m[3]!);
  m = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})$/.exec(s);
  if (m) return iso(+m[3]!, +m[2]!, +m[1]!);
  return null;
}

/** Excel often drops a phone number's leading 0 (712345678), so put it back before checking it. */
function importPhone(v: ImportCell): string | null {
  let s = typeof v === 'number' ? String(Math.round(v)) : text(v);
  if (/^[17]\d{8}$/.test(s)) s = `0${s}`;
  return normalizePhone(s);
}

export type ImportStatus = 'enrolled' | 'applicant' | 'deferred' | 'withdrawn';
function importStatus(v: ImportCell): { status: ImportStatus; graduated: boolean } | null {
  const k = key(v);
  if (!k || ['enrolled', 'active', 'current', 'continuing', 'admitted', 'ongoing', 'inprogress'].includes(k)) return { status: 'enrolled', graduated: false };
  if (['graduated', 'completed', 'complete', 'finished', 'alumni', 'alumnus'].includes(k)) return { status: 'enrolled', graduated: true };
  if (['applicant', 'applied', 'pending', 'application'].includes(k)) return { status: 'applicant', graduated: false };
  if (['deferred', 'deferral', 'onhold'].includes(k)) return { status: 'deferred', graduated: false };
  if (['withdrawn', 'dropped', 'droppedout', 'dropout', 'left', 'discontinued'].includes(k)) return { status: 'withdrawn', graduated: false };
  return null;
}

function importGender(v: ImportCell): string | null {
  const k = key(v);
  if (['f', 'female', 'girl', 'woman'].includes(k)) return 'Female';
  if (['m', 'male', 'boy', 'man'].includes(k)) return 'Male';
  return null;
}

export interface ImportCourse { id: string; name: string; levels: string[] }
export interface ImportIntake { id: string; courseId: string; name: string }
export interface ImportPerson { id: string; fullName: string; phone?: string | null }
export interface ImportStudent { id: string; admissionNo?: string | null }

export interface ImportRow {
  /** The worksheet it came from ('' for CSV). */
  sheet: string;
  /** The row number as Excel shows it. */
  line: number;
  name: string;
  admissionNo: string | null;
  /** National ID or birth certificate number, kept in the student's private details. */
  idNumber: string | null;
  phone: string | null;
  gender: string | null;
  programme: string;
  /** An existing programme, or null when it will be added (newCourse). */
  courseId: string | null;
  newCourse: boolean;
  intake: string;
  intakeId: string | null;
  newIntake: boolean;
  level: string;
  status: ImportStatus;
  graduated: boolean;
  startDate: string | null;
  sponsor: { name: string; phone: string; relation: string } | null;
  /** An existing person (not yet a student) who will be enrolled rather than added again. */
  personId: string | null;
  /** Why the row will be left out; null when it will be imported. */
  skip: string | null;
  /** Things that were set aside but don't stop the row (a phone that doesn't look right). */
  notes: string[];
}

export interface ImportPlan {
  rows: ImportRow[];
  ready: ImportRow[];
  newCourses: string[];
  newIntakes: { courseName: string; name: string }[];
  missingColumns: string[];
  /** Each programme name the file uses, and the ADIA programme it goes to (null: added as new). */
  programmes: { key: string; name: string; courseId: string | null; rows: number }[];
  /** Worksheets with no name column, which were left out. */
  sheetsSkipped: string[];
}

const same = (a: string, b: string) => key(a) === key(b) && key(a) !== '';

/** "MAGDALINE NDANU MUTUKU" becomes "Magdaline Ndanu Mutuku"; names already in mixed case are kept. */
export function tidyName(name: string, keepShortWords = false): string {
  if (name !== name.toUpperCase() || !/[A-Z]/.test(name)) return name;
  const t = name.toLowerCase().replace(/(^|[\s'-])([a-z])/g, (_, a: string, b: string) => a + b.toUpperCase());
  // In a programme name a short word in capitals is usually an abbreviation: IT, ICT.
  return keepShortWords ? t.replace(/\b[A-Za-z]{1,3}\b/g, (w) => w.toUpperCase()) : t;
}

/** Words that mean the same programme, so CATERING finds "Food and Beverage Production". */
const PROGRAMME_FAMILIES = [
  ['catering', 'hospitality', 'food', 'beverage', 'culinary', 'cookery'],
  ['it', 'ict', 'computer', 'computers', 'computing', 'technology'],
  ['beauty', 'cosmetology', 'hair', 'hairdressing', 'salon'],
  ['tailoring', 'dressmaking', 'fashion', 'garment'],
];
const words = (v: string) => v.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);

/** The existing programme a name in the file most likely means, or null. */
export function suggestCourse(name: string, courses: readonly ImportCourse[]): ImportCourse | null {
  const exact = courses.find((c) => same(c.name, name) || same(c.id, name));
  if (exact) return exact;
  const w = words(name);
  if (!w.length) return null;
  const contained = courses.filter((c) => w.every((x) => words(c.name).includes(x)));
  if (contained.length === 1) return contained[0]!;
  const fam = PROGRAMME_FAMILIES.find((f) => w.some((x) => f.includes(x)));
  if (!fam) return null;
  const hits = courses.filter((c) => words(c.name).some((x) => fam.includes(x)));
  return hits.length === 1 ? hits[0]! : null;
}

/** A cohort typed as a bare number becomes "Cohort 3"; with none, the number inside an admission no such as ADIA/IT/2025/3/011. */
function intakeName(raw: string, adm: string | null): string {
  if (/^\d{1,2}$/.test(raw)) return `Cohort ${Number(raw)}`;
  if (raw) return raw.slice(0, 80);
  const m = adm ? /\/(?:19|20)\d\d\/(\d{1,2})\/\d+$/.exec(adm) : null;
  return m ? `Cohort ${Number(m[1])}` : '';
}

export interface ImportSheet { name: string; rows: readonly (readonly ImportCell[])[] }

/**
 * Checks every worksheet against what ADIA already holds. `defaults` fill in a programme or intake
 * the file leaves out, and `courseMap` says which ADIA programme each programme name in the file
 * goes to ('' to add it as a new programme); names not in it use the suggested match.
 */
export function planStudentImport(
  input: readonly (readonly ImportCell[])[] | readonly ImportSheet[],
  have: { courses: readonly ImportCourse[]; intakes: readonly ImportIntake[]; people: readonly ImportPerson[]; students: readonly ImportStudent[] },
  defaults: { programme?: string; intake?: string; startDate: string; courseMap?: Record<string, string> },
): ImportPlan | null {
  const sheets: readonly ImportSheet[] = input.length && !Array.isArray(input[0]) ? (input as readonly ImportSheet[]) : [{ name: '', rows: input as readonly (readonly ImportCell[])[] }];
  const studentIds = new Set(have.students.map((s) => s.id));
  const admissionNos = new Set(have.students.map((s) => key(s.admissionNo)).filter(Boolean));
  const seenAdm = new Set<string>();
  const seenNames = new Set<string>();
  const out: ImportRow[] = [];
  const newCourses = new Map<string, string>();
  const newIntakes = new Map<string, { courseName: string; name: string }>();
  const programmes = new Map<string, { key: string; name: string; courseId: string | null; rows: number }>();
  const sheetsSkipped: string[] = [];
  const missing = new Set<string>();
  let anySheet = false;

  const courseFor = (programme: string): ImportCourse | null => {
    const k = key(programme);
    const mapped = defaults.courseMap?.[k];
    if (mapped !== undefined) return mapped ? have.courses.find((c) => c.id === mapped) ?? null : null;
    return suggestCourse(programme, have.courses);
  };

  for (const sheet of sheets) {
    const found = findColumns(sheet.rows);
    if (!found) { if (sheet.rows.some((r) => r.some((c) => text(c)))) sheetsSkipped.push(sheet.name || 'the file'); continue; }
    anySheet = true;
    const { headerRow, columns, nameParts } = found;
    for (const f of ['programme', 'intake'] as const) if (columns[f] == null && !defaults[f] && !(f === 'intake' && columns.admissionNo != null)) missing.add(f === 'programme' ? 'Programme' : 'Intake');
    const cell = (r: readonly ImportCell[], f: ImportField) => (columns[f] == null ? null : r[columns[f]!]);

    sheet.rows.forEach((r, i) => {
      if (i <= headerRow) return;
      const name = tidyName((nameParts.length ? nameParts.map((c) => text(r[c])).filter(Boolean).join(' ') : text(cell(r, 'name'))).slice(0, 120));
      if (!name && r.every((c) => !text(c))) return;
      const notes: string[] = [];
      const rawPhone = cell(r, 'phone');
      const phone = importPhone(rawPhone);
      const phoneText = typeof rawPhone === 'number' ? String(rawPhone) : text(rawPhone);
      if (phoneText && !phone) notes.push(`phone "${phoneText}" left out`);
      const programmeRaw = text(cell(r, 'programme')) || defaults.programme || '';
      const course = programmeRaw ? courseFor(programmeRaw) : null;
      const programme = course?.name ?? tidyName(programmeRaw, true);
      const adm = text(cell(r, 'admissionNo')).replace(/\s+/g, '').slice(0, 40) || null;
      const intake = intakeName(text(cell(r, 'intake')) || defaults.intake?.trim() || '', adm);
      const existingIntake = course ? have.intakes.find((x) => x.courseId === course.id && same(x.name, intake)) ?? null : null;
      const st = importStatus(cell(r, 'status'));
      const levelRaw = text(cell(r, 'level')).slice(0, 60);
      const level = course?.levels.find((l) => same(l, levelRaw)) ?? levelRaw;
      const sName = text(cell(r, 'sponsorName')).slice(0, 80);
      const sPhone = importPhone(cell(r, 'sponsorPhone'));
      if (sName && !sPhone) notes.push('sponsor left out: no valid phone');
      const startDate = importDate(cell(r, 'startDate'));
      if (text(cell(r, 'startDate')) && !startDate && !(cell(r, 'startDate') instanceof Date)) notes.push('start date not understood, used the intake start');

      const row: ImportRow = {
        sheet: sheet.name, line: i + 1, name, admissionNo: adm, idNumber: (typeof cell(r, 'idNumber') === 'number' ? String(cell(r, 'idNumber')) : text(cell(r, 'idNumber'))).replace(/\s+/g, '').slice(0, 40) || null, phone, gender: importGender(cell(r, 'gender')),
        programme, courseId: course?.id ?? null, newCourse: !course && !!programme,
        intake, intakeId: existingIntake?.id ?? null, newIntake: !existingIntake && !!intake && !!programme,
        level, status: st?.status ?? 'enrolled', graduated: !!st?.graduated, startDate,
        sponsor: sName && sPhone ? { name: sName, phone: sPhone, relation: text(cell(r, 'sponsorRelation')).slice(0, 40) } : null,
        personId: null, skip: null, notes,
      };
      if (st == null) notes.push(`status "${text(cell(r, 'status'))}" not understood, imported as enrolled`);
      if (st?.graduated) notes.push('graduated: mark on the Graduation page');

      // Someone already in the system: same name and the same phone (or no phone given).
      const match = have.people.find((p) => same(p.fullName, name) && (phone ? p.phone === phone : true)) ?? null;
      const dupKey = `${key(name)}|${phone ?? ''}`;
      if (name.length < 2) row.skip = 'no name';
      else if (!programme) row.skip = 'no programme';
      else if (!intake) row.skip = 'no intake';
      else if (adm && admissionNos.has(key(adm))) row.skip = `admission no ${adm} is already in ADIA`;
      else if (adm && seenAdm.has(key(adm))) row.skip = `admission no ${adm} appears twice in the file`;
      else if (seenNames.has(dupKey)) row.skip = 'appears twice in the file';
      else if (match && studentIds.has(match.id)) row.skip = 'already a student';
      if (match && !row.skip) row.personId = match.id;
      if (programmeRaw) {
        const k = key(programmeRaw);
        const p = programmes.get(k) ?? { key: k, name: tidyName(programmeRaw, true), courseId: course?.id ?? null, rows: 0 };
        p.rows++;
        programmes.set(k, p);
      }
      if (!row.skip) {
        if (adm) seenAdm.add(key(adm));
        seenNames.add(dupKey);
        if (row.newCourse) newCourses.set(key(programme), programme);
        if (row.newIntake) newIntakes.set(`${key(programme)}|${key(intake)}`, { courseName: programme, name: intake });
      }
      out.push(row);
    });
  }
  if (!anySheet) return null;
  return {
    rows: out, ready: out.filter((r) => !r.skip), newCourses: [...newCourses.values()], newIntakes: [...newIntakes.values()],
    missingColumns: [...missing], programmes: [...programmes.values()], sheetsSkipped,
  };
}
