import type { Consent } from '../../../functions/src/shared/hope';

/** Yes, no or not yet, with the date it was recorded. Never blocks saving. */
export function ConsentField({ label, value, onChange, today, disabled }: { label: string; value: Consent; onChange: (v: Consent) => void; today: string; disabled?: boolean }) {
  const current = value.given == null ? 'unknown' : value.given ? 'yes' : 'no';
  return (
    <label className="field">
      <span>{label}</span>
      <select disabled={disabled} value={current} onChange={(e) => {
        const v = e.target.value;
        onChange(v === 'unknown' ? { given: null, date: null } : { given: v === 'yes', date: value.date ?? today });
      }}>
        <option value="unknown">Not on file yet</option>
        <option value="yes">Yes, agreed</option>
        <option value="no">No, declined</option>
      </select>
      {value.given != null && (
        <input type="date" aria-label={`${label}: date`} disabled={disabled} value={value.date ?? ''} max={today} onChange={(e) => onChange({ ...value, date: e.target.value || null })} />
      )}
    </label>
  );
}
