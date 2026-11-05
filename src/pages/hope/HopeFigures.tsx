import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../../state/AuthContext';
import { useChampions, useClubs, useHopeDays, useHopeMeals } from '../../state/useHope';
import { AdiaIcon } from '../../components/icons';
import { DeptBars, HOPE_DONUT_COLOURS, Kpi, Ring, StackBars, StatusDonut } from '../../components/LavFigures';
import { canCountMeals, MEAL_LABELS, mealMonth, MEALS, mealWeeks } from '../../../functions/src/shared/hopeRecords';
import { formatDateKey } from '../../../functions/src/shared/datetime';
import { consentMissing, isCurrentChild, SCHOOL_STATUSES, SCHOOL_STATUS_LABELS } from '../../../functions/src/shared/hope';
import { dayTrend, rateFrom, saturdayOnOrBefore } from '../../../functions/src/shared/hopeRegister';
import { pct, useHopePage } from './common';
import { TrendChart } from './registerParts';
import type { Organization } from '../../state/OrgContext';

/**
 * The Hope Centre's figures (v182, 11A): moved from Today to the top of Reports. The same KPIs, rings and charts as
 * ADIA's, in the Hope greens. Counts only, no names.
 */
export function HopeFigures({ org }: { org: Organization }) {
  const h = useHopePage(org);
  const { profile, can } = useAuth();
  const { days } = useHopeDays(org.id);
  const champ = useChampions(org.id);
  const clubs = useClubs(org.id);
  const { meals } = useHopeMeals(org.id);
  const mealCounter = canCountMeals(profile, org.id);
  const marker = can('attendance.write');
  const isSaturday = saturdayOnOrBefore(h.today) === h.today;
  const sat = saturdayOnOrBefore(h.today);
  const current = useMemo(() => h.children.filter(isCurrentChild), [h.children]);
  const kids = rateFrom(Object.values(days.find((d) => d.date === sat)?.marks ?? {}));
  const champs = rateFrom(Object.values(champ.days.find((d) => d.date === sat)?.marks ?? {}));
  const serving = champ.champions.filter((x) => x.status === 'active').length;
  const trend = useMemo(() => dayTrend(days), [days]);
  const m = h.metrics;

  const missing = h.children.filter(consentMissing).length;
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
                      {mealCounter && <Link to="/hope/attendance/today#meals" className="lav-btn dark small">Count meals</Link>}
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

          </div>
  );
}
