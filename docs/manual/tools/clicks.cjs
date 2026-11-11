const { open, BASE } = require('./lib.cjs');
(async () => {
  const { browser, page } = await open();
  await page.goto(BASE + '/programs'); await page.waitForTimeout(2000);
  await page.getByRole('button', { name: /Add Growth Track/ }).click().catch((e) => console.log('p', e.message));
  await page.waitForTimeout(2000);
  await page.goto(BASE + '/reports'); await page.waitForTimeout(2000);
  await page.getByRole('button', { name: /last week.s report now/i }).click().catch((e) => console.log('r', e.message));
  await page.waitForTimeout(12000);
  await page.goto(BASE + '/reports'); await page.waitForTimeout(3000);
  await page.screenshot({ path: '/tmp/rep.png' });
  await browser.close();
})();
