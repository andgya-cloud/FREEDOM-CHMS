import { useState, type ChangeEvent, type InputHTMLAttributes } from 'react';
import { ADIA_START } from '../../functions/src/shared/adiaYears';

/**
 * A date (or month) box for ADIA's records (Andy, 2026-11-20, 4B): ADIA began on 1 August 2025, so an earlier
 * day is refused with a short note and never saved. Birth dates do not use it.
 */
export function AdiaDate({ type = 'date', onChange, ...rest }: InputHTMLAttributes<HTMLInputElement> & { type?: 'date' | 'month' }) {
  const [bad, setBad] = useState(false);
  const min = type === 'month' ? ADIA_START.slice(0, 7) : ADIA_START;
  const lower = typeof rest.min === 'string' && rest.min > min ? rest.min : min;
  function change(e: ChangeEvent<HTMLInputElement>) {
    const v = e.target.value;
    if (v && v.length === min.length && v < min) {
      setBad(true);
      // An uncontrolled box keeps what was typed, so clear it.
      if (rest.value === undefined) e.target.value = '';
      return;
    }
    setBad(false);
    onChange?.(e);
  }
  return (
    <>
      <input {...rest} type={type} min={lower} onChange={change} />
      {bad && <span className="up-bad small" role="alert">ADIA began in August 2025. Choose {type === 'month' ? 'a month' : 'a date'} from then on.</span>}
    </>
  );
}
