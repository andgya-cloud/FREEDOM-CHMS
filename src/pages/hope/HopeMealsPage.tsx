import { useEffect, useState } from 'react';
import { useAuth } from '../../state/AuthContext';
import { useToast } from '../../state/ToastContext';
import { useHopeDays, useHopeMeals } from '../../state/useHope';
import { friendlyError } from '../../lib/errors';
import { saveMeals } from '../../lib/hopeRecords';
import { CleanupButton } from '../../components/CleanupDialog';
import { formatDateKey } from '../../../functions/src/shared/datetime';
import { rateFrom } from '../../../functions/src/shared/hopeRegister';
import { canCountMeals, MEAL_EMOJI, MEAL_LABELS, MEAL_MAX, MEALS, type Meal } from '../../../functions/src/shared/hopeRecords';
import { useHopePage } from './common';
import type { Organization } from '../../state/OrgContext';

/**
 * Meals served on a day (v182, 4A): counted on the day itself, on Today's live board or the day's attendance page,
 * no longer on a page of their own. It starts with the number checked in; the Director adjusts and saves.
 */
export function MealCounter({ org, date }: { org: Organization; date: string }) {
  useEffect(() => { if (window.location.hash === '#meals') window.setTimeout(() => document.getElementById('meals')?.scrollIntoView({ behavior: 'smooth' }), 400); }, []);
  const h = useHopePage(org);
  const { profile } = useAuth();
  const toast = useToast();
  const counter = canCountMeals(profile, org.id);
  const { meals } = useHopeMeals(org.id);
  const { days } = useHopeDays(org.id);
  const saved = meals.find((m) => m.date === date);
  const present = rateFrom(Object.values(days.find((d) => d.date === date)?.marks ?? {})).present;
  const [counts, setCounts] = useState<Record<Meal, string>>({ breakfast: '', lunch: '', fruit: '' });
  useEffect(() => {
    const start = (m: Meal) => String(saved ? saved[m] : present || '');
    setCounts({ breakfast: start('breakfast'), lunch: start('lunch'), fruit: start('fruit') });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [date, saved?.breakfast, saved?.lunch, saved?.fruit, present]);
  const num = (v: string) => Math.max(0, Math.min(MEAL_MAX, Math.round(Number(v) || 0)));
  const step = (m: Meal, by: number) => setCounts((c) => ({ ...c, [m]: String(Math.max(0, num(c[m]) + by)) }));

  function save() {
    try {
      saveMeals(org.id, date, { breakfast: num(counts.breakfast), lunch: num(counts.lunch), fruit: num(counts.fruit) }).catch((err) => toast.show(friendlyError(err)));
      toast.show(`Meals saved for ${date === h.today ? 'today' : formatDateKey(date)}`);
    } catch (err) { toast.show(friendlyError(err)); }
  }

  return (
      <section className="card stack" id="meals">
        <div className="ck-day">
          <span className="ck-day-ico" aria-hidden="true">📅</span>
          <span className="grow"><b>🍽️ Meals {date === h.today ? 'today' : `on ${formatDateKey(date)}`}</b>
            <span className="small muted">{present ? `${present} ${present === 1 ? 'child' : 'children'} checked in` : 'Nobody checked in on this day yet'}</span></span>
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

  );
}
