import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../../state/AuthContext';
import { useToast } from '../../state/ToastContext';
import { useChildPhotos, useHopeDays } from '../../state/useHope';
import { ConfirmDialog } from '../../components/ConfirmDialog';
import { friendlyError } from '../../lib/errors';
import { markKid, markMany, updateChild } from '../../lib/hopeWrites';
import { formatDateKey } from '../../../functions/src/shared/datetime';
import { isCurrentChild, normalizeCode } from '../../../functions/src/shared/hope';
import { dayTrend, KID_MARK_LABELS, KID_MARKS, kidRate, rateFrom, saturdayOnOrBefore, type KidEntry, type KidMark } from '../../../functions/src/shared/hopeRegister';
import { HopeGate, HopeNav, useHopePage } from './common';
import { Avatar, nowTime, PctBadge, RegisterCalendar, TrendCard } from './registerParts';
import type { Organization } from '../../state/OrgContext';

export function KidsRegisterPage() {
  return <HopeGate title="Children's register">{(org) => <KidsRegister org={org} />}</HopeGate>;
}

const SHORT: Record<KidMark, string> = { present: 'Present', absent: 'Absent', excused: 'Excused', departing: 'Departing', departed: 'Departed' };

/**
 * The children's weekly register (Andy, 2026-11-04): a calendar (Saturday first), each child marked Present,
 * Absent, Excused (with the reason), Departing or Departed, the check-in time, and each child's percentage.
 */
function KidsRegister({ org }: { org: Organization }) {
  const h = useHopePage(org);
  const { can } = useAuth();
  const toast = useToast();
  const { days } = useHopeDays(org.id);
  const photos = useChildPhotos(org.id);
  const [date, setDate] = useState(() => saturdayOnOrBefore(h.today));
  const [q, setQ] = useState('');
  const [departed, setDeparted] = useState<string | null>(null);
  const canMark = can('attendance.write');
  const fail = (err: unknown) => toast.show(friendlyError(err));

  const day = days.find((d) => d.date === date);
  const marks = day?.marks ?? {};
  const markedDays = useMemo(() => new Set(days.filter((d) => Object.keys(d.marks ?? {}).length).map((d) => d.date)), [days]);
  const trend = useMemo(() => dayTrend(days), [days]);

  const list = useMemo(() => {
    const text = q.trim().toLowerCase();
    const code = normalizeCode(q);
    return h.children
      .filter((c) => marks[c.id] || (isCurrentChild(c) && (!c.enrolledOn || c.enrolledOn <= date)))
      .map((c) => ({ c, name: h.nameOf(c.id) }))
      .filter(({ c, name }) => !text || name.toLowerCase().includes(text) || (c.code ?? '').toLowerCase().includes(text) || (!!code && c.code === code))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [h.children, h.nameOf, marks, date, q]);

  const dayRate = rateFrom(Object.values(marks));
  const unmarked = list.filter(({ c }) => !marks[c.id]);

  function mark(childId: string, s: KidMark, extra: Partial<KidEntry> = {}) {
    const old = marks[childId];
    if (s === 'departed' && old?.s !== 'departed') { setDeparted(childId); return; }
    const entry: KidEntry = { s, t: s === 'present' || s === 'departing' ? (old?.t ?? (date === h.today ? nowTime() : null)) : null, r: s === 'present' ? null : (old?.s === s ? old.r ?? null : null), ...extra };
    markKid(org.id, date, childId, entry).catch(fail);
    const child = h.children.find((c) => c.id === childId);
    if (s === 'departing' && child?.status === 'active') updateChild(org.id, childId, { status: 'departing' }).catch(fail);
  }
  function confirmDeparted() {
    const id = departed!;
    setDeparted(null);
    markKid(org.id, date, id, { s: 'departed', t: null, r: marks[id]?.r ?? null }).catch(fail);
    updateChild(org.id, id, { status: 'exited', exitedOn: date }).catch(fail);
    toast.show(`${h.nameOf(id)} moved to Past children.`);
  }
  function restAbsent() {
    const entries = Object.fromEntries(unmarked.map(({ c }) => [c.id, { s: 'absent', t: null, r: null }]));
    markMany(org.id, 'hopeDays', date, entries).catch(fail);
    toast.show(`${unmarked.length} marked absent`);
  }

  return (
    <div className="page narrow">
      <div className="page-head"><h1>Children's register</h1>{can('people.write') && <Link to="/hope/children/import" className="btn">Upload from Excel</Link>}</div>
      <HopeNav />

      <section className="card hr-top">
        <RegisterCalendar value={date} onChange={setDate} marked={markedDays} today={h.today} />
        <div className="stack">
          <h2>{formatDateKey(date)}</h2>
          <div className="hr-counts">
            <span><b>{dayRate.present}</b> present</span>
            <span><b>{dayRate.absent}</b> absent</span>
            <span><b>{dayRate.excused}</b> excused</span>
            <span><b>{unmarked.length}</b> not marked</span>
          </div>
          {dayRate.pct != null && <p className="lead">{dayRate.pct}% came</p>}
          {canMark && unmarked.length > 0 && Object.keys(marks).length > 0 && (
            <button type="button" className="btn btn-quiet align-start" onClick={restAbsent}>Mark the {unmarked.length} not marked as absent</button>
          )}
        </div>
      </section>

      <input type="search" className="search" placeholder="Find by name or code" aria-label="Find a child" value={q} onChange={(e) => setQ(e.target.value)} />

      {h.loading ? <p className="muted">Loading…</p> : list.length === 0 ? (
        <div className="card"><p>No children on the register yet. <Link to="/hope/children/new">Register a child</Link> or <Link to="/hope/children/import">upload them from Excel</Link>.</p></div>
      ) : (
        <ul className="hr-list">
          {list.map(({ c, name }) => {
            const e = marks[c.id];
            const rate = kidRate(c.id, days);
            return (
              <li key={c.id} className={`card hr-row${e ? ` m-${e.s}` : ''}`}>
                <div className="hr-who">
                  <Avatar photo={c.photoConsent?.given ? photos.get(c.id) : null} name={name} />
                  <div>
                    <Link to={`/hope/children/${c.id}`} className="link-title">{name}</Link>
                    <span className="small muted"> {h.codeOf(c)}{c.status === 'departing' ? ' · Departing' : c.status === 'exited' ? ' · Departed' : ''}</span>
                  </div>
                  <PctBadge pct={rate.pct} />
                </div>
                <div className="hr-marks" role="group" aria-label={`Mark ${name}`}>
                  {KID_MARKS.map((s) => (
                    <button key={s} type="button" disabled={!canMark} aria-pressed={e?.s === s} className={`hr-mark k-${s}${e?.s === s ? ' on' : ''}`} onClick={() => mark(c.id, s)}>{SHORT[s]}</button>
                  ))}
                </div>
                {e && (e.s === 'present' || e.s === 'departing') && (
                  <label className="hr-inline"><span>Checked in at</span>
                    <input type="time" disabled={!canMark} defaultValue={e.t ?? ''} key={`${date}${e.t}`} onBlur={(ev) => ev.target.value !== (e.t ?? '') && mark(c.id, e.s, { t: ev.target.value || null })} />
                  </label>
                )}
                {e && e.s !== 'present' && e.s !== 'absent' && (
                  <label className="hr-inline grow"><span>{e.s === 'excused' ? 'Reason' : 'Note'}</span>
                    <input disabled={!canMark} maxLength={200} defaultValue={e.r ?? ''} key={`${date}${e.r}`} placeholder={e.s === 'excused' ? 'Sick, school trip, travelled…' : 'Moving away, finished the programme…'}
                      onBlur={(ev) => ev.target.value.trim() !== (e.r ?? '') && mark(c.id, e.s, { r: ev.target.value.trim() || null })} />
                  </label>
                )}
              </li>
            );
          })}
        </ul>
      )}

      <TrendCard title="Attendance as time goes" trend={trend} />
      <p className="small muted">Percentages count Present and Departing as there. Excused days are not held against a child. {KID_MARK_LABELS.departed} moves the child to Past children.</p>

      <ConfirmDialog open={!!departed} title={`Has ${departed ? h.nameOf(departed) : ''} left the Hope Centre for good?`}
        body="They move to Past children and leave the weekly register. Their records are kept, and you can bring them back from their page."
        confirmLabel="Yes, departed" danger onConfirm={confirmDeparted} onCancel={() => setDeparted(null)} />
    </div>
  );
}
