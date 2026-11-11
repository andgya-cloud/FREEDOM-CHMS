const fs = require('fs'); const { open } = require('./lib.cjs');
(async () => {
  const { browser, page } = await open();
  const fn = fs.readFileSync(process.argv[2], 'utf8');
  try { console.log(JSON.stringify(await page.evaluate(`(${fn})()`))); } catch (e) { console.log('ERR', e.message.slice(0, 1500)); }
  await browser.close();
})();
