import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useAuth } from '../../state/AuthContext';
import { useToast } from '../../state/ToastContext';
import { friendlyError } from '../../lib/errors';
import { downloadFile, shareOrDownload } from '../../lib/givingPdf';
import { STORY_ACCEPT } from '../../lib/hopePhotos';
import {
  approveChat, chatBoard, chatFile, chatSummary, editChatMessage, emailChat, listChats, openChat, removeChatFile, restoreChatFile, sendChatMessage, setChatSeverity, setChatStatus,
  type BoardPerson, type ChatList, type ChatOpen, type StoredChat, type StoredMessage,
} from '../../lib/hopeChats';
import { hopeChatPdf } from '../../lib/hopeChatPdf';
import { CHAT_FILES_MAX, CHAT_STATUS_LABELS, CHAT_STATUSES, CHAT_TEXT_MAX, chatTime, isUnread, type ChatStatus } from '../../../functions/src/shared/hopeChats';
import { APPROVAL_LABELS, builtInFace, faceKey, SEVERITY_LABELS, type ApprovalSlot, type PhotoFile, type Severity } from '../../../functions/src/shared/hopePhotos';
import { formatDateKey, localDateKey } from '../../../functions/src/shared/datetime';
import { useIsAndy } from '../../lib/andy';
import { myOwnProof, passwordProof } from '../../lib/pettyPin';
import { ChildCards, Face, FileView, Picked, pickFiles, tintStyle, useChildPicker } from './HopePhotosPage';
import type { Organization } from '../../state/OrgContext';
import { HopeGate } from './common';

export const STATUS_ICON: Record<ChatStatus, string> = { open: '🔴', handling: '🟠', closed: '✅', sent: '📨' };

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
        {(['all', 'open', 'handling', 'closed', 'sent'] as const).map((k) => (
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
  const [data, setData] = useState<ChatOpen | null>(null);
  const [error, setError] = useState('');
  const [text, setText] = useState('');
  const [files, setFiles] = useState<File[]>([]);
  const [sending, setSending] = useState('');
  const [panel, setPanel] = useState<'' | 'close' | 'send' | 'approve'>('');
  const [note, setNote] = useState('');
  const end = useRef<HTMLDivElement>(null);
  const tz = org.timeZone || 'Africa/Nairobi';
  const count = data?.messages.length ?? 0;
  const picker = useChildPicker(org.id, text, setText);
  const myName = useAuth().profile?.displayName ?? '';

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
  const getFile = useCallback((f: PhotoFile) => chatFile(org.id, id, f), [org.id, id]);

  const guard = (f: () => Promise<unknown>) => async (): Promise<void> => { try { await f(); load(); } catch (err) { toast.show(friendlyError(err)); throw err; } };
  async function send() {
    if (!text.trim() && !files.length && !picker.picked.length) return;
    setSending(files.length ? `Sending 1 of ${files.length}…` : 'Sending…');
    try {
      await sendChatMessage(org.id, id, text.trim(), files, (d, of) => setSending(`Sending ${Math.min(d + 1, of)} of ${of}…`), picker.picked.map((c) => c.id));
      setText(''); setFiles([]); picker.clear(); load();
    } catch (err) { toast.show(friendlyError(err)); } finally { setSending(''); }
  }
  async function status(s: ChatStatus) {
    try { await setChatStatus(org.id, id, s, s === 'closed' ? note : ''); setNote(''); setPanel(''); load(); } catch (err) { toast.show(friendlyError(err)); }
  }
  async function pdf(share: boolean) {
    if (!data) return;
    setSending('Making the PDF…');
    try {
      const f = await hopeChatPdf(org, data, myName);
      if (share) await shareOrDownload(f, `Conversation about ${data.chat.childName}`); else downloadFile(f);
    } catch (err) { toast.show(friendlyError(err)); } finally { setSending(''); }
  }

  if (error && !data) return <div className="page narrow"><p className="notice notice-warn">{error}</p><Link to="/hope/records?show=chats" className="btn">Back to Care</Link></div>;
  if (!data) return <div className="page narrow"><p className="muted">Loading…</p></div>;
  const c = data.chat;
  const closed = c.status === 'closed';
  const seenBy = Object.entries(c.seen ?? {}).filter(([u, t]) => u !== data.me && t >= c.lastAt).map(([u]) => c.seenNames?.[u]).filter(Boolean) as string[];
  const kidPhoto = data.childPhotos[c.childId];
  const step = CHAT_STATUSES.indexOf(c.status);
  return (
    <div className="page narrow">
      <section className="st-room chat-room">
        <div className="st-scene st-scene-default" />
        <header className="st-head">
          <Link to="/hope/records?show=chats" className="st-back" aria-label="Back to Care">←</Link>
          <Link to={`/hope/children/${c.childId}`} className="chat-kid" aria-label={`${c.childName}'s page`}>
            {kidPhoto ? <img src={kidPhoto} alt="" /> : <span>{c.childName.split(/\s+/).slice(0, 2).map((w) => w[0] ?? '').join('').toUpperCase()}</span>}
          </Link>
          <div className="st-title">
            <b>{c.childName}{c.childCode ? ` · ${c.childCode}` : ''}</b>
            <small>{c.ref ? `${c.ref} · ` : ''}🔒 Director, board, Andy and Doreen{c.severity ? ` · ${SEVERITY_LABELS[c.severity]} urgency` : ''}</small>
          </div>
        </header>
        <div className="st-status">
          <ol className="st-steps" aria-label="Status">
            {CHAT_STATUSES.map((st, i) => <li key={st} className={step >= i ? 'on' : ''}>{CHAT_STATUS_LABELS[st]}</li>)}
          </ol>
          <div className="st-menu">
            {c.status === 'open' && <button type="button" className="st-chip" onClick={() => void status('handling')}>🟠 Being handled</button>}
            {data.closer && !closed && <button type="button" className="st-chip" onClick={() => setPanel(panel === 'close' ? '' : 'close')}>✅ Resolved</button>}
            {data.closer && (closed || c.status === 'sent') && <button type="button" className="st-chip" onClick={() => void status('open')}>↩︎ Open again</button>}
            <span className="chat-sev" role="radiogroup" aria-label="Urgency">
              {(['low', 'medium', 'high'] as Severity[]).map((v) => (
                <button key={v} type="button" role="radio" aria-checked={c.severity === v} className={`st-chip sev-${v}${c.severity === v ? ' on' : ''}`}
                  onClick={() => void guard(() => setChatSeverity(org.id, id, v))().catch(() => undefined)}>{SEVERITY_LABELS[v]}</button>
              ))}
            </span>
          </div>
          <div className="st-menu">
            <button type="button" className="st-chip" onClick={() => setPanel(panel === 'approve' ? '' : 'approve')}>✍️ Approvals{c.approvals?.director || c.approvals?.board ? ` (${[c.approvals?.director, c.approvals?.board].filter(Boolean).length}/2)` : ''}</button>
            <button type="button" className="st-chip" disabled={!!sending} onClick={() => void pdf(false)}>⬇︎ PDF</button>
            <button type="button" className="st-chip" disabled={!!sending} onClick={() => void pdf(true)}>🟢 WhatsApp</button>
            <button type="button" className="st-chip" onClick={() => setPanel(panel === 'send' ? '' : 'send')}>✉️ Send to the board</button>
          </div>
        </div>
        {panel === 'close' && (
          <div className="st-facts stack">
            <label className="field"><span>How was it resolved? (kept in the record)</span><textarea rows={2} maxLength={1000} value={note} onChange={(e) => setNote(e.target.value)} /></label>
            <div className="btn-line"><button type="button" className="btn btn-primary" disabled={!note.trim()} onClick={() => void status('closed')}>Mark resolved</button><button type="button" className="btn btn-quiet" onClick={() => setPanel('')}>Cancel</button></div>
          </div>
        )}
        {panel === 'approve' && <div className="st-facts"><ChatApprovals org={org} data={data} onDone={load} /></div>}
        {panel === 'send' && <div className="st-facts"><SendBox org={org} data={data} onSent={() => { setPanel(''); load(); }} /></div>}

        <div className="st-thread" aria-live="polite">
          {data.messages.map((m, i) => {
            const day = m.at.slice(0, 10);
            const showDay = i === 0 || data.messages[i - 1]!.at.slice(0, 10) !== day;
            return (
              <div key={m.id} className="st-row">
                {showDay && <span className="st-day">{formatDateKey(localDateKey(new Date(m.at), tz))}</span>}
                <ChatBubble org={org} data={data} m={m} getFile={getFile}
                  onEdit={(t) => guard(() => editChatMessage(org.id, id, m.id, t))()}
                  onRemoveFile={(key) => guard(() => removeChatFile(org.id, id, key))()} />
              </div>
            );
          })}
          {seenBy.length > 0 && <p className="st-seen">Seen by {seenBy.map((n) => n.split(' ')[0]).join(', ')}</p>}
          {data.keeps && (c.removed?.length ?? 0) > 0 && (
            <details className="st-facts st-removed">
              <summary><span>🗑 {c.removed!.length} {c.removed!.length === 1 ? 'file' : 'files'} taken out</span></summary>
              <ul>{c.removed!.map((x) => (
                <li key={x.file.key}><span>{x.file.name} · by {x.removedByName}, {chatTime(x.removedAt, tz)}</span>
                  <button type="button" className="st-chip" onClick={() => void guard(() => restoreChatFile(org.id, id, x.file.key))().catch(() => undefined)}>↩︎ Put back</button></li>
              ))}</ul>
            </details>
          )}
          <div ref={end} />
        </div>

        {closed ? (
          <p className="st-day">Resolved{c.closedOn ? ` on ${formatDateKey(c.closedOn)}` : ''}: {c.closeNote?.replace(/[.\s]+$/, '')}. {data.closer ? 'Tap "Open again" to continue it.' : 'The Director, Andy or Doreen can open it again.'}</p>
        ) : (
          <div className="st-compose-wrap">
            {picker.panel}
            {picker.chips}
            {files.length > 0 && <div className="st-picked"><Picked files={files} onRemove={(i) => setFiles(files.filter((_, j) => j !== i))} /></div>}
            <div className="st-composer">
              <label className="st-ic" aria-label="Add photos, videos or files">📎
                <input type="file" multiple hidden accept={STORY_ACCEPT} onChange={(e) => { setFiles(pickFiles(e.target.files, files, CHAT_FILES_MAX, toast.show)); e.target.value = ''; }} />
              </label>
              <button type="button" className="st-ic" aria-label="Name another child" onClick={picker.toggle}>👧</button>
              <textarea rows={1} value={text} maxLength={CHAT_TEXT_MAX} placeholder="Write a reply… (@ to name a child)" aria-label="Message" onChange={(e) => setText(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey && window.matchMedia('(pointer: fine)').matches) { e.preventDefault(); void send(); } }} />
              <button type="button" className="st-send" disabled={!!sending || (!text.trim() && !files.length && !picker.picked.length)} onClick={() => void send()}>{sending ? '…' : 'Send'}</button>
            </div>
            {sending && <p className="st-day">{sending}</p>}
          </div>
        )}
      </section>
    </div>
  );
}

/** One bubble (1A): the speaker's face and colour, name, role and time; their own words can be edited (4A). */
function ChatBubble({ org, data, m, getFile, onEdit, onRemoveFile }: {
  org: Organization; data: ChatOpen; m: StoredMessage; getFile: (f: PhotoFile) => Promise<File>;
  onEdit: (text: string) => Promise<void>; onRemoveFile: (key: string) => Promise<void>;
}) {
  const tz = org.timeZone || 'Africa/Nairobi';
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(m.text);
  const [busy, setBusy] = useState(false);
  if (m.system) return <p className="st-gone st-system">{m.text} · {chatTime(m.at, tz)}</p>;
  const mine = m.byUid === data.me;
  async function save() {
    setBusy(true);
    try { await onEdit(draft); setEditing(false); } catch { /* already shown */ } finally { setBusy(false); }
  }
  return (
    <div className={`st-msg${mine ? ' mine' : ''}`} style={tintStyle(m.byName, m.byUid)}>
      <Face name={m.byName} photo={data.faces[faceKey(m.byName)] || builtInFace(m.byName)} />
      <div className="st-bubble">
        <div className="st-who"><b>{m.byName}</b>{m.byRole && <span>{m.byRole}</span>}<span>{chatTime(m.at, tz)}</span></div>
        {editing ? (
          <div className="stack">
            <textarea className="st-edit" rows={3} value={draft} maxLength={CHAT_TEXT_MAX} onChange={(e) => setDraft(e.target.value)} autoFocus />
            <div className="btn-line">
              <button type="button" className="st-chip on" disabled={busy} onClick={() => void save()}>{busy ? 'Saving…' : 'Save'}</button>
              <button type="button" className="st-chip" onClick={() => { setEditing(false); setDraft(m.text); }}>Cancel</button>
            </div>
            <small className="st-note">The earlier words are kept, and the PDF lists the change.</small>
          </div>
        ) : m.text && <p>{m.text}</p>}
        <ChildCards kids={m.children ?? []} photos={data.childPhotos} />
        {m.files?.length > 0 && (
          <div className="st-pics">
            {m.files.map((f) => <FileView key={f.key} org={org} reportId={data.chat.id} file={f} getFile={getFile} onRemove={data.keeps ? () => onRemoveFile(f.key) : undefined} />)}
          </div>
        )}
        <div className="st-when">
          <span>{m.editedAt ? 'edited' : ''}</span>
          {mine && !editing && <button type="button" className="st-more" aria-label="Edit" onClick={() => { setDraft(m.text); setEditing(true); }}>✏️</button>}
        </div>
      </div>
    </div>
  );
}

/** The Director's and the board's approval of the outcome, each with their own password (7A; none for Andy). */
function ChatApprovals({ org, data, onDone }: { org: Organization; data: ChatOpen; onDone: () => void }) {
  const toast = useToast();
  const { profile } = useAuth();
  const andy = useIsAndy();
  const [slot, setSlot] = useState<ApprovalSlot | null>(null);
  const [pw, setPw] = useState('');
  const [busy, setBusy] = useState(false);
  const tz = org.timeZone || 'Africa/Nairobi';
  const c = data.chat;
  async function approve(s: ApprovalSlot, undo = false) {
    if (!profile) return;
    setBusy(true);
    try {
      const proof = andy ? await myOwnProof() : await passwordProof(profile.uid, profile.email, pw);
      await approveChat(org.id, c.id, s, proof, undo);
      toast.show(undo ? 'Approval taken back.' : 'Approved.');
      setSlot(null); setPw(''); onDone();
    } catch (err) {
      const code = (err as { code?: string }).code ?? '';
      toast.show(/invalid-credential|wrong-password/.test(code) ? 'That password is not right.' : friendlyError(err));
    } finally { setBusy(false); }
  }
  return (
    <div className="stack st-approvals">
      {(['director', 'board'] as ApprovalSlot[]).map((s) => {
        const a = c.approvals?.[s];
        return (
          <div key={s} className="st-approval">
            <span className="grow"><b>{APPROVAL_LABELS[s]}</b><br /><span className="small muted">{a ? `✅ ${a.name}, ${a.role}, ${chatTime(a.at, tz)}` : 'Not approved yet'}</span></span>
            {data.approves[s] && slot !== s && <button type="button" className="btn btn-small" disabled={busy} onClick={() => (andy ? void approve(s, !!a) : setSlot(s))}>{a ? 'Take back' : '✅ Approve'}</button>}
          </div>
        );
      })}
      {slot && !andy && (
        <div className="stack">
          <label className="field"><span>Your Insight-IQ password</span><input type="password" autoComplete="current-password" value={pw} onChange={(e) => setPw(e.target.value)} autoFocus /></label>
          <div className="btn-line">
            <button type="button" className="btn btn-primary" disabled={busy || !pw} onClick={() => void approve(slot, !!c.approvals?.[slot])}>{busy ? 'Checking…' : c.approvals?.[slot] ? 'Take back my approval' : 'Approve'}</button>
            <button type="button" className="btn btn-quiet" onClick={() => { setSlot(null); setPw(''); }}>Cancel</button>
          </div>
        </div>
      )}
      <p className="small muted">The PDF prints each approval with the name and time. Without one, it leaves a line to sign by hand.</p>
    </div>
  );
}

const waNumber = (phone: string) => phone.replace(/\D/g, '').replace(/^0/, '254');

/** Email the conversation's PDF to the ticked board members, or ask each one on WhatsApp for an urgent reply. */
function SendBox({ org, data, onSent }: { org: Organization; data: ChatOpen; onSent: () => void }) {
  const chat = data.chat;
  const { profile } = useAuth();
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
    try { const to = await emailChat(org.id, chat.id, [...ticked], await hopeChatPdf(org, data, profile?.displayName ?? '')); toast.show(`Emailed to ${to.join(', ')}.`); onSent(); } catch (err) { toast.show(friendlyError(err)); } finally { setBusy(false); }
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
