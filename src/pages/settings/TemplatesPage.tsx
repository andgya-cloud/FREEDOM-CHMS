import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { doc, getDoc } from 'firebase/firestore';
import { db } from '../../firebase';
import { useTemplates } from '../../state/useFollowUps';
import { useToast } from '../../state/ToastContext';
import { saveTemplates } from '../../lib/followUpWrites';
import { friendlyError } from '../../lib/errors';
import { useSavedMessage } from '../../lib/useSavedMessage';
import { DEFAULT_TEMPLATES, MERGE_FIELDS, unknownFields, type MessageTemplate } from '../../../functions/src/shared/followups';

/** The WhatsApp message templates, with the merge fields they can use. */
export function TemplatesPage() {
  const { templates: current } = useTemplates();
  const toast = useToast();
  const saved = useSavedMessage();
  const [list, setList] = useState<MessageTemplate[]>(current);
  const [dirty, setDirty] = useState(false);

  useEffect(() => { if (!dirty) setList(current); }, [current, dirty]);

  function change(id: string, patch: Partial<MessageTemplate>) {
    setList(list.map((t) => (t.id === id ? { ...t, ...patch } : t)));
    setDirty(true);
  }

  async function save() {
    if (list.some((t) => !t.name.trim() || !t.body.trim())) return toast.show('Every template needs a name and some words.');
    try {
      const exists = (await getDoc(doc(db, 'settings', 'whatsappTemplates')).catch(() => null))?.exists() ?? false;
      saveTemplates(list, exists).catch((err) => toast.show(friendlyError(err)));
      setDirty(false);
      toast.show(saved('Templates saved'));
    } catch (err) {
      toast.show(friendlyError(err));
    }
  }

  return (
    <div className="page narrow">
      <p><Link to="/settings">← Settings</Link></p>
      <h1>WhatsApp messages</h1>
      <p className="lead">The words each follow-up starts with. Staff can still change them before sending.</p>

      <section className="card stack">
        <h2>Merge fields</h2>
        <p className="small">Type these in curly brackets and the app fills them in for each person. A field with nothing to fill is left out.</p>
        <ul className="plain">
          {MERGE_FIELDS.map((f) => <li key={f.key} className="small"><code>{`{${f.key}}`}</code> {f.meaning}</li>)}
        </ul>
      </section>

      {list.map((t) => {
        const unknown = unknownFields(t.body);
        const original = DEFAULT_TEMPLATES.find((d) => d.id === t.id);
        return (
          <section key={t.id} className="card stack template-card">
            <label className="field"><span>Name</span><input value={t.name} maxLength={80} onChange={(e) => change(t.id, { name: e.target.value })} /></label>
            <label className="field">
              <span>Message</span>
              <textarea rows={5} value={t.body} maxLength={1000} onChange={(e) => change(t.id, { body: e.target.value })} />
            </label>
            {unknown.length > 0 && <p className="notice notice-warn small" role="status">Not a merge field: {unknown.map((k) => `{${k}}`).join(', ')}. Check the spelling against the list above.</p>}
            {original && (original.body !== t.body || original.name !== t.name) && (
              <button type="button" className="btn btn-quiet align-start" onClick={() => change(t.id, { name: original.name, body: original.body })}>Back to the original words</button>
            )}
          </section>
        );
      })}

      <div className="dialog-actions">
        <button type="button" className="btn btn-primary" disabled={!dirty} onClick={() => void save()}>Save templates</button>
      </div>
    </div>
  );
}
