async () => {
  const R = await import('/src/lib/classRegister.ts');
  const ids = ["8avd6apn6LfHqt58xbJc","FEYZLLvK2N1xSLGXlTZK","JaCc5sOR9K5myvXtAuc6","TxUvZeiEDSNgmwk65x8i","UMeUF6N2edU6tarmvkr7","WDdkUSlctLiLaRobuWTh","a1jDknap34M7kLZJBeit","ayHBQT3RoA5wz2qBDRZD","ePIIFKIytfTVRMMXu3kb","fe5n5VNPTBrmwc50W2Cv","kMx9iItjyrflTDCzq4Ql","kyrF6XrcZDsQPZ0hcgQw"];
  const out = [];
  out.push(await R.markFromList('church', 'freedom_252', '2026-11-10', ids.slice(0, 10).map((personId) => ({ personId }))));
  out.push(await R.markFromList('church', 'freedom_252', '2026-11-17', ids.filter((_, i) => i !== 3 && i !== 7).map((personId) => ({ personId }))));
  out.push(await R.markFromList('church', 'freedom_252', '2026-11-24', ids.slice(0, 2).map((personId) => ({ personId }))));
  return out;
}
