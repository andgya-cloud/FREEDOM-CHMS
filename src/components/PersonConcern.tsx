import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useToast } from '../state/ToastContext';
import { useAuth } from '../state/AuthContext';
import type { Organization } from '../state/OrgContext';
import { friendlyError } from '../lib/errors';
import { startChat } from '../lib/hopeChats';
import { ChatRow, useChats } from '../pages/hope/HopeChatsPage';
import { circleOf } from '../../functions/src/shared/circles';
import { CHAT_TEXT_MAX, isUnread } from '../../functions/src/shared/hopeChats';
import { SEVERITY_LABELS, type Severity } from '../../functions/src/shared/hopePhotos';

/**
 * "Worried about this student?" on an ADIA student's page, and "Worried about this member?" on a church member's
 * page (Andy, 2026-11-07, 5A): starts a private conversation, and the readers get an URGENT email. Readers see the
 * conversations about this person; anyone else who raises a worry sees only that it is being dealt with.
 */
export function PersonConcern({ org, personId, name }: { org: Organization; personId: string; name: string }) {
  const circle = circleOf(org.type);
  const me = useAuth().profile?.uid ?? '';
  const toast = useToast();
  const navigate = useNavigate();
  const { list, reload } = useChats(org.id, personId);
  const [open, setOpen] = useState(false);
  const [text, setText] = useState('');
  const [severity, setSeverity] = useState<Severity | null>(null);
  const [busy, setBusy] = useState(false);
  const first = name.split(' ')[0] || `this ${circle.person}`;
  if (!list || (!list.reader && !list.raiser)) return null;
  const reader = list.reader;

  async function start() {
    setBusy(true);
    try {
      const r = await startChat(org.id, personId, text.trim(), !reader, severity ?? undefined);
      setText(''); setOpen(false); setSeverity(null);
      toast.show(reader ? `Started.${r.emailed.length ? ` ${r.emailed.length} were emailed that their urgent response is needed.` : ''}` : `Sent. ${circle.readers.replace(/^the /, 'The ')} have been told it is urgent.`);
      if (reader) navigate(`${circle.chatsPath}/${r.id}`); else reload();
    } catch (err) { toast.show(friendlyError(err)); } finally { setBusy(false); }
  }

  return (
    <section className="card stack person-concern">
      <div className="card-head">
        <h2>🔒 Private conversations</h2>
        {!open && <button type="button" className="btn btn-danger btn-small" onClick={() => setOpen(true)}>🔴 Worried about {first}?</button>}
      </div>
      {open && (
        <div className="stack">
          <p className="small">{reader
            ? `Start a private conversation with ${circle.readers}. They are emailed that their URGENT response is needed.`
            : <>Write what you saw or heard. <strong>Only {circle.readers} will read it</strong>, and they are told it is urgent. Please do not talk to others about it.</>}</p>
          <label className="field"><span>{reader ? 'First message' : 'What are you worried about?'}</span>
            <textarea rows={3} maxLength={CHAT_TEXT_MAX} value={text} onChange={(e) => setText(e.target.value)} autoFocus /></label>
          <div className="field">
            <span>How urgent is it?</span>
            <div className="chips" role="radiogroup" aria-label="Urgency">
              {(['low', 'medium', 'high'] as Severity[]).map((v) => (
                <button key={v} type="button" role="radio" aria-checked={severity === v} className={`chip${severity === v ? ' chip-on' : ''}`} onClick={() => setSeverity(severity === v ? null : v)}>{SEVERITY_LABELS[v]}</button>
              ))}
            </div>
          </div>
          <div className="btn-line">
            <button type="button" className="btn btn-primary" disabled={busy || !text.trim()} onClick={() => void start()}>{busy ? 'Sending…' : reader ? 'Start the conversation' : 'Send it'}</button>
            <button type="button" className="btn btn-quiet" onClick={() => setOpen(false)}>Cancel</button>
          </div>
        </div>
      )}
      {list.chats.length === 0 ? <p className="muted small">{reader ? `No conversations about ${first} yet.` : `Nothing raised about ${first} by you.`}</p> : (
        <ul className="link-list chat-list">
          {list.chats.map((c) => <ChatRow key={c.id} c={c} reader={reader} unread={reader && isUnread(c, me)} type={org.type} />)}
        </ul>
      )}
    </section>
  );
}
