import type { Consent, ChildProgramme } from '../../../functions/src/shared/hope';
import { MEALS_PROGRAMME } from '../../../functions/src/shared/hope';

const same = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

/** What to ask about for each programme: a team or class, and a level. */
export function programmeLabels(name: string): { group: string | null; level: string | null } {
  const n = name.toLowerCase();
  if (n.includes('football')) return { group: 'Team or age group', level: null };
  if (n.includes('chess')) return { group: null, level: 'Level reached' };
  if (n.includes('music')) return { group: 'Instrument or class', level: 'Progress level' };
  return { group: null, level: null };
}

/** Tick the programmes a child joined; each can carry a team or class and a level. */
export function ProgrammeFields({ programmes, value, onChange, disabled }: { programmes: string[]; value: ChildProgramme[]; onChange: (v: ChildProgramme[]) => void; disabled?: boolean }) {
  const find = (name: string) => value.find((p) => same(p.name, name));
  const toggle = (name: string, on: boolean) => onChange(on ? [...value, { name, group: '', level: '' }] : value.filter((p) => !same(p.name, name)));
  const patch = (name: string, change: Partial<ChildProgramme>) => onChange(value.map((p) => (same(p.name, name) ? { ...p, ...change } : p)));
  return (
    <fieldset className="stack">
      <legend>Programmes</legend>
      {programmes.map((name) => {
        const joined = find(name);
        const labels = programmeLabels(name);
        return (
          <div key={name} className="stack">
            <label className="check"><input type="checkbox" disabled={disabled} checked={!!joined} onChange={(e) => toggle(name, e.target.checked)} /><span>{name}{same(name, MEALS_PROGRAMME) ? ' (drop-in)' : ''}</span></label>
            {joined && (labels.group || labels.level) && (
              <div className="field-row">
                {labels.group && <label className="field"><span>{labels.group}</span><input disabled={disabled} maxLength={60} value={joined.group} onChange={(e) => patch(name, { group: e.target.value })} /></label>}
                {labels.level && <label className="field"><span>{labels.level}</span><input disabled={disabled} maxLength={60} value={joined.level} onChange={(e) => patch(name, { level: e.target.value })} /></label>}
              </div>
            )}
          </div>
        );
      })}
    </fieldset>
  );
}

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
