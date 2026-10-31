import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useWhatsAppSettings } from '../../state/useSettingsDoc';
import { useToast } from '../../state/ToastContext';
import { saveWhatsAppSettings } from '../../lib/whatsappWrites';
import { friendlyError } from '../../lib/errors';
import { useSavedMessage } from '../../lib/useSavedMessage';
import { app } from '../../firebase';
import { PETTY_WA_TEMPLATES } from '../../../functions/src/shared/pettyNotices';
import { AUTO_TEMPLATES, SEND_MODES, SEND_MODE_LABELS, modeFor, type SendMode, type WhatsAppSettings } from '../../../functions/src/shared/whatsapp';

const REGION = import.meta.env.VITE_FUNCTIONS_REGION || 'africa-south1';

/** Turn WhatsApp Cloud API sending on, and choose per message type: off, approve first, or automatic. */
export function WhatsAppSettingsPage() {
  const current = useWhatsAppSettings();
  const toast = useToast();
  const saved = useSavedMessage();
  const [form, setForm] = useState<WhatsAppSettings>(current);
  const [dirty, setDirty] = useState(false);
  const webhook = `https://${REGION}-${app.options.projectId}.cloudfunctions.net/whatsappWebhook`;

  useEffect(() => { if (!dirty) setForm(current); }, [current, dirty]);
  const change = (patch: Partial<WhatsAppSettings>) => { setForm({ ...form, ...patch }); setDirty(true); };

  async function save() {
    try {
      await saveWhatsAppSettings(form);
      setDirty(false);
      toast.show(saved('WhatsApp settings saved'));
    } catch (err) {
      toast.show(friendlyError(err));
    }
  }

  return (
    <div className="page narrow">
      <p><Link to="/settings/group/whatsapp">← WhatsApp</Link></p>
      <h1>WhatsApp automation</h1>
      <p className="lead">
        Send welcomes, check-ins and care messages through WhatsApp by themselves. Only people who agreed to WhatsApp are messaged, and a child's
        message always goes to their parent or guardian. The button that opens WhatsApp for staff keeps working either way.
      </p>

      <section className="card stack">
        <h2>1. Switch on</h2>
        <label className="check">
          <input type="checkbox" checked={form.enabled} onChange={(e) => change({ enabled: e.target.checked })} />
          <span>Allow automatic WhatsApp messages (nothing is sent while this is off)</span>
        </label>
        <label className="field">
          <span>Phone number ID (from Meta, a long number, not the phone number itself)</span>
          <input inputMode="numeric" value={form.phoneNumberId} maxLength={30} onChange={(e) => change({ phoneNumberId: e.target.value.replace(/\D/g, '') })} />
        </label>
        <label className="field">
          <span>Template language (the code you chose in Meta, usually en)</span>
          <input value={form.language} maxLength={10} onChange={(e) => change({ language: e.target.value })} />
        </label>
        <p className="small muted">The access token is never typed here. It is stored safely in Firebase when the setup script runs (see the Stage 11 guide).</p>
      </section>

      <section className="card stack">
        <h2>2. Choose how each message goes</h2>
        <p className="small">Start with <strong>Staff approve each message first</strong>. When you trust a message type, switch it to <strong>Send by itself</strong>. Messages go out between 08:00 and 20:00 only.</p>
        {AUTO_TEMPLATES.map((t) => (
          <div key={t.id} className="stack">
            <label className="field">
              <span>{t.label}</span>
              <select value={modeFor(form, t.id)} onChange={(e) => change({ modes: { ...form.modes, [t.id]: e.target.value as SendMode } })}>
                {SEND_MODES.map((m) => <option key={m} value={m}>{SEND_MODE_LABELS[m]}</option>)}
              </select>
            </label>
          </div>
        ))}
        <p className="small muted">Salvation and baptism messages, and school-fee reminders, are never sent by themselves. Staff always send those.</p>
      </section>

      <section className="card stack">
        <h2>3. Words for Meta to approve</h2>
        <p className="small">WhatsApp lets a church start a conversation only with a message Meta has approved. Paste each text below into Meta (WhatsApp Manager → Message templates → Create), with the same name. The <code>{'{{1}}'}</code> slots are filled in for each person. What people read is the approved text.</p>
        {AUTO_TEMPLATES.map((t) => (
          <div key={t.id} className="stack">
            <h3>{t.label}</h3>
            <label className="field">
              <span>Template name in Meta</span>
              <input value={form.metaNames[t.id] ?? t.metaName} maxLength={60} onChange={(e) => change({ metaNames: { ...form.metaNames, [t.id]: e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, '') } })} />
            </label>
            <pre className="small wa-template" style={{ whiteSpace: 'pre-wrap' }}>{t.body}</pre>
            <p className="small muted">Category: {t.category === 'UTILITY' ? 'Utility' : 'Marketing'}. Slots in order: {t.fields.join(', ')}. Example values for Meta: {t.example.join(' / ')}.</p>
          </div>
        ))}
      </section>

      <section className="card stack">
        <h2>Petty cash notices</h2>
        <p className="small">These go to petty cash stakeholders by themselves: "please approve" when a request is submitted, a reminder after 24 hours, and "approved" with the signed voucher. Create each in Meta as a <strong>Utility</strong> template with exactly this name and wording. For <strong>petty_cash_approved</strong>, add a <strong>Document</strong> header. Each stakeholder's number is set on their Staff account.</p>
        {PETTY_WA_TEMPLATES.map((t) => (
          <div key={t.metaName} className="stack">
            <h3>{t.metaName}{t.header ? ' (with a Document header)' : ''}</h3>
            <pre className="small wa-template" style={{ whiteSpace: 'pre-wrap' }}>{t.body}</pre>
            <p className="small muted">Example values for Meta: {t.example.join(' / ')}.</p>
          </div>
        ))}
      </section>

      <section className="card stack">
        <h2>4. Webhook address</h2>
        <p className="small">In Meta (App → WhatsApp → Configuration) the callback URL is:</p>
        <pre className="small" style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>{webhook}</pre>
        <p className="small muted">Subscribe to the <strong>messages</strong> field. That is how delivery ticks and "stop" replies come back. If this address does not work, the setup script prints the exact one.</p>
      </section>

      <div className="dialog-actions">
        <button type="button" className="btn btn-primary" disabled={!dirty} onClick={() => void save()}>Save</button>
      </div>
    </div>
  );
}
