import { useMemo, useState } from 'react';
import { useAuth } from '../state/AuthContext';
import { usePeople, type Person } from '../state/PeopleContext';
import { useToast } from '../state/ToastContext';
import { useTemplates, type FollowUp } from '../state/useFollowUps';
import type { Organization } from '../state/OrgContext';
import { logMessage, markDone } from '../lib/followUpWrites';
import { friendlyError } from '../lib/errors';
import { useSavedMessage } from '../lib/useSavedMessage';
import {
  firstNameOf,
  recipientFor,
  renderTemplate,
  SENSITIVE_TEMPLATES,
  whatsappLink,
  type FollowUpOutcome,
} from '../../functions/src/shared/followups';
import { formatPhone } from '../../functions/src/shared/phone';

interface Props {
  org: Organization;
  person: Person;
  templateId: string;
  /** Extra merge fields, for example the receipt number or the programme. */
  fields?: Record<string, string>;
  followUp?: FollowUp | null;
  giftId?: string | null;
  /** Limit the choice of templates (for a receipt, only the receipt template). */
  templateIds?: string[];
  onSent?: () => void;
  onClose: () => void;
}

/**
 * Tap to send: shows the message filled in from the template, opens WhatsApp
 * with it ready, and records that it was sent. A child's message goes to
 * their parent or guardian; nobody who said no or asked us to stop is messaged.
 */
export function WhatsAppSheet({ org, person, templateId, fields = {}, followUp, giftId, templateIds, onSent, onClose }: Props) {
  const { profile, can } = useAuth();
  const { byId } = usePeople();
  const toast = useToast();
  const saved = useSavedMessage();
  const { templates: all, ready } = useTemplates();
  const templates = all.filter((t) => (!templateIds || templateIds.includes(t.id)) && (can('pastoral.read') || !SENSITIVE_TEMPLATES.includes(t.id)));
  const [picked, setChosen] = useState<string | null>(null);
  const chosen = picked ?? (templates.some((t) => t.id === templateId) ? templateId : templates[0]?.id ?? '');
  const template = templates.find((t) => t.id === chosen);
  const guardian = person.guardianId ? byId(person.guardianId) ?? null : null;
  const recipient = recipientFor(person, guardian);
  const callPhone = person.status === 'child' ? guardian?.phone : person.phone;
  const [edited, setEdited] = useState<string | null>(null);
  const [sent, setSent] = useState(false);

  const text = useMemo(() => {
    if (!template || !recipient.ok || !ready) return '';
    return renderTemplate(template.body, {
      first_name: firstNameOf(recipient.to),
      child_name: recipient.viaGuardian ? firstNameOf(person) : '',
      campus: org.name,
      service_time: org.serviceTimes?.[0] ?? '',
      staff_name: (profile?.displayName ?? '').split(' ')[0] ?? '',
      ...fields,
    });
  }, [template, recipient, person, org, profile, fields, ready]);
  const message = edited ?? text;

  function send() {
    if (!template || !recipient.ok) return;
    logMessage({
      orgId: org.id, about: person, to: recipient.to as Person, viaGuardian: recipient.viaGuardian, template,
      senderName: profile?.displayName ?? '', followUp, giftId,
    }).catch((err) => toast.show(friendlyError(err)));
    window.open(whatsappLink(recipient.phone, message), '_blank', 'noopener');
    onSent?.();
    if (followUp) setSent(true);
    else {
      toast.show(saved('Message recorded'));
      onClose();
    }
  }

  function finish(outcome: FollowUpOutcome | null) {
    if (outcome && followUp) {
      markDone(followUp, outcome).catch((err) => toast.show(friendlyError(err)));
      toast.show(saved(`${person.fullName}: done`));
    }
    onClose();
  }

  return (
    <div className="sheet-backdrop" role="presentation" onClick={onClose}>
      <div className="sheet" role="dialog" aria-modal="true" aria-labelledby="wa-h" onClick={(e) => e.stopPropagation()}>
        <h2 id="wa-h">WhatsApp {recipient.ok ? recipient.to.fullName : person.fullName}</h2>

        {!recipient.ok ? (
          <>
            <div className="notice notice-warn" role="status">{recipient.reason}</div>
            {callPhone && <a className="btn align-start" href={`tel:${callPhone}`}>Call {formatPhone(callPhone)}</a>}
            <div className="sheet-actions"><button type="button" className="btn btn-quiet" onClick={onClose}>Close</button></div>
          </>
        ) : sent ? (
          <>
            <p>WhatsApp opened with the message. Once you've sent it, mark this follow-up done.</p>
            <div className="sheet-actions">
              <button type="button" className="btn btn-primary" onClick={() => finish('Message sent, no reply yet')}>Done: message sent</button>
              <button type="button" className="btn" onClick={() => finish('Reached')}>Done: we spoke</button>
              <button type="button" className="btn btn-quiet" onClick={() => finish(null)}>Not yet</button>
            </div>
          </>
        ) : (
          <>
            <p className="muted small">
              To {formatPhone(recipient.phone)}
              {recipient.viaGuardian && <> ({person.firstName || person.fullName}'s parent or guardian: we never message a child directly)</>}
            </p>
            {templates.length > 1 && (
              <label className="field">
                <span>Message</span>
                <select value={chosen} onChange={(e) => { setChosen(e.target.value); setEdited(null); }}>
                  {templates.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
                </select>
              </label>
            )}
            <label className="field">
              <span>{templates.length > 1 ? 'Words' : template?.name ?? 'Message'}</span>
              <textarea rows={6} value={ready ? message : 'Loading…'} disabled={!ready} onChange={(e) => setEdited(e.target.value)} />
              <small className="hint">You can change the words here or in WhatsApp before you tap Send.</small>
            </label>
            <div className="sheet-actions">
              <button type="button" className="btn btn-primary" disabled={!message.trim()} onClick={send}>Open WhatsApp</button>
              <button type="button" className="btn btn-quiet" onClick={onClose}>Cancel</button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
