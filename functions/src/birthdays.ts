import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createCanvas, GlobalFonts, loadImage } from '@napi-rs/canvas';
import { logger } from 'firebase-functions';
import { defineSecret } from 'firebase-functions/params';
import { onSchedule } from 'firebase-functions/v2/scheduler';
import nodemailer from 'nodemailer';
import { db, FieldValue } from './common.js';
import { localDateKey } from './shared/datetime.js';
import { letterheadFor } from './shared/pettyVoucher.js';
import { cardGreeting, cardId, CARD_FONT, cleanLayout, drawGreeting, type CardLayout } from './shared/birthdayCard.js';

/**
 * The 7 a.m. birthday card email (Andy, 2026-11-01, 2A): everyone at Freedom Church with a birthday today and an
 * email address (a child's goes to the parent or guardian) gets the card with "Dear Mary," on it, from the church's
 * Gmail. Each card is recorded in birthdayCards, so it never goes twice.
 */
const CHURCH_EMAIL_APP_PASSWORD = defineSecret('CHURCH_EMAIL_APP_PASSWORD');
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

let fontReady = false;
async function defaultPicture(): Promise<Buffer> {
  return readFile(new URL('../assets/birthday.jpg', import.meta.url));
}

/** The card as a JPEG with the greeting drawn on. */
export async function renderCard(picture: Buffer, greeting: string, layout: CardLayout): Promise<Buffer> {
  if (!fontReady) {
    GlobalFonts.registerFromPath(fileURLToPath(new URL('../assets/GreatVibes-Regular.ttf', import.meta.url)), CARD_FONT);
    fontReady = true;
  }
  const img = await loadImage(picture);
  const canvas = createCanvas(img.width, img.height);
  const ctx = canvas.getContext('2d');
  ctx.drawImage(img, 0, 0);
  drawGreeting(ctx, img.width, img.height, greeting, layout);
  return canvas.toBuffer('image/jpeg', 90);
}

/** Today's "MM-DD", plus 29 February on the 28th when this year has no 29th. */
export function birthdayKeysFor(todayKey: string): string[] {
  const [y] = todayKey.split('-').map(Number);
  const key = todayKey.slice(5);
  const leap = (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
  return key === '02-28' && !leap ? ['02-28', '02-29'] : [key];
}

interface PersonDoc { fullName: string; firstName?: string; email?: string | null; status?: string; guardianId?: string | null; deletedAt?: unknown }

export async function sendBirthdayCards(now = new Date()): Promise<number> {
  const test = process.env.PETTY_MAIL_TEST_DIR;
  const orgs = await db.collection('organizations').where('type', '==', 'church_campus').get();
  let sent = 0;
  for (const org of orgs.docs) {
    if (org.get('deletedAt') != null || org.get('active') === false) continue;
    const tz = (org.get('timeZone') as string | undefined) || 'Africa/Nairobi';
    const today = localDateKey(now, tz);
    const year = Number(today.slice(0, 4));
    const people = await db.collection(`organizations/${org.id}/people`).where('birthday', 'in', birthdayKeysFor(today)).get();
    const due = people.docs.filter((d) => { const p = d.data() as PersonDoc; return !p.deletedAt && p.status !== 'inactive'; });
    if (!due.length) continue;

    const lh = letterheadFor({ type: 'church_campus', name: (org.get('name') as string) ?? '' });
    const pass = test ? 'test' : CHURCH_EMAIL_APP_PASSWORD.value().replace(/\s+/g, '');
    if (!lh.email || !pass) { logger.info(`Birthday cards skipped for ${org.id}: no church email password yet.`); continue; }
    const transport = test ? nodemailer.createTransport({ jsonTransport: true }) : nodemailer.createTransport({ service: 'gmail', auth: { user: lh.email, pass } });

    const design = (await db.doc(`organizations/${org.id}/cards/birthday`).get()).data();
    const image = typeof design?.image === 'string' ? design.image : null;
    const picture = image ? Buffer.from(image.slice(image.indexOf(',') + 1), 'base64') : await defaultPicture();
    const layout = cleanLayout(design as Partial<CardLayout> | undefined);

    for (const d of due) {
      const p = d.data() as PersonDoc;
      const ref = db.doc(`organizations/${org.id}/birthdayCards/${cardId(d.id, year)}`);
      if ((await ref.get()).get('emailAt')) continue;
      // A child's card goes to the parent or guardian (5A).
      let to = p.email ?? null;
      let toName = p.fullName;
      if ((p.status === 'child' || !to) && p.guardianId) {
        const g = (await db.doc(`organizations/${org.id}/people/${p.guardianId}`).get()).data() as PersonDoc | undefined;
        if (g?.email) { to = g.email; toName = g.fullName; }
      }
      if (!to || !EMAIL.test(to)) continue;
      const first = p.firstName || p.fullName.split(' ')[0] || p.fullName;
      try {
        const card = await renderCard(picture, cardGreeting(first), layout);
        const info = await transport.sendMail({
          from: `"${lh.name}" <${lh.email}>`, to: `"${toName.replace(/"/g, '')}" <${to}>`, replyTo: lh.email,
          subject: `Happy birthday, ${first}!`,
          text: `Happy birthday, ${first}!`,
          html: `<div style="text-align:center"><img src="cid:card" alt="Happy birthday, ${first.replace(/[<>&"]/g, '')}!" style="max-width:100%;width:560px;height:auto"></div>`,
          attachments: [{ filename: 'Happy-birthday.jpg', content: card, contentType: 'image/jpeg', cid: 'card' }],
        });
        if (test) {
          await mkdir(test, { recursive: true });
          await writeFile(join(test, `${Date.now()}-birthday-${d.id}.json`), String((info as { message?: unknown }).message ?? ''));
          await writeFile(join(test, `birthday-${d.id}.jpg`), card);
        }
        await ref.set({ orgId: org.id, personId: d.id, year, emailAt: FieldValue.serverTimestamp(), emailTo: to }, { merge: true });
        sent++;
      } catch (err) {
        logger.warn(`Birthday card for ${d.id} failed`, err);
        if ((err as { code?: string })?.code === 'EAUTH') break;
      }
    }
  }
  return sent;
}

export const birthdayCards = onSchedule(
  // Cloud Scheduler isn't offered in africa-south1, so this job runs from Europe; 7 a.m. in Nairobi.
  { schedule: 'every day 07:00', timeZone: 'Africa/Nairobi', region: process.env.SCHEDULER_REGION || 'europe-west1', timeoutSeconds: 300, memory: '512MiB', secrets: [CHURCH_EMAIL_APP_PASSWORD] },
  async () => { logger.info(`Birthday cards emailed: ${await sendBirthdayCards()}`); },
);
