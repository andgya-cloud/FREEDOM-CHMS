import { useMemo, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { useAuth } from '../../state/AuthContext';
import { useToast } from '../../state/ToastContext';
import { useHopeDays, useHopeMeals } from '../../state/useHope';
import { useHopeReportList } from './HopeReportsPage';
import { friendlyError } from '../../lib/errors';
import { downloadFile } from '../../lib/givingPdf';
import { attendanceDayExcel, attendanceDayPdf, attendanceMonthExcel, type DayLine } from '../../lib/hopeAttendanceFiles';
import { CleanupButton } from '../../components/CleanupDialog';
import { formatDateKey } from '../../../functions/src/shared/datetime';
import { kidCame, KID_MARK_LABELS, rateFrom } from '../../../functions/src/shared/hopeRegister';
import { canReadNotes, MEAL_EMOJI, MEAL_LABELS, mealMonth, MEALS } from '../../../functions/src/shared/hopeRecords';
import { MealCounter } from './HopeMealsPage';
import { HopeGate, useHopePage } from './common';
import type { Organization } from '../../state/OrgContext';

export function HopeAttendancePage() {
  return <HopeGate title="Attendance">{(org) => <Months org={org} />}</HopeGate>;
}
export function HopeAttendanceDayPage() {
  return <HopeGate title="Attendance">{(org) => <Day org={org} />}</HopeGate>;
}

const monthLabel = (m: string) => new Intl.DateTimeFormat('en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${m}-15T12:00:00Z`));
const weekday = (d: string) => new Intl.DateTimeFormat('en-GB', { weekday: 'long', timeZone: 'UTC' }).format(new Date(`${d}T12:00:00Z`));

/**
 * Reports → Attendance (Andy, 2026-11-05, 2A): every register day kept in folders by month. Each day opens to who
 * came and when, who was absent and who was excused. The Director, Andy and Doreen download a day as PDF or Excel,
 * or a whole month as one Excel grid.
 */
function Months({ org }: { org: Organization }) {
  const h = useHopePage(org);
  const { profile, can } = useAuth();
  const toast = useToast();
  const { days, loading } = useHopeDays(org.id);
  const files = canReadNotes(profile, org.id);
  const marked = useMemo(() => days.filter((d) => Object.keys(d.marks ?? {}).length > 0).sort((a, b) => b.date.localeCompare(a.date)), [days]);
  const { meals } = useHopeMeals(org.id);
  const { reports, pastor } = useHopeReportList(org.id);
  const [params] = useSearchParams();
  const asked = params.get('month');
  const months = useMemo(() => {
    const m = new Map<string, typeof marked>();
    for (const d of marked) { const k = d.date.slice(0, 7); m.set(k, [...(m.get(k) ?? []), d]); }
    for (const x of meals) { const k = x.date.slice(0, 7); if (!m.has(k)) m.set(k, []); }
    return [...m.entries()].sort((a, b) => b[0].localeCompare(a[0]));
  }, [marked, meals]);

  async function monthExcel(month: string, list: typeof marked) {
    try {
      const dates = list.map((d) => d.date).sort();
      const ids = new Set(list.flatMap((d) => Object.keys(d.marks ?? {})));
      const kids = h.children.filter((c) => ids.has(c.id)).map((c) => ({ name: h.nameOf(c.id), code: c.code ?? '', marks: dates.map((dt) => list.find((d) => d.date === dt)?.marks?.[c.id] ?? null) }))
        .sort((a, b) => a.name.localeCompare(b.name));
      downloadFile(await attendanceMonthExcel(org, month, monthLabel(month), dates, kids));
    } catch (err) { toast.show(friendlyError(err)); }
  }

  return (
    <div className="page narrow">
      <p><Link to="/hope/reports">← Reports</Link></p>
      <div className="page-head"><h1>📋 Attendance and meals</h1><Link to="/hope/register?d=today" className="btn btn-primary">✅ Check in</Link></div>
      <p className="muted small">Every register day, the meals served and the month's report, in folders by month.</p>
      {can('people.write') && <p><Link to="/hope/register/upload" className="btn btn-quiet btn-small">⬆︎ Upload past registers</Link></p>}
      {loading || h.loading ? <p className="muted">Loading…</p> : months.length === 0 ? (
        <div className="card"><p>No register has been marked yet. Tap <b>Check in</b> to start today's.</p></div>
      ) : months.map(([month, list], i) => {
        const came = list.reduce((n, d) => n + rateFrom(Object.values(d.marks)).present, 0);
        const food = mealMonth(meals, `${month}-01`);
        const mine = reports.filter((r) => r.from.slice(0, 7) === month && (r.audience === 'counts' || pastor));
        return (
          <details key={month} className="card hr-fold" open={asked ? asked === month : i === 0}>
            <summary><h2>📁 {monthLabel(month)}</h2><span className="small muted">{list.length} {list.length === 1 ? 'day' : 'days'} · {came} {came === 1 ? 'check-in' : 'check-ins'}{food.total ? ` · ${food.total} meals` : ''}</span></summary>
            <div className="stack">
              {food.days > 0 && (
                <div className="ck-counts meal-month">
                  <span>🍽️ <b>{food.total}</b> meals in {food.days} {food.days === 1 ? 'day' : 'days'}</span>
                  {MEALS.map((k) => <span key={k}>{MEAL_EMOJI[k]} <b>{food[k]}</b> {MEAL_LABELS[k].toLowerCase()}</span>)}
                </div>
              )}
              {mine.length > 0 && (
                <ul className="link-list">
                  {mine.map((r) => <li key={r.id}><Link to={`/hope/reports?report=${r.id}`}><span className="link-title">📄 {r.type === 'weekly' ? 'Weekly report' : 'Month report'}: {r.label}</span>
                    <span className="link-detail">{r.type === 'weekly' ? 'For the pastor, with the children to follow up' : 'Numbers only, for leaders and donors'}</span></Link></li>)}
                </ul>
              )}
              <ul className="link-list">
                {list.map((d) => {
                  const r = rateFrom(Object.values(d.marks));
                  return (
                    <li key={d.date}><Link to={`/hope/attendance/${d.date}`}>
                      <span className="link-title">{weekday(d.date)}, {formatDateKey(d.date)}</span>
                      <span className="link-detail">{r.present} came · {r.absent} absent{r.excused ? ` · ${r.excused} excused` : ''}{r.pct != null ? ` · ${r.pct}%` : ''}</span>
                    </Link></li>
                  );
                })}
              </ul>
              {files && list.length > 0 && <button type="button" className="btn btn-quiet align-start" onClick={() => void monthExcel(month, list)}>⬇︎ {monthLabel(month)} in Excel</button>}
            </div>
          </details>
        );
      })}
    </div>
  );
}

function Day({ org }: { org: Organization }) {
  const { date: asked = '' } = useParams();
  const h = useHopePage(org);
  const date = asked === 'today' ? h.today : asked;
  const { profile } = useAuth();
  const toast = useToast();
  const { days, loading } = useHopeDays(org.id);
  const [busy, setBusy] = useState(false);
  const files = canReadNotes(profile, org.id);
  const day = days.find((d) => d.date === date);
  const lines: DayLine[] = useMemo(() => Object.entries(day?.marks ?? {}).map(([id, entry]) => {
    const c = h.children.find((x) => x.id === id);
    return { name: h.nameOf(id), code: c?.code ?? '', entry };
  }).sort((a, b) => a.name.localeCompare(b.name)), [day, h.children, h.nameOf]);
  const came = lines.filter((l) => kidCame(l.entry?.s)).sort((a, b) => (a.entry?.t ?? '99').localeCompare(b.entry?.t ?? '99'));
  const absent = lines.filter((l) => l.entry?.s === 'absent');
  const excused = lines.filter((l) => l.entry?.s === 'excused');
  const other = lines.filter((l) => l.entry?.s === 'departed');

  async function get(kind: 'pdf' | 'excel') {
    setBusy(true);
    try { downloadFile(kind === 'pdf' ? await attendanceDayPdf(org, date, lines) : await attendanceDayExcel(org, date, lines)); }
    catch (err) { toast.show(friendlyError(err)); }
    finally { setBusy(false); }
  }

  return (
    <div className="page narrow">
      <p><Link to="/hope/attendance">← Attendance</Link></p>
      <div className="page-head">
        <h1>{date ? `${weekday(date)}, ${formatDateKey(date)}` : 'Attendance'}</h1>
        {day && <CleanupButton orgId={org.id} kind="hopeDay" id={date} back="/hope/attendance" label="Reset this day" />}
      </div>
      {loading || h.loading ? <p className="muted">Loading…</p> : !day ? <div className="card"><p>The register was not marked on this day.</p></div> : (
        <>
          <section className="card ck-counts">
            <span className="ok"><b>{came.length}</b> came</span>
            <span className="bad"><b>{absent.length}</b> absent</span>
            <span><b>{excused.length}</b> excused</span>
          </section>
          {files && (
            <div className="btn-line">
              <button type="button" className="btn" disabled={busy} onClick={() => void get('pdf')}>⬇︎ PDF</button>
              <button type="button" className="btn" disabled={busy} onClick={() => void get('excel')}>⬇︎ Excel</button>
              <Link to={`/hope/register?d=${date}`} className="btn btn-quiet">Open the register</Link>
            </div>
          )}
          <AttList title="Came" rows={came} detail={(l) => (l.entry?.t ? `Arrived ${l.entry.t}` : 'Here')} />
          <AttList title="Absent" rows={absent} detail={() => 'Absent'} />
          <AttList title="Excused" rows={excused} detail={(l) => l.entry?.r || 'Excused'} />
          <AttList title="Departed" rows={other} detail={(l) => l.entry ? KID_MARK_LABELS[l.entry.s] : ''} />
        </>
      )}
      {/^\d{4}-\d{2}-\d{2}$/.test(date) && date <= h.today && <MealCounter org={org} date={date} />}
    </div>
  );
}

function AttList({ title, rows, detail }: { title: string; rows: DayLine[]; detail: (l: DayLine) => string }) {
  if (!rows.length) return null;
  return (
    <section className="card stack">
      <h2>{title} ({rows.length})</h2>
      <ol className="att-list">
        {rows.map((l) => <li key={`${l.name}${l.code}`}><span className="grow"><b>{l.name}</b> <span className="small muted">{l.code}</span></span><span className="small">{detail(l)}</span></li>)}
      </ol>
    </section>
  );
}
