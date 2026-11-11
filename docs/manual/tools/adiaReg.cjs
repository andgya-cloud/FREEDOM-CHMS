const { open, org, BASE } = require('./lib.cjs');
(async () => {
  const { browser, page } = await open({ mobile: true });
  await org(page, 'adia');
  await page.goto(BASE + '/attendance'); await page.waitForTimeout(2000);
  await page.getByText('Food and Beverage Production').first().click(); await page.waitForTimeout(2500);
  console.log(page.url());
  await page.screenshot({ path: '/tmp/reg1.png', fullPage: true });
  await browser.close();
})();
