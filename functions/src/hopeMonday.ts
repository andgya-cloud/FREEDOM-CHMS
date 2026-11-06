import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { logger } from 'firebase-functions/v2';
import { defineSecret } from 'firebase-functions/params';
import { onSchedule } from 'firebase-functions/v2/scheduler';
import nodemailer from 'nodemailer';
import { db } from './common.js';
import { contactsFor, plainName } from './pettyContacts.js';
import { letterheadFor } from './shared/pettyVoucher.js';
import { localDateKey } from './shared/datetime.js';
import { POWERED_BY, poweredByHtml } from './shared/poweredBy.js';
import { mondaySummary } from './shared/hopeMonday.js';
import type { Child } from './shared/hope.js';
import type { Champion, ChampionDay, HopeDay } from './shared/hopeRegister.js';
import type { ChampionExtra } from './shared/hopeChampionPay.js';
import type { MealDay } from './shared/hopeRecords.js';
import type { HopeChat } from './shared/hopeChats.js';

const HOPE_EMAIL_APP_PASSWORD = defineSecret('HOPE_EMAIL_APP_PASSWORD');
/** Andy approved this one automatic email (2026-11-05, 16A): to him and the Director, every Monday at 7am. */
const TO = ['Andrew Guya', 'Diana Kiunga'];
const appUrl = () => process.env.APP_URL || 'https://freedom-chms.web.app';
const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

export async function sendMondaySummaries(now = new Date()): Promise<void> {
  const from = letterheadFor({ type: 'ministry', name: '' }).email;
  const test = process.env.PETTY_MAIL_TEST_DIR;
  const pass = test ? 'test' : HOPE_EMAIL_APP_PASSWORD.value().replace(/\s+/g, '');
  if (!from || !pass) { logger.warn('Monday summary: no Hope email sender set'); return; }
  const transport = test ? nodemailer.createTransport({ jsonTransport: true }) : nodemailer.createTransport({ service: 'gmail', auth: { user: from, pass } });
  const to = contactsFor('ministry').filter((c) => TO.some((n) => plainName(n) === plainName(c.name))).map((c) => c.email).filter(Boolean);
  if (!to.length) return;
  const today = localDateKey(now);
  const orgs = await db.collection('organizations').where('type', '==', 'ministry').get();
  for (const org of orgs.docs) {
    if (org.get('deletedAt') != null || org.get('active') === false) continue;
    try {
      const base = org.ref;
      const all = async <T>(name: string) => (await base.collection(name).get()).docs.map((d) => ({ id: d.id, ...d.data() }) as T & { id: string });
      const [children, people, days, meals, champions, championDays, extras, approved, chats] = await Promise.all([
        all<Child>('children'), base.collection('people').where('status', '==', 'child').get(), all<HopeDay>('hopeDays'), all<MealDay>('hopeMeals'),
        all<Champion>('champions'), all<ChampionDay>('championDays'), all<ChampionExtra>('championExtras'), all<{ total: number }>('championPay'), all<HopeChat>('hopeChats'),
      ]);
      const first: Record<string, string> = {};
      for (const p of people.docs) first[p.id] = String(p.get('fullName') ?? '').trim().split(/\s+/)[0] ?? '';
      const open = chats.filter((c) => c.status === 'open' || c.status === 'handling');
      const { subject, lines } = mondaySummary({
        today, children: children.filter((c) => !(c as { deletedAt?: unknown }).deletedAt), firstName: (id) => first[id] ?? '',
        days, meals, champions, championDays, extras: extras.filter((e) => !e.deletedAt), approvedPay: approved,
        openChats: open.length, urgentChildIds: new Set(open.filter((c) => c.status === 'open').map((c) => c.childId)),
      });
      const name = String(org.get('name') ?? 'Freedom Hope Center');
      const text = [`Good morning,`, '', `Here is ${name} this week.`, '', ...lines, '', `Open Insight-IQ: ${appUrl()}/hope`, '', 'This summary shows numbers and first names only.', '', POWERED_BY].join('\n');
      const html = `<div style="font-family:Arial,sans-serif;max-width:560px;margin:auto;color:#1d2b22">
<div style="background:#038241;color:#fff;padding:16px 20px;border-radius:12px 12px 0 0"><b style="font-size:18px">${esc(name)}</b><br>Monday summary</div>
<div style="padding:16px 20px;border:1px solid #e3ece6;border-top:0;border-radius:0 0 12px 12px">
<p>Good morning,</p>${lines.map((l) => (!l ? '' : /^[A-Z ]+(\d|$)/.test(l) && l === l.toUpperCase() ? `<h3 style="color:#038241;margin:16px 0 6px;font-size:14px">${esc(l)}</h3>` : `<p style="margin:4px 0">${esc(l)}</p>`)).join('')}
<p style="margin-top:18px"><a href="${appUrl()}/hope" style="background:#038241;color:#fff;padding:10px 16px;border-radius:999px;text-decoration:none">Open Insight-IQ</a></p>
<p style="color:#6b7280;font-size:12px">This summary shows numbers and first names only.</p>${poweredByHtml()}</div></div>`;
      const info = await transport.sendMail({ from: `${name} <${from}>`, to, subject, text, html });
      if (test) { await mkdir(test, { recursive: true }); await writeFile(join(test, `${Date.now()}-monday.json`), String((info as { message?: unknown }).message ?? '')); }
      logger.info(`Monday summary for ${org.id} sent to ${to.length}`);
    } catch (err) {
      logger.error(`Monday summary for ${org.id} failed`, err);
    }
  }
}

export const hopeMondaySummary = onSchedule(
  { schedule: 'every monday 07:00', timeZone: 'Africa/Nairobi', region: process.env.SCHEDULER_REGION || 'europe-west1', timeoutSeconds: 300, memory: '512MiB', secrets: [HOPE_EMAIL_APP_PASSWORD] },
  () => sendMondaySummaries(),
);
