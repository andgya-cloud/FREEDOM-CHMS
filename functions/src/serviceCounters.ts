import { randomBytes } from 'node:crypto';
import { logger } from 'firebase-functions';
import { HttpsError, onCall } from 'firebase-functions/v2/https';
import { db, FieldValue, requireCaller, writeAudit } from './common.js';
import { CHURCH_EMAIL_APP_PASSWORD, circleMailer, keepTestMail, appUrl, EMAIL } from './circleKit.js';
import { contactEmail } from './pettyContacts.js';
import { can, canAccessOrg } from './shared/permissions.js';
import { cleanCount, eventIdFor, isOtherServiceName, isSundayService, type Headcounts } from './shared/attendance.js';
import { addDays, occurrences, type CalendarEvent } from './shared/calendar.js';
import { localDateKey, DEFAULT_TIME_ZONE } from './shared/datetime.js';
import { poweredByHtml } from './shared/poweredBy.js';
import {
  allFinished, cleanPerson, COUNTER_INFO, COUNTER_JOBS, counterServices, countLines, isCounterJob,
  type CounterJob, type CounterJobDoc, type ServiceCountDoc,
} from './shared/counters.js';

/**
 * Phone counters (Andy, 2026-11-23, 1A-10A). One person per Sunday number, each with their own link and no
 * password (1A). Everything goes through here: the leaders set who counts what, and the counters' + taps and typed
 * numbers land in the day's service record, so the Sunday page shows them live. A counter can only change today's
 * numbers (8A); after the day only a leader can, on the Sunday page. When every counter has pressed Finished,
 * Andy gets one email with the totals (10A).
 */
const TOKEN = /^[A-Za-z0-9_-]{20,64}$/;
const ORG = /^[A-Za-z0-9_-]{1,60}$/;
const by = (job: CounterJob) => `counter:${job}`;

const jobsCol = (orgId: string) => db.collection(`organizations/${orgId}/counterJobs`);
const countRef = (orgId: string, eventId: string) => db.doc(`organizations/${orgId}/serviceCounts/${eventId}`);
const eventRef = (orgId: string, eventId: string) => db.doc(`organizations/${orgId}/events/${eventId}`);

interface Church { id: string; name: string; tz: string; otherServices: string[] }
async function loadChurch(orgId: string): Promise<Church> {
  if (!ORG.test(orgId)) throw new HttpsError('not-found', 'This link is not right.');
  const o = await db.doc(`organizations/${orgId}`).get();
  if (!o.exists || o.get('deletedAt') != null || o.get('type') !== 'church_campus') throw new HttpsError('not-found', 'This link is not right.');
  return { id: orgId, name: String(o.get('name') ?? 'Freedom Church'), tz: String(o.get('timeZone') || DEFAULT_TIME_ZONE), otherServices: (o.get('otherServices') as string[] | undefined) ?? [] };
}

async function loadJobs(orgId: string): Promise<CounterJobDoc[]> {
  const snap = await jobsCol(orgId).get();
  return snap.docs.map((d) => d.data() as CounterJobDoc).filter((j) => isCounterJob(j.job));
}

const newToken = () => randomBytes(18).toString('base64url');
const linkOf = (orgId: string, token: string) => `${appUrl()}/count/${encodeURIComponent(orgId)}/${token}`;

/** Today's services a counter can pick (6A), with today's numbers. */
async function todaysServices(church: Church, today: string) {
  const sunday = new Date(`${today}T12:00:00Z`).getUTCDay() === 0;
  const recent = await db.collection(`organizations/${church.id}/events`).where('date', '>=', addDays(today, -42)).get();
  const services = recent.docs.map((d) => ({ id: d.id, ...(d.data() as { date: string; type: string; name: string; serviceKind?: string | null; programId?: string | null; groupId?: string | null; deletedAt?: unknown; headcounts?: Headcounts }) }))
    .filter((e) => e.type === 'service' && !e.programId && !e.groupId && e.deletedAt == null);
  const started = services.filter((e) => e.date === today).map((e) => e.name);
  const lastSunday = services.filter((e) => e.date < today && isSundayService(e)).sort((a, b) => b.date.localeCompare(a.date))[0]?.name ?? null;
  const cal = await db.collection(`organizations/${church.id}/calendar`).where('type', '==', 'service').get();
  const calendar = cal.docs.map((d) => d.data() as CalendarEvent)
    .filter((e) => e.deletedAt == null && occurrences(e, today, today).length > 0)
    .sort((a, b) => (a.start ?? '').localeCompare(b.start ?? ''))
    .map((e) => ({ title: e.title, start: e.allDay ? null : e.start }));
  const names = counterServices({ today, isSunday: sunday, started, calendar, lastSunday });
  const byId = new Map(services.filter((e) => e.date === today).map((e) => [e.id, e]));
  return names.map((name) => ({ name, id: eventIdFor(today, name), counts: byId.get(eventIdFor(today, name))?.headcounts ?? {} }));
}

async function counterFor(orgId: string, token: unknown): Promise<CounterJobDoc> {
  if (typeof token !== 'string' || !TOKEN.test(token)) throw new HttpsError('not-found', 'This link is not right.');
  const snap = await jobsCol(orgId).where('token', '==', token).limit(1).get();
  const job = snap.docs[0]?.data() as CounterJobDoc | undefined;
  if (!job || !isCounterJob(job.job)) throw new HttpsError('not-found', 'This link is not right.');
  if (!job.active || !job.person) throw new HttpsError('failed-precondition', 'This link has been switched off. Please ask the church office for a new one.');
  return job;
}

async function emailAndy(church: Church, eventId: string, name: string, date: string) {
  const mail = circleMailer('church_campus');
  const to = contactEmail('Andrew Guya');
  if (!mail || !EMAIL.test(to)) return;
  const [ev, count] = await Promise.all([eventRef(church.id, eventId).get(), countRef(church.id, eventId).get()]);
  const counts = (ev.get('headcounts') ?? {}) as Headcounts;
  const lines = countLines(counts, ((count.data() as ServiceCountDoc | undefined)?.by) ?? {});
  const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const day = new Date(`${date}T12:00:00Z`).toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
  const html = `<!doctype html><html><body style="margin:0;background:#f4f5f9;font-family:Arial,Helvetica,sans-serif">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f5f9;padding:24px 0"><tr><td align="center">
<table role="presentation" width="520" cellpadding="0" cellspacing="0" style="max-width:520px;background:#ffffff;border-radius:14px;overflow:hidden">
<tr><td style="background:#2e8b57;height:6px"></td></tr>
<tr><td style="padding:22px 28px 6px;color:#6b7280;font-size:13px">${esc(church.name)} · ${esc(day)}</td></tr>
<tr><td style="padding:0 28px 12px;color:#0b112c;font-size:21px;font-weight:bold">${esc(name)}: the counts are in</td></tr>
${lines.map((l) => `<tr><td style="padding:3px 28px;color:#1f2937;font-size:16px">${esc(l)}</td></tr>`).join('')}
<tr><td style="padding:16px 28px 6px"><a href="${appUrl()}/attendance" style="background:#2e8b57;color:#fff;text-decoration:none;padding:11px 18px;border-radius:8px;font-weight:bold;display:inline-block">Open the Sunday page</a></td></tr>
<tr><td style="padding:14px 28px 22px;color:#6b7280;font-size:12px;border-top:1px solid #f1f1f1">Every counter pressed Finished.${poweredByHtml()}</td></tr>
</table></td></tr></table></body></html>`;
  try {
    const info = await mail.transport.sendMail({ from: { name: mail.name, address: mail.from }, to, subject: `${name}: the counts are in`, text: `${name}, ${day}\n\n${lines.join('\n')}`, html });
    await keepTestMail(mail.test, info, 'counts');
  } catch (err) {
    logger.warn('Counts email was not sent', err);
  }
}

export const serviceCounters = onCall({ invoker: 'public', memory: '512MiB', timeoutSeconds: 60, maxInstances: 10, secrets: [CHURCH_EMAIL_APP_PASSWORD] }, async (request) => {
  const data = (request.data ?? {}) as Record<string, unknown>;
  const orgId = typeof data.orgId === 'string' ? data.orgId : '';
  const action = String(data.action ?? '');
  const church = await loadChurch(orgId);
  const today = localDateKey(new Date(), church.tz);

  /* ---------- The leaders: who counts what (Andy and those with rota.manage) ---------- */
  if (['jobs', 'saveJob', 'newLink', 'switch'].includes(action)) {
    const caller = await requireCaller(request);
    if (!canAccessOrg(caller.profile, orgId) || !(can(caller.profile, 'users.manage') || can(caller.profile, 'rota.manage'))) {
      throw new HttpsError('permission-denied', 'Only Mr Andrew and the leaders he ticks can set the counters.');
    }
    if (action !== 'jobs') {
      const job = data.job;
      if (!isCounterJob(job)) throw new HttpsError('invalid-argument', 'Please pick a number to count.');
      const ref = jobsCol(orgId).doc(job);
      const old = (await ref.get()).data() as CounterJobDoc | undefined;
      const next: CounterJobDoc = { job, person: old?.person ?? '', phone: old?.phone ?? '', token: old?.token || newToken(), active: old?.active ?? true };
      if (action === 'saveJob') {
        next.person = cleanPerson(data.person);
        next.phone = cleanPerson(data.phone).slice(0, 30);
        if (next.person && !old?.person) next.active = true;
      }
      if (action === 'newLink') next.token = newToken();
      if (action === 'switch') next.active = data.active === true;
      await ref.set({ ...next, updatedAt: FieldValue.serverTimestamp(), updatedBy: caller.uid });
      await writeAudit({ actorUid: caller.uid, actorEmail: caller.email, action: 'update', path: ref.path, collection: 'counterJobs', docId: job, orgId, changedFields: ['person', 'phone', 'token', 'active'], note: `${action} ${COUNTER_INFO[job].label}` });
    }
    const jobs = await loadJobs(orgId);
    return {
      jobs: COUNTER_JOBS.map((k) => {
        const j = jobs.find((x) => x.job === k);
        return { job: k, person: j?.person ?? '', phone: j?.phone ?? '', active: j ? j.active : false, link: j?.token ? linkOf(orgId, j.token) : '' };
      }),
      church: church.name,
    };
  }

  /* ---------- A counter's own link ---------- */
  const job = await counterFor(orgId, data.token);
  const services = await todaysServices(church, today);

  const pickService = () => {
    const name = typeof data.service === 'string' ? data.service.trim() : '';
    const s = services.find((x) => x.name === name);
    if (!s) throw new HttpsError('failed-precondition', 'This service is not on today\'s list. Please pick it again.');
    return s;
  };

  if (action === 'count' || action === 'finish') {
    const s = pickService();
    const ref = eventRef(orgId, s.id);
    const stamps = { updatedAt: FieldValue.serverTimestamp(), updatedBy: by(job.job) };
    const add = Math.floor(Number(data.add));
    const set = data.set !== undefined ? cleanCount(data.set) : null;
    if (action === 'count') {
      if (set === null && !(add >= 1 && add <= 500)) throw new HttpsError('invalid-argument', 'Please tap + or type the number.');
      await db.runTransaction(async (tx) => {
        const ev = await tx.get(ref);
        if (ev.exists && ev.get('deletedAt') != null) throw new HttpsError('failed-precondition', 'This service was removed. Please ask the church office.');
        if (!ev.exists) {
          tx.set(ref, {
            orgId, date: today, type: 'service', name: s.name.slice(0, 120), activity: null, headcounts: { [job.job]: set ?? add }, notes: '',
            serviceKind: isOtherServiceName(church.otherServices, s.name) ? 'other' : null,
            deletedAt: null, deletedBy: null, createdAt: FieldValue.serverTimestamp(), createdBy: by(job.job), ...stamps,
          });
        } else {
          tx.update(ref, { [`headcounts.${job.job}`]: set ?? FieldValue.increment(add), ...stamps });
        }
        tx.set(countRef(orgId, s.id), { eventId: s.id, date: today, name: s.name, by: { [job.job]: { person: job.person, done: false } } }, { merge: true });
      });
    } else {
      const ev = await ref.get();
      if (!ev.exists) {
        // Finished with nothing counted: a real 0 (for example no salvations today).
        await ref.set({
          orgId, date: today, type: 'service', name: s.name.slice(0, 120), activity: null, headcounts: { [job.job]: 0 }, notes: '',
          serviceKind: isOtherServiceName(church.otherServices, s.name) ? 'other' : null,
          deletedAt: null, deletedBy: null, createdAt: FieldValue.serverTimestamp(), createdBy: by(job.job), ...stamps,
        }, { merge: true });
      }
      const jobs = await loadJobs(orgId);
      const send = await db.runTransaction(async (tx) => {
        const c = await tx.get(countRef(orgId, s.id));
        const doc = (c.data() as ServiceCountDoc | undefined) ?? { eventId: s.id, date: today, name: s.name, by: {} };
        const nextBy = { ...doc.by, [job.job]: { person: job.person, done: true } };
        const ready = !doc.emailed && allFinished(jobs, nextBy);
        tx.set(countRef(orgId, s.id), { eventId: s.id, date: today, name: s.name, by: nextBy, ...(ready ? { emailed: true } : {}) }, { merge: true });
        return ready;
      });
      if (send) await emailAndy(church, s.id, s.name, today);
    }
    const fresh = (await ref.get()).get('headcounts') as Headcounts | undefined;
    return { count: Number(fresh?.[job.job]) || 0 };
  }

  if (action === 'info') {
    const counted = await Promise.all(services.map((s) => countRef(orgId, s.id).get()));
    return {
      church: church.name, job: job.job, person: job.person.split(' ')[0] || job.person, today,
      services: services.map((s, i) => ({
        name: s.name, count: Number(s.counts[job.job]) || 0,
        done: ((counted[i]!.data() as ServiceCountDoc | undefined)?.by?.[job.job]?.done) === true,
      })),
    };
  }
  throw new HttpsError('invalid-argument', 'Unknown action.');
});
