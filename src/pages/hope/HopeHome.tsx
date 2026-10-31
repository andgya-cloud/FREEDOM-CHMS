import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../../state/AuthContext';
import { useToast } from '../../state/ToastContext';
import { friendlyError } from '../../lib/errors';
import { createEvent } from '../../lib/attendanceWrites';
import { requestAbsenceCheck } from '../../lib/hopeWrites';
import { eventTypeFor } from '../../../functions/src/shared/attendance';
import { MEALS_PROGRAMME, SCHOOL_STATUSES, SCHOOL_STATUS_LABELS } from '../../../functions/src/shared/hope';
import { ColumnChart, Donut, Gauge, KpiCard, KpiRow, Panel } from '../../components/charts';
import { HopeGate, HopeNav, pct, useHopePage } from './common';
import type { Organization } from '../../state/OrgContext';

/** Hope Center home: counts only (no names), what needs attention, and a shortcut to start today's session. */
export function HopeHome() {
  return <HopeGate title="Freedom Hope Center">{(org) => <Home org={org} />}</HopeGate>;
}

function Home({ org }: { org: Organization }) {
  const h = useHopePage(org);
  const { can } = useAuth();
  const toast = useToast();
  const navigate = useNavigate();
  const [checking, setChecking] = useState(false);
  const m = h.metrics;
  const openFollowUps = h.absenceTasks.filter((t) => t.status === 'open').length;

  const sessions = [...new Set(h.programmes.flatMap((p) => (p.toLowerCase() === 'football academy' ? [`${p} training`, `${p} match`] : [p])))];
  function start(name: string) {
    try {
      const { id, synced } = createEvent(org.id, { date: h.today, type: eventTypeFor(org.type, name), name, activity: name });
      synced.catch((err) => toast.show(friendlyError(err)));
      navigate(`/attendance/${org.id}/${id}`);
    } catch (err) {
      toast.show(friendlyError(err));
    }
  }
  function check() {
    setChecking(true);
    try { requestAbsenceCheck(org.id); toast.show('Checking attendance. New follow-ups will appear under Follow-ups in a moment.'); } catch (err) { toast.show(friendlyError(err)); }
    window.setTimeout(() => setChecking(false), 4000);
  }

  const active = h.children.filter((c) => c.status === 'active');
  const ageOf = (dob: string | null | undefined) => (dob ? Math.floor((Date.parse(h.today) - Date.parse(dob)) / (365.25 * 864e5)) : null);
  const AGES: [string, (a: number | null) => boolean][] = [
    ['Under 6', (a) => a != null && a < 6], ['6 to 9', (a) => a != null && a >= 6 && a <= 9], ['10 to 13', (a) => a != null && a >= 10 && a <= 13],
    ['14 to 17', (a) => a != null && a >= 14 && a <= 17], ['18 and over', (a) => a != null && a >= 18], ['Age not known', (a) => a == null],
  ];
  const rate = (label: string, v: number | null) => <Gauge key={label} value={v ?? 0} max={100} label={label} display={pct(v)} bands={[0.5, 0.75]} />;

  return (
    <div className="page narrow">
      <div className="page-head"><h1>{org.name}</h1>{can('people.write') && <Link to="/hope/children/new" className="btn btn-primary">Register a child</Link>}</div>
      <HopeNav />

      {(m.consentMissing > 0 || h.openConcerns.length > 0 || openFollowUps > 0) && (
        <section className="card stack" aria-label="Needs attention">
          <h2>Needs attention</h2>
          {h.openConcerns.length > 0 && (
            <p className="notice notice-warn">
              <strong>{h.openConcerns.length} safeguarding {h.openConcerns.length === 1 ? 'concern is' : 'concerns are'} open.</strong>{' '}
              {h.openConcerns.map((c, i) => {
                const child = h.children.find((x) => x.id === c.childId);
                return <span key={c.id}>{i > 0 && ', '}<Link to={`/hope/children/${c.childId}`}>{child ? `${h.codeOf(child)} ${h.nameOf(child.id)}` : 'Open'}</Link></span>;
              })}
            </p>
          )}
          {m.consentMissing > 0 && <p className="notice notice-warn small"><span><Link to="/hope/children?consent=missing">{m.consentMissing} {m.consentMissing === 1 ? 'child has' : 'children have'} consent missing</Link>. They are kept on the register, but photos must not be taken until the guardian agrees.</span></p>}
          {openFollowUps > 0 && can('followups.manage') && <p className="notice small"><span><Link to="/follow-ups">{openFollowUps} {openFollowUps === 1 ? 'guardian' : 'guardians'} to call</Link> about children who missed three sessions.</span></p>}
        </section>
      )}

      <KpiRow label="Hope Center numbers">
        <KpiCard label="Registered" value={String(m.registered)} tone="gold" note={`${m.active} active`} to="/hope/children" />
        <KpiCard label="Came in the last 8 weeks" value={String(m.attendingLast8Weeks)} note={`${m.reachTwoPlus} join two or more programmes`} />
        <KpiCard label="New this month" value={String(m.newlyRegistered)} tone="ok" />
        <KpiCard label="Meals this month" value={String(m.meals.total)} note={`${m.meals.sessions} ${m.meals.sessions === 1 ? 'Saturday' : 'Saturdays'} · ${m.meals.newChildren} new`} />
      </KpiRow>
      <div className="dash-grid">
        <Panel title="How the children are doing" wide>
          <div className="gauges">
            {rate('Attending regularly', m.consistencyRate)}
            {rate('Still here after 6 months', m.retentionRate)}
            {rate('In school', m.schoolEnrolmentRate)}
            {rate('Guardians reached', m.guardianContactRate)}
          </div>
        </Panel>
        <Panel title="Children in each programme this month">
          <ColumnChart label="Children in each programme this month" rows={[{ label: 'Meals', value: m.meals.newChildren + m.meals.returningChildren }, ...m.byProgramme.map((p) => ({ label: p.name.replace(/ Academy$/, ''), value: p.children }))]} highlight={0} height={170} />
        </Panel>
        <Panel title="Ages">
          <Donut label="Active children by age" rows={AGES.map(([label, f]) => ({ label, value: active.filter((c) => f(ageOf(c.dateOfBirth))).length }))} center={String(active.length)} centerNote="active" />
        </Panel>
        <Panel title="School">
          <Donut label="Active children by school" rows={SCHOOL_STATUSES.map((k) => ({ label: SCHOOL_STATUS_LABELS[k], value: active.filter((c) => c.schoolStatus === k).length }))} center={pct(m.schoolEnrolmentRate)} centerNote="in school" />
        </Panel>
      </div>

      {can('attendance.write') && (
        <section className="card stack">
          <h2>Start today's session</h2>
          <p className="small muted">Saturday meals can be counted without names. For the other programmes, tap each child's name or type or scan their code.</p>
          <div className="chips">{sessions.map((n) => <button key={n} type="button" className="chip" onClick={() => start(n)}>{n}</button>)}</div>
        </section>
      )}

      <section className="card stack">
        <h2>Programmes this month</h2>
        <ul className="link-list">
          <li><div><span className="link-title">{MEALS_PROGRAMME}</span><span className="link-detail">{m.meals.sessions} {m.meals.sessions === 1 ? 'Saturday' : 'Saturdays'} · {m.meals.total} meals · {m.meals.newChildren} new, {m.meals.returningChildren} returning</span></div></li>
          {m.byProgramme.map((p) => (
            <li key={p.name}><div><span className="link-title">{p.name}</span><span className="link-detail">{p.children} {p.children === 1 ? 'child' : 'children'} · {p.sessions} sessions · average {p.averageAttendance ?? '–'} per session</span></div></li>
          ))}
        </ul>
      </section>

      {can('followups.manage') && (
        <button type="button" className="btn btn-quiet align-start" disabled={checking} onClick={check}>{checking ? 'Checking…' : 'Check for absent children now'}</button>
      )}
      <p className="small muted">This screen shows numbers only. A check runs every morning at 06:30.</p>
    </div>
  );
}
