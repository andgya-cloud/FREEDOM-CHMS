import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../../state/AuthContext';
import { useToast } from '../../state/ToastContext';
import { friendlyError } from '../../lib/errors';
import { markNote, useReviewerNotes } from '../../lib/reviewerNotes';

/** Settings › Reviewer notes (Andy, 2026-11-11, 4A): every suggestion from a Reviewer, newest first, with its page. */
export function ReviewerNotesPage() {
  const { can } = useAuth();
  const toast = useToast();
  const allowed = can('users.manage');
  const { rows, loading } = useReviewerNotes(allowed);
  const [show, setShow] = useState<'new' | 'done'>('new');
  if (!allowed) return <div className="page narrow"><h1>Reviewer notes</h1><p>Only Mr Andrew reads the reviewers' notes.</p></div>;
  const list = rows.filter((n) => n.status === show);
  const waiting = rows.filter((n) => n.status === 'new').length;
  return (
    <div className="page narrow">
      <p><Link to="/settings">← Settings</Link></p>
      <h1>Reviewer notes</h1>
      <p className="muted small">Ideas from the people reviewing the app. Each note says the page it is about. Tap the page to see it.</p>
      <label className="field">
        <span className="visually-hidden">Show</span>
        <select className="filter-select" value={show} onChange={(e) => setShow(e.target.value as 'new' | 'done')}>
          <option value="new">New ({waiting})</option>
          <option value="done">Done ({rows.length - waiting})</option>
        </select>
      </label>
      {loading && rows.length === 0 ? <p className="muted">Loading…</p> : list.length === 0 ? (
        <p className="muted">{show === 'new' ? '🌱 No new notes. When a reviewer sends an idea from Just ask Andy, it shows here.' : 'Nothing marked done yet.'}</p>
      ) : (
        <ul className="plain stack">
          {list.map((n) => (
            <li key={n.id} className="card stack">
              <span className="small muted">{n.name || 'A reviewer'} · {n.createdAt ? n.createdAt.toDate().toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : 'just now'} · <Link to={n.path}>{n.page}</Link></span>
              <p style={{ margin: 0, whiteSpace: 'pre-wrap' }}>{n.text}</p>
              <button type="button" className="btn btn-small align-start" onClick={() => { markNote(n.id, show === 'new' ? 'done' : 'new').catch((err) => toast.show(friendlyError(err))); }}>
                {show === 'new' ? '✓ Mark done' : 'Move back to new'}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
