import { useId, useMemo, useState } from 'react';
import { usePeople, type Person } from '../state/PeopleContext';
import { matchesSearch } from '../../functions/src/shared/people';
import { formatPhone } from '../../functions/src/shared/phone';

interface Props {
  label: string;
  /** The chosen person, or free text when nobody in the system matches. */
  value: { id: string | null; name: string };
  onChange: (value: { id: string | null; name: string }) => void;
  allowFreeText?: boolean;
  excludeId?: string;
  orgId?: string;
  hint?: string;
}

/** Type a name or number and pick someone already in the system. */
export function PersonPicker({ label, value, onChange, allowFreeText, excludeId, orgId, hint }: Props) {
  const { people } = usePeople();
  const [open, setOpen] = useState(false);
  const id = useId();
  const matches = useMemo(() => {
    if (value.name.trim().length < 2) return [];
    return people.filter((p) => p.id !== excludeId && (!orgId || p.orgId === orgId) && matchesSearch(p, value.name)).slice(0, 6);
  }, [people, value.name, excludeId, orgId]);

  const pick = (p: Person) => {
    onChange({ id: p.id, name: p.fullName });
    setOpen(false);
  };

  return (
    <div className="field picker">
      <label htmlFor={id}>{label}</label>
      <input
        id={id}
        value={value.name}
        autoComplete="off"
        onFocus={() => setOpen(true)}
        onBlur={() => window.setTimeout(() => setOpen(false), 150)}
        onChange={(e) => { onChange({ id: null, name: e.target.value }); setOpen(true); }}
        onKeyDown={(e) => { if (e.key === 'Escape') setOpen(false); }}
        aria-expanded={open && matches.length > 0}
        aria-controls={`${id}-list`}
      />
      {value.id && <small className="hint hint-ok">Linked to {value.name} in the system.</small>}
      {!value.id && value.name && !allowFreeText && <small className="hint">Pick someone from the list.</small>}
      {hint && !value.name && <small className="hint">{hint}</small>}
      {open && matches.length > 0 && (
        <ul className="picker-list" id={`${id}-list`} role="listbox">
          {matches.map((p) => (
            <li key={p.id} role="option" aria-selected={value.id === p.id}>
              <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => pick(p)}>
                <span>{p.fullName}</span>
                <span className="muted small">{formatPhone(p.phone)}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
