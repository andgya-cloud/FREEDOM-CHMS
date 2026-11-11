// Takes every picture the manual needs, with numbered circles on the buttons the steps name.
const fs = require('fs');
const { open, skip, org, BASE } = require('./lib.cjs');
const spec = require(process.argv[2]);
const only = process.argv.slice(3);
const OUT = '/home/user/manual/shots/m';

async function mark(page, locs) {
  const boxes = [];
  for (let i = 0; i < locs.length; i++) {
    if (!locs[i]) { boxes.push(null); continue; }
    const l = locs[i](page).filter({ visible: true }).first();
    if (!(await l.count())) { console.log('  no marker', i + 1, String(locs[i])); boxes.push(null); continue; }
    boxes.push(await l.boundingBox());
  }
  await page.evaluate((boxes) => {
    document.querySelectorAll('.mm-mark').forEach((e) => e.remove());
    boxes.forEach((b, i) => {
      if (!b) return;
      const ring = document.createElement('div'); ring.className = 'mm-mark';
      Object.assign(ring.style, { position: 'absolute', left: (b.x + scrollX - 3) + 'px', top: (b.y + scrollY - 3) + 'px', width: (b.width + 6) + 'px', height: (b.height + 6) + 'px',
        border: '2.5px solid #e4572e', borderRadius: '10px', zIndex: 99998, pointerEvents: 'none', boxSizing: 'border-box' });
      const dot = document.createElement('div'); dot.className = 'mm-mark'; dot.textContent = String(i + 1);
      const left = Math.max(2, Math.min(innerWidth - 30, b.x + scrollX + b.width - 14));
      Object.assign(dot.style, { position: 'absolute', left: left + 'px', top: Math.max(2, b.y + scrollY - 14) + 'px', width: '26px', height: '26px', borderRadius: '50%',
        background: '#e4572e', color: '#fff', font: '700 15px/26px system-ui, sans-serif', textAlign: 'center', zIndex: 99999, boxShadow: '0 1px 4px rgba(0,0,0,.35)', pointerEvents: 'none' });
      document.body.appendChild(ring); document.body.appendChild(dot);
    });
  }, boxes);
}

(async () => {
  const groups = {};
  for (const t of spec) for (const s of t.shots || []) {
    if (only.length && !only.includes(t.id)) continue;
    const key = `${s.device || 'm'}|${s.user || ''}|${s.signedOut ? 'out' : ''}`;
    (groups[key] ||= []).push({ t, s });
  }
  for (const [key, list] of Object.entries(groups)) {
    const [device, user, out] = key.split('|');
    let browser, page;
    if (out) { const { chromium } = require('playwright'); browser = await chromium.launch();
      const ctx = await browser.newContext(device === 'm' ? { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true } : { viewport: { width: 1366, height: 860 }, deviceScaleFactor: 2 });
      page = await ctx.newPage(); await page.addInitScript(() => document.addEventListener('DOMContentLoaded', () => { const st = document.createElement('style'); st.textContent = '.dev-ribbon{display:none!important}'; document.head.appendChild(st); })); }
    else ({ browser, page } = await open({ mobile: device === 'm', ...(user ? { email: user, password: 'DemoPass2026' } : {}) }));
    let cur = 'church';
    for (const { t, s } of list) {
      try {
        const o = s.org || 'church';
        if (o !== cur) { await page.goto(BASE + '/'); await page.waitForTimeout(1200); await org(page, o); cur = o; }
        await page.goto(BASE + s.path); await page.waitForTimeout(s.wait || 1800); await skip(page);
        for (const g of await page.getByRole('button', { name: /^got it$/i }).all()) await g.click().catch(() => {});
        const W = device === 'm' ? 390 : 1366, Hh = device === 'm' ? 900 : 860;
        await page.setViewportSize({ width: W, height: s.tall || Hh });
        await page.evaluate((show) => { let st = document.getElementById('mm-hide'); if (!st) { st = document.createElement('style'); st.id = 'mm-hide'; document.head.appendChild(st); } st.textContent = show ? '' : '.jaa-fab{display:none!important}'; }, !!s.fab);
        if (s.prep) await s.prep(page);
        if (s.scroll) { const l = s.scroll(page).first(); if (await l.count()) { await l.scrollIntoViewIfNeeded(); await page.evaluate((y) => scrollBy(0, y), s.offset ?? -200); } }
        await page.waitForTimeout(400);
        await mark(page, s.marks || []);
        const name = `${OUT}/${s.name || t.id}.png`;
        await page.screenshot({ path: name, fullPage: !!s.full });
        console.log('ok', t.id, s.name || '');
      } catch (e) { console.log('FAIL', t.id, e.message.split('\n')[0]); }
    }
    await browser.close();
  }
})();
