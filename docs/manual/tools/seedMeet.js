async () => {
  const R = await import('/src/lib/classRegister.ts');
  const ids = ["8avd6apn6LfHqt58xbJc","FEYZLLvK2N1xSLGXlTZK","JaCc5sOR9K5myvXtAuc6","TxUvZeiEDSNgmwk65x8i","UMeUF6N2edU6tarmvkr7","WDdkUSlctLiLaRobuWTh","a1jDknap34M7kLZJBeit","ayHBQT3RoA5wz2qBDRZD","ePIIFKIytfTVRMMXu3kb","fe5n5VNPTBrmwc50W2Cv","kMx9iItjyrflTDCzq4Ql","kyrF6XrcZDsQPZ0hcgQw"];
  const rows = ids.slice(0, 10).map((personId, i) => ({ name: 'n' + i, personId, minutes: i === 4 ? 25 : i === 8 ? 38 : 52 + (i % 8), join: 1200 + (i % 5), leave: i === 4 ? 1227 : i === 8 ? 1240 : 1259 }));
  rows.push({ name: 'Galaxy A14', skip: true, minutes: 40, join: 1205, leave: 1245 });
  return await R.saveMeetList('church', '2026-11-24_freedom_252_makeup', rows);
}
