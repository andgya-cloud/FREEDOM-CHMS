import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useAuth } from '../../state/AuthContext';
import { useToast } from '../../state/ToastContext';
import { cleanupError } from '../../lib/cleanup';
import { listNotes, type StoredNote } from '../../lib/hopeRecords';
import { canReadNotes, NOTE_KIND_EMOJI, NOTE_KIND_LABELS, NOTE_KINDS, type NoteKind } from '../../../functions/src/shared/hopeRecords';
import { formatDateKey } from '../../../functions/src/shared/datetime';
import { NoteCard } from './ChildRecords';
import { ChatRow, useChats, Vault } from './HopeChatsPage';
import type { StoredChat } from '../../lib/hopeChats';
import { isUnread } from '../../../functions/src/shared/hopeChats';
import { HopeGate } from './common';
import type { Organization } from '../../state/OrgContext';

/**
 * One Care page (v182, 5A): the notes and conversations together. The Director, Andy and Doreen see every note and
 * conversation by child; the board sees the conversations; other staff see the worries they raised.
 */
export function HopeRecordsPage() {
  const { profile } = useAuth();
  return <HopeGate title="Care">{(org) => (canReadNotes(profile, org.id) ? <Records org={org} /> : <Vault org={org} />)}</HopeGate>;
}

/**
 * Reports → Records (Andy, 2026-11-05, 4A 5A): every welfare, health, home, visit and leaving note, one folder per
 * child, newest first. Only the Director, Andy and Doreen open it. Notes are written on the child's page.
 */
function Records({ org }: { org: Organization }) {
  const { profile } = useAuth();
  const toast = useToast();
  const reader = canReadNotes(profile, org.id);
  const [notes, setNotes] = useState<StoredNote[] | null>(null);
  const [q, setQ] = useState('');
  const [params] = useSearchParams();
  type Kind = NoteKind | 'chat' | 'chat:open' | 'chat:handling' | 'chat:closed' | '';
  const [kind, setKind] = useState<Kind>(params.get('show') === 'chats' ? 'chat' : '');
  const chatOnly = kind.startsWith('chat');
  const chatStatus = kind.startsWith('chat:') ? kind.slice(5) : '';
  const load = useCallback(() => { listNotes(org.id).then((r) => setNotes(r.notes), (err) => toast.show(cleanupError(err))); }, [org.id, toast]);
  useEffect(() => { if (reader) load(); }, [reader, load]);
  const chats = useChats(org.id).list;
  const me = profile?.uid ?? '';

  const folders = useMemo(() => {
    const text = q.trim().toLowerCase();
    type Folder = { childId: string; childName: string; childCode: string; latest: string; notes: StoredNote[]; chats: StoredChat[] };
    const m = new Map<string, Folder>();
    const folder = (id: string, name: string, code: string) => {
      let f = m.get(id);
      if (!f) { f = { childId: id, childName: name, childCode: code, latest: '', notes: [], chats: [] }; m.set(id, f); }
      return f;
    };
    for (const n of notes ?? []) {
      if (chatOnly || (kind && n.kind !== kind)) continue;
      if (text && !`${n.childName} ${n.childCode} ${n.text} ${n.byName}`.toLowerCase().includes(text)) continue;
      const f = folder(n.childId, n.childName, n.childCode);
      f.notes.push(n);
      if (n.day > f.latest) f.latest = n.day;
    }
    for (const c of chats?.chats ?? []) {
      if (kind && !chatOnly) continue;
      if (chatStatus && c.status !== chatStatus) continue;
      if (text && !`${c.childName} ${c.childCode} ${c.lastText}`.toLowerCase().includes(text)) continue;
      const f = folder(c.childId, c.childName, c.childCode);
      f.chats.push(c);
      if (c.lastAt.slice(0, 10) > f.latest) f.latest = c.lastAt.slice(0, 10);
    }
    return [...m.values()].sort((a, b) => a.childName.localeCompare(b.childName));
  }, [notes, chats, q, kind, chatOnly, chatStatus]);

  if (!reader) return null;
  return (
    <div className="page narrow">
      <p><Link to="/hope/reports">← Reports</Link></p>
      <h1>🔒 Care</h1>
      <p className="muted small">Every note and conversation about each child, in a folder per child. Write a note or start a conversation on the child's Care tab.</p>
      <div className="ck-tools">
        <input type="search" className="search" placeholder="Find a child, code or word" aria-label="Find" value={q} onChange={(e) => setQ(e.target.value)} />
        <select aria-label="Show" value={kind} onChange={(e) => setKind(e.target.value as Kind)}>
          <option value="">Everything</option>
          <optgroup label="Conversations">
            <option value="chat">All conversations</option>
            <option value="chat:open">🔴 Open</option>
            <option value="chat:handling">🟠 Being handled</option>
            <option value="chat:closed">✅ Closed</option>
          </optgroup>
          <optgroup label="Notes">
          {NOTE_KINDS.map((k) => <option key={k} value={k}>{NOTE_KIND_EMOJI[k]} {NOTE_KIND_LABELS[k]}</option>)}
          </optgroup>
        </select>
      </div>
      {notes === null ? <p className="muted">Loading…</p> : folders.length === 0 ? <div className="card"><p className="muted">{notes.length || chats?.chats.length ? 'Nothing matches.' : 'No notes yet.'}</p></div> : folders.map((f) => {
        const count = f.notes.length + f.chats.length;
        const open = f.chats.filter((c) => c.status !== 'closed').length;
        return (
          <details key={f.childId} className="card hr-fold">
            <summary><h2>📁 {f.childName}{f.childCode ? ` · ${f.childCode}` : ''}</h2>
              <span className="small muted">{f.notes.length ? `${f.notes.length} ${f.notes.length === 1 ? 'note' : 'notes'}` : ''}{f.notes.length && f.chats.length ? ' · ' : ''}{f.chats.length ? `${f.chats.length} ${f.chats.length === 1 ? 'conversation' : 'conversations'}${open ? ` (${open} open)` : ''}` : ''}{count ? ` · latest ${formatDateKey(f.latest)}` : ''}</span></summary>
            <div className="stack">
              <Link to={`/hope/children/${f.childId}?tab=care`} className="btn btn-quiet align-start">Open {f.childName.split(' ')[0]}'s Care tab</Link>
              {f.chats.length > 0 && <ul className="link-list chat-list">{f.chats.map((c) => <ChatRow key={c.id} c={c} reader unread={isUnread(c, me)} />)}</ul>}
              {f.notes.length > 0 && <ul className="note-list">{f.notes.map((n) => <NoteCard key={n.id} n={n} orgId={org.id} onRemoved={load} />)}</ul>}
            </div>
          </details>
        );
      })}
    </div>
  );
}
