import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../../state/AuthContext';
import { useToast } from '../../state/ToastContext';
import { friendlyError } from '../../lib/errors';
import { feesOwing, saveMeals } from '../../lib/hopeRecords';
import { canCountMeals, canKeepFees, canReadNotes, formatKes, MEAL_EMOJI, MEALS, type MealDay } from '../../../functions/src/shared/hopeRecords';
import { consentMissing, isCurrentChild } from '../../../functions/src/shared/hope';
import { birthdayThisWeek, missedSaturdays, rateFrom, type HopeDay } from '../../../functions/src/shared/hopeRegister';
import { formatDateKey } from '../../../functions/src/shared/datetime';
import { useChats } from './HopeChatsPage';
import { useChampionPay, useChampions } from '../../state/useHope';
import { isChampionManager } from '../../../functions/src/shared/hopeChampionPay';
import { monthPay, payMonthReady } from '../../../functions/src/shared/hopeChampionPay';
import type { useHopePage } from './common';
import type { Organization } from '../../state/OrgContext';
import type { Club, ClubDay } from '../../../functions/src/shared/hopeClubs';

type H = ReturnType<typeof useHopePage>;

/**
 * Today on an open day (Andy, 2026-11-05, v173 11A and 14A): one live board with Check in, the children and
 * helpers here, the meals and the clubs meeting today. Once children are checked in, the meals are one tap:
 * "28 children here. Serve 28 breakfasts, lunches and fruit?"
 */
export function LiveBoard({ org, h, days, helpers, meals, clubsToday, clubDays }: {
  org: Organization; h: H; days: HopeDay[]; helpers: { uid: string; name: string; t: string }[]; meals: (MealDay & { id: string })[];
  clubsToday: Club[]; clubDays: ClubDay[]; marker?: boolean;
}) {
  const { profile } = useAuth();
  const toast = useToast();
  const kids = rateFrom(Object.values(days.find((d) => d.date === h.today)?.marks ?? {}));
  const today = meals.find((m) => m.date === h.today);
  const counter = canCountMeals(profile, org.id);
  const [skip, setSkip] = useState(false);

  function serve() {
    try {
      saveMeals(org.id, h.today, { breakfast: kids.present, lunch: kids.present, fruit: kids.present }).catch((err) => toast.show(friendlyError(err)));
      toast.show(`Meals saved: ${kids.present} of each`);
    } catch (err) { toast.show(friendlyError(err)); }
  }

  return (
    <section className="card ht-live" aria-label="Today, live">
      <div className="ht-live-stats">
        <Link to="/hope/register?d=today"><span aria-hidden="true">👧</span><b>{kids.present}</b><span>children here</span></Link>
        <Link to="/hope/register?w=champions"><span aria-hidden="true">🙋</span><b>{helpers.length}</b><span>{helpers.length ? helpers.map((x) => x.name.split(' ')[0]).join(', ') : 'helpers here'}</span></Link>
        <Link to="/hope/meals"><span aria-hidden="true">🍽️</span><b>{today ? today.breakfast + today.lunch + today.fruit : '–'}</b><span>{today ? MEALS.map((k) => `${MEAL_EMOJI[k]} ${today[k]}`).join(' ') : 'meals not counted'}</span></Link>
        <Link to={clubsToday.length === 1 ? `/hope/clubs/${clubsToday[0]!.id}` : '/hope/register?w=club'}><span aria-hidden="true">⭐</span><b>{clubsToday.length}</b>
          <span>{clubsToday.length ? clubsToday.map((x) => {
            const r = rateFrom(Object.values(clubDays.find((d) => d.clubId === x.id && d.date === h.today)?.marks ?? {}));
            return `${x.emoji || ''} ${x.name.replace(/ (Academy|Club)$/i, '')}${r.marked ? ` ${r.present}` : x.time ? ` ${x.time}` : ''}`;
          }).join(', ') : 'clubs today'}</span></Link>
      </div>
      {counter && !today && kids.present > 0 && !skip && (
        <div className="ht-serve">
          <span className="grow"><b>{kids.present} {kids.present === 1 ? 'child' : 'children'} here.</b> Serve {kids.present} {kids.present === 1 ? 'breakfast, lunch and fruit' : 'breakfasts, lunches and fruit'}?</span>
          <button type="button" className="btn btn-primary" onClick={serve}>Yes</button>
          <Link to="/hope/meals" className="btn btn-quiet" onClick={() => setSkip(true)}>Change</Link>
        </div>
      )}
    </section>
  );
}

/**
 * Check in, right under the greeting (Andy, 2026-11-05). On an open day it shows how many are here; on other days
 * a calm line about last Saturday and the next one.
 */
export function HeroCheckin({ h, days, marker, openDay }: { h: H; days: HopeDay[]; marker: boolean; openDay: boolean }) {
  const current = h.children.filter(isCurrentChild).length;
  const kids = rateFrom(Object.values(days.find((d) => d.date === h.today)?.marks ?? {}));
  const last = [...days].filter((d) => Object.keys(d.marks ?? {}).length > 0 && d.date < h.today).sort((a, b) => b.date.localeCompare(a.date))[0];
  const r = last ? rateFrom(Object.values(last.marks)) : null;
  const dow = new Date(`${h.today}T12:00:00Z`).getUTCDay();
  const toSat = (6 - dow + 7) % 7;
  const calm = `${last && r ? `${formatDateKey(last.date)}: ${r.present} came. ` : ''}${toSat ? `Saturday is in ${toSat} ${toSat === 1 ? 'day' : 'days'}.` : ''}`;
  const sub = openDay || kids.marked ? `${kids.present} of ${current} children here${kids.absent ? ` · ${kids.absent} absent` : ''}` : `A quiet day. ${calm}`;
  const share = current ? Math.min(100, Math.round((kids.present / current) * 100)) : 0;
  if (!marker) return <p className="small muted ht-hero-calm">{sub}</p>;
  return (
    <Link to="/hope/register?d=today" className="ht-checkin ht-hero-checkin">
      <span className="ht-checkin-ico" aria-hidden="true">✅</span>
      <span className="grow"><b>{kids.marked ? 'Carry on checking in' : 'Check in'}</b><span>{sub}</span>
        {(openDay || kids.marked > 0) && <span className="ht-sat-meter" aria-hidden="true"><i style={{ width: `${share}%` }} /></span>}</span>
    </Link>
  );
}

type Line = { key: string; icon: string; who: string; why: string; to: string; tel?: string };

/**
 * Children who need us (Andy, 2026-11-05, v173 13A): each child to act on, with one tap to their page (or a call).
 * Missed the last 3 Saturdays, fees still owing this term, consent missing, an open urgent conversation, a birthday.
 * Many of one reason fold into one line.
 */
export function NeedsUs({ org, h, days }: { org: Organization; h: H; days: HopeDay[] }) {
  const { profile } = useAuth();
  const reader = canReadNotes(profile, org.id);
  const fees = canKeepFees(profile, org.id);
  const chats = useChats(org.id).list;
  const [owing, setOwing] = useState<{ childId: string; left: number }[]>([]);
  const [all, setAll] = useState(false);
  useEffect(() => { if (fees) feesOwing(org.id).then((r) => setOwing(r.owing), () => setOwing([])); }, [fees, org.id]);

  const groups = useMemo(() => {
    const current = h.children.filter(isCurrentChild);
    const name = (id: string) => h.nameOf(id);
    const out: { reason: string; icon: string; more: string; lines: Line[] }[] = [];
    if (reader && chats) {
      const open = chats.chats.filter((c) => c.status === 'open');
      out.push({ reason: 'urgent', icon: '🔴', more: '/hope/chats', lines: open.map((c) => ({ key: `u${c.id}`, icon: '🔴', who: c.childName, why: 'Urgent conversation, not yet handled', to: `/hope/chats/${c.id}` })) });
    }
    out.push({ reason: 'missed', icon: '📞', more: '/hope/children?show=missed', lines: current.filter((c) => missedSaturdays(c.id, c.enrolledOn, days)).map((c) => ({
      key: `m${c.id}`, icon: '📞', who: name(c.id), why: 'Missed the last 3 Saturdays', to: `/hope/children/${c.id}?tab=attendance`, tel: c.parentPhone || undefined })) });
    if (fees) {
      const ids = new Set(current.map((c) => c.id));
      out.push({ reason: 'fees', icon: '💳', more: '/hope/children?show=owing', lines: owing.filter((o) => ids.has(o.childId)).map((o) => ({
        key: `f${o.childId}`, icon: '💳', who: name(o.childId), why: `${formatKes(o.left)} fees still to pay this term`, to: `/hope/children/${o.childId}?tab=fees` })) });
    }
    out.push({ reason: 'consent', icon: '📝', more: '/hope/consent', lines: current.filter(consentMissing).map((c) => ({
      key: `c${c.id}`, icon: '📝', who: name(c.id), why: 'Consent missing', to: `/hope/children/${c.id}?tab=about` })) });
    out.push({ reason: 'birthday', icon: '🎈', more: '/hope/children?show=birthdays', lines: current.filter((c) => birthdayThisWeek(c.dateOfBirth, h.today)).map((c) => ({
      key: `b${c.id}`, icon: '🎈', who: name(c.id), why: 'Birthday this week', to: `/hope/children/${c.id}` })) });
    return out.filter((g) => g.lines.length);
  }, [h, days, reader, chats, fees, owing]);

  const count = groups.reduce((n, g) => n + g.lines.length, 0);
  if (!count) return null;
  const FOLD = 3;
  const SUMMARY: Record<string, (n: number) => string> = {
    urgent: (n) => `${n} urgent conversations not yet handled`,
    missed: (n) => `${n} children missed the last 3 Saturdays`,
    fees: (n) => `${n} children have fees still to pay this term`,
    consent: (n) => `${n} children need consent recorded`,
    birthday: (n) => `${n} birthdays this week`,
  };
  return (
    <section className="card ht-needs" aria-label="Children who need us">
      <h2>Children who need us</h2>
      <ul className="ht-needs-list">
        {groups.map((g) => (g.lines.length > FOLD && !all
          ? <li key={g.reason}><Link to={g.more}><span aria-hidden="true">{g.icon}</span><span className="grow"><b>{SUMMARY[g.reason]!(g.lines.length)}</b></span><span aria-hidden="true">›</span></Link></li>
          : g.lines.map((l) => (
            <li key={l.key}>
              <Link to={l.to}><span aria-hidden="true">{l.icon}</span><span className="grow"><b>{l.who}</b><span className="small muted">{l.why}</span></span><span aria-hidden="true">›</span></Link>
              {l.tel && <a className="btn btn-quiet" href={`tel:${l.tel}`} aria-label={`Call ${l.who}'s parent`}>📞 Call</a>}
            </li>
          ))))}
      </ul>
      {groups.some((g) => g.lines.length > FOLD) && <button type="button" className="btn btn-quiet align-start" onClick={() => setAll((v) => !v)}>{all ? 'Show less' : `Show all ${count}`}</button>}
    </section>
  );
}

/**
 * Champions' pay is ready (Andy, 2026-11-05, 10A): on the 28th to check, and from the 1st as the final report, for the
 * Director (and admins) only, until it is approved.
 */
export function PayReady({ org, today }: { org: Organization; today: string }) {
  const { profile } = useAuth();
  const manager = isChampionManager(profile, org.id);
  const ready = payMonthReady(today);
  const data = useChampions(manager && ready ? org.id : '');
  const pay = useChampionPay(org.id, manager && !!ready);
  if (!manager || !ready || data.loading) return null;
  const r = monthPay(data.champions, data.days, pay.extras, ready.month);
  const approved = pay.approved.find((a) => a.id === ready.month);
  if (!r.total || (approved && approved.total === r.total)) return null;
  const name = new Intl.DateTimeFormat('en-GB', { month: 'long', timeZone: 'UTC' }).format(new Date(`${ready.month}-15T12:00:00Z`));
  return (
    <Link to="/hope/register?w=champions&tab=pay" className="card ht-pay">
      <span aria-hidden="true">💵</span>
      <span className="grow"><b>Champions' pay for {name} is {ready.final ? 'ready' : 'ready to check'}</b><span className="small muted">{formatKes(r.total)} for {r.lines.filter((l) => l.total > 0).length} champions. Check and approve it.</span></span>
      <span aria-hidden="true">›</span>
    </Link>
  );
}
