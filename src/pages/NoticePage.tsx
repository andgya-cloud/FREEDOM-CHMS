import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useOrg } from '../state/OrgContext';
import { useToast } from '../state/ToastContext';
import { aiWrite } from '../lib/aiWrite';
import { AI_MARK, AiBox } from '../components/Ai';
import { VoiceButton } from '../components/VoiceButton';

/**
 * Write a WhatsApp notice (Andy, 2026-11-10): a leader types a few lines (what, when, where) and the helper writes
 * the group message. The leader reads and changes it, then copies it or opens WhatsApp to choose the group.
 */
export function NoticePage() {
  const { current } = useOrg();
  const toast = useToast();
  const [notes, setNotes] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);

  async function write() {
    if (!current || notes.trim().length < 5) return;
    setBusy(true);
    try { setNotice(await aiWrite({ orgId: current.id, kind: 'notice', context: notes })); }
    catch (err) { toast.show(err instanceof Error ? err.message : 'The helper could not answer.'); }
    finally { setBusy(false); }
  }
  async function copy() {
    try { await navigator.clipboard.writeText(notice); toast.show('Copied. Paste it in the WhatsApp group.'); }
    catch { window.prompt('Copy this:', notice); }
  }

  return (
    <div className="page narrow">
      <p><Link to="/more">← More</Link></p>
      <h1>{AI_MARK} Write a notice</h1>
      <p className="lead">Type a few lines: what, when and where. The helper writes the WhatsApp message; you check it before sending.</p>
      <label className="field">
        <span className="label-row">Your notes <VoiceButton value={notes} onChange={setNotes} /></span>
        <textarea rows={4} maxLength={1000} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder={'Youth night Friday 6pm, main hall\nBring a friend, snacks provided'} />
      </label>
      <button type="button" className="btn btn-ai-solid align-start" disabled={busy || notes.trim().length < 5} onClick={() => void write()}>{AI_MARK} {busy ? 'Writing…' : notice ? 'Write it again' : 'Write it for me'}</button>
      {notice && (
        <AiBox title="The notice" note="Written by AI from your notes. Check the date, time and place before you send.">
          <label className="field">
            <span>You can change it</span>
            <textarea rows={7} value={notice} onChange={(e) => setNotice(e.target.value)} />
          </label>
          <div className="chips">
            <button type="button" className="btn btn-primary" onClick={() => void copy()}>Copy</button>
            <a className="btn" href={`https://wa.me/?text=${encodeURIComponent(notice)}`} target="_blank" rel="noopener noreferrer">Open WhatsApp</a>
          </div>
        </AiBox>
      )}
    </div>
  );
}
