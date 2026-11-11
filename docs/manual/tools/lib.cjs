const { chromium } = require('playwright');
const BASE = 'http://127.0.0.1:5173';
async function open({ mobile = false, email = 'pastor@example.org', password = 'DemoPass2026', dark = false } = {}) {
  const browser = await chromium.launch({ args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'] });
  const ctx = await browser.newContext(mobile
    ? { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, colorScheme: dark ? 'dark' : 'light' }
    : { viewport: { width: 1366, height: 860 }, deviceScaleFactor: 2, colorScheme: dark ? 'dark' : 'light' });
  const page = await ctx.newPage();
  await page.addInitScript(() => { const f = () => { const st = document.createElement('style'); st.textContent = '.dev-ribbon{display:none!important}'; document.head.appendChild(st); }; document.readyState === 'loading' ? document.addEventListener('DOMContentLoaded', f) : f(); });
  page.on('pageerror', (e) => console.log('PAGEERR', e.message));
  await page.goto(BASE + '/');
  await page.waitForTimeout(1500);
  const withEmail = page.getByText(/email/i).first();
  const emailBox = page.locator('input[type=email]');
  if (!(await emailBox.count())) { const t = page.getByRole('button', { name: /email/i }); if (await t.count()) await t.first().click(); }
  if (await page.locator('input[type=email]').count()) await page.locator('input[type=email]').fill(email);
  await page.locator('input[type=password]').fill(password);
  await page.locator('button[type=submit]').click();
  await page.waitForTimeout(4000);
  await skip(page);
  return { browser, ctx, page };
}
async function skip(page) {
  for (let i = 0; i < 3; i++) {
    const s = page.getByRole('button', { name: /^skip/i });
    if (await s.count()) { await s.first().click().catch(() => {}); await page.waitForTimeout(800); }
  }
}
async function shot(page, path, name, { wait = 1500, full = false } = {}) {
  await page.goto(BASE + path); await page.waitForTimeout(wait); await skip(page);
  await page.screenshot({ path: `/home/user/manual/shots/${name}.png`, fullPage: full });
}
async function org(page, id) {
  const sel = page.locator(`select:has(option[value="${id}"])`).first();
  await sel.selectOption(id); await page.waitForTimeout(2500); await skip(page);
}
module.exports = { open, shot, skip, org, BASE };
