import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../../state/AuthContext';
import { useToast } from '../../state/ToastContext';
import { friendlyError } from '../../lib/errors';
import { createEvent } from '../../lib/attendanceWrites';
import { requestAbsenceCheck } from '../../lib/hopeWrites';
import { eventTypeFor } from '../../../functions/src/shared/attendance';
import { MEALS_PROGRAMME } from '../../../functions/src/shared/hope';
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

  const tiles: [string, string][] = [
    ['Registered', String(m.registered)], ['Active', String(m.active)], ['Came in the last 8 weeks', String(m.attendingLast8Weeks)],
    ['New this month', String(m.newlyRegistered)], ['Meals this month', String(m.meals.total)], ['Attending regularly', pct(m.consistencyRate)],
    ['Still here after 6 months', pct(m.retentionRate)], ['Join two or more programmes', String(m.reachTwoPlus)],
    ['In school', pct(m.schoolEnrolmentRate)], ['Guardians reached', pct(m.guardianContactRate)],
  ];

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

      <ul className="tiles" aria-label="Hope Center numbers">
        {tiles.map(([label, value]) => <li key={label}><div className="tile"><span className="tile-label">{label}</span><span className="tile-value">{value}</span></div></li>)}
      </ul>

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
