async () => {
  const F = await import('/src/firebase.ts');
  const fs = await import('/src/__fs.ts');
  const S = await import('/src/lib/schoolWrites.ts');
  const G = await import('/src/lib/givingWrites.ts');
  const E = await import('/src/lib/examWrites.ts');
  const Pw = await import('/src/lib/payrollWrites.ts');
  const X = await import('/functions/src/shared/exams.ts');
  const studs = (await fs.getDocs(fs.collection(F.db, 'organizations', 'adia', 'students'))).docs;
  const people = Object.fromEntries((await fs.getDocs(fs.collection(F.db, 'organizations', 'adia', 'people'))).docs.map((d) => [d.id, d.data().fullName]));
  const byIntake = {};
  for (const d of studs) (byIntake[d.data().intakeId] ||= []).push(d.id);
  for (const [intake, ids] of Object.entries(byIntake)) S.billStudents('adia', ids, [{ name: 'Tuition', amountCents: 1800000 }, { name: 'Materials', amountCents: 300000 }], 'Term 3 2026', '2026-09-30', intake, new Set());
  let k = 0;
  for (const d of studs) {
    const paid = [2100000, 1500000, 1000000, 2100000, 500000][k % 5];
    G.recordGift('adia', { personId: d.id, giverName: people[d.id], phone: null, date: '2026-09-1' + (k % 9), amountCents: paid, fundId: 'school_fees', method: k % 2 ? 'mpesa' : 'cash', mpesaCode: k % 2 ? 'TJA' + (2000000 + k * 31) : null, accountRef: '', notes: '' }, 'Andrew Guya');
    k++;
  }
  const uid = F.auth.currentUser.uid;
  const sheet = await E.createExamSheet('adia', { cohort: 'Cohort 3', courseId: 'food_and_beverage_production', courseName: 'Food and Beverage Production', teacherName: 'Andrew Guya', weights: X.DEFAULT_EXAM_WEIGHTS, ownerUid: uid, ownerName: 'Andrew Guya', semester: 1 });
  const staff = [['Mary Wairimu', 'Principal', 6500000], ['Joseph Ndungu', 'Trainer, ICT', 4200000], ['Lucy Atieno', 'Trainer, Dressmaking', 3800000], ['Peter Mutiso', 'Lab technician', 2800000]];
  staff.forEach(([name, jobTitle, basic], i) => Pw.saveStaff('adia', null, { name, staffNo: 'ADIA-0' + (i + 1), jobTitle, kraPin: 'A00000000' + i + 'X', nssfNo: '', shifNo: '', paymentDetails: 'M-Pesa 0700 000 30' + i, basicCents: basic, allowances: [], deductions: [], active: true }));
  await new Promise((r) => setTimeout(r, 5000));
  return { students: studs.length, sheet: sheet?.id ?? String(sheet) };
}
