import { describe, expect, it } from 'vitest';
import {
  admissionNumber, arrearsList, buildSchoolReport, attendanceAlerts, capacityOf, certificateSerial, collectionRate, DEFAULT_SCHOOL_SETTINGS as S,
  feeBalance, gradeFor, invoiceTotal, lastSchoolWeek, oldestUnpaidDue, outcomeDueDate, overallResult, schoolMetrics, studentAttendance, studentResults,
  unitResult, withDefaults, type Assessment, type Course, type Mark, type Student,
} from './school.js';

const course: Course = {
  id: 'ict', name: 'ICT', levels: ['Level 1'], timetable: [],
  units: [{ id: 'web', name: 'Web design', level: 'Level 1', trainer: 'Mr Otieno' }, { id: 'net', name: 'Networking', level: 'Level 1', trainer: 'Ms Achieng' }],
};
const student = (id: string, over: Partial<Student> = {}): Student => ({ id, courseId: 'ict', intakeId: 'jan', level: 'Level 1', status: 'enrolled', ...over });

describe('numbers and grades', () => {
  it('formats admission numbers and certificate serials', () => {
    expect(admissionNumber('ADIA', 2026, 42)).toBe('ADIA/2026/0042');
    expect(certificateSerial('ADIA', 2026, 7)).toBe('ADIA-CERT-2026-0007');
  });
  it('grades by the highest band reached, with an editable scale', () => {
    expect(gradeFor(80, S.gradingScale)).toBe('Distinction');
    expect(gradeFor(79.9, S.gradingScale)).toBe('Credit');
    expect(gradeFor(10, S.gradingScale)).toBe('Fail');
    expect(gradeFor(70, [{ min: 70, grade: 'A' }, { min: 0, grade: 'B' }])).toBe('A');
    expect(withDefaults({ gradingScale: [{ min: 0, grade: 'F' }, { min: 90, grade: 'A' }] }).gradingScale[0]!.grade).toBe('A');
  });
});

describe('intake capacity', () => {
  it('counts enrolled and applicant students and flags a full intake', () => {
    const list = [student('a'), student('b', { status: 'applicant' }), student('c', { status: 'withdrawn' }), student('d', { intakeId: 'may' })];
    expect(capacityOf({ id: 'jan', capacity: 3 }, list)).toEqual({ taken: 2, free: 1, full: false });
    expect(capacityOf({ id: 'jan', capacity: 2 }, list).full).toBe(true);
    expect(capacityOf({ id: 'jan', capacity: null }, list)).toMatchObject({ free: null, full: false });
  });
});

describe('attendance', () => {
  const events = ['2026-10-05', '2026-10-06', '2026-10-07', '2026-10-08'].map((date, i) => ({ id: `e${i}`, date, name: 'ICT', activity: 'ICT' }));
  const rec = (personId: string, eventId: string, status = 'present') => ({ personId, eventId, status });
  const records = [
    ...['e0', 'e1', 'e2', 'e3'].map((e) => rec('a', e)),
    rec('b', 'e0'), rec('b', 'e1', 'absent'), rec('b', 'e2', 'late'), rec('b', 'e3', 'excused'),
    rec('c', 'e0'), // c was not on the later registers
  ];
  it('is attended over held, counting late as attended and excused as not', () => {
    expect(studentAttendance('a', 'ICT', events, records)).toEqual({ held: 4, attended: 4, percent: 100 });
    expect(studentAttendance('b', 'ICT', events, records)).toEqual({ held: 4, attended: 2, percent: 50 });
    expect(studentAttendance('c', 'ICT', events, records).percent).toBe(25);
  });
  it('ignores classes with no register and classes before the student started', () => {
    const extra = [...events, { id: 'e9', date: '2026-10-09', name: 'ICT', activity: 'ICT' }];
    expect(studentAttendance('a', 'ICT', extra, records).held).toBe(4);
    expect(studentAttendance('a', 'ICT', events, records, '2026-10-07').held).toBe(2);
  });
  it('lists enrolled students under the threshold, lowest first, needing 3 classes held', () => {
    const students = [student('a'), student('b'), student('c'), student('d', { status: 'withdrawn' })];
    expect(attendanceAlerts(students, [course], events, records, 75).map((x) => [x.studentId, x.percent])).toEqual([['c', 25], ['b', 50]]);
    expect(attendanceAlerts(students, [course], events.slice(0, 2), records, 75)).toEqual([]);
  });
});

describe('results', () => {
  const assessments: Assessment[] = [
    { id: 'w1', courseId: 'ict', unitId: 'web', type: 'continuous', name: 'CAT 1', maxMarks: 20, date: '2026-10-01' },
    { id: 'w2', courseId: 'ict', unitId: 'web', type: 'exam', name: 'Exam', maxMarks: 100, date: '2026-10-20' },
    { id: 'n1', courseId: 'ict', unitId: 'net', type: 'practical', name: 'Lab', maxMarks: 50, date: '2026-10-02' },
  ];
  const marks: Mark[] = [
    { assessmentId: 'w1', studentId: 'a', marks: 18 }, { assessmentId: 'w2', studentId: 'a', marks: 70 },
    { assessmentId: 'n1', studentId: 'a', marks: 20 },
    { assessmentId: 'w1', studentId: 'b', marks: 10 },
  ];
  it('weights each type by the settings', () => {
    // continuous 90% x30 + exam 70% x40 = (2700+2800)/70 = 78.6
    expect(unitResult(course.units[0]!, 'a', assessments, marks, S)).toMatchObject({ percent: 78.6, grade: 'Credit', passed: true, assessed: 2 });
  });
  it('scales the weights when a type has no marks yet', () => {
    expect(unitResult(course.units[0]!, 'b', assessments, marks, S)).toMatchObject({ percent: 50, passed: true });
    expect(unitResult(course.units[0]!, 'zed', assessments, marks, S)).toMatchObject({ percent: null, grade: null, passed: null });
  });
  it('fails a unit under the pass mark, and caps a mark above the maximum at 100%', () => {
    expect(unitResult(course.units[1]!, 'a', assessments, marks, S)).toMatchObject({ percent: 40, grade: 'Fail', passed: false });
    const over: Mark[] = [{ assessmentId: 'w1', studentId: 'x', marks: 40 }];
    expect(unitResult(course.units[0]!, 'x', assessments, over, S).percent).toBe(100);
  });
  it('gives an overall result across assessed units and filters units by level', () => {
    const r = studentResults(course, 'Level 1', 'a', assessments, marks, S);
    expect(overallResult(r, S)).toMatchObject({ percent: 59.3, grade: 'Pass', passedUnits: 1, assessedUnits: 2 });
    expect(studentResults({ ...course, units: [...course.units, { id: 'l2', name: 'Level 2 unit', level: 'Level 2', trainer: '' }] }, 'Level 1', 'a', assessments, marks, S)).toHaveLength(2);
    expect(overallResult([], S).percent).toBeNull();
  });
});

describe('fees', () => {
  const invoices = [
    { id: 'i1', studentId: 'a', items: [], totalCents: 3_000_000, dueDate: '2026-10-01', label: 'Term 1', status: 'open' as const },
    { id: 'i2', studentId: 'a', items: [], totalCents: 500_000, dueDate: null, label: 'Kit', status: 'void' as const },
    { id: 'i3', studentId: 'b', items: [], totalCents: 3_000_000, dueDate: '2026-12-01', label: 'Term 1', status: 'open' as const },
  ];
  const payments = [
    { personId: 'a', amountCents: 1_000_000, status: 'confirmed' },
    { personId: 'a', amountCents: 999, status: 'void' },
    { personId: 'a', amountCents: 5, status: 'confirmed', fundId: 'tithes' },
    { personId: 'b', amountCents: 3_500_000, status: 'confirmed' },
  ];
  it('is billed minus paid, ignoring void invoices, void gifts and other funds', () => {
    expect(feeBalance('a', invoices, payments)).toEqual({ billedCents: 3_000_000, paidCents: 1_000_000, balanceCents: 2_000_000 });
    expect(feeBalance('b', invoices, payments).balanceCents).toBe(-500_000);
  });
  it('totals invoice items', () => expect(invoiceTotal([{ name: 'Tuition', amountCents: 100 }, { name: 'Kit', amountCents: 50 }])).toBe(150));
  it('lists arrears, largest first, with overdue marked', () => {
    const rows = [
      { studentId: 'a', billedCents: 0, paidCents: 0, balanceCents: 2_000_000, oldestDue: '2026-10-01' },
      { studentId: 'b', billedCents: 0, paidCents: 0, balanceCents: -5, oldestDue: null },
      { studentId: 'c', billedCents: 0, paidCents: 0, balanceCents: 3_000_000, oldestDue: '2026-12-01' },
    ];
    expect(arrearsList(rows, '2026-10-18')).toEqual([{ studentId: 'c', balanceCents: 3_000_000, overdue: false }, { studentId: 'a', balanceCents: 2_000_000, overdue: true }]);
  });
  it('collection rate caps at 100 and is null with nothing billed', () => {
    expect(collectionRate(1000, 250)).toBe(25);
    expect(collectionRate(1000, 5000)).toBe(100);
    expect(collectionRate(0, 0)).toBeNull();
  });
});

describe('oldest unpaid invoice', () => {
  const inv = (id: string, total: number, dueDate: string | null, status: 'open' | 'void' = 'open') => ({ id, studentId: 'a', items: [], totalCents: total, dueDate, label: id, status });
  it('applies payments to the oldest invoice first', () => {
    const list = [inv('t2', 100, '2026-12-01'), inv('t1', 100, '2026-09-01'), inv('v', 999, '2026-01-01', 'void')];
    expect(oldestUnpaidDue(list, 0)).toBe('2026-09-01');
    expect(oldestUnpaidDue(list, 100)).toBe('2026-12-01');
    expect(oldestUnpaidDue(list, 250)).toBeNull();
  });
});

describe('graduation outcomes', () => {
  it('adds whole months and clamps to the end of a shorter month', () => {
    expect(outcomeDueDate('2026-11-30', 3)).toBe('2027-02-28');
    expect(outcomeDueDate('2026-08-31', 6)).toBe('2027-02-28');
    expect(outcomeDueDate('2026-12-15', 12)).toBe('2027-12-15');
    expect(outcomeDueDate('2026-10-18', 3)).toBe('2027-01-18');
  });
});

describe('school metrics', () => {
  const students = [student('a'), student('b'), student('g', { status: 'graduated' }), student('w', { status: 'withdrawn' }), student('x', { status: 'applicant' })];
  const events = ['e0', 'e1', 'e2'].map((id, i) => ({ id, date: `2026-10-0${i + 5}`, name: 'ICT', activity: 'ICT' }));
  const records = [...['e0', 'e1', 'e2'].map((e) => ({ personId: 'a', eventId: e, status: 'present' })), { personId: 'b', eventId: 'e0', status: 'present' }];
  const m = schoolMetrics({
    courses: [course], students, events, records, assessments: [], marks: [],
    invoices: [{ id: 'i', studentId: 'a', items: [], totalCents: 100_000, dueDate: null, label: 'T1', status: 'open' }],
    payments: [{ personId: 'a', amountCents: 40_000, status: 'confirmed', date: '2026-10-06' }],
    outcomes: [{ studentId: 'g', months: 6, status: 'employed' }, { studentId: 'h', months: 6, status: 'seeking' }, { studentId: 'u', months: 6, status: 'unreachable' }],
    settings: S,
  });
  it('counts enrolment, retention, graduation and the trainer ratio', () => {
    expect(m.enrolled).toBe(2);
    expect(m.withdrawn).toBe(1);
    expect(m.retentionRate).toBe(75); // 3 of the 4 who started are still enrolled or graduated
    expect(m.graduationRate).toBe(25);
    expect(m.byCourse[0]).toMatchObject({ enrolled: 2, trainers: 2, ratio: 1 });
  });
  it('works out attendance, fees and employment', () => {
    expect(m.attendanceRate).toBe(67); // 4 of 6 student-classes
    expect(m.billedCents).toBe(100_000);
    expect(m.arrearsCents).toBe(60_000);
    expect(m.collectionRate).toBe(40);
    expect(m.employmentRate).toBe(50); // unreachable people are left out
    expect(m.belowThreshold).toBe(1); // b: 1 of 3
  });
  it('limits attendance and payments to a period', () => {
    const p = schoolMetrics({ courses: [course], students, events, records, assessments: [], marks: [], invoices: [], payments: [{ personId: 'a', amountCents: 40_000, status: 'confirmed', date: '2026-10-06' }, { personId: 'a', amountCents: 10_000, status: 'confirmed', date: '2026-09-01' }], outcomes: [], settings: S }, { from: '2026-10-05', to: '2026-10-05' });
    expect(p.attendanceRate).toBe(100);
    expect(p.paidCents).toBe(0); // 2026-10-06 is outside the one-day period
    expect(p.employmentRate).toBeNull();
  });
});

describe('school week', () => {
  it('is the Monday-to-Sunday week before today', () => {
    expect(lastSchoolWeek('2026-10-19')).toEqual({ from: '2026-10-12', to: '2026-10-18' });
    expect(lastSchoolWeek('2026-10-21')).toEqual({ from: '2026-10-12', to: '2026-10-18' });
    expect(lastSchoolWeek('2026-10-18')).toEqual({ from: '2026-10-05', to: '2026-10-11' });
  });
});

describe('school report', () => {
  const students = [student('a'), student('b')];
  const events = ['e0', 'e1', 'e2'].map((id, i) => ({ id, date: `2026-10-0${i + 5}`, name: 'ICT', activity: 'ICT' }));
  const records = [...['e0', 'e1', 'e2'].map((e) => ({ personId: 'a', eventId: e, status: 'present' })), { personId: 'b', eventId: 'e0', status: 'present' }];
  const report = buildSchoolReport({
    courses: [course], students, events, records, assessments: [], marks: [],
    invoices: [{ id: 'i', studentId: 'b', items: [], totalCents: 500, dueDate: '2026-10-01', label: 'T1', status: 'open' }],
    payments: [], outcomes: [], settings: S,
    dueOutcomes: [{ studentId: 'a', months: 3, due: '2026-10-10', status: null }, { studentId: 'a', months: 6, due: '2027-01-10', status: null }, { studentId: 'a', months: 12, due: '2026-10-01', status: 'employed' }],
  }, { a: 'Amani', b: 'Baraka' }, 'weekly', { from: '2026-10-05', to: '2026-10-11' }, 'Week of 05/10/2026 to 11/10/2026', '2026-10-18');
  it('names the students who need attention', () => {
    expect(report.alerts).toEqual([{ studentId: 'b', name: 'Baraka', course: 'ICT', percent: 33, held: 3 }]);
    expect(report.arrears).toEqual([{ studentId: 'b', name: 'Baraka', course: 'ICT', balanceCents: 500, overdue: true }]);
  });
  it('lists only outcome checks that are due and not yet recorded', () => {
    expect(report.outcomesDue).toEqual([{ studentId: 'a', name: 'Amani', months: 3, due: '2026-10-10' }]);
  });
  it('carries the period and its numbers', () => {
    expect(report).toMatchObject({ type: 'weekly', from: '2026-10-05', metrics: { enrolled: 2, attendanceRate: 67 } });
  });
});
