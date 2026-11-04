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
import { nowTime } from './registerParts';
import { SceneVideo } from '../../components/SceneVideo';
import { firstNameOf, timeGreeting } from '../../components/Greeting';
import { FirstRunChecklist } from '../../components/FirstRunChecklist';
import { AdiaIcon } from '../../components/icons';
import { PoweredBy } from '../../components/PoweredBy';
import { ColumnChart, Donut, Gauge, KpiCard, KpiRow } from '../../components/charts';
import { consentMissing, isCurrentChild, SCHOOL_STATUSES, SCHOOL_STATUS_LABELS } from '../../../functions/src/shared/hope';
import { addDays } from '../../../functions/src/shared/metrics';
import { birthdayThisWeek, dayTrend, rateFrom, saturdayOnOrBefore } from '../../../functions/src/shared/hopeRegister';
import { pct, useHopePage } from './common';
import { TrendChart } from './registerParts';
import type { Organization } from '../../state/OrgContext';

type Chart = 'trend' | 'doing' | 'programmes' | 'ages' | 'school';
const CHARTS: [Chart, string][] = [['trend', 'Attendance as time goes'], ['doing', 'How the children are doing'], ['programmes', 'Children in each programme'], ['ages', 'Ages'], ['school', 'School']];

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
      <Link to="/hope/register" className="hp-big"><span className="hp-ico" aria-hidden="true">🧒</span><span><b>Children's register</b><span>{kids.present ? `${kids.present} here today` : 'Tap each child as they arrive'}</span></span></Link>
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
  const [chart, setChart] = useState<Chart>('trend');
  const [checking, setChecking] = useState(false);

  const isSaturday = saturdayOnOrBefore(h.today) === h.today;
  const sat = saturdayOnOrBefore(h.today);
  const current = useMemo(() => h.children.filter(isCurrentChild), [h.children]);
  const kids = rateFrom(Object.values(days.find((d) => d.date === sat)?.marks ?? {}));
  const champs = rateFrom(Object.values(champ.days.find((d) => d.date === sat)?.marks ?? {}));
  const serving = champ.champions.filter((x) => x.status === 'active').length;
  const trend = useMemo(() => dayTrend(days), [days]);
  const since = addDays(h.today, -55);
  const cameRecently = useMemo(() => new Set(days.filter((d) => d.date >= since)
    .flatMap((d) => Object.entries(d.marks ?? {}).filter(([, e]) => e.s === 'present' || e.s === 'departing').map(([id]) => id))), [days, since]);
  const m = h.metrics;

  const missing = h.children.filter(consentMissing).length;
  const { helpers } = useHelperDay(org.id, h.today);
  const departing = h.children.filter((c) => c.status === 'departing').length;
  const birthdays = current.filter((c) => birthdayThisWeek(c.dateOfBirth, h.today)).length;
  const toCall = h.absenceTasks.filter((t) => t.status === 'open').length;
  const alerts = [
    h.openConcerns.length > 0 && { warn: true, to: '/hope/children?show=concerns', text: `${h.openConcerns.length} safeguarding ${h.openConcerns.length === 1 ? 'concern is' : 'concerns are'} open` },
    can('followups.manage') && (counts.due > 0 || toCall > 0) && { warn: false, to: '/follow-ups', text: `${Math.max(counts.due, toCall)} ${Math.max(counts.due, toCall) === 1 ? 'guardian' : 'guardians'} to call` },
    helpers.length > 0 && { warn: false, to: '/hope/register', text: `🙋 Helpers here today: ${helpers.map((x) => `${firstNameOf(x.name) || x.name} ${x.t}`).join(', ')}` },
    missing > 0 && { warn: true, to: '/hope/consent', text: `${missing} ${missing === 1 ? 'child needs' : 'children need'} consent recorded` },
    departing > 0 && { warn: false, to: '/hope/children?show=departing', text: `${departing} ${departing === 1 ? 'child is' : 'children are'} departing` },
    birthdays > 0 && { warn: false, to: '/hope/children?show=birthdays', text: `🎈 ${birthdays} ${birthdays === 1 ? 'birthday' : 'birthdays'} this week` },
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
  const satWord = isSaturday ? 'Today' : 'Last Saturday';
  const ageOf = (dob: string | null | undefined) => (dob ? Math.floor((Date.parse(h.today) - Date.parse(dob)) / (365.25 * 864e5)) : null);
  const AGES: [string, (a: number | null) => boolean][] = [
    ['Under 6', (a) => a != null && a < 6], ['6 to 9', (a) => a != null && a >= 6 && a <= 9], ['10 to 13', (a) => a != null && a >= 10 && a <= 13],
    ['14 to 17', (a) => a != null && a >= 14 && a <= 17], ['18 and over', (a) => a != null && a >= 18], ['Age not known', (a) => a == null],
  ];
  const gauge = (label: string, v: number | null) => <Gauge key={label} value={v ?? 0} max={100} label={label} display={pct(v)} bands={[0.5, 0.75]} />;

  return (
    <div className="page lav-today">
      {isSaturday && marker && (
        <Link to="/hope/register" className="card ht-saturday">
          <span className="ht-sat-ico" aria-hidden="true"><AdiaIcon name="register" /></span>
          <span className="ht-sat-text">
            <b>{kids.marked ? 'Carry on with today\'s register' : 'Start today\'s register'}</b>
            <span>{kids.present} of {current.length} checked in{kids.marked ? ` · ${kids.absent} absent · ${kids.excused} excused` : ''}</span>
          </span>
          <span className="ht-sat-meter" aria-hidden="true"><i style={{ width: `${current.length ? Math.min(100, Math.round((kids.present / current.length) * 100)) : 0}%` }} /></span>
        </Link>
      )}

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
          {!(isSaturday && marker) && (can('attendance.write') || can('people.read')) && (
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
          {can('people.write') && (
            <Link to="/hope/children/new" className="card lav-job">
              <span className="lav-ico i3"><AdiaIcon name="addStudent" /></span>
              <b>Register child</b>
              <span className="lav-sub">A new child at the centre</span>
            </Link>
          )}
        </div>
      </section>

      {clubsToday.length > 0 && (
        <section className="card ht-clubs" aria-label="Clubs meeting today">
          <h2>Clubs today</h2>
          <div className="ht-club-row">
            {clubsToday.map((x) => {
              const r = rateFrom(Object.values(clubs.days.find((d) => d.clubId === x.id && d.date === h.today)?.marks ?? {}));
              return (
                <Link key={x.id} to={`/hope/clubs/${x.id}`} className="ht-club">
                  <span className="cl-emoji" aria-hidden="true">{x.emoji || '⭐'}</span>
                  <span><b>{x.name}</b><span className="small muted">{x.time || 'Time not set'} · {r.marked ? `${r.present} of ${x.memberIds.length} here` : `${x.memberIds.length} members`}</span></span>
                </Link>
              );
            })}
          </div>
        </section>
      )}

      {can('people.read') && (
        <details className="lav-figs">
          <summary><span className="lav-ico small i5"><AdiaIcon name="trend" /></span><b>See figures</b><span className="lav-sub">Numbers and charts</span>
            <svg className="lav-caret" viewBox="0 0 24 24" aria-hidden="true"><path d="m9 6 6 6-6 6" /></svg></summary>
          <div className="lav-figs-body stack">
            <KpiRow label="Hope Centre numbers">
              <KpiCard label="Children" value={String(current.length)} tone="gold" note={`${m.newlyRegistered} new this month`} to="/hope/children" />
              <KpiCard label="Came in the last 8 weeks" value={String(Math.max(m.attendingLast8Weeks, cameRecently.size))} />
              <KpiCard label={`${satWord}'s attendance`} value={pct(kids.pct)} tone="ok" note={`${kids.present} came`} to="/hope/register" />
              <KpiCard label="Champions serving" value={`${champs.present}/${serving}`} note={satWord} to="/hope/register?w=champions" />
            </KpiRow>
            <label className="field ht-chart-pick"><span>Chart</span>
              <select value={chart} onChange={(e) => setChart(e.target.value as Chart)}>{CHARTS.map(([k, label]) => <option key={k} value={k}>{label}</option>)}</select>
            </label>
            <div className="card ht-chart">
              {chart === 'trend' && (trend.length >= 2 ? <TrendChart label="Attendance as time goes" trend={trend} /> : <p className="muted">The line appears after two Saturdays are marked.</p>)}
              {chart === 'doing' && <div className="gauges">{gauge('Attending regularly', m.consistencyRate)}{gauge('Still here after 6 months', m.retentionRate)}{gauge('In school', m.schoolEnrolmentRate)}{gauge('Guardians reached', m.guardianContactRate)}</div>}
              {chart === 'programmes' && <ColumnChart label="Children in each programme" rows={m.byProgramme.map((p) => ({ label: p.name.replace(/ Academy$/i, ''), value: p.children }))} height={180} />}
              {chart === 'ages' && <Donut label="Children by age" rows={AGES.map(([label, f]) => ({ label, value: current.filter((c) => f(ageOf(c.dateOfBirth))).length }))} center={String(current.length)} centerNote="children" />}
              {chart === 'school' && <Donut label="Children by school" rows={SCHOOL_STATUSES.map((k) => ({ label: SCHOOL_STATUS_LABELS[k], value: current.filter((c) => c.schoolStatus === k).length }))} center={pct(m.schoolEnrolmentRate)} centerNote="in school" />}
            </div>
            <Link to="/hope/reports" className="btn btn-quiet align-start">Weekly and monthly reports</Link>
            <Link to="/hope/photos" className="btn btn-quiet align-start">📷 Photo reports</Link>
          </div>
        </details>
      )}

      <PoweredBy />
    </div>
  );
}
