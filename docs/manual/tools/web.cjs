// Makes the in-app manual from the same pages as the PDF: src/lib/manualData.ts and public/manual/<id>.jpg.
// Run: node web.cjs   (needs python3 with Pillow for the pictures)
const fs = require('fs');
const { execFileSync } = require('child_process');
const APP = process.env.APP || '/home/user/freedom-chms';
const SHOTS = process.env.SHOTS || '/home/user/manual/shots/m';
const front = require('./front.cjs');
const back = require('./back.cjs');
const TOPICS = [...require('./spec-church.cjs'), ...require('./spec-adia.cjs'), ...require('./spec-hope.cjs'), ...require('./spec-shared.cjs'), ...require('./spec-admin.cjs')];

const strip = (h) => h.replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();
const bold = (h) => h.replace(/<b>(.*?)<\/b>/g, '**$1**').replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
const rows = (h) => [...h.matchAll(/<tr>(.*?)<\/tr>/gs)].map((m) => [...m[1].matchAll(/<td[^>]*>(.*?)<\/td>/gs)].map((c) => bold(c[1]))).filter((r) => r.length);

// A demo id or date in an address becomes '*', so the guide can match the real page.
const pattern = (p) => p.split('/').map((s) => (/^[A-Za-z0-9]{20}$/.test(s) || /^\d{4}-\d{2}-\d{2}/.test(s) ? '*' : s)).join('/');

const outImg = `${APP}/public/manual`;
fs.mkdirSync(outImg, { recursive: true });
const jobs = [];
const topics = TOPICS.map((t) => {
  const shots = (t.shots || []).filter((s) => !s.noPrint);
  const shot = shots.find((s) => s.device === 'm') || shots[0];
  const name = shot ? shot.name || t.id : null;
  if (name && fs.existsSync(`${SHOTS}/${name}.png`)) jobs.push([`${SHOTS}/${name}.png`, `${outImg}/${t.id}.jpg`, shot.device === 'd' ? 900 : 520]);
  const path = (t.shots || []).find((s) => s.path && !s.signedOut)?.path;
  return {
    id: t.id, part: t.part, title: t.title, purpose: t.purpose, who: t.who, where: t.where,
    ...(t.before && { before: t.before }), steps: t.steps, ...(t.see && { see: t.see }), ...(t.tip && { tip: t.tip }), ...(t.warn && { warn: t.warn }),
    ...(name && jobs.some((j) => j[1].endsWith(`/${t.id}.jpg`)) && { img: `/manual/${t.id}.jpg`, wide: shot.device === 'd' }),
    ...(path && { path: pattern(path) }),
  };
});
fs.writeFileSync('/tmp/manual-img-jobs.json', JSON.stringify(jobs));
execFileSync('python3', ['-c', `
import json
from PIL import Image
for src, dst, w in json.load(open('/tmp/manual-img-jobs.json')):
    im = Image.open(src).convert('RGB')
    if im.width > w: im = im.resize((w, round(im.height * w / im.width)), Image.LANCZOS)
    im.save(dst, 'JPEG', quality=72, optimize=True, progressive=True)
`], { stdio: 'inherit' });

const pages = front.pages({ md: (s) => s, esc: (s) => s, VERSION: '1.0', DATE: 'November 2026', APPV: 'v256' });
const roleHtml = pages.find((p) => p.id === 'roles').html;
const ROLE_IDS = { Pastor: 'pastor', Admin: 'admin', 'Organization head': 'head', Staff: 'staff', Usher: 'usher', Finance: 'finance', 'Petty cash signatory': 'signatory', Principal: 'principal', Trainer: 'trainer', 'Lab technician': 'labtech', 'Hope helper': 'helper', Reviewer: 'reviewer' };
const roles = rows(roleHtml).map(([role, does, read]) => {
  const card = back.CARDS.find((c) => c.role === role) || {};
  return { roleId: ROLE_IDS[role], role, does, read, menu: card.menu, jobs: (card.jobs || []).map((j) => (j === 'g-screen' ? 'g-screen' : j)), remember: card.remember || [] };
});

const sections = (html) => html.split(/<h2>/).slice(1).map((s) => ({ h: strip(s.split('</h2>')[0]), items: [...s.matchAll(/<li>(.*?)<\/li>/gs)].map((m) => bold(m[1])) }));
const privacyHtml = back.privacy();
const privacy = { intro: strip(privacyHtml.match(/<\/h1>\s*<p>(.*?)<\/p>/s)[1]), sections: sections(privacyHtml), warn: strip(privacyHtml.match(/Warning<\/span>(.*?)<\/div>/s)[1]) };
const problems = rows(back.problems());
const words = rows(back.words());
const contacts = rows(back.contacts());

const how = pages.find((p) => p.id === 'how').html;
const welcome = [...pages.find((p) => p.id === 'welcome').html.matchAll(/<p>(.*?)<\/p>/gs)].map((m) => bold(m[1]));

const ts = `// Made by docs/manual/tools/web.cjs from the manual's pages. Do not edit by hand: change the spec files and run it again.
export type ManualPartKey = 'start' | 'church' | 'adia' | 'hope' | 'shared' | 'admin';
export interface ManualTopic { id: string; part: ManualPartKey; title: string; purpose: string; who: string; where: string; before?: string; steps: string[]; see?: string; tip?: string; warn?: string; img?: string; wide?: boolean; path?: string }
export interface ManualRole { roleId: string; role: string; does: string; read: string; menu?: string; jobs: string[]; remember: string[] }

export const MANUAL_VERSION = '1.0, November 2026';
export const MANUAL_PARTS: Record<ManualPartKey, { n: string; title: string; color: string; intro: string }> = ${JSON.stringify({
  start: { n: 'Getting started', title: 'Getting started', color: '#1f2a5c', intro: 'Signing in, finding your way around the screen, putting the app on your phone and getting help.' },
  church: { n: 'Part 1', title: 'Freedom Church Nairobi', color: '#2f6b47', intro: 'People, Sunday services, first-timers and follow-ups, giving and reports.' },
  adia: { n: 'Part 2', title: 'ADIA Training Centre', color: '#1f2a5c', intro: 'Students, the register, fees, exams, graduation, payroll, Tutor Files and inventory.' },
  hope: { n: 'Part 3', title: 'Freedom Hope Center', color: '#038241', intro: 'Children, Saturday registers and gate sign-in, clubs, parents, sponsors and reports.' },
  shared: { n: 'Part 4', title: 'Shared by all three', color: '#7a5a12', intro: 'Petty cash, signing, bank and financial statements, and the AI helps.' },
  admin: { n: 'Administrator guide', title: 'Accounts and settings', color: '#14213d', intro: 'For Mr Andrew and Doreen: staff accounts, passwords, reviewers and settings.' },
}, null, 2)};
export const MANUAL_TOPICS: ManualTopic[] = ${JSON.stringify(topics, null, 1)};
export const MANUAL_ROLES: ManualRole[] = ${JSON.stringify(roles, null, 1)};
export const MANUAL_PRIVACY = ${JSON.stringify(privacy, null, 1)};
export const MANUAL_PROBLEMS: [string, string][] = ${JSON.stringify(problems)};
export const MANUAL_WORDS: [string, string][] = ${JSON.stringify(words)};
export const MANUAL_CONTACTS: [string, string][] = ${JSON.stringify(contacts)};
export const MANUAL_WELCOME: string[] = ${JSON.stringify(welcome)};
export const MANUAL_HOW: [string, string][] = ${JSON.stringify(rows(how).filter((r) => r.length === 2))};
`;
fs.writeFileSync(`${APP}/src/lib/manualData.ts`, ts);
console.log(`${topics.length} topics, ${jobs.length} pictures, ${roles.length} roles`);
