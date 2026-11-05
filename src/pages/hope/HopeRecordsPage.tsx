import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../../state/AuthContext';
import { useToast } from '../../state/ToastContext';
import { cleanupError } from '../../lib/cleanup';
import { listNotes, type StoredNote } from '../../lib/hopeRecords';
import { canReadNotes, NOTE_KIND_EMOJI, NOTE_KIND_LABELS, NOTE_KINDS, type NoteKind } from '../../../functions/src/shared/hopeRecords';
import { formatDateKey } from '../../../functions/src/shared/datetime';
import { NoteCard } from './ChildRecords';
import { HopeGate } from './common';
import type { Organization } from '../../state/OrgContext';

export function HopeRecordsPage() {
  return <HopeGate title="Records">{(org) => <Records org={org} />}</HopeGate>;
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
  const [kind, setKind] = useState<NoteKind | ''>('');
  const load = useCallback(() => { listNotes(org.id).then((r) => setNotes(r.notes), (err) => toast.show(cleanupError(err))); }, [org.id, toast]);
  useEffect(() => { if (reader) load(); }, [reader, load]);

  const folders = useMemo(() => {
    const text = q.trim().toLowerCase();
    const m = new Map<string, StoredNote[]>();
    for (const n of notes ?? []) {
      if (kind && n.kind !== kind) continue;
      if (text && !`${n.childName} ${n.childCode} ${n.text} ${n.byName}`.toLowerCase().includes(text)) continue;
      m.set(n.childId, [...(m.get(n.childId) ?? []), n]);
    }
    return [...m.values()].sort((a, b) => a[0]!.childName.localeCompare(b[0]!.childName));
  }, [notes, q, kind]);

  if (!reader) return <div className="page narrow"><h1>Records</h1><p className="muted">Only the Director, Andrew Guya and Doreen can open the records.</p></div>;
  return (
    <div className="page narrow">
      <p><Link to="/hope/reports">← Reports</Link></p>
      <h1>📁 Records</h1>
      <p className="muted small">Welfare and leaving notes about each child. Write a note on the child's page; it is kept here, dated and signed.</p>
      <div className="ck-tools">
        <input type="search" className="search" placeholder="Find a child, code or word" aria-label="Find" value={q} onChange={(e) => setQ(e.target.value)} />
        <select aria-label="Kind of note" value={kind} onChange={(e) => setKind(e.target.value as NoteKind | '')}>
          <option value="">All notes</option>
          {NOTE_KINDS.map((k) => <option key={k} value={k}>{NOTE_KIND_EMOJI[k]} {NOTE_KIND_LABELS[k]}</option>)}
        </select>
      </div>
      {notes === null ? <p className="muted">Loading…</p> : folders.length === 0 ? <div className="card"><p className="muted">{notes.length ? 'Nothing matches.' : 'No notes yet.'}</p></div> : folders.map((list) => {
        const f = list[0]!;
        return (
          <details key={f.childId} className="card hr-fold">
            <summary><h2>📁 {f.childName}{f.childCode ? ` · ${f.childCode}` : ''}</h2>
              <span className="small muted">{list.length} {list.length === 1 ? 'note' : 'notes'} · latest {formatDateKey(f.day)}</span></summary>
            <div className="stack">
              <Link to={`/hope/children/${f.childId}`} className="btn btn-quiet align-start">Open {f.childName.split(' ')[0]}'s page</Link>
              <ul className="note-list">{list.map((n) => <NoteCard key={n.id} n={n} orgId={org.id} onRemoved={load} />)}</ul>
            </div>
          </details>
        );
      })}
    </div>
  );
}
