const { open, shot } = require('./lib.cjs');
(async () => {
  const { browser, page } = await open({ mobile: process.argv[2] === 'm' });
  for (const p of process.argv.slice(3)) await shot(page, p, 'try' + p.replace(/\W/g, '_'));
  console.log(page.url());
  await browser.close();
})();
