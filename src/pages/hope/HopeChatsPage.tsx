import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useAuth } from '../../state/AuthContext';
import { useToast } from '../../state/ToastContext';
import { friendlyError } from '../../lib/errors';
import { downloadFile, shareOrDownload } from '../../lib/givingPdf';
import { isDocFile, isPhotoFile } from '../../lib/hopePhotos';
import {
  chatBoard, chatFile, chatSummary, emailChat, listChats, openChat, sendChatMessage, setChatStatus,
  type BoardPerson, type ChatList, type StoredChat, type StoredMessage,
} from '../../lib/hopeChats';
import { hopeChatPdf } from '../../lib/hopeChatPdf';
import { CHAT_FILES_MAX, CHAT_STATUS_LABELS, CHAT_TEXT_MAX, chatColour, chatTime, isUnread, type ChatStatus } from '../../../functions/src/shared/hopeChats';
import type { PhotoFile } from '../../../functions/src/shared/hopePhotos';
import { formatDateKey } from '../../../functions/src/shared/datetime';
import type { Organization } from '../../state/OrgContext';
import { HopeGate } from './common';

export const STATUS_ICON: Record<ChatStatus, string> = { open: '🔴', handling: '🟠', closed: '✅' };

/** The urgent banner on Today: conversations not yet opened, and new messages (9A). */
export function useChatSummary(orgId: string) {
  const [s, setS] = useState<{ reader: boolean; urgent: number; unread: number } | null>(null);
  useEffect(() => { chatSummary(orgId).then(setS).catch(() => setS(null)); }, [orgId]);
  return s;
}

export function useChats(orgId: string, childId?: string) {
  const [list, setList] = useState<ChatList | null>(null);
  const [error, setError] = useState('');
  const reload = useCallback(() => {
    listChats(orgId, childId).then((l) => { setList(l); setError(''); }).catch((err) => setError(friendlyError(err)));
  }, [orgId, childId]);
  useEffect(() => { reload(); }, [reload]);
  return { list, error, reload };
}

/** The vault (8A): every conversation about a child, searchable, with an Open/Being handled/Closed filter. Shown on the Care page (v182, 5A) to the board and staff. */
export function Vault({ org }: { org: Organization }) {
  const { list, error } = useChats(org.id);
  const [q, setQ] = useState('');
  const [status, setStatus] = useState<ChatStatus | 'all'>('all');
  const me = useAuth().profile?.uid ?? '';
  const rows = (list?.chats ?? []).filter((c) => (status === 'all' || c.status === status)
    && (!q.trim() || `${c.childName} ${c.childCode}`.toLowerCase().includes(q.trim().toLowerCase())));
  return (
    <div className="page narrow">
      <p><Link to="/hope/reports">← Reports</Link></p>
      <h1>🔒 Care</h1>
      <p className="small muted">{list?.reader === false ? 'The worries you raised, and whether they are being dealt with. Only the Director, the board, Andy and Doreen read the conversations.' : 'Every conversation about a child, kept for the record. Only the Director, the board, Andy and Doreen can open them.'}</p>
      {error && <p className="notice notice-warn small">{error}</p>}
      <label className="field"><span>Find a child</span><input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Name or HC code" /></label>
      <div className="chips" role="radiogroup" aria-label="Show">
        {(['all', 'open', 'handling', 'closed'] as const).map((k) => (
          <button key={k} type="button" role="radio" aria-checked={status === k} className={`chip${status === k ? ' chip-on' : ''}`} onClick={() => setStatus(k)}>
            {k === 'all' ? 'All' : `${STATUS_ICON[k]} ${CHAT_STATUS_LABELS[k]}`}
          </button>
        ))}
      </div>
      {!list ? (!error && <p className="muted">Loading…</p>) : rows.length === 0 ? <div className="card"><p>{list.chats.length ? 'None match.' : 'No conversations yet. Start one from a child\'s page.'}</p></div> : (
        <ul className="link-list chat-list">
          {rows.map((c) => <ChatRow key={c.id} c={c} reader={list.reader} unread={list.reader && isUnread(c, me)} />)}
        </ul>
      )}
    </div>
  );
}

export function ChatRow({ c, reader, unread }: { c: StoredChat; reader: boolean; unread: boolean }) {
  const body = (
    <>
      <span className="link-title">{STATUS_ICON[c.status]} {c.childName}{c.childCode ? ` · ${c.childCode}` : ''}{unread && <span className="badge badge-warn">New</span>}</span>
      <span className="link-detail">{reader ? `${c.lastByName}: ${c.lastText}` : CHAT_STATUS_LABELS[c.status]} · {chatTime(c.lastAt)}</span>
    </>
  );
  return <li>{reader ? <Link to={`/hope/chats/${c.id}`}>{body}</Link> : <div>{body}</div>}</li>;
}

/** One conversation, like a WhatsApp group (3A, 5A, 6A, 7A). */
export function HopeChatPage() {
  return <HopeGate title="Conversation">{(org) => <Chat org={org} />}</HopeGate>;
}

function Chat({ org }: { org: Organization }) {
  const { id = '' } = useParams();
  const toast = useToast();
  const [data, setData] = useState<Awaited<ReturnType<typeof openChat>> | null>(null);
  const [error, setError] = useState('');
  const [text, setText] = useState('');
  const [files, setFiles] = useState<File[]>([]);
  const [sending, setSending] = useState('');
  const [panel, setPanel] = useState<'' | 'close' | 'send'>('');
  const [note, setNote] = useState('');
  const end = useRef<HTMLDivElement>(null);
  const tz = org.timeZone || 'Africa/Nairobi';
  const count = data?.messages.length ?? 0;

  const load = useCallback(() => {
    openChat(org.id, id).then((d) => { setData(d); setError(''); }).catch((err) => setError(friendlyError(err)));
  }, [org.id, id]);
  useEffect(() => {
    load();
    // New messages from the others show within a few seconds while the conversation is open.
    const t = window.setInterval(() => { if (document.visibilityState === 'visible') load(); }, 8000);
    return () => window.clearInterval(t);
  }, [load]);
  useEffect(() => { end.current?.scrollIntoView({ block: 'end' }); }, [count]);

  async function send() {
    if (!text.trim() && !files.length) return;
    setSending(files.length ? `Sending 1 of ${files.length}…` : 'Sending…');
    try {
      await sendChatMessage(org.id, id, text.trim(), files, (d, of) => setSending(`Sending ${Math.min(d + 1, of)} of ${of}…`));
      setText(''); setFiles([]); load();
    } catch (err) { toast.show(friendlyError(err)); } finally { setSending(''); }
  }
  async function status(s: ChatStatus) {
    try { await setChatStatus(org.id, id, s, s === 'closed' ? note : ''); setNote(''); setPanel(''); load(); } catch (err) { toast.show(friendlyError(err)); }
  }
  async function pdf(share: boolean) {
    if (!data) return;
    setSending('Making the PDF…');
    try {
      const f = await hopeChatPdf(org, data.chat, data.messages);
      if (share) await shareOrDownload(f, `Conversation about ${data.chat.childName}`); else downloadFile(f);
    } catch (err) { toast.show(friendlyError(err)); } finally { setSending(''); }
  }

  if (error && !data) return <div className="page narrow"><p className="notice notice-warn">{error}</p><Link to="/hope/records?show=chats" className="btn">Back to Care</Link></div>;
  if (!data) return <div className="page narrow"><p className="muted">Loading…</p></div>;
  const c = data.chat;
  let lastDay = '';
  return (
    <div className="page narrow chat-page">
      <header className="card chat-head">
        <Link to="/hope/records?show=chats" className="btn btn-quiet btn-small" aria-label="Back to Care">‹</Link>
        <div className="chat-title">
          <b><Link to={`/hope/children/${c.childId}`}>{c.childName}</Link>{c.childCode ? ` · ${c.childCode}` : ''}</b>
          <span className="small muted">{STATUS_ICON[c.status]} {CHAT_STATUS_LABELS[c.status]}{c.status === 'closed' && c.closedByName ? ` by ${c.closedByName}` : ''} · Director, board, Andy and Doreen</span>
        </div>
      </header>

      <div className="chat-actions">
        {c.status === 'open' && <button type="button" className="btn btn-small" onClick={() => void status('handling')}>🟠 Being handled</button>}
        {data.closer && c.status !== 'closed' && <button type="button" className="btn btn-small" onClick={() => setPanel(panel === 'close' ? '' : 'close')}>✅ Close</button>}
        {data.closer && c.status === 'closed' && <button type="button" className="btn btn-small" onClick={() => void status('open')}>↩︎ Open again</button>}
        <button type="button" className="btn btn-small" disabled={!!sending} onClick={() => void pdf(false)}>⬇︎ PDF</button>
        <button type="button" className="btn btn-small" disabled={!!sending} onClick={() => void pdf(true)}>🟢 WhatsApp</button>
        <button type="button" className="btn btn-small" onClick={() => setPanel(panel === 'send' ? '' : 'send')}>✉️ Email / urgent</button>
      </div>
      {panel === 'close' && (
        <div className="card stack">
          <label className="field"><span>How was it resolved? (kept in the record)</span><textarea rows={2} maxLength={1000} value={note} onChange={(e) => setNote(e.target.value)} /></label>
          <div className="btn-line"><button type="button" className="btn btn-primary" disabled={!note.trim()} onClick={() => void status('closed')}>Close the conversation</button><button type="button" className="btn btn-quiet" onClick={() => setPanel('')}>Cancel</button></div>
        </div>
      )}
      {panel === 'send' && <SendBox org={org} chat={c} messages={data.messages} />}

      <div className="chat-thread" aria-live="polite">
        {data.messages.map((m) => {
          const day = chatTime(m.at, tz).split(',')[0] ?? '';
          const sep = day !== lastDay ? <div className="chat-day" key={`d${m.id}`}><span>{day}</span></div> : null;
          lastDay = day;
          if (m.system) return [sep, <div key={m.id} className="chat-system"><span>{m.text} · {chatTime(m.at, tz).split(', ')[1]}</span></div>];
          const mine = m.byUid === data.me;
          const [bubble, ink] = chatColour(m.byUid || m.byName);
          return [sep, (
            <div key={m.id} className={`chat-msg${mine ? ' mine' : ''}`}>
              <div className="chat-bubble" style={{ background: bubble, borderColor: ink }}>
                {!mine && <b className="chat-name" style={{ color: ink }}>{m.byName}</b>}
                {m.files?.length > 0 && <div className="chat-files">{m.files.map((f) => <ChatAttachment key={f.key} org={org} chatId={c.id} file={f} />)}</div>}
                {m.text && <p className="chat-text">{m.text}</p>}
                <span className="chat-sig" style={{ color: ink }}>{m.byName} · {m.byRole} · {chatTime(m.at, tz)}</span>
              </div>
            </div>
          )];
        })}
        <div ref={end} />
      </div>

      {c.status === 'closed' ? (
        <p className="notice small">Closed{c.closedOn ? ` on ${formatDateKey(c.closedOn)}` : ''}: {c.closeNote?.replace(/[.\s]+$/, '')}. {data.closer ? 'Tap "Open again" to continue it.' : 'The Director, Andy or Doreen can open it again.'}</p>
      ) : (
        <div className="chat-compose">
          {files.length > 0 && (
            <div className="chat-picked">
              {files.map((f, i) => <span key={`${f.name}${i}`} className="chip">{isPhotoFile(f) ? '📷' : '📄'} {f.name.slice(0, 24)}<button type="button" aria-label={`Remove ${f.name}`} onClick={() => setFiles(files.filter((_, j) => j !== i))}>×</button></span>)}
            </div>
          )}
          <div className="chat-bar">
            <label className="chat-clip" aria-label="Add photos or files">📎
              <input type="file" multiple hidden accept="image/*,.heic,.heif,.pdf,.doc,.docx" onChange={(e) => {
                const chosen = [...(e.target.files ?? [])].filter((f) => isPhotoFile(f) || isDocFile(f));
                setFiles([...files, ...chosen].slice(0, CHAT_FILES_MAX)); e.target.value = '';
              }} />
            </label>
            <textarea rows={1} value={text} maxLength={CHAT_TEXT_MAX} placeholder="Message" aria-label="Message" onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey && window.matchMedia('(pointer: fine)').matches) { e.preventDefault(); void send(); } }} />
            <button type="button" className="chat-send" disabled={!!sending || (!text.trim() && !files.length)} onClick={() => void send()} aria-label="Send">➤</button>
          </div>
          {sending && <p className="small muted">{sending}</p>}
        </div>
      )}
    </div>
  );
}

function ChatAttachment({ org, chatId, file }: { org: Organization; chatId: string; file: PhotoFile }) {
  const [url, setUrl] = useState('');
  useEffect(() => {
    if (!file.photo) return;
    let u = '';
    chatFile(org.id, chatId, file).then((f) => { u = URL.createObjectURL(f); setUrl(u); }).catch(() => undefined);
    return () => { if (u) URL.revokeObjectURL(u); };
  }, [org.id, chatId, file]);
  if (!file.photo) return <button type="button" className="chat-doc" onClick={() => void chatFile(org.id, chatId, file).then(downloadFile)}>📄 {file.name}</button>;
  return <a className="chat-photo" href={url || undefined} target="_blank" rel="noreferrer">{url ? <img src={url} alt="" /> : <span className="small muted">Loading photo…</span>}</a>;
}

const waNumber = (phone: string) => phone.replace(/\D/g, '').replace(/^0/, '254');

/** Email the conversation's PDF to the ticked board members, or ask each one on WhatsApp for an urgent reply. */
function SendBox({ org, chat, messages }: { org: Organization; chat: StoredChat; messages: StoredMessage[] }) {
  const toast = useToast();
  const [people, setPeople] = useState<BoardPerson[] | null>(null);
  const [ticked, setTicked] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    chatBoard(org.id).then((p) => { setPeople(p); setTicked(new Set(p.filter((x) => x.hasEmail).map((x) => x.name))); }).catch((err) => toast.show(friendlyError(err)));
  }, [org.id, toast]);
  const link = `${location.origin}/hope/chats/${chat.id}`;
  const urgent = useMemo(() => `URGENT: your response is needed in the conversation about ${chat.childName.split(' ')[0]}${chat.childCode ? ` (${chat.childCode})` : ''} at Freedom Hope Center. Please open it: ${link}`, [chat, link]);
  async function email() {
    setBusy(true);
    try { const to = await emailChat(org.id, chat.id, [...ticked], await hopeChatPdf(org, chat, messages)); toast.show(`Emailed to ${to.join(', ')}.`); } catch (err) { toast.show(friendlyError(err)); } finally { setBusy(false); }
  }
  return (
    <div className="card stack">
      {!people ? <p className="muted small">Loading…</p> : (
        <>
          <ul className="ph-people">
            {people.map((p) => (
              <li key={p.name}>
                <label className="check"><input type="checkbox" disabled={!p.hasEmail} checked={ticked.has(p.name)} onChange={(e) => { const n = new Set(ticked); if (e.target.checked) n.add(p.name); else n.delete(p.name); setTicked(n); }} /> {p.name}</label>
                {p.phone && <a className="btn btn-quiet btn-small" href={`https://wa.me/${waNumber(p.phone)}?text=${encodeURIComponent(urgent)}`} target="_blank" rel="noreferrer">WhatsApp: urgent</a>}
              </li>
            ))}
          </ul>
          <button type="button" className="btn btn-primary align-start" disabled={busy || ticked.size === 0} onClick={() => void email()}>{busy ? 'Emailing…' : `✉️ Email the PDF to ${ticked.size}`}</button>
          <p className="small muted">The email carries the whole conversation as a PDF. "WhatsApp: urgent" asks that person for an urgent reply with a link; the child's details stay in Insight-IQ.</p>
        </>
      )}
    </div>
  );
}
