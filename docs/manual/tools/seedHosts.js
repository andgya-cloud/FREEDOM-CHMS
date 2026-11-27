async () => {
  const { httpsCallable } = await import('/node_modules/.vite/deps/firebase_functions.js').catch(() => import('firebase/functions'));
  const F = await import('/src/firebase.ts');
  const call = (d) => httpsCallable(F.functions, 'serviceHosts', { timeout: 120000 })(d).then((r) => r.data);
  const out = [];
  const hosts = [['Grace Wanjiru','0712000201','grace@example.org'],['Peter Otieno','0712000202','peter@example.org'],['James Mwangi','0712000203','james@example.org'],['Faith Njeri','0712000204','faith@example.org'],['Samuel Kamau','0712000205','samuel@example.org']];
  for (const [name, phone, email] of hosts) out.push(await call({ team: 'host', orgId: 'church', action: 'saveHost', name, phone, email }));
  const pray = [['Ruth Chebet','0712000210','ruth@example.org'],['Joseph Mutua','0712000211','joseph@example.org'],['Naomi Akinyi','0712000212','naomi@example.org']];
  for (const [name, phone, email] of pray) out.push(await call({ team: 'prayer', orgId: 'church', action: 'saveHost', name, phone, email }));
  for (const team of ['host', 'prayer']) { out.push(await call({ team, orgId: 'church', action: 'suggest' })); out.push(await call({ team, orgId: 'church', action: 'useSuggestions' })); }
  out.push(await call({ team: 'host', orgId: 'church', action: 'uploadDoc', name: 'Freedom-Church-Service-Leading-Team-Manual.pdf', base64: PDF_BASE64 /* paste the requirements PDF as base64 here */ }));
  return out;
}
