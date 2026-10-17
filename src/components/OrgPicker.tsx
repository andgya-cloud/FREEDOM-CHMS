import { useOrg } from '../state/OrgContext';

/** In the combined view, asks which organization a new record belongs to. */
export function OrgPicker({ value, onChange }: { value: string; onChange: (id: string) => void }) {
  const { organizations } = useOrg();
  return (
    <label className="field">
      <span>Organization</span>
      <select value={value} onChange={(e) => onChange(e.target.value)}>
        <option value="">Choose…</option>
        {organizations.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
      </select>
    </label>
  );
}
