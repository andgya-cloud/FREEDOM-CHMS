import { useEffect, useRef, useState } from 'react';
import { useToast } from '../state/ToastContext';
import type { ChurchEvent } from '../state/useAttendance';
import { saveHeadcounts } from '../lib/attendanceWrites';
import { friendlyError } from '../lib/errors';
import { useSavedMessage } from '../lib/useSavedMessage';
import {
  cleanCount,
  HEADCOUNT_FIELDS,
  HEADCOUNT_LABELS,
  headcountTotal,
  type HeadcountKey,
  type Headcounts,
} from '../../functions/src/shared/attendance';

const HINTS: Partial<Record<HeadcountKey, string>> = {
  adults: '20 and over',
  teens: '13 to 19',
  children: 'Under 13',
  new: 'First time here',
  returning: 'Been before',
  total: 'When names are not taken',
};

/**
 * The ushers' count. Tap + as people come in, or type the number at the end.
 * Saves by itself a moment after the last change.
 */
export function HeadcountEditor({ event, canEdit }: { event: ChurchEvent; canEdit: boolean }) {
  const toast = useToast();
  const saved = useSavedMessage();
  const fields = HEADCOUNT_FIELDS[event.type];
  const [counts, setCounts] = useState<Headcounts>(event.headcounts ?? {});
  const [status, setStatus] = useState('');
  const dirty = useRef(false);
  const timer = useRef<number | undefined>(undefined);
  const pending = useRef<(() => void) | null>(null);

  // Take changes made on other devices, unless this one has unsaved typing.
  useEffect(() => {
    if (!dirty.current) setCounts(event.headcounts ?? {});
  }, [event.id, JSON.stringify(event.headcounts)]);

  // Leaving the page straight after a tap still saves it.
  useEffect(() => () => {
    window.clearTimeout(timer.current);
    pending.current?.();
  }, []);

  if (fields.length === 0) return null;

  function change(key: HeadcountKey, value: number) {
    const next = { ...counts, [key]: cleanCount(value) };
    setCounts(next);
    dirty.current = true;
    setStatus('');
    window.clearTimeout(timer.current);
    pending.current = () => {
      pending.current = null;
      const clean: Headcounts = {};
      for (const k of fields) clean[k] = cleanCount(next[k]);
      saveHeadcounts(event.orgId, event.id, clean).catch((err) => toast.show(friendlyError(err)));
      dirty.current = false;
    };
    timer.current = window.setTimeout(() => {
      pending.current?.();
      setStatus(saved('Saved'));
    }, 800);
  }

  const total = headcountTotal(counts, event.type);
  return (
    <section className="card">
      <div className="card-head">
        <h2>{event.type === 'meal' ? 'Meals served' : 'Headcount'}</h2>
        <strong className="big-number" aria-label={`Total ${total}`}>{total}</strong>
      </div>
      <div className="steppers">
        {fields.map((k) => (
          <div key={k} className="stepper">
            <label htmlFor={`count-${k}`}>
              <span className="stepper-label">{HEADCOUNT_LABELS[k]}</span>
              <span className="hint">{HINTS[k]}</span>
            </label>
            <div className="stepper-controls">
              <button type="button" className="btn" disabled={!canEdit || !counts[k]} aria-label={`One fewer ${HEADCOUNT_LABELS[k].toLowerCase()}`} onClick={() => change(k, (counts[k] ?? 0) - 1)}>−</button>
              <input
                id={`count-${k}`}
                type="number"
                inputMode="numeric"
                min={0}
                value={counts[k] ?? 0}
                disabled={!canEdit}
                onFocus={(e) => e.target.select()}
                onChange={(e) => change(k, Number(e.target.value))}
              />
              <button type="button" className="btn btn-primary" disabled={!canEdit} aria-label={`One more ${HEADCOUNT_LABELS[k].toLowerCase()}`} onClick={() => change(k, (counts[k] ?? 0) + 1)}>+</button>
            </div>
          </div>
        ))}
      </div>
      {status && <p className="hint hint-ok" role="status">{status}</p>}
    </section>
  );
}
