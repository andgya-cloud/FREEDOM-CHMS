import { useState } from 'react';
import { collection, doc, query, where, type Timestamp } from 'firebase/firestore';
import { db } from '../firebase';
import { useToast } from '../state/ToastContext';
import { useLiveQuery } from '../lib/useQuery';
import { addPastoralNote, addPrayerRequest } from '../lib/peopleWrites';
import { updateRecord } from '../lib/records';
import { friendlyError } from '../lib/errors';
import { formatDateTime } from '../../functions/src/shared/datetime';

interface Note {
  id: string;
  text: string;
  status?: string;
  createdAt?: Timestamp;
  deletedAt?: Timestamp | null;
}

const byNewest = (a: Note, b: Note) => (b.createdAt?.toMillis() ?? Date.now()) - (a.createdAt?.toMillis() ?? Date.now());

/** Pastoral notes and prayer needs. Only rendered for staff with pastoral access; the server enforces the same. */
export function PastoralSection({ orgId, personId }: { orgId: string; personId: string }) {
  const toast = useToast();
  const notes = useLiveQuery<Note>(() => query(collection(db, 'organizations', orgId, 'pastoralNotes'), where('personId', '==', personId)), [orgId, personId]);
  const prayers = useLiveQuery<Note>(() => query(collection(db, 'organizations', orgId, 'prayerRequests'), where('personId', '==', personId)), [orgId, personId]);
  const [noteText, setNoteText] = useState('');
  const [prayerText, setPrayerText] = useState('');

  return (
    <>
      <section className="card pastoral" aria-labelledby="notes-h">
        <h2 id="notes-h">Pastoral notes <span className="badge badge-muted">Private</span></h2>
        <form className="input-with-button" onSubmit={(e) => {
          e.preventDefault();
          if (!noteText.trim()) return;
          addPastoralNote(orgId, personId, noteText).catch((err) => toast.show(friendlyError(err)));
          setNoteText('');
        }}>
          <textarea rows={2} placeholder="Add a note" value={noteText} onChange={(e) => setNoteText(e.target.value)} />
          <button type="submit" className="btn">Add</button>
        </form>
        <ul className="note-list">
          {notes.rows.filter((n) => !n.deletedAt).sort(byNewest).map((n) => (
            <li key={n.id}><p>{n.text}</p><span className="muted small">{n.createdAt ? formatDateTime(n.createdAt.toDate()) : 'Just now'}</span></li>
          ))}
        </ul>
      </section>

      <section className="card pastoral" aria-labelledby="prayer-h">
        <h2 id="prayer-h">Prayer needs <span className="badge badge-muted">Private</span></h2>
        <form className="input-with-button" onSubmit={(e) => {
          e.preventDefault();
          if (!prayerText.trim()) return;
          addPrayerRequest(orgId, personId, prayerText).catch((err) => toast.show(friendlyError(err)));
          setPrayerText('');
        }}>
          <textarea rows={2} placeholder="Add a prayer need" value={prayerText} onChange={(e) => setPrayerText(e.target.value)} />
          <button type="submit" className="btn">Add</button>
        </form>
        <ul className="note-list">
          {prayers.rows.filter((n) => !n.deletedAt).sort(byNewest).map((n) => (
            <li key={n.id} className={n.status === 'answered' ? 'answered' : ''}>
              <p>{n.text}</p>
              <span className="muted small">
                {n.createdAt ? formatDateTime(n.createdAt.toDate()) : 'Just now'}
                {n.status === 'answered' ? ' · Answered' : ''}
              </span>
              {n.status !== 'answered' && (
                <button type="button" className="btn btn-quiet" onClick={() => {
                  updateRecord(doc(db, 'organizations', orgId, 'prayerRequests', n.id), { status: 'answered' }).catch((err) => toast.show(friendlyError(err)));
                }}>Mark answered</button>
              )}
            </li>
          ))}
        </ul>
      </section>
    </>
  );
}
