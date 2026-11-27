async () => {
  const W = await import('/src/lib/programWrites.ts');
  const ids = ["8avd6apn6LfHqt58xbJc","FEYZLLvK2N1xSLGXlTZK","JaCc5sOR9K5myvXtAuc6","TxUvZeiEDSNgmwk65x8i","UMeUF6N2edU6tarmvkr7","WDdkUSlctLiLaRobuWTh","a1jDknap34M7kLZJBeit","ayHBQT3RoA5wz2qBDRZD","ePIIFKIytfTVRMMXu3kb","fe5n5VNPTBrmwc50W2Cv","kMx9iItjyrflTDCzq4Ql","kyrF6XrcZDsQPZ0hcgQw"];
  const c = W.addCohort('church', { programId: 'freedom_252', name: 'November 2026', startDate: '2026-11-10', endDate: null, schedule: 'Tuesdays 8:00pm to 9:00pm' });
  const cid = c?.id ?? c?.ref?.id ?? null;
  for (const id of ids) W.enrol('church', 'freedom_252', id, cid, '2026-11-10');
  await new Promise((r) => setTimeout(r, 3000));
  return { n: ids.length, cid };
}
