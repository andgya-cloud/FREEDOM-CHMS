# Stage 9: ADIA Training Centre

## What I built

A School section for the ADIA organization (type College): students, programmes, class attendance, results, fees, graduation and the school's own reports. It reuses people, attendance, giving receipts, WhatsApp and offline mode. Petty cash and inventory are not rebuilt.

- **Students**: enrol an existing person or a new one; programme, intake, level, status (applicant, enrolled, deferred, graduated, withdrawn), sponsors or guardians. Admission numbers like ADIA/2026/0042 are issued by the server, never reused. ID or passport numbers are visible to the pastor only.
- **Programmes**: the four from your plan are added by the Set up button. Levels, units, a trainer per unit, timetable and intakes with a number of places are all editable. Nothing else is filled in for you.
- **Attendance**: Attendance → programme name gives a register of that programme's students (present, late, absent, excused), offline-capable. Each student has an attendance %; below the threshold (75%, changeable) they appear on the overview and the weekly report.
- **Results**: assessments by type, marks per student, an editable grading scale, pass mark and weights. Report card and transcript PDFs. Exam candidate list as a spreadsheet (the exam body's format comes when you send the template).
- **Fees**: fee structure per programme and intake, bill the intake, payments by M-Pesa, bank or cash recorded as School fees (numbered ADIA receipts), balance per student, arrears list, fee statement PDF, WhatsApp reminder to a sponsor who agreed to WhatsApp. Paybill statement import works as before (account `ADIA#Fees`).
- **Graduation**: certificates with serial numbers, a register, and 3, 6 and 12 month follow-ups.
- **Metrics and reports**: enrolment by programme, retention, attendance rate, pass rate, fee collection rate and arrears, graduation rate, graduate employment at 6 months, students per trainer. Weekly and monthly reports are made automatically (Monday and the 1st at 07:00) and on request, with PDF.

## Who can do what

| | Admin | Pastor |
|---|---|---|
| See students, courses, results, attendance | yes | yes |
| Enrol, change status, enter marks, record outcomes | yes | yes |
| Fees, billing, arrears, payments | with gift access | yes |
| ID numbers, issue certificates, school settings, school reports | no | yes |

## Test it (about 15 minutes)

1. Choose ADIA at the top → School → **Set up now**.
2. Courses → open ICT → add a level, a unit with a trainer, an intake with places → Save.
3. Students → Enrol a student (with a sponsor who agreed to WhatsApp). The admission number appears within seconds.
4. Attendance → tap ICT on two different days and mark the student (try it with the phone in flight mode).
5. Fees → ICT, intake → add Tuition, Save, Bill all. The student appears under Arrears.
6. On the student page → Record a payment → save. The receipt number is ADIA-… and Arrears drops by that amount.
7. Results → add an assessment, enter a mark. Open the student → Report card.
8. Remind sponsor opens WhatsApp with the reminder filled in.
9. Graduation → issue a certificate. School reports → Make the report.

## What I tested here

Automated: school calculations (23 tests), 14 permission tests (admins cannot reach ID numbers, fee balances need fee access, balances and serials are server-only), all earlier tests still pass. In a phone-size browser on local Firebase: the whole path above, including admission number, balance and arrears after a payment, the ADIA receipt, results, report card and fee statement PDFs, certificate serial, and a generated report.

## What I could not test

The real WhatsApp opening and the Monday/1st schedule on the live project (checked after you deploy), and the exam-body format, which needs your template.
