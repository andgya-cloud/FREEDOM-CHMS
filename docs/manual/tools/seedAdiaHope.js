async () => {
  const S = await import('/src/lib/schoolWrites.ts');
  const H = await import('/src/lib/hopeWrites.ts');
  const C = await import('/src/lib/pettyCashWrites.ts');
  await S.setupSchool('adia', { courses: [], hasSettings: false, hasFund: false });
  const progs = ['Food and Beverage Production', 'Dressmaking & Tailoring', 'ICT', 'Beauty Therapy & Cosmetology'];
  const ids = { 'Food and Beverage Production': 'food_and_beverage_production', 'Dressmaking & Tailoring': 'dressmaking_and_tailoring', 'ICT': 'ict', 'Beauty Therapy & Cosmetology': 'beauty_therapy_and_cosmetology' };
  const first = ['Alice','Brian','Cynthia','Duncan','Evelyn','Francis','Gladys','Hillary','Irene','Jackline','Kelvin','Linet','Moses','Nancy','Oscar','Purity','Quincy','Rebecca','Simon','Tabitha',' Umar'.trim(),'Violet','Wycliffe','Yvonne'];
  const last = ['Nekesa','Ochieng','Wanjala','Karanja','Chepkoech','Mumbi','Barasa','Langat','Adhiambo','Gitau','Jeptoo','Muriuki'];
  const rows = first.map((f, i) => ({ sheet: '', line: i + 2, name: `${f} ${last[i % last.length]}`, admissionNo: null, idNumber: null, phone: '+254700000' + (400 + i), gender: i % 2 ? 'male' : 'female',
    programme: progs[i % 4], courseId: null, newCourse: true, intake: i < 12 ? 'Cohort 3' : 'Cohort 4', intakeId: null, newIntake: true, level: '', status: 'enrolled', graduated: false,
    startDate: i < 12 ? '2026-01-12' : '2026-05-04', sponsor: null, personId: null, skip: null }));
  rows.forEach((r) => { r.courseId = ids[r.programme]; r.newCourse = false; });
  await S.importStudents('adia', rows, { courseIds: Object.values(ids), keepAdmissionNos: false, keepIdNumbers: false }, '2026-11-12', null);
  C.submitRequisition('adia', { requesterName: 'Andrew Guya', category: 'Training materials', categoryNote: null, items: [{ description: 'Fabric for Dressmaking class', amountCents: 450000 }], month: '2026-11' });
  const kids = ['Baraka','Neema','Tumaini','Zawadi','Imani','Furaha','Amani','Pendo','Jabali','Nuru','Shujaa','Upendo','Bahati','Rehema','Hodari','Subira','Wema','Tabasamu'];
  const sur = ['Otieno','Wanjiku','Kariuki','Akoth','Mwende','Kiptum'];
  const crows = kids.map((k, i) => ({ line: i + 2, code: null, givenCode: null, name: `${k} ${sur[i % 6]}`, gender: i % 2 ? 'male' : 'female', dateOfBirth: `${2012 + (i % 6)}-0${1 + (i % 9)}-1${i % 9}`,
    school: 'Kibera Primary', sponsorName: i % 3 ? 'Sponsor Family ' + (i + 1) : '', sponsorPhone: '', sponsorEmail: '', parentName: 'Parent of ' + k, parentPhone: '+254700000' + (600 + i),
    enrolledOn: '2025-01-15', photoConsent: true, guardianConsent: true, schoolClass: `Grade ${3 + (i % 5)}`, payment: null, skip: null, warn: null }));
  await H.importChildren('hope', crows, '2026-11-12');
  C.submitRequisition('hope', { requesterName: 'Andrew Guya', category: "Children's needs", categoryNote: null, items: [{ description: 'Exercise books', amountCents: 280000 }], month: '2026-11' });
  await new Promise((r) => setTimeout(r, 5000));
  return 'ok';
}
