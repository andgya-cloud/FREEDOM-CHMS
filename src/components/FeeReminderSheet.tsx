import { useMemo, useState } from 'react';
import { useAuth } from '../state/AuthContext';
import { useToast } from '../state/ToastContext';
import { useTemplates } from '../state/useFollowUps';
import type { Organization } from '../state/OrgContext';
import type { Sponsor } from '../state/useSchool';
import { logSponsorMessage } from '../lib/followUpWrites';
import { friendlyError } from '../lib/errors';
import { useSavedMessage } from '../lib/useSavedMessage';
import { firstNameOf, renderTemplate, whatsappLink } from '../../functions/src/shared/followups';
import { formatMoney, PAYBILL_NUMBER } from '../../functions/src/shared/giving';
import { formatPhone } from '../../functions/src/shared/phone';

interface Props {
  org: Organization;
  studentId: string;
  studentName: string;
  sponsors: Sponsor[];
  balanceCents: number;
  onClose: () => void;
}

/**
 * A fee reminder to a student's sponsor or guardian, from the "School fee reminder" template.
 * Only a sponsor who agreed to WhatsApp is messaged that way; anyone else gets a Call button.
 */
export function FeeReminderSheet({ org, studentId, studentName, sponsors, balanceCents, onClose }: Props) {
  const { profile } = useAuth();
  const toast = useToast();
  const saved = useSavedMessage();
  const { templates, ready } = useTemplates();
  const template = templates.find((t) => t.id === 'fee_reminder');
  const [index, setIndex] = useState(0);
  const sponsor = sponsors[index];
  const [edited, setEdited] = useState<string | null>(null);

  const text = useMemo(() => {
    if (!template || !sponsor) return '';
    return renderTemplate(template.body, {
      first_name: firstNameOf({ fullName: sponsor.name, firstName: '' }),
      student_name: studentName.split(' ')[0] ?? studentName,
      staff_name: (profile?.displayName ?? '').split(' ')[0] ?? '',
      campus: org.name,
      amount: formatMoney(balanceCents, org.currency || 'KES'),
      paybill: PAYBILL_NUMBER,
      account: 'ADIA#Fees',
    });
  }, [template, sponsor, studentName, profile, org, balanceCents]);
  const message = edited ?? text;

  function send() {
    if (!template || !sponsor) return;
    logSponsorMessage({ orgId: org.id, studentId, sponsorName: sponsor.name, template, senderName: profile?.displayName ?? '' })
      .catch((err) => toast.show(friendlyError(err)));
    window.open(whatsappLink(sponsor.phone, message), '_blank', 'noopener');
    toast.show(saved('Message recorded'));
    onClose();
  }

  return (
    <div className="sheet-backdrop" role="presentation" onClick={onClose}>
      <div className="sheet" role="dialog" aria-modal="true" aria-labelledby="fr-h" onClick={(e) => e.stopPropagation()}>
        <h2 id="fr-h">Fee reminder for {studentName}</h2>
        {!sponsor ? (
          <div className="notice notice-warn" role="status">No sponsor or guardian is saved for this student. Add one on the student's page first.</div>
        ) : (
          <>
            {sponsors.length > 1 && (
              <label className="field"><span>Send to</span>
                <select value={index} onChange={(e) => { setIndex(Number(e.target.value)); setEdited(null); }}>
                  {sponsors.map((sp, i) => <option key={i} value={i}>{sp.name}{sp.relation ? ` (${sp.relation})` : ''}</option>)}
                </select>
              </label>
            )}
            <p className="muted small">To {sponsor.name}, {formatPhone(sponsor.phone)}</p>
            {sponsor.whatsapp ? (
              <>
                <label className="field"><span>Words</span>
                  <textarea rows={6} value={ready ? message : 'Loading…'} disabled={!ready} onChange={(e) => setEdited(e.target.value)} />
                  <small className="hint">You can change the words here or in WhatsApp before you tap Send.</small>
                </label>
                <div className="sheet-actions">
                  <button type="button" className="btn btn-primary" disabled={!message.trim()} onClick={send}>Open WhatsApp</button>
                  <button type="button" className="btn btn-quiet" onClick={onClose}>Cancel</button>
                </div>
              </>
            ) : (
              <>
                <div className="notice notice-warn" role="status">{sponsor.name} has not agreed to WhatsApp messages, so none is sent. You can call instead.</div>
                <div className="sheet-actions">
                  <a className="btn btn-primary" href={`tel:${sponsor.phone}`}>Call {formatPhone(sponsor.phone)}</a>
                  <button type="button" className="btn btn-quiet" onClick={onClose}>Close</button>
                </div>
              </>
            )}
          </>
        )}
      </div>
    </div>
  );
}
