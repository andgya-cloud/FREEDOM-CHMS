import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../../state/AuthContext';
import { useToast } from '../../state/ToastContext';
import { friendlyError } from '../../lib/errors';
import { addNote, feesOwing, saveMeals } from '../../lib/hopeRecords';
import { canAddLeavingNote, canCountMeals, canKeepFees, canReadNotes, formatKes, MEAL_EMOJI, MEALS, type MealDay } from '../../../functions/src/shared/hopeRecords';
import { consentMissing, isCurrentChild } from '../../../functions/src/shared/hope';
import { birthdayThisWeek, needsCall, rateFrom, type HopeDay } from '../../../functions/src/shared/hopeRegister';
import { formatDateKey } from '../../../functions/src/shared/datetime';
import { useChats } from './HopeChatsPage';
import { useChampionPay, useChampions, useChildPhotos } from '../../state/useHope';
import { Avatar } from './registerParts';
import { isChampionManager } from '../../../functions/src/shared/hopeChampionPay';
import { monthPay, payMonthReady } from '../../../functions/src/shared/hopeChampionPay';
import type { useHopePage } from './common';
import { fillMessage, MESSAGE_TEMPLATES, waLink } from '../../../functions/src/shared/hopeMessages';
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
        <Link to="/hope/attendance/today#meals"><span aria-hidden="true">🍽️</span><b>{today ? today.breakfast + today.lunch + today.fruit : '–'}</b><span>{today ? MEALS.map((k) => `${MEAL_EMOJI[k]} ${today[k]}`).join(' ') : 'meals not counted'}</span></Link>
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
          <Link to="/hope/attendance/today#meals" className="btn btn-quiet" onClick={() => setSkip(true)}>Change</Link>
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

type Line = { key: string; who: string; why: string; to: string; childId?: string; tel?: string; wa?: string; call?: { childId: string; name: string } };
type Family = 'urgent' | 'money' | 'children';
type Group = { reason: string; family: Family; more: string; lines: Line[]; big?: string; label?: string; sub?: string };

/** Clean line icons in soft colour circles (Andy, 2026-11-06, v196 4A). */
const ICON_PATHS: Record<string, string> = {
  urgent: 'M12 8v5M12 16.5v.01M10.3 3.9 2.6 17.5A2 2 0 0 0 4.3 20.5h15.4a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z',
  unread: 'M21 12a8 8 0 0 1-11.6 7.1L4 20.5l1.4-4.9A8 8 0 1 1 21 12Z',
  pay: 'M3 7h18v10H3zM12 9.5a2.5 2.5 0 1 0 0 5 2.5 2.5 0 0 0 0-5ZM6.5 10v4M17.5 10v4',
  fees: 'M3 6h18v12H3zM3 10h18M7 15h4',
  missed: 'M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2Z',
  consent: 'M9 4h6v3H9zM7 5.5H5v15h14v-15h-2M9 13l2 2 4-4',
  departing: 'M14 4h5v16h-5M10 8l-4 4 4 4M6 12h10',
  birthday: 'M4 20h16M5 20v-7h14v7M12 13V9M12 6.5c-1 0-1.5-.8-1.5-1.5S12 3 12 3s1.5 1.3 1.5 2-.5 1.5-1.5 1.5ZM5 16c2 1 3.5 1 5 0s3-1 5 0 3 1 4 0',
};
function NeedIcon({ name }: { name: string }) {
  return (
    <span className={`nu-ico nu-ico-${name}`} aria-hidden="true">
      <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d={ICON_PATHS[name] ?? ICON_PATHS.urgent} /></svg>
    </span>
  );
}

const FAMILY_OF: Record<string, Family> = { urgent: 'urgent', unread: 'urgent', pay: 'money', fees: 'money', missed: 'children', consent: 'children', departing: 'children', birthday: 'children' };
const TILE_LABEL: Record<string, string> = { unread: 'New messages', pay: "Champions' pay", fees: 'Fees still to pay', missed: 'Missed 3 Saturdays', consent: 'Consent missing', departing: 'Departing' };
const TILE_SUB: Record<string, string> = { unread: 'Open Care to read them', fees: 'This term', missed: 'Call or WhatsApp the parents', consent: 'Record it on their page', departing: 'Say goodbye well' };
const PILLS: { id: 'all' | Family; label: string }[] = [{ id: 'all', label: 'All' }, { id: 'urgent', label: 'Urgent' }, { id: 'children', label: 'Children' }, { id: 'money', label: 'Money' }];

/**
 * Needs you (v182; redesigned v196, Andy chose 1A to 7A): urgent conversations as one red banner with the children's
 * faces (one line per child), then a grid of colour tiles, one for each kind, each with a big count, the first two
 * names and Open; birthdays in a Celebrate strip; pills to show only Urgent, Children or Money.
 */
export function NeedsUs({ org, h, days, unread }: { org: Organization; h: H; days: HopeDay[]; unread?: number }) {
  const { profile } = useAuth();
  const toast = useToast();
  const reader = canReadNotes(profile, org.id);
  const fees = canKeepFees(profile, org.id);
  const caller = canAddLeavingNote(profile, org.id);
  const chats = useChats(org.id).list;
  const pay = usePayReady(org, h.today);
  const photos = useChildPhotos(org.id);
  const [owing, setOwing] = useState<{ childId: string; left: number }[]>([]);
  const [pill, setPill] = useState<'all' | Family>('all');
  const [done, setDone] = useState<{ childId: string; name: string } | null>(null);
  const [note, setNote] = useState('');
  const [hidden, setHidden] = useState<string[]>([]);
  useEffect(() => { if (fees) feesOwing(org.id).then((r) => setOwing(r.owing), () => setOwing([])); }, [fees, org.id]);
  const missedText = MESSAGE_TEMPLATES.find((t) => t.id === 'missed')?.text ?? 'Hello {parent}, we have missed {child} at the Hope Centre.';

  const { urgent, groups } = useMemo(() => {
    const current = h.children.filter(isCurrentChild);
    const name = (id: string) => h.nameOf(id);
    // One line per child, however many urgent conversations they have (3A).
    const urgent: Line[] = [];
    if (reader && chats) {
      const byChild = new Map<string, typeof chats.chats>();
      for (const c of chats.chats.filter((x) => x.status === 'open')) byChild.set(c.childId, [...(byChild.get(c.childId) ?? []), c]);
      for (const [childId, list] of byChild) {
        // The latest line under each child (v197, 10A), newest conversation first.
        const latest = [...list].sort((x, y) => y.lastAt.localeCompare(x.lastAt))[0]!;
        const line = latest.lastText ? `${latest.lastByName.split(' ')[0]}: ${latest.lastText}` : 'Urgent conversation, not yet handled';
        urgent.push({ key: `u${childId}`, childId, who: list[0]!.childName, why: list.length > 1 ? `${list.length} conversations · ${line}` : line,
          to: list.length > 1 ? '/hope/records?show=chats' : `/hope/chats/${list[0]!.id}` });
      }
    }
    const urgentCount = reader && chats ? chats.chats.filter((x) => x.status === 'open').length : 0;
    const out: Group[] = [];
    const add = (g: Omit<Group, 'family'>) => { if (g.lines.length) out.push({ ...g, family: FAMILY_OF[g.reason]! }); };
    if (unread && unread > urgentCount) add({ reason: 'unread', more: '/hope/records?show=chats', big: String(unread), lines: [{ key: 'unread', who: `${unread === 1 ? 'A conversation has' : `${unread} conversations have`} new messages`, why: '', to: '/hope/records?show=chats' }] });
    if (pay) add({ reason: 'pay', more: '/hope/register?w=champions&tab=pay', big: pay.amount, label: pay.label, sub: pay.sub, lines: [{ key: 'pay', who: pay.title, why: pay.why, to: '/hope/register?w=champions&tab=pay' }] });
    add({ reason: 'missed', more: '/hope/children?show=missed', lines: current.filter((c) => needsCall(c, days) && !hidden.includes(c.id)).map((c) => {
      const n = name(c.id);
      const phone = c.parentPhone || undefined;
      return {
        key: `m${c.id}`, childId: c.id, who: n, why: c.parentName ? `Parent: ${c.parentName}` : '', to: `/hope/children/${c.id}?tab=attendance`, tel: phone,
        wa: phone ? waLink(phone, fillMessage(missedText, { parentName: c.parentName || '', children: [{ id: c.id, name: n }] })) : undefined,
        call: caller ? { childId: c.id, name: n } : undefined,
      };
    }) });
    if (fees) {
      const ids = new Set(current.map((c) => c.id));
      add({ reason: 'fees', more: '/hope/children?show=owing', lines: owing.filter((o) => ids.has(o.childId)).map((o) => ({
        key: `f${o.childId}`, childId: o.childId, who: name(o.childId), why: formatKes(o.left), to: `/hope/children/${o.childId}?tab=fees` })) });
    }
    add({ reason: 'consent', more: '/hope/children?show=consent', lines: current.filter(consentMissing).map((c) => ({
      key: `c${c.id}`, childId: c.id, who: name(c.id), why: '', to: `/hope/children/${c.id}` })) });
    add({ reason: 'departing', more: '/hope/children?show=departing', lines: h.children.filter((c) => c.status === 'departing').map((c) => ({
      key: `d${c.id}`, childId: c.id, who: name(c.id), why: '', to: `/hope/children/${c.id}` })) });
    add({ reason: 'birthday', more: '/hope/children?show=birthdays', lines: current.filter((c) => birthdayThisWeek(c.dateOfBirth, h.today)).map((c) => ({
      key: `b${c.id}`, childId: c.id, who: name(c.id), why: '', to: `/hope/children/${c.id}` })) });
    return { urgent, groups: out };
  }, [h, days, reader, chats, fees, owing, unread, pay, caller, hidden, missedText]);

  function saveCall() {
    if (!done) return;
    const d = done;
    addNote(org.id, d.childId, 'call', note.trim() || 'Called the parent about the missed Saturdays.')
      .then(() => toast.show(`Saved. ${d.name} is off the list.`), (err) => { setHidden((x) => x.filter((id) => id !== d.childId)); toast.show(friendlyError(err)); });
    setHidden((x) => [...x, d.childId]);
    setDone(null); setNote('');
  }

  const tiles = groups.filter((g) => g.reason !== 'birthday');
  const birthdays = groups.find((g) => g.reason === 'birthday');
  const sizeOf = (f: Family) => (f === 'urgent' ? urgent.length : 0) + groups.filter((g) => g.family === f).reduce((n, g) => n + g.lines.length, 0);
  const total = PILLS.slice(1).reduce((n, p) => n + sizeOf(p.id as Family), 0);
  if (!total) return <section className="card ht-needs" aria-label="Needs you"><p className="muted">✅ Nothing needs you right now.</p></section>;
  const show = (f: Family) => pill === 'all' || pill === f;
  const face = (l: Line, size = 32) => <Avatar photo={l.childId ? photos.get(l.childId) : null} name={l.who} size={size} />;

  return (
    <section className="card ht-needs nu" aria-label="Needs you">
      <div className="nu-head">
        <h2>Needs you</h2>
        <div className="nu-pills" role="radiogroup" aria-label="Show">
          {PILLS.filter((p) => p.id === 'all' || sizeOf(p.id) > 0).map((p) => (
            <button key={p.id} type="button" role="radio" aria-checked={pill === p.id} className={`nu-pill nu-pill-${p.id}${pill === p.id ? ' on' : ''}`} onClick={() => setPill(p.id)}>
              {p.label} <span>{p.id === 'all' ? total : sizeOf(p.id)}</span>
            </button>
          ))}
        </div>
      </div>

      {show('urgent') && urgent.length > 0 && (
        <div className="nu-urgent">
          <div className="nu-urgent-top">
            <span className="nu-faces" aria-hidden="true">{urgent.slice(0, 4).map((l) => <span key={l.key}>{face(l, 40)}</span>)}</span>
            <span className="grow"><b>{urgent.length === 1 ? '1 child has' : `${urgent.length} children have`} an urgent conversation</b><span>Not yet handled. Tap a child to open it.</span></span>
          </div>
          <ul className="nu-urgent-list">
            {urgent.map((l) => <li key={l.key}><Link to={l.to}>{face(l, 28)}<span className="grow"><b>{l.who}</b><span>{l.why}</span></span><span className="nu-go" aria-hidden="true">›</span></Link></li>)}
          </ul>
        </div>
      )}

      {tiles.some((g) => show(g.family)) && (
        <div className="nu-grid">
          {tiles.filter((g) => show(g.family)).map((g) => (
            <article key={g.reason} className={`nu-tile nu-${g.family}`}>
              <div className="nu-tile-top">
                <NeedIcon name={g.reason} />
                <span className="grow"><b className="nu-big">{g.big ?? g.lines.length}</b><span className="nu-label">{g.label ?? TILE_LABEL[g.reason]}</span>{(g.sub ?? TILE_SUB[g.reason]) && <span className="nu-sub">{g.sub ?? TILE_SUB[g.reason]}</span>}</span>
              </div>
              {g.reason !== 'unread' && g.reason !== 'pay' && (
                <ul className="nu-names">
                  {g.lines.slice(0, 2).map((l) => (
                    <li key={l.key}>
                      <Link to={l.to}>{face(l)}<span className="grow"><b>{l.who}</b>{l.why && <span>{l.why}</span>}</span></Link>
                      {(l.tel || l.call) && (
                        <span className="nu-acts">
                          {l.tel && <a className="nu-act" href={`tel:${l.tel}`} aria-label={`Call ${l.who}'s parent`} title="Call"><NeedIcon name="missed" /></a>}
                          {l.wa && <a className="nu-act nu-wa" href={l.wa} target="_blank" rel="noopener noreferrer" aria-label={`WhatsApp ${l.who}'s parent`} title="WhatsApp">WA</a>}
                          {l.call && <button type="button" className="nu-act" onClick={() => { setDone(l.call!); setNote(''); }} aria-label={`Mark ${l.who} as called`} title="Done">✓</button>}
                        </span>
                      )}
                      {done && l.call && done.childId === l.call.childId && (
                        <div className="ht-done stack">
                          <label className="field"><span>What did the parent say? (optional)</span>
                            <input value={note} maxLength={500} autoFocus onChange={(e) => setNote(e.target.value)} placeholder="He was sick, coming back on Saturday" /></label>
                          <div className="chips"><button type="button" className="btn btn-primary btn-small" onClick={saveCall}>Save</button><button type="button" className="btn btn-quiet btn-small" onClick={() => setDone(null)}>Cancel</button></div>
                        </div>
                      )}
                    </li>
                  ))}
                </ul>
              )}
              <Link to={g.more} className="nu-open">{g.reason === 'pay' ? 'Check and approve' : g.lines.length > 2 ? `Open all ${g.lines.length}` : 'Open'} <span aria-hidden="true">›</span></Link>
            </article>
          ))}
        </div>
      )}

      {show('children') && birthdays && (
        <div className="nu-celebrate">
          <div className="nu-celebrate-head"><NeedIcon name="birthday" /><b>Celebrate</b><span>{birthdays.lines.length === 1 ? '1 birthday' : `${birthdays.lines.length} birthdays`} this week</span>
            <Link to={birthdays.more} className="nu-open">See all <span aria-hidden="true">›</span></Link></div>
          <ul className="nu-celebrate-list">
            {birthdays.lines.map((l) => <li key={l.key}><Link to={l.to}>{face(l, 52)}<span>{l.who.split(' ')[0]}</span></Link></li>)}
          </ul>
        </div>
      )}
    </section>
  );
}

/** Champions' pay to approve (Andy, 2026-11-05, 10A): from the 28th, for the Director and admins, until approved. */
function usePayReady(org: Organization, today: string): { title: string; why: string; amount: string; label: string; sub: string } | null {
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
  const n = r.lines.filter((l) => l.total > 0).length;
  return {
    title: `Champions' pay for ${name} is ${ready.final ? 'ready' : 'ready to check'}`, why: `${formatKes(r.total)} for ${n} champions. Check and approve it.`,
    amount: formatKes(r.total), label: `Champions' pay for ${name}`, sub: `${n} ${n === 1 ? 'champion' : 'champions'} · ${ready.final ? 'ready' : 'ready to check'}`,
  };
}
