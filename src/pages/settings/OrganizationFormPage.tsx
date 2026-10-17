import { useEffect, useState, type FormEvent } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { doc } from 'firebase/firestore';
import { db } from '../../firebase';
import { useOrg } from '../../state/OrgContext';
import { useToast } from '../../state/ToastContext';
import { createRecord, updateRecord } from '../../lib/records';
import { friendlyError } from '../../lib/errors';
import { useSavedMessage } from '../../lib/useSavedMessage';
import {
  ORGANIZATION_TYPES,
  ORGANIZATION_TYPE_LABELS,
  organizationProblems,
  suggestReceiptPrefix,
  type OrganizationInput,
  type OrganizationType,
} from '../../../functions/src/shared/organizations';

/** The three organizations named in the brief, offered as one-tap starting points. */
type OrgForm = OrganizationInput & { active: boolean; serviceTimes: string[] };

const STARTERS: (OrganizationInput & { serviceTimes?: string[] })[] = [
  { name: 'Freedom Church Nairobi', type: 'church_campus', parentId: null, timeZone: 'Africa/Nairobi', currency: 'KES', receiptPrefix: 'FCN', serviceTimes: ['Sunday 10:00'] },
  { name: 'ADIA Training Centre', type: 'college', parentId: null, timeZone: 'Africa/Nairobi', currency: 'KES', receiptPrefix: 'ADIA' },
  { name: 'Freedom Hope Center', type: 'ministry', parentId: null, timeZone: 'Africa/Nairobi', currency: 'KES', receiptPrefix: 'FHC' },
];

const TIME_ZONES = ['Africa/Nairobi', 'Africa/Kampala', 'Africa/Dar_es_Salaam', 'Africa/Kigali', 'Africa/Johannesburg', 'Africa/Lagos', 'Europe/London'];

const EMPTY: OrgForm = {
  name: '', type: 'church_campus', parentId: null, timeZone: 'Africa/Nairobi', currency: 'KES', receiptPrefix: '', active: true, serviceTimes: [],
};

export function OrganizationFormPage() {
  const { orgId } = useParams();
  const { allIncludingDeleted, organizations } = useOrg();
  const navigate = useNavigate();
  const toast = useToast();
  const saved = useSavedMessage();
  const existing = orgId ? allIncludingDeleted.find((o) => o.id === orgId) : undefined;
  const [form, setForm] = useState<OrgForm>(EMPTY);
  const [serviceText, setServiceText] = useState('');
  const [prefixTouched, setPrefixTouched] = useState(false);
  const [problems, setProblems] = useState<string[]>([]);

  useEffect(() => {
    if (existing) {
      setForm({
        name: existing.name, type: existing.type, parentId: existing.parentId ?? null, timeZone: existing.timeZone,
        currency: existing.currency, receiptPrefix: existing.receiptPrefix, active: existing.active,
        serviceTimes: existing.serviceTimes ?? [],
      });
      setServiceText((existing.serviceTimes ?? []).join('\n'));
      setPrefixTouched(true);
    }
  }, [existing?.id]);

  if (orgId && !existing) {
    return <div className="page"><p><Link to="/settings/organizations">← Organizations</Link></p><p>Loading…</p></div>;
  }

  const set = <K extends keyof typeof form>(key: K, value: (typeof form)[K]) => setForm((f) => ({ ...f, [key]: value }));
  const unusedStarters = STARTERS.filter((s) => !organizations.some((o) => o.name.toLowerCase() === s.name.toLowerCase()));
  const prefixTaken = organizations.some((o) => o.id !== orgId && o.receiptPrefix === form.receiptPrefix);

  function submit(e: FormEvent) {
    e.preventDefault();
    const serviceTimes = serviceText.split('\n').map((t) => t.trim()).filter(Boolean).slice(0, 20);
    const input = { ...form, name: form.name.trim(), receiptPrefix: form.receiptPrefix.trim().toUpperCase(), serviceTimes };
    const found = organizationProblems(input);
    if (prefixTaken) found.push('Another organization already uses that receipt prefix.');
    setProblems(found);
    if (found.length) return;
    try {
      if (existing) {
        updateRecord(doc(db, 'organizations', existing.id), input).catch((err) => toast.show(friendlyError(err)));
      } else {
        createRecord('organizations', input).synced.catch((err) => toast.show(friendlyError(err)));
      }
      toast.show(saved(`${input.name} saved`));
      navigate('/settings/organizations');
    } catch (err) {
      setProblems([friendlyError(err)]);
    }
  }

  return (
    <div className="page narrow">
      <p><Link to="/settings/organizations">← Organizations</Link></p>
      <h1>{existing ? `Edit ${existing.name}` : 'Add an organization'}</h1>

      {!existing && unusedStarters.length > 0 && (
        <div className="starters">
          <p className="muted small">Start from one of yours:</p>
          {unusedStarters.map((s) => (
            <button key={s.name} type="button" className="chip" onClick={() => { setForm({ ...s, active: true, serviceTimes: s.serviceTimes ?? [] }); setServiceText((s.serviceTimes ?? []).join('\n')); setPrefixTouched(true); }}>
              {s.name}
            </button>
          ))}
        </div>
      )}

      <form className="form" onSubmit={submit} noValidate>
        <label className="field">
          <span>Name</span>
          <input
            value={form.name}
            required
            onChange={(e) => {
              set('name', e.target.value);
              if (!prefixTouched) set('receiptPrefix', suggestReceiptPrefix(e.target.value));
            }}
          />
        </label>
        <label className="field">
          <span>Type</span>
          <select value={form.type} onChange={(e) => set('type', e.target.value as OrganizationType)}>
            {ORGANIZATION_TYPES.map((t) => <option key={t} value={t}>{ORGANIZATION_TYPE_LABELS[t]}</option>)}
          </select>
        </label>
        <label className="field">
          <span>Part of (optional)</span>
          <select value={form.parentId ?? ''} onChange={(e) => set('parentId', e.target.value || null)}>
            <option value="">None</option>
            {organizations.filter((o) => o.id !== orgId).map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
          </select>
        </label>
        <label className="field">
          <span>Receipt prefix</span>
          <input
            value={form.receiptPrefix}
            maxLength={6}
            autoCapitalize="characters"
            onChange={(e) => { setPrefixTouched(true); set('receiptPrefix', e.target.value.toUpperCase().replace(/[^A-Z]/g, '')); }}
          />
          <small className="hint">Receipts will look like {form.receiptPrefix || 'FCN'}-{new Date().getFullYear()}-000123.</small>
        </label>
        <div className="field-row">
          <label className="field">
            <span>Time zone</span>
            <select value={form.timeZone} onChange={(e) => set('timeZone', e.target.value)}>
              {TIME_ZONES.map((z) => <option key={z} value={z}>{z.replace('_', ' ')}</option>)}
            </select>
          </label>
          <label className="field">
            <span>Currency</span>
            <input value={form.currency} maxLength={3} onChange={(e) => set('currency', e.target.value.toUpperCase())} />
          </label>
        </div>
        <label className="field">
          <span>{form.type === 'church_campus' ? 'Service times' : 'Session times'} (one per line, optional)</span>
          <textarea rows={2} value={serviceText} placeholder="Sunday 10:00" onChange={(e) => setServiceText(e.target.value)} />
          <small className="hint">Used on the visitor form and in WhatsApp messages.</small>
        </label>
        {existing && (
          <label className="check">
            <input type="checkbox" checked={form.active} onChange={(e) => set('active', e.target.checked)} />
            <span>Active (untick to pause without deleting)</span>
          </label>
        )}
        {problems.length > 0 && <ul className="error" role="alert">{problems.map((p) => <li key={p}>{p}</li>)}</ul>}
        <button type="submit" className="btn btn-primary btn-block">Save</button>
      </form>
    </div>
  );
}
