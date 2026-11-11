const { open, org, BASE } = require('./lib.cjs');
(async () => {
  const { browser, page } = await open({ mobile: true });
  await org(page, 'hope');
  await page.goto(BASE + '/hope/clubs'); await page.waitForTimeout(2000);
  await page.getByRole('button', { name: 'Add the clubs' }).click().catch((e) => console.log('c', e.message.split('\n')[0]));
  await page.waitForTimeout(2000);
  await page.goto(BASE + '/hope/register'); await page.waitForTimeout(2500);
  const pres = page.getByRole('button', { name: 'Present', exact: true });
  const n = await pres.count(); console.log('present buttons', n);
  for (let i = 0; i < Math.min(n, 14); i++) { await pres.nth(i).click().catch(() => {}); await page.waitForTimeout(250); }
  await page.getByRole('button', { name: 'Late', exact: true }).nth(15).click().catch(() => {});
  await page.waitForTimeout(2000);
  await org(page, 'adia');
  await page.goto(BASE + '/attendance/adia/2026-11-12_food_and_beverage_production'); await page.waitForTimeout(2500);
  const p2 = page.getByRole('button', { name: 'Present', exact: true });
  for (let i = 0; i < 4; i++) { await p2.nth(i).click().catch(() => {}); await page.waitForTimeout(300); }
  await page.getByRole('button', { name: 'Late', exact: true }).nth(4).click().catch(() => {});
  await page.waitForTimeout(2500);
  await browser.close();
})();
