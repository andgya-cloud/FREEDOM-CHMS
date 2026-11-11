// Builds the Freedom ChMS user manual PDF from the topic specs and the screenshots.
// Two passes: the first finds the page each topic lands on, the second writes those numbers in the contents.
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');
const { PDFDocument } = require('pdf-lib');

const ROOT = '/home/user/manual';
const APP = '/home/user/freedom-chms/public';
const OUT = process.argv[2] || `${ROOT}/out/Freedom-ChMS-User-Manual.pdf`;
const VERSION = '1.0 (sample: front pages and Part 1)';
const DATE = 'November 2026';
const APPV = 'v255';

const topics = [...require('./spec-church.cjs')];
const front = require('./front.cjs');

const img = (p) => `data:image/${p.endsWith('.jpg') ? 'jpeg' : 'png'};base64,${fs.readFileSync(p).toString('base64')}`;
const LOGO = img(`${APP}/logo-mark.png`);
const CHURCH = img(`${APP}/org/freedom-church-logo.png`);
const ADIA = img(`${APP}/org/adia-crest.png`);
const HOPE = img(`${APP}/org/hope-centre-logo.png`);
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;');
const md = (s) => esc(s).replace(/\*\*(.+?)\*\*/g, '<b>$1</b>');

const PARTS = {
  start: { n: 'Getting started', title: 'Getting started', logo: LOGO, color: '#1f2a5c',
    intro: 'Everything you need on your first day: signing in, finding your way around the screen, putting the app on your phone and getting help.' },
  church: { n: 'Part 1', title: 'Freedom Church Nairobi', logo: CHURCH, color: '#2f6b47',
    intro: 'People, Sunday services, first-timers and follow-ups, giving and reports for Freedom Church Nairobi.' },
};

const CSS = `
@page { size: A4; margin: 16mm 16mm 20mm 16mm; }
* { box-sizing: border-box; }
html { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
body { font-family: Inter, system-ui, sans-serif; font-size: 10.5pt; line-height: 1.5; color: #1d2430; margin: 0; }
h1, h2, h3 { font-family: 'Inter Display', Inter, sans-serif; color: #14213d; margin: 0; }
b { font-weight: 650; color: #0f172a; }
.page { page-break-after: always; break-after: page; position: relative; }
.page:last-child { page-break-after: auto; }
.crumb { font-size: 8.5pt; letter-spacing: .08em; text-transform: uppercase; color: var(--c, #2f6b47); font-weight: 600; margin-bottom: 2mm; }
.topic h2 { font-size: 20pt; margin-bottom: 2mm; }
.purpose { font-size: 11.5pt; color: #39424e; margin: 0 0 4mm; }
.facts { display: grid; grid-template-columns: 34mm 1fr; border-top: 1px solid #e3e7ec; margin-bottom: 5mm; }
.facts div { padding: 1.6mm 0; border-bottom: 1px solid #e3e7ec; font-size: 9.5pt; }
.facts .k { color: #6b7480; font-weight: 600; }
.body { display: flex; gap: 8mm; align-items: flex-start; }
.body.wide { flex-direction: column; gap: 5mm; }
.text { flex: 1; min-width: 0; }
.shot { flex: 0 0 auto; }
.shot img { display: block; box-shadow: 0 1.2mm 4mm rgba(20,33,61,.18); }
.shot.phone img { border: 2.4mm solid #1b1f27; border-radius: 7mm; }
.shot.desk img { border: 1.6mm solid #1b1f27; border-radius: 2.5mm; }
.shot.phone img { max-width: 64mm; max-height: 178mm; width: auto; height: auto; }
.shot.desk { align-self: center; } .shot.desk img { max-width: 100%; max-height: 98mm; width: auto; height: auto; }
.shot .cap { font-size: 8pt; color: #6b7480; margin-top: 1.5mm; text-align: center; }
h3 { font-size: 11pt; margin: 0 0 2mm; text-transform: none; }
ol.steps { list-style: none; padding: 0; margin: 0 0 4mm; counter-reset: s; }
ol.steps li { counter-increment: s; position: relative; padding: 0 0 3mm 9mm; }
ol.steps li::before { content: counter(s); position: absolute; left: 0; top: .2mm; width: 6mm; height: 6mm; border-radius: 50%; background: #e4572e; color: #fff; font-weight: 700; font-size: 9pt; line-height: 6mm; text-align: center; }
.box { border-radius: 2.5mm; padding: 2.6mm 3.5mm 2.6mm 11mm; margin: 0 0 3mm; position: relative; font-size: 9.8pt; break-inside: avoid; }
.box::before { position: absolute; left: 3.2mm; top: 2.4mm; font-weight: 700; width: 5.5mm; height: 5.5mm; border-radius: 50%; color: #fff; text-align: center; line-height: 5.5mm; font-size: 8.5pt; }
.box .h { font-weight: 700; display: block; font-size: 8.5pt; letter-spacing: .06em; text-transform: uppercase; margin-bottom: .5mm; }
.see { background: #eef3fb; } .see::before { content: '✓'; background: #3b6fb6; } .see .h { color: #2c568f; }
.tip { background: #edf6ef; } .tip::before { content: 'i'; background: #2f6b47; } .tip .h { color: #2f6b47; }
.warn { background: #fdf3e4; } .warn::before { content: '!'; background: #c47a12; } .warn .h { color: #9a5d06; }
.before { background: #f3f1fa; } .before::before { content: '›'; background: #5b4b9a; } .before .h { color: #4a3d82; }
/* divider */
.divider { height: 255mm; display: flex; flex-direction: column; justify-content: center; padding: 0 8mm; }
.divider .n { font-size: 12pt; letter-spacing: .14em; text-transform: uppercase; color: var(--c); font-weight: 700; }
.divider h1 { font-size: 34pt; margin: 3mm 0 6mm; }
.divider p { font-size: 12pt; color: #46505c; max-width: 140mm; }
.divider img.logo { height: 34mm; margin-bottom: 10mm; align-self: flex-start; }
.divider .rule { height: 2mm; width: 40mm; background: var(--c); border-radius: 1mm; margin-bottom: 8mm; }
.divider ul { columns: 2; padding-left: 4mm; margin-top: 6mm; color: #39424e; }
/* front matter */
.front h1 { font-size: 22pt; margin-bottom: 6mm; }
.front h2 { font-size: 12.5pt; margin: 4.5mm 0 1.5mm; }
.front p { margin: 0 0 3mm; }
table.t { width: 100%; border-collapse: collapse; font-size: 9pt; margin: 2mm 0 4mm; line-height: 1.4; }
table.t th { text-align: left; background: #14213d; color: #fff; font-weight: 600; padding: 2mm 3mm; }
table.t td { padding: 1.5mm 3mm; border-bottom: 1px solid #e3e7ec; vertical-align: top; }
table.t tr:nth-child(even) td { background: #f7f8fa; }
.toc { list-style: none; padding: 0; margin: 0; }
.toc li { display: flex; align-items: baseline; gap: 2mm; padding: .7mm 0; font-size: 9.8pt; }
.toc li.part { font-weight: 700; margin-top: 4mm; color: #14213d; font-size: 11pt; }
.toc li .dots { flex: 1; border-bottom: 1px dotted #b4bcc6; transform: translateY(-1mm); }
.toc li.sub { padding-left: 6mm; }
.conv { display: grid; grid-template-columns: 38mm 1fr; gap: 3mm 5mm; align-items: center; }
.dot { display: inline-block; width: 6mm; height: 6mm; border-radius: 50%; background: #e4572e; color: #fff; font-weight: 700; font-size: 9pt; line-height: 6mm; text-align: center; }
.sig { margin-top: 10mm; }
.sig .name { font-family: 'Great Vibes', cursive; font-size: 26pt; color: #14213d; }
.roles td:first-child { font-weight: 650; width: 42mm; }
`;

function topicPage(t) {
  const P = PARTS[t.part];
  const shots = t.shots || [];
  const wide = shots.some((s) => s.device === 'd');
  const shotHtml = shots.filter((s) => !s.noPrint).slice(0, wide ? 1 : 1).map((s) => {
    const f = `${ROOT}/shots/j/${s.name || t.id}.jpg`;
    if (!fs.existsSync(f)) return '';
    return `<div class="shot ${s.device === 'd' ? 'desk' : 'phone'}"><img src="${img(f)}"><div class="cap">${s.device === 'd' ? 'On a computer' : 'On a phone'}</div></div>`;
  }).join('');
  const boxes = [
    t.see && `<div class="box see"><span class="h">What you will see</span>${md(t.see)}</div>`,
    t.tip && `<div class="box tip"><span class="h">Tip</span>${md(t.tip)}</div>`,
    t.warn && `<div class="box warn"><span class="h">Warning</span>${md(t.warn)}</div>`,
  ].filter(Boolean).join('');
  const text = `<div class="text">
      ${t.before ? `<div class="box before"><span class="h">Before you begin</span>${md(t.before)}</div>` : ''}
      <h3>Steps</h3><ol class="steps">${t.steps.map((s) => `<li>${md(s)}</li>`).join('')}</ol>${boxes}</div>`;
  return `<section class="page topic" id="${t.id}" style="--c:${P.color}">
    <div class="crumb">${esc(P.title)}</div>
    <h2>${esc(t.title)}</h2>
    <p class="purpose">${md(t.purpose)}</p>
    <div class="facts"><div class="k">Who can do it</div><div>${md(t.who)}</div><div class="k">Where to find it</div><div>${md(t.where)}</div></div>
    <div class="body ${wide ? 'wide' : ''}">${wide ? shotHtml + text : text + shotHtml}</div>
  </section>`;
}

function divider(key, list) {
  const P = PARTS[key];
  return `<section class="page divider" id="part-${key}" style="--c:${P.color}">
    <img class="logo" src="${P.logo}"><div class="rule"></div>
    <div class="n">${esc(P.n)}</div><h1>${esc(P.title)}</h1><p>${esc(P.intro)}</p>
    <ul>${list.map((t) => `<li>${esc(t.title)}</li>`).join('')}</ul></section>`;
}

function bodyHtml(pages) {
  const toc = [];
  const sections = [];
  for (const f of front.pages({ md, esc, LOGO, CHURCH, ADIA, HOPE, VERSION, DATE, APPV })) {
    sections.push(f.html); if (f.toc) toc.push({ id: f.id, title: f.title, cls: 'part' });
  }
  for (const key of Object.keys(PARTS)) {
    const list = topics.filter((t) => t.part === key);
    if (!list.length) continue;
    sections.push(divider(key, list));
    toc.push({ id: `part-${key}`, title: `${PARTS[key].n === PARTS[key].title ? '' : PARTS[key].n + ': '}${PARTS[key].title}`, cls: 'part' });
    for (const t of list) { sections.push(topicPage(t)); toc.push({ id: t.id, title: t.title, cls: 'sub' }); }
  }
  const tocHtml = `<section class="page front" id="contents"><h1>Contents</h1><ul class="toc">${toc.map((e) =>
    `<li class="${e.cls}"><span>${esc(e.title)}</span><span class="dots"></span><span>${pages[e.id] ?? ''}</span></li>`).join('')}</ul></section>`;
  // Contents goes after the document control page and the welcome.
  sections.splice(front.tocAfter, 0, tocHtml);
  return { html: `<!doctype html><html><head><meta charset="utf-8"><style>@font-face{font-family:'Great Vibes';src:url(${'data:font/ttf;base64,' + fs.readFileSync(APP + '/fonts/GreatVibes-Regular.ttf').toString('base64')})}${CSS}</style></head><body>${sections.join('\n')}</body></html>`, ids: toc.map((e) => e.id) };
}

const footer = `<div style="width:100%;font-family:Inter,sans-serif;font-size:7.5pt;color:#7a838e;padding:0 16mm;display:flex;align-items:center;justify-content:space-between;">
  <span style="width:60mm">Freedom ChMS User Manual · Version 1.0</span>
  <span style="display:flex;align-items:center;gap:1.5mm;"><img src="${LOGO}" style="height:5mm;width:5mm"> Powered by <b style="color:#14213d;margin-left:.8mm">Insight-IQ</b></span>
  <span style="width:60mm;text-align:right">Page <span class="pageNumber"></span></span></div>`;

async function render(browser, html, file, withFooter) {
  const page = await browser.newPage();
  await page.setContent(html, { waitUntil: 'load' });
  await page.pdf({ path: file, format: 'A4', printBackground: true, preferCSSPageSize: true, displayHeaderFooter: withFooter, headerTemplate: '<span></span>', footerTemplate: footer });
  await page.close();
}

async function pageMap(browser, html, ids) {
  // Find each section's page by rendering it with a marker and reading the PDF text.
  const page = await browser.newPage();
  const marked = html.replace(/<section class="page([^"]*)" id="([^"]+)"([^>]*)>/g, '<section class="page$1" id="$2"$3><span style="font-size:1px;color:#fff">@@$2@@</span>');
  await page.setContent(marked, { waitUntil: 'load' });
  const buf = await page.pdf({ format: 'A4', printBackground: true, preferCSSPageSize: true });
  await page.close();
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const doc = await pdfjs.getDocument({ data: new Uint8Array(buf) }).promise;
  const map = {};
  for (let i = 1; i <= doc.numPages; i++) {
    const tc = await (await doc.getPage(i)).getTextContent();
    const s = tc.items.map((x) => x.str).join('');
    for (const m of s.matchAll(/@@([^@]+)@@/g)) if (!(m[1] in map)) map[m[1]] = i; // the cover has no number
  }
  return map;
}

function coverHtml() {
  return `<!doctype html><html><head><meta charset="utf-8"><style>
  @page { size: A4; margin: 0; } html { -webkit-print-color-adjust: exact; } body { margin: 0; font-family: Inter, sans-serif; }
  .c { width: 210mm; height: 297mm; position: relative; background: linear-gradient(160deg, #14213d 0%, #1f2a5c 55%, #24476b 100%); color: #fff; overflow: hidden; }
  .band { position: absolute; left: 0; right: 0; bottom: 0; height: 92mm; background: #f6f4ee; }
  .gold { position: absolute; left: 0; right: 0; bottom: 92mm; height: 2.2mm; background: #c99a3c; }
  .in { position: absolute; left: 22mm; right: 22mm; top: 48mm; }
  .k { letter-spacing: .22em; text-transform: uppercase; font-size: 10pt; color: #d9c08a; font-weight: 600; }
  h1 { font-family: 'Inter Display', Inter; font-size: 44pt; line-height: 1.05; margin: 6mm 0 6mm; font-weight: 700; }
  p { font-size: 13pt; color: #d6dbe6; max-width: 150mm; line-height: 1.5; margin: 0; }
  .logos { position: absolute; left: 22mm; right: 22mm; bottom: 34mm; display: flex; gap: 14mm; align-items: center; }
  .logos div { text-align: center; color: #39424e; font-size: 8.5pt; width: 45mm; }
  .logos img { height: 28mm; display: block; margin: 0 auto 3mm; }
  .meta { position: absolute; left: 22mm; bottom: 12mm; color: #6b7480; font-size: 9pt; }
  .pb { position: absolute; right: 22mm; bottom: 11mm; display: flex; align-items: center; gap: 2mm; color: #6b7480; font-size: 9pt; }
  .pb img { height: 7mm; }
  </style></head><body><div class="c"><div class="gold"></div><div class="band"></div>
  <div class="in"><div class="k">User Manual</div><h1>Freedom ChMS</h1>
  <p>The church management system for Freedom Church Nairobi, ADIA Training Centre and Freedom Hope Center.</p>
  <p style="margin-top:8mm;font-size:11pt;color:#b8c1d1">Version ${VERSION} · ${DATE} · Matches the app at ${APPV}</p></div>
  <div class="logos"><div><img src="${CHURCH}">Freedom Church Nairobi</div><div><img src="${ADIA}">ADIA Training Centre</div><div><img src="${HOPE}">Freedom Hope Center</div></div>
  <div class="meta">For staff and leaders · Internal use only</div>
  <div class="pb"><img src="${LOGO}"> Powered by <b style="color:#14213d">Insight-IQ</b></div>
  </div></body></html>`;
}

(async () => {
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  const browser = await chromium.launch();
  let { html, ids } = bodyHtml({});
  const pages = await pageMap(browser, html, ids);
  ({ html } = bodyHtml(pages));
  fs.writeFileSync(`${ROOT}/out/manual.html`, html);
  await render(browser, coverHtml(), `${ROOT}/out/cover.pdf`, false);
  await render(browser, html, `${ROOT}/out/body.pdf`, true);
  await browser.close();
  const outDoc = await PDFDocument.create();
  for (const f of ['cover.pdf', 'body.pdf']) {
    const src = await PDFDocument.load(fs.readFileSync(`${ROOT}/out/${f}`));
    for (const p of await outDoc.copyPages(src, src.getPageIndices())) outDoc.addPage(p);
  }
  outDoc.setTitle('Freedom ChMS User Manual'); outDoc.setAuthor('Freedom Church Nairobi'); outDoc.setCreator('Insight-IQ');
  fs.writeFileSync(OUT, await outDoc.save());
  console.log('pages', outDoc.getPageCount(), OUT);
})();
