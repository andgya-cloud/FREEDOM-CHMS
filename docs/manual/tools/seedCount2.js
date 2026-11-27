async () => {
  const { httpsCallable } = await import('/node_modules/.vite/deps/firebase_functions.js');
  const F = await import('/src/firebase.ts');
  const call = (fn, d) => httpsCallable(F.functions, fn)(d).then((r) => r.data);
  const out = [];
  const toks = { adults: 'aSzjgkOxVWp9s80yAkDk6Xxt', all: '7_sxsolBF-CqQuyjcPgS13aD', firstTimers: '6mZq1i9xlHxv5idbhewTjwNf', salvations: 'kCHPV1XvSzJzczmQUHymfDCS' };
  const n = { adults: 142, all: 238, firstTimers: 6, salvations: 2 };
  for (const [k, t] of Object.entries(toks)) { try { out.push(await call('serviceCounters', { orgId: 'church', token: t, action: 'count', service: 'Thanksgiving Service', set: n[k] })); } catch (e) { out.push('ERR ' + e.message); } }
  const info = await call('serviceCounters', { orgId: 'church', action: 'ssInfo' });
  const counts = [9, 14, 11, 8, 17];
  for (let i = 0; i < info.classes.length; i++) { try { await call('serviceCounters', { orgId: 'church', action: 'classCount', classId: info.classes[i].id, set: counts[i] ?? 5 }); } catch (e) { out.push('ERR ' + e.message); } }
  try { out.push(await call('youth', { orgId: 'church', action: 'count', set: 34 })); } catch (e) { out.push('YERR ' + e.message); }
  return { out: out.map((o) => (typeof o === 'string' ? o : 'ok')), classes: info.classes.map((c) => c.name) };
}
