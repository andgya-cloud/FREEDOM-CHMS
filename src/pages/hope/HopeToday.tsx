import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../../state/AuthContext';
import { useToast } from '../../state/ToastContext';
import { useChampions, useClubs, useHelperDay, useHopeDays } from '../../state/useHope';
import { friendlyError } from '../../lib/errors';
import { markHelperArrived } from '../../lib/hopeWrites';
import { HELPER_ROLE_ID } from '../../../functions/src/shared/permissions';
import { HelperGuide } from './HelperGuide';
import { useChatSummary } from './HopeChatsPage';
import { HeroCheckin, LiveBoard, NeedsUs } from './HopeTodayBoard';
import { nowTime } from './registerParts';
import { SceneVideo } from '../../components/SceneVideo';
import { firstNameOf, timeGreeting } from '../../components/Greeting';
import { FirstRunChecklist } from '../../components/FirstRunChecklist';
import { PoweredBy } from '../../components/PoweredBy';
import { useHopeMeals } from '../../state/useHope';
import { isCurrentChild } from '../../../functions/src/shared/hope';
import { rateFrom, saturdayOnOrBefore } from '../../../functions/src/shared/hopeRegister';
import { useHopePage } from './common';
import { isChampionManager } from '../../../functions/src/shared/hopeChampionPay';
import type { Organization } from '../../state/OrgContext';


/**
 * Freedom Hope Centre's one home page (Andy, 2026-11-04, 2A-5A): Today and Overview merged. A greeting, what
 * needs attention, the registers as the main tiles (a big live card on Saturdays), and the figures folded away
 * with a dropdown to pick one chart. Counts only: no child is named on this page.
 */
export function HopeToday({ org }: { org: Organization }) {
  const { profile } = useAuth();
  return profile?.roleId === HELPER_ROLE_ID ? <HelperHome org={org} /> : <LeaderToday org={org} />;
}

/**
 * A helper's home (Andy, 2026-11-04, 2A and 10A): "I'm here" records the time they arrived, then two big buttons,
 * the children's register and today's clubs. A picture guide shows the first time.
 */
function HelperHome({ org }: { org: Organization }) {
  const h = useHopePage(org);
  const { profile } = useAuth();
  const toast = useToast();
  const tz = org.timeZone || 'Africa/Nairobi';
  const { helpers } = useHelperDay(org.id, h.today);
  const { days } = useHopeDays(org.id);
  const clubs = useClubs(org.id);
  const [guide, setGuide] = useState(false);
  const mine = helpers.find((x) => x.uid === profile?.uid);
  const kids = rateFrom(Object.values(days.find((d) => d.date === h.today)?.marks ?? {}));
  const weekday = new Intl.DateTimeFormat('en-GB', { weekday: 'long', timeZone: 'UTC' }).format(new Date(`${h.today}T12:00:00Z`));
  const clubsToday = clubs.clubs.filter((x) => x.status === 'active' && x.day === weekday).sort((a, b) => (a.time || '99').localeCompare(b.time || '99'));
  function arrived() {
    if (!profile) return;
    markHelperArrived(org.id, h.today, profile.uid, profile.displayName || 'Helper', nowTime()).catch((err) => toast.show(friendlyError(err)));
  }
  return (
    <div className="page narrow hp-home">
      <HelperGuide open={guide} onClose={() => setGuide(false)} />
      <h1 className="hp-greet">{timeGreeting(tz)}{firstNameOf(profile?.displayName) ? `, ${firstNameOf(profile?.displayName)}` : ''} 👋</h1>
      {mine ? (
        <div className="card hp-here"><span aria-hidden="true">✅</span><span><b>You arrived at {mine.t}</b><span className="small muted">Thank you for serving today.</span></span></div>
      ) : (
        <button type="button" className="hp-big hp-arrive" onClick={arrived}><span className="hp-ico" aria-hidden="true">🙋</span><span><b>I'm here</b><span>Tap when you arrive</span></span></button>
      )}
      <Link to="/hope/register?d=today" className="hp-big"><span className="hp-ico" aria-hidden="true">✅</span><span><b>Check in children</b><span>{kids.present ? `${kids.present} here today` : 'Tap each child as they arrive'}</span></span></Link>
      {clubsToday.map((x) => (
        <Link key={x.id} to={`/hope/clubs/${x.id}`} className="hp-big"><span className="hp-ico" aria-hidden="true">{x.emoji || '⭐'}</span><span><b>{x.name}</b><span>{x.time ? `Today at ${x.time}` : 'Meets today'}</span></span></Link>
      ))}
      {clubsToday.length === 0 && <Link to="/hope/register?w=club" className="hp-big hp-small"><span className="hp-ico" aria-hidden="true">⭐</span><span><b>Club registers</b><span>No club meets today</span></span></Link>}
      <Link to="/hope/photos?new=1" className="hp-big hp-small"><span className="hp-ico" aria-hidden="true">📷</span><span><b>Send photos</b><span>Good news, an activity or an incident</span></span></Link>
      <button type="button" className="btn btn-quiet align-start" onClick={() => setGuide(true)}>❓ How it works</button>
      <PoweredBy />
    </div>
  );
}

function LeaderToday({ org }: { org: Organization }) {
  const h = useHopePage(org);
  const { profile, can } = useAuth();
  const tz = org.timeZone || 'Africa/Nairobi';
  const { days } = useHopeDays(org.id);
  const champ = useChampions(org.id);
  const clubs = useClubs(org.id);
  const { helpers } = useHelperDay(org.id, h.today);
  const chats = useChatSummary(org.id);
  const { meals } = useHopeMeals(org.id);
  const isSaturday = saturdayOnOrBefore(h.today) === h.today;
  const current = useMemo(() => h.children.filter(isCurrentChild), [h.children]);
  const serving = champ.champions.filter((x) => x.status === 'active').length;
  const todayKids = rateFrom(Object.values(days.find((d) => d.date === h.today)?.marks ?? {}));
  const weekday = new Intl.DateTimeFormat('en-GB', { weekday: 'long', timeZone: 'UTC' }).format(new Date(`${h.today}T12:00:00Z`));
  const clubsToday = clubs.clubs.filter((x) => x.status === 'active' && x.day === weekday).sort((a, b) => (a.time || '99').localeCompare(b.time || '99'));
  const first = firstNameOf(profile?.displayName);
  const marker = can('attendance.write');
  // An open day (v173 11A): a Saturday, a day someone was checked in, or a day a club meets.
  const openDay = isSaturday || todayKids.marked > 0 || clubsToday.length > 0;

  return (
    <div className="page lav-today">
      <section className="card lav-hero">
        <div className="lav-hero-text">
          <span className="lav-eyebrow"><i aria-hidden="true" />{new Intl.DateTimeFormat('en-GB', { weekday: 'long', day: 'numeric', month: 'long', timeZone: tz }).format(new Date())}</span>
          <h1 className="lav-greet">{timeGreeting(tz)}{first ? `, ${first}` : ''}</h1>
          <p className="lav-org"><em>{org.name}</em></p>
          {/* Check in sits right under the greeting (Andy, 2026-11-05). */}
          <HeroCheckin h={h} days={days} marker={marker} openDay={openDay} />
          <p>{h.loading ? '' : current.length ? `${current.length} ${current.length === 1 ? 'child' : 'children'} and ${serving} ${serving === 1 ? 'champion' : 'champions'}.` : 'Register the first child to start.'}</p>
        </div>
        <div className="lav-scene">
          <SceneVideo name="hope-intro" />
          <FirstRunChecklist variant="scene" />
        </div>
      </section>

      {openDay && <LiveBoard org={org} h={h} days={days} helpers={helpers} meals={meals} clubsToday={clubsToday} clubDays={clubs.days} marker={marker} />}

      {(can('people.read') || isChampionManager(profile, org.id)) && <NeedsUs org={org} h={h} days={days} unread={chats?.unread} />}

      <PoweredBy />
    </div>
  );
}
