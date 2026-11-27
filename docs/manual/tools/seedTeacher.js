async () => {
  const { httpsCallable } = await import('/node_modules/.vite/deps/firebase_functions.js');
  const F = await import('/src/firebase.ts');
  const call = (fn, d) => httpsCallable(F.functions, fn, { timeout: 120000 })(d).then((r) => r.data);
  const info = await call('serviceCounters', { orgId: 'church', action: 'ssInfo' });
  const out = [];
  try { out.push(await call('createUser', { email: 'christine@example.org', displayName: 'Christine Wairimu', roleId: 'ssteacher', orgIds: ['church'], password: 'DemoPass2026', ssClass: info.classes[0].id })); } catch (e) { out.push('ERR ' + e.message); }
  try { out.push(await call('createUser', { email: 'sheila@example.org', displayName: 'Sheila Achieng', roleId: 'youth', orgIds: ['church'], password: 'DemoPass2027' })); } catch (e) { out.push('ERR ' + e.message); }
  return out;
}
