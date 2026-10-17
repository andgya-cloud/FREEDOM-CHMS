import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { doc, getDoc, setDoc } from 'firebase/firestore';
import { db } from '../../firebase';
import { CUSTOM_FIELD_TYPES, useCustomFields, type CustomField, type CustomFieldType } from '../../state/useSettingsDoc';
import { useToast } from '../../state/ToastContext';
import { createStamps, updateRecord } from '../../lib/records';
import { trackWrite } from '../../lib/sync';
import { friendlyError } from '../../lib/errors';
import { useSavedMessage } from '../../lib/useSavedMessage';

const TYPE_LABELS: Record<CustomFieldType, string> = { text: 'Text', date: 'Date', yesno: 'Yes or no', choice: 'Pick from a list' };

/** Extra fields on every person, added by the pastor without code. */
export function CustomFieldsPage() {
  const current = useCustomFields();
  const toast = useToast();
  const saved = useSavedMessage();
  const [fields, setFields] = useState<CustomField[]>(current);
  const [dirty, setDirty] = useState(false);
  useEffect(() => { if (!dirty) setFields(current); }, [current, dirty]);

  const update = (id: string, change: Partial<CustomField>) => { setFields(fields.map((f) => (f.id === id ? { ...f, ...change } : f))); setDirty(true); };

  function add() {
    let id = `field_${Date.now().toString(36)}`;
    while (fields.some((f) => f.id === id)) id += '_';
    setFields([...fields, { id, label: '', type: 'text', options: [], active: true }]);
    setDirty(true);
  }

  async function save() {
    if (fields.some((f) => !f.label.trim())) return toast.show('Every field needs a name.');
    const clean = fields.map((f) => ({
      ...f,
      label: f.label.trim(),
      options: f.type === 'choice' ? (f.options ?? []).map((o) => o.trim()).filter(Boolean) : [],
    }));
    const ref = doc(db, 'settings', 'customFields');
    try {
      const exists = (await getDoc(ref).catch(() => null))?.exists() ?? true;
      const write = exists ? updateRecord(ref, { fields: clean }) : trackWrite(setDoc(ref, { fields: clean, ...createStamps() }));
      write.catch((err) => toast.show(friendlyError(err)));
      setDirty(false);
      toast.show(saved('Fields saved'));
    } catch (err) {
      toast.show(friendlyError(err));
    }
  }

  return (
    <div className="page narrow">
      <p><Link to="/settings">← Settings</Link></p>
      <h1>Extra fields</h1>
      <p className="muted">Add your own fields to every person, such as “Estate” or “Occupation”. Only collect what you need.</p>
      {fields.length === 0 && <p className="muted">No extra fields yet.</p>}
      {fields.map((f) => (
        <div key={f.id} className="card">
          <label className="field">
            <span>Field name</span>
            <input value={f.label} onChange={(e) => update(f.id, { label: e.target.value })} placeholder="For example: Estate" />
          </label>
          <label className="field">
            <span>Type</span>
            <select value={f.type} onChange={(e) => update(f.id, { type: e.target.value as CustomFieldType })}>
              {CUSTOM_FIELD_TYPES.map((t) => <option key={t} value={t}>{TYPE_LABELS[t]}</option>)}
            </select>
          </label>
          {f.type === 'choice' && (
            <label className="field">
              <span>Choices (one per line)</span>
              <textarea rows={3} value={(f.options ?? []).join('\n')} onChange={(e) => update(f.id, { options: e.target.value.split('\n') })} />
            </label>
          )}
          <label className="check">
            <input type="checkbox" checked={f.active} onChange={(e) => update(f.id, { active: e.target.checked })} />
            <span>In use</span>
          </label>
        </div>
      ))}
      <button type="button" className="btn" onClick={add}>Add a field</button>
      <button type="button" className="btn btn-primary btn-block" disabled={!dirty} onClick={() => void save()}>Save fields</button>
    </div>
  );
}

