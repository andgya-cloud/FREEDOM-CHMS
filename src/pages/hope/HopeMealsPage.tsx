import { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useAuth } from '../../state/AuthContext';
import { useToast } from '../../state/ToastContext';
import { useHopeDays, useHopeMeals } from '../../state/useHope';
import { friendlyError } from '../../lib/errors';
import { saveMeals } from '../../lib/hopeRecords';
import { CleanupButton } from '../../components/CleanupDialog';
import { formatDateKey } from '../../../functions/src/shared/datetime';
import { rateFrom } from '../../../functions/src/shared/hopeRegister';
import { canCountMeals, MEAL_EMOJI, MEAL_LABELS, MEAL_MAX, mealMonth, MEALS, type Meal } from '../../../functions/src/shared/hopeRecords';
import { HopeGate, useHopePage } from './common';
import type { Organization } from '../../state/OrgContext';

export function HopeMealsPage() {
  return <HopeGate title="Meals">{(org) => <Meals org={org} />}</HopeGate>;
}

/**
 * Meals served (Andy, 2026-11-05, 9A 10A 11 12A): how many children had breakfast, lunch and fruit each day. It starts
 * with the number checked in that day; the Director adjusts and saves. Counts only, no names.
 */
function Meals({ org }: { org: Organization }) {
  const h = useHopePage(org);
  const { profile } = useAuth();
  const toast = useToast();
  const [params, setParams] = useSearchParams();
  const counter = canCountMeals(profile, org.id);
  const { meals, loading } = useHopeMeals(org.id);
  const { days } = useHopeDays(org.id);
  const asked = params.get('d');
  const date = asked && /^\d{4}-\d{2}-\d{2}$/.test(asked) && asked <= h.today ? asked : h.today;
  const saved = meals.find((m) => m.date === date);
  const present = rateFrom(Object.values(days.find((d) => d.date === date)?.marks ?? {})).present;
  const [counts, setCounts] = useState<Record<Meal, string>>({ breakfast: '', lunch: '', fruit: '' });
  useEffect(() => {
    const start = (m: Meal) => String(saved ? saved[m] : present || '');
    setCounts({ breakfast: start('breakfast'), lunch: start('lunch'), fruit: start('fruit') });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [date, saved?.breakfast, saved?.lunch, saved?.fruit, present]);
  const month = useMemo(() => mealMonth(meals, h.today), [meals, h.today]);
  const num = (v: string) => Math.max(0, Math.min(MEAL_MAX, Math.round(Number(v) || 0)));
  const step = (m: Meal, by: number) => setCounts((c) => ({ ...c, [m]: String(Math.max(0, num(c[m]) + by)) }));

  function save() {
    try {
      saveMeals(org.id, date, { breakfast: num(counts.breakfast), lunch: num(counts.lunch), fruit: num(counts.fruit) }).catch((err) => toast.show(friendlyError(err)));
      toast.show(`Meals saved for ${date === h.today ? 'today' : formatDateKey(date)}`);
    } catch (err) { toast.show(friendlyError(err)); }
  }

  return (
    <div className="page narrow">
      <p><Link to="/">← Today</Link></p>
      <h1>🍽️ Meals</h1>
      <section className="card stack">
        <div className="ck-day">
          <span className="ck-day-ico" aria-hidden="true">📅</span>
          <span className="grow"><b>{date === h.today ? 'Today' : formatDateKey(date)}</b>
            <span className="small muted">{present ? `${present} ${present === 1 ? 'child' : 'children'} checked in` : 'Nobody checked in on this day yet'}</span></span>
          <input type="date" aria-label="Day" value={date} max={h.today} onChange={(e) => setParams(e.target.value && e.target.value !== h.today ? { d: e.target.value } : {}, { replace: true })} />
        </div>
        <div className="meal-grid">
          {MEALS.map((m) => (
            <div key={m} className="meal-box">
              <span className="meal-ico" aria-hidden="true">{MEAL_EMOJI[m]}</span>
              <b>{MEAL_LABELS[m]}</b>
              <div className="meal-step">
                <button type="button" className="btn btn-quiet" disabled={!counter} aria-label={`One less ${MEAL_LABELS[m]}`} onClick={() => step(m, -1)}>−</button>
                <input inputMode="numeric" aria-label={`${MEAL_LABELS[m]} served`} disabled={!counter} value={counts[m]} onChange={(e) => setCounts((c) => ({ ...c, [m]: e.target.value.replace(/[^0-9]/g, '') }))} />
                <button type="button" className="btn btn-quiet" disabled={!counter} aria-label={`One more ${MEAL_LABELS[m]}`} onClick={() => step(m, 1)}>+</button>
              </div>
            </div>
          ))}
        </div>
        {counter ? (
          <div className="chips">
            <button type="button" className="btn btn-primary" onClick={save}>{saved ? 'Save changes' : 'Save meals'}</button>
            {saved && <CleanupButton orgId={org.id} kind="mealDay" id={date} hope label="Reset this day" />}
          </div>
        ) : <p className="small muted">The Director records the meals.</p>}
        {saved && <p className="small muted">✓ Saved for this day.</p>}
      </section>

      <section className="card stack">
        <h2>This month</h2>
        <div className="ck-counts">
          {MEALS.map((m) => <span key={m}><b>{month[m]}</b> {MEAL_LABELS[m].toLowerCase()}</span>)}
          <span className="ok"><b>{month.total}</b> meals in {month.days} {month.days === 1 ? 'day' : 'days'}</span>
        </div>
        {loading ? <p className="muted">Loading…</p> : meals.length === 0 ? <p className="muted small">No meals saved yet.</p> : (
          <ul className="link-list">
            {meals.slice(0, 31).map((m) => (
              <li key={m.date}><Link to={m.date === h.today ? '/hope/meals' : `/hope/meals?d=${m.date}`}>
                <span className="link-title">{formatDateKey(m.date)}</span>
                <span className="link-detail">{MEALS.map((k) => `${MEAL_EMOJI[k]} ${m[k]}`).join('  ')}</span>
              </Link></li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
