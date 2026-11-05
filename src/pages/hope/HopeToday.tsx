import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../../state/AuthContext';
import { useToast } from '../../state/ToastContext';
import { useFollowUpCounts } from '../../state/useFollowUps';
import { useChampions, useClubs, useHelperDay, useHopeDays } from '../../state/useHope';
import { friendlyError } from '../../lib/errors';
import { markHelperArrived, requestAbsenceCheck } from '../../lib/hopeWrites';
import { HELPER_ROLE_ID } from '../../../functions/src/shared/permissions';
import { HelperGuide } from './HelperGuide';
import { useChatSummary } from './HopeChatsPage';
import { CalmDay, LiveBoard, NeedsUs } from './HopeTodayBoard';
import { nowTime } from './registerParts';
import { SceneVideo } from '../../components/SceneVideo';
import { firstNameOf, timeGreeting } from '../../components/Greeting';
import { FirstRunChecklist } from '../../components/FirstRunChecklist';
import { AdiaIcon } from '../../components/icons';
import { PoweredBy } from '../../components/PoweredBy';
import { DeptBars, HOPE_DONUT_COLOURS, Kpi, Ring, StackBars, StatusDonut } from '../../components/LavFigures';
import { useHopeMeals } from '../../state/useHope';
import { canCountMeals, MEAL_EMOJI, MEAL_LABELS, mealMonth, MEALS, mealWeeks } from '../../../functions/src/shared/hopeRecords';
import { formatDateKey } from '../../../functions/src/shared/datetime';
import { consentMissing, isCurrentChild, SCHOOL_STATUSES, SCHOOL_STATUS_LABELS } from '../../../functions/src/shared/hope';
import { dayTrend, rateFrom, saturdayOnOrBefore } from '../../../functions/src/shared/hopeRegister';
import { pct, useHopePage } from './common';
import { TrendChart } from './registerParts';
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
  const toast = useToast();
  const tz = org.timeZone || 'Africa/Nairobi';
  const counts = useFollowUpCounts(org.id, tz);
  const { days } = useHopeDays(org.id);
  const champ = useChampions(org.id);
  const clubs = useClubs(org.id);
  const [checking, setChecking] = useState(false);

  const isSaturday = saturdayOnOrBefore(h.today) === h.today;
  const sat = saturdayOnOrBefore(h.today);
  const current = useMemo(() => h.children.filter(isCurrentChild), [h.children]);
  const kids = rateFrom(Object.values(days.find((d) => d.date === sat)?.marks ?? {}));
  const champs = rateFrom(Object.values(champ.days.find((d) => d.date === sat)?.marks ?? {}));
  const serving = champ.champions.filter((x) => x.status === 'active').length;
  const trend = useMemo(() => dayTrend(days), [days]);
  const m = h.metrics;

  const missing = h.children.filter(consentMissing).length;
  const { helpers } = useHelperDay(org.id, h.today);
  const chats = useChatSummary(org.id);
  const { meals } = useHopeMeals(org.id);
  const mealsToday = meals.find((x) => x.date === h.today);
  const mealCounter = canCountMeals(profile, org.id);
  const todayKids = rateFrom(Object.values(days.find((d) => d.date === h.today)?.marks ?? {}));
  const departing = h.children.filter((c) => c.status === 'departing').length;
  const toCall = h.absenceTasks.filter((t) => t.status === 'open').length;
  const alerts = [
    !!chats?.unread && chats.unread > (chats.urgent ?? 0) && { warn: false, to: '/hope/chats', text: `💬 ${chats.unread} ${chats.unread === 1 ? 'conversation has' : 'conversations have'} new messages` },
    can('followups.manage') && (counts.due > 0 || toCall > 0) && { warn: false, to: '/follow-ups', text: `${Math.max(counts.due, toCall)} ${Math.max(counts.due, toCall) === 1 ? 'guardian' : 'guardians'} to call` },
    departing > 0 && { warn: false, to: '/hope/children?show=departing', text: `${departing} ${departing === 1 ? 'child is' : 'children are'} departing` },
  ].filter(Boolean) as { warn: boolean; to: string; text: string }[];

  function check() {
    setChecking(true);
    try { requestAbsenceCheck(org.id); toast.show('Checking attendance. New calls appear under Follow-ups in a moment.'); } catch (err) { toast.show(friendlyError(err)); }
    window.setTimeout(() => setChecking(false), 4000);
  }

  const weekday = new Intl.DateTimeFormat('en-GB', { weekday: 'long', timeZone: 'UTC' }).format(new Date(`${h.today}T12:00:00Z`));
  const clubsToday = clubs.clubs.filter((x) => x.status === 'active' && x.day === weekday).sort((a, b) => (a.time || '99').localeCompare(b.time || '99'));
  const first = firstNameOf(profile?.displayName);
  const marker = can('attendance.write');
  // An open day (v173 11A): a Saturday, a day someone was checked in, or a day a club meets.
  const openDay = isSaturday || todayKids.marked > 0 || clubsToday.length > 0;
  const satWord = isSaturday ? 'Today' : 'Last Saturday';
  const ageOf = (dob: string | null | undefined) => (dob ? Math.floor((Date.parse(h.today) - Date.parse(dob)) / (365.25 * 864e5)) : null);
  const AGES: [string, (a: number | null) => boolean][] = [
    ['Under 6', (a) => a != null && a < 6], ['6 to 9', (a) => a != null && a >= 6 && a <= 9], ['10 to 13', (a) => a != null && a >= 10 && a <= 13],
    ['14 to 17', (a) => a != null && a >= 14 && a <= 17], ['18 and over', (a) => a != null && a >= 18], ['Age not known', (a) => a == null],
  ];
  const sponsored = current.filter((c) => !!c.sponsorName?.trim()).length;
  const marked = trend.filter((t) => t.pct != null);
  const sparkline = marked.map((t) => t.pct as number);
  const lastSat = trend.find((t) => t.date === sat)?.pct ?? null;
  const prevSat = [...marked].reverse().find((t) => t.date < sat)?.pct ?? null;
  const satChange = lastSat == null || prevSat == null ? null : Math.round(lastSat - prevSat);
  // Attending regularly: came on at least 3 of the last 4 Saturdays marked.
  const last4 = days.filter((d) => !d.deletedAt && Object.keys(d.marks ?? {}).length > 0).sort((a, b) => b.date.localeCompare(a.date)).slice(0, 4);
  const regular = last4.length < 4 ? null : current.length === 0 ? null
    : Math.round((current.filter((c) => last4.filter((d) => ['present', 'departing'].includes(d.marks?.[c.id]?.s ?? '')).length >= 3).length / current.length) * 100);
  const activeClubs = clubs.clubs.filter((x) => x.status === 'active');
  const groupRows = activeClubs.map((x) => ({ label: x.name.replace(/ (Academy|Club)$/i, ''), title: x.name, value: x.memberIds.length }));

  return (
    <div className="page lav-today">
      {openDay ? (
        <LiveBoard org={org} h={h} days={days} helpers={helpers} meals={meals} clubsToday={clubsToday} clubDays={clubs.days} marker={marker} />
      ) : <CalmDay h={h} days={days} marker={marker} />}

      <section className="card lav-hero">
        <div className="lav-hero-text">
          <span className="lav-eyebrow"><i aria-hidden="true" />{new Intl.DateTimeFormat('en-GB', { weekday: 'long', day: 'numeric', month: 'long', timeZone: tz }).format(new Date())}</span>
          <h1 className="lav-greet">{timeGreeting(tz)}{first ? `, ${first}` : ''}</h1>
          <p className="lav-org"><em>{org.name}</em></p>
          <p>{h.loading ? '' : current.length ? `${current.length} ${current.length === 1 ? 'child' : 'children'} and ${serving} ${serving === 1 ? 'champion' : 'champions'}.` : 'Register the first child to start.'}</p>
        </div>
        <div className="lav-scene">
          <SceneVideo name="hope-intro" />
          <FirstRunChecklist variant="scene" />
        </div>
      </section>

      {can('people.read') && <NeedsUs org={org} h={h} days={days} />}

      {alerts.length > 0 && (
        <section className="card ht-alerts" aria-label="Needs your attention">
          <h2>Needs your attention</h2>
          <ul>{alerts.map((a) => <li key={a.text} className={a.warn ? 'warn' : ''}><Link to={a.to}>{a.text}</Link></li>)}</ul>
          {can('followups.manage') && <button type="button" className="btn btn-quiet align-start" disabled={checking} onClick={check}>{checking ? 'Checking…' : 'Check for absent children now'}</button>}
        </section>
      )}

      <section className="lav-jobs" aria-label="What do you want to do?">
        <h2>What do you want to do?</h2>
        <div className="lav-jobs-grid ht-jobs">
          {!openDay && (can('attendance.write') || can('people.read')) && (
            <Link to="/hope/register" className="card lav-job">
              <span className="lav-ico i1"><AdiaIcon name="register" /></span>
              <b>Children's register</b>
              <span className="lav-sub">{kids.marked ? `${satWord}: ${kids.present} came, ${kids.absent} absent` : `${satWord}: not marked yet`}</span>
            </Link>
          )}
          {(can('attendance.write') || can('people.read')) && (
            <Link to="/hope/register?w=champions" className="card lav-job">
              <span className="lav-ico i2"><AdiaIcon name="people" /></span>
              <b>Champions register</b>
              <span className="lav-sub">{champs.marked ? `${satWord}: ${champs.present} of ${serving} served` : `${satWord}: not marked yet`}</span>
            </Link>
          )}
          {!openDay && (mealCounter || mealsToday) && (
            <Link to="/hope/meals" className="card lav-job">
              <span className="lav-ico i4" aria-hidden="true">🍽️</span>
              <b>Meals today</b>
              <span className="lav-sub">{mealsToday ? MEALS.map((k) => `${MEAL_EMOJI[k]} ${mealsToday[k]}`).join('  ') : 'Count breakfast, lunch and fruit'}</span>
            </Link>
          )}
          {can('people.write') && (
            <Link to="/hope/children/new" className="card lav-job">
              <span className="lav-ico i3"><AdiaIcon name="addStudent" /></span>
              <b>Register child</b>
              <span className="lav-sub">A new child at the centre</span>
            </Link>
          )}
        </div>
      </section>

      {can('people.read') && (
        <details className="lav-figs">
          <summary><span className="lav-ico small i5"><AdiaIcon name="trend" /></span><b>See figures</b><span className="lav-sub">Children, attendance, champions and charts</span>
            <svg className="lav-caret" viewBox="0 0 24 24" aria-hidden="true"><path d="m9 6 6 6-6 6" /></svg></summary>
          <div className="lav-figs-body">
            {/* The same figures page as ADIA (Andy, 2026-11-04), in the Hope Centre's greens. Counts only, no names. */}
            <section className="lav-kpis" aria-label="Hope Centre key figures">
              <Kpi to="/hope/children" label="Children registered" chip={activeClubs.length ? `${activeClubs.length} ${activeClubs.length === 1 ? 'club' : 'clubs'}` : undefined} value={String(current.length)}
                sub={`${m.newlyRegistered} new this month`} />
              <Kpi to="/hope/register" label={`Attendance ${isSaturday ? 'today' : 'last Saturday'}`} chip={satChange == null ? 'Saturday' : `${satChange >= 0 ? '▲' : '▼'} ${Math.abs(satChange)}%`}
                tone={satChange == null ? undefined : satChange >= 0 ? 'ok' : 'warn'} value={pct(kids.pct)}
                sub={prevSat == null ? `${kids.present} children came` : `Saturday before ${prevSat}%`} spark={sparkline.length > 1 ? sparkline : undefined} />
              <Kpi to="/hope/register?w=champions" label="Champions serving" chip={champs.pct == null ? undefined : `${champs.pct}% came`} tone="ok" value={String(serving)}
                sub={`${champs.present} came ${isSaturday ? 'today' : 'last Saturday'}`} />
              <Kpi to="/hope/children?show=nosponsor" label="Sponsored" chip={current.length ? `${Math.round((sponsored / current.length) * 100)}%` : undefined} tone={sponsored < current.length ? 'warn' : 'ok'}
                value={String(sponsored)} sub={`${current.length - sponsored} ${current.length - sponsored === 1 ? 'child needs' : 'children need'} a sponsor`} />
            </section>

            <section className="card lav-panel">
              <div className="lav-head"><div><h2>How the children are doing</h2><p className="lav-sub">Key outcomes across the Hope Centre</p></div></div>
              <div className="lav-rings">
                <Ring label="Attending regularly" value={regular ?? m.consistencyRate} note="3 of the last 4 Saturdays" />
                <Ring label="Still here after 6 months" value={m.retentionRate} />
                <Ring label="In school" value={m.schoolEnrolmentRate} note="Of those known" />
                <Ring label="Guardians reached" value={m.guardianContactRate} note="After absences" />
                <Ring label="Consent recorded" value={current.length ? Math.round(((current.length - missing) / current.length) * 100) : null} note={missing ? `${missing} missing` : 'All done'} />
                <Ring label="Champions came" value={champs.pct} note={satWord} />
              </div>
            </section>

            <section className="lav-grid2">
              <div className="card lav-panel">
                <div className="lav-head"><div><h2>Saturday attendance</h2><p className="lav-sub">The last 12 Saturdays marked</p></div></div>
                {trend.length < 2 ? (
                  <div className="lav-empty">
                    <span className="lav-ico i5"><AdiaIcon name="trend" /></span>
                    <b>No trend yet</b>
                    <span>The line appears after two Saturdays are marked.</span>
                    {marker && <Link to="/hope/register" className="lav-btn dark small">Mark register</Link>}
                  </div>
                ) : <TrendChart label="Attendance on each Saturday" trend={trend} />}
              </div>
              <div className="card lav-panel">
                <div className="lav-head"><div><h2>Children in each club</h2><p className="lav-sub">Members of each club</p></div><span className="lav-chip">{activeClubs.length} {activeClubs.length === 1 ? 'club' : 'clubs'}</span></div>
                {groupRows.some((r) => r.value > 0) ? <DeptBars what="Children in each club" rows={groupRows} /> : (
                  <div className="lav-empty">
                    <span className="lav-ico i5"><AdiaIcon name="trend" /></span>
                    <b>No club members yet</b>
                    <span>The columns appear once children join clubs.</span>
                    <Link to="/hope/clubs" className="lav-btn dark small">Open clubs</Link>
                  </div>
                )}
              </div>
            </section>

            {(() => {
              const weeks = mealWeeks(meals, h.today, 8);
              const month = mealMonth(meals, h.today);
              return (
                <section className="card lav-panel">
                  <div className="lav-head"><div><h2>Meals served</h2><p className="lav-sub">Each week, the last 8 weeks</p></div><span className="lav-chip">{month.total} this month</span></div>
                  {weeks.some((w) => w.breakfast + w.lunch + w.fruit > 0) ? (
                    <StackBars what="Meals served each week" parts={MEALS.map((m, i) => ({ label: MEAL_LABELS[m], colour: ['#038241', '#c99a3c', '#7fc8a0'][i]! }))}
                      cols={weeks.map((w) => ({ label: formatDateKey(w.start).replace(/ \d{4}$/, ''), title: `Week of ${formatDateKey(w.start)}`, values: [w.breakfast, w.lunch, w.fruit] }))} />
                  ) : (
                    <div className="lav-empty">
                      <span className="lav-ico i5" aria-hidden="true">🍽️</span>
                      <b>No meals counted yet</b>
                      <span>The columns appear once meals are saved.</span>
                      {mealCounter && <Link to="/hope/meals" className="lav-btn dark small">Count meals</Link>}
                    </div>
                  )}
                  {month.total > 0 && <p className="small muted">This month: {MEALS.map((m) => `${month[m]} ${MEAL_LABELS[m].toLowerCase()}`).join(', ')} over {month.days} {month.days === 1 ? 'day' : 'days'}.</p>}
                </section>
              );
            })()}

            <StatusDonut title="Children by age" sub="Ages of the children" noun="children" colours={HOPE_DONUT_COLOURS}
                rows={AGES.map(([label, f]) => ({ label, value: current.filter((c) => f(ageOf(c.dateOfBirth))).length }))} />
            <StatusDonut title="Children in school" sub="School, as recorded" noun="children" colours={HOPE_DONUT_COLOURS}
                rows={SCHOOL_STATUSES.map((k) => ({ label: SCHOOL_STATUS_LABELS[k], value: current.filter((c) => c.schoolStatus === k).length }))} />

            <div className="btn-line">
              <Link to="/hope/reports" className="btn btn-quiet">Weekly and monthly reports</Link>
              <Link to="/hope/photos" className="btn btn-quiet">📷 Photo reports</Link>
              <Link to="/hope/attendance" className="btn btn-quiet">📋 Attendance</Link>
              <Link to="/hope/meals" className="btn btn-quiet">🍽️ Meals</Link>
            </div>
          </div>
        </details>
      )}

      <PoweredBy />
    </div>
  );
}
