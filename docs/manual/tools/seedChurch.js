async () => {
  const P = await import('/src/lib/peopleWrites.ts');
  const A = await import('/src/lib/attendanceWrites.ts');
  const G = await import('/src/lib/givingWrites.ts');
  const C = await import('/src/lib/pettyCashWrites.ts');
  const org = 'church';
  const consent = { given: true, date: '2026-09-06', recordedBy: 'seed', stoppedAt: null };
  const names = ['Grace Wanjiru','Peter Otieno','Mary Achieng','James Mwangi','Faith Njeri','John Kiprono','Esther Wambui','Daniel Odhiambo','Ruth Chebet','Samuel Kamau','Lydia Atieno','Joseph Mutua','Sarah Nyambura','David Kibet','Naomi Akinyi','Paul Njoroge','Rose Moraa','Stephen Ouma','Joy Wairimu','Brian Kiptoo','Mercy Auma','Kevin Maina','Ann Muthoni','Victor Onyango','Agnes Jepkoech','Collins Wekesa','Beatrice Nduta','Dennis Omondi','Caroline Wangari','Felix Rotich'];
  const ids = [];
  for (let i = 0; i < names.length; i++) {
    const phone = '+254700000' + String(200 + i);
    const status = i < 4 ? 'visitor' : i < 12 ? 'regular' : 'member';
    const bd = i === 5 ? '11-13' : i === 9 ? '11-15' : i === 14 ? '11-12' : `0${1 + (i % 9)}-${10 + (i % 18)}`;
    const r = P.addPerson(org, { fullName: names[i], phone, whatsapp: phone, whatsappConsent: consent, email: null, status,
      firstVisitDate: status === 'visitor' ? (i < 2 ? '2026-11-08' : '2026-11-01') : null, gender: i % 2 ? 'male' : 'female', birthday: bd,
      howHeard: status === 'visitor' ? 'Invited by a friend' : null, serviceAttended: status === 'visitor' ? 'Sunday 10:00' : null }, { recordVisitorStage: status === 'visitor' });
    ids.push(r.ref.id);
  }
  const sundays = ['2026-09-27','2026-10-04','2026-10-11','2026-10-18','2026-10-25','2026-11-01','2026-11-08'];
  const out = [];
  for (let s = 0; s < sundays.length; s++) {
    const ev = await A.recordService(org, { date: sundays[s], name: 'Sunday Service', other: false, headcounts: { adults: 140 + s * 6, teens: 28 + s, children: 52 + s * 2, new: 3 + (s % 3), salvations: s % 2 } });
    const present = ids.slice(4 - (s === 6 ? 2 : 0)).filter((_, k) => (k + s) % 5 !== 0).map((personId) => ({ personId, existing: undefined }));
    A.markMany(org, { id: ev.id, date: sundays[s], name: 'Sunday Service', type: 'service' }, present, 'present', 'manual');
    out.push(ev.id);
  }
  await G.addStandardFunds(org, []);
  const amts = [5000, 2000, 10000, 1500, 3000, 7500, 1000, 2500, 12000, 4000];
  for (let i = 0; i < 18; i++) {
    const pi = 4 + (i % 20);
    G.recordGift(org, { personId: ids[pi], giverName: names[pi], phone: '+254700000' + (200 + pi), date: sundays[3 + (i % 4)], amountCents: amts[i % 10] * 100,
      fundId: i % 3 ? 'tithes' : 'offerings', method: i % 4 ? 'mpesa' : 'cash', mpesaCode: i % 4 ? 'TKB' + (1000000 + i * 7919) : null, accountRef: '', notes: '' }, 'Andrew Guya');
  }
  G.recordGift(org, { personId: null, giverName: '', phone: '+254700000999', date: '2026-11-08', amountCents: 300000, fundId: null, method: 'mpesa', mpesaCode: 'TKB9988776', accountRef: 'OFFERING', notes: '' }, 'Andrew Guya');
  C.submitRequisition(org, { requesterName: 'Andrew Guya', category: 'Hospitality', categoryNote: null, items: [{ description: 'Tea and snacks for first-timers', amountCents: 350000 }], month: '2026-11' });
  C.submitRequisition(org, { requesterName: 'Andrew Guya', category: 'Ministry & programmes', categoryNote: null, items: [{ description: 'Sound system cables', amountCents: 620000 }, { description: 'Batteries for microphones', amountCents: 120000 }], month: '2026-11' });
  await new Promise((r) => setTimeout(r, 4000));
  return { people: ids.length, events: out.length };
}
