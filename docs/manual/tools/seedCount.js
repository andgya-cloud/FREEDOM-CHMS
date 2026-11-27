async () => {
  const A = await import('/src/lib/attendanceWrites.ts');
  const { httpsCallable } = await import('/node_modules/.vite/deps/firebase_functions.js');
  const F = await import('/src/firebase.ts');
  const today = new Date(Date.now() + 3 * 3600e3).toISOString().slice(0, 10);
  const ev = await A.recordService('church', { date: today, name: 'Thanksgiving Service', other: true, headcounts: { adults: 0 } });
  const out = [ev.id];
  const call = (d) => httpsCallable(F.functions, 'serviceCounters')(d).then((r) => r.data);
  for (const [job, person, phone] of [['adults', 'Peter Otieno', '0712000202'], ['all', 'James Mwangi', '0712000203'], ['firstTimers', 'Faith Njeri', '0712000204'], ['salvations', 'Grace Wanjiru', '0712000201']]) {
    try { out.push(await call({ orgId: 'church', action: 'saveJob', job, person, phone }).then(() => job)); } catch (e) { out.push('ERR ' + e.message); }
  }
  const j = await call({ orgId: 'church', action: 'jobs' });
  return { out, links: j.jobs.map((x) => x.link) };
}
