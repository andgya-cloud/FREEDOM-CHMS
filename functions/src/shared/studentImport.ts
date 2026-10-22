/**
 * Reading a class list from Excel or CSV: finds the header row, matches each column by its name,
 * and checks every student against the programmes, intakes and people already in ADIA, so the
 * preview can say exactly what will be added, what is new and what is skipped.
 */
import { normalizePhone } from './phone';

export type ImportCell = string | number | Date | null | undefined;

export const IMPORT_FIELDS = ['name', 'admissionNo', 'phone', 'gender', 'programme', 'intake', 'level', 'status', 'startDate', 'sponsorName', 'sponsorPhone', 'sponsorRelation'] as const;
export type ImportField = (typeof IMPORT_FIELDS)[number];

/** The column titles in the template, in order. */
export const IMPORT_TEMPLATE_HEAD = ['Name', 'Admission no', 'Phone', 'Gender', 'Programme', 'Intake', 'Level', 'Status', 'Start date', 'Sponsor name', 'Sponsor phone', 'Sponsor relation'];

/** Other titles people commonly use for the same column (lower case, letters and digits only). */
const ALIASES: Record<ImportField, string[]> = {
  name: ['name', 'fullname', 'studentname', 'student', 'names', 'nameofstudent', 'studentsname'],
  admissionNo: ['admissionno', 'admissionnumber', 'admno', 'adm', 'regno', 'registrationno', 'registrationnumber', 'studentno', 'studentnumber', 'indexno'],
  phone: ['phone', 'phoneno', 'phonenumber', 'mobile', 'mobileno', 'telephone', 'tel', 'contact', 'studentphone'],
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
export function findColumns(rows: readonly (readonly ImportCell[])[]): { headerRow: number; columns: Partial<Record<ImportField, number>> } | null {
  for (let r = 0; r < Math.min(rows.length, 10); r++) {
    const columns: Partial<Record<ImportField, number>> = {};
    (rows[r] ?? []).forEach((cell, c) => {
      const k = key(cell);
      if (!k) return;
      for (const f of IMPORT_FIELDS) if (columns[f] == null && ALIASES[f].includes(k)) { columns[f] = c; break; }
    });
    if (columns.name != null) return { headerRow: r, columns };
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
  /** The row number as Excel shows it. */
  line: number;
  name: string;
  admissionNo: string | null;
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
}

const same = (a: string, b: string) => key(a) === key(b) && key(a) !== '';

/**
 * Checks a sheet against what ADIA already holds. `defaults` fill in a programme or intake the
 * sheet leaves out (a class list for one intake often has no Intake column).
 */
export function planStudentImport(
  rows: readonly (readonly ImportCell[])[],
  have: { courses: readonly ImportCourse[]; intakes: readonly ImportIntake[]; people: readonly ImportPerson[]; students: readonly ImportStudent[] },
  defaults: { programme?: string; intake?: string; startDate: string },
): ImportPlan | null {
  const found = findColumns(rows);
  if (!found) return null;
  const { headerRow, columns } = found;
  const cell = (r: readonly ImportCell[], f: ImportField) => (columns[f] == null ? null : r[columns[f]!]);
  const studentIds = new Set(have.students.map((s) => s.id));
  const admissionNos = new Set(have.students.map((s) => key(s.admissionNo)).filter(Boolean));
  const seenAdm = new Set<string>();
  const seenNames = new Set<string>();
  const out: ImportRow[] = [];
  const newCourses = new Map<string, string>();
  const newIntakes = new Map<string, { courseName: string; name: string }>();

  rows.forEach((r, i) => {
    if (i <= headerRow) return;
    const name = text(cell(r, 'name')).slice(0, 120);
    if (!name && r.every((c) => !text(c))) return;
    const notes: string[] = [];
    const rawPhone = cell(r, 'phone');
    const phone = importPhone(rawPhone);
    const phoneText = typeof rawPhone === 'number' ? String(rawPhone) : text(rawPhone);
    if (phoneText && !phone) notes.push(`phone "${phoneText}" left out`);
    const programme = text(cell(r, 'programme')) || defaults.programme || '';
    const course = have.courses.find((c) => same(c.name, programme) || same(c.id, programme)) ?? null;
    const intake = text(cell(r, 'intake')) || defaults.intake || '';
    const existingIntake = course ? have.intakes.find((x) => x.courseId === course.id && same(x.name, intake)) ?? null : null;
    const st = importStatus(cell(r, 'status'));
    const adm = text(cell(r, 'admissionNo')).slice(0, 40) || null;
    const levelRaw = text(cell(r, 'level')).slice(0, 60);
    const level = course?.levels.find((l) => same(l, levelRaw)) ?? levelRaw;
    const sName = text(cell(r, 'sponsorName')).slice(0, 80);
    const sPhone = importPhone(cell(r, 'sponsorPhone'));
    if (sName && !sPhone) notes.push('sponsor left out: no valid phone');
    const startDate = importDate(cell(r, 'startDate'));
    if (text(cell(r, 'startDate')) && !startDate && !(cell(r, 'startDate') instanceof Date)) notes.push('start date not understood, used the intake start');

    const row: ImportRow = {
      line: i + 1, name, admissionNo: adm, phone, gender: importGender(cell(r, 'gender')),
      programme, courseId: course?.id ?? null, newCourse: !course && !!programme,
      intake, intakeId: existingIntake?.id ?? null, newIntake: !existingIntake && !!intake && !!programme,
      level, status: st?.status ?? 'enrolled', graduated: !!st?.graduated, startDate,
      sponsor: sName && sPhone ? { name: sName, phone: sPhone, relation: text(cell(r, 'sponsorRelation')).slice(0, 40) } : null,
      personId: null, skip: null, notes,
    };
    if (st == null) notes.push(`status "${text(cell(r, 'status'))}" not understood, imported as enrolled`);
    if (st?.graduated) notes.push('graduated: mark on the Graduation page');

    // Someone already in the system: same name and the same phone (or no phone given on either side).
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
    if (!row.skip) {
      if (adm) seenAdm.add(key(adm));
      seenNames.add(dupKey);
      if (row.newCourse) newCourses.set(key(programme), programme);
      if (row.newIntake) newIntakes.set(`${key(programme)}|${key(intake)}`, { courseName: course?.name ?? newCourses.get(key(programme)) ?? programme, name: intake });
    }
    out.push(row);
  });

  const missingColumns = (['programme', 'intake'] as const).filter((f) => columns[f] == null && !defaults[f]).map((f) => (f === 'programme' ? 'Programme' : 'Intake'));
  return { rows: out, ready: out.filter((r) => !r.skip), newCourses: [...newCourses.values()], newIntakes: [...newIntakes.values()], missingColumns };
}
