const { open, shot, org } = require('./lib.cjs');
(async () => {
  const mobile = process.argv[2] === 'm'; const o = process.argv[3];
  const { browser, page } = await open({ mobile });
  if (o !== 'church') { await page.goto('http://127.0.0.1:5173/'); await page.waitForTimeout(1500); await org(page, o); }
  for (const p of process.argv.slice(4)) { await shot(page, p, `s_${o}_${mobile ? 'm' : 'd'}${p.replace(/\W/g, '_')}`, { full: true }); }
  await browser.close();
})();
