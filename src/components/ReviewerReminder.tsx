import { useEffect, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { useAuth } from '../state/AuthContext';
import { useMyReviews, wroteToday } from '../lib/reviewerNotes';

const FIRST_MS = 3 * 60_000;
const AGAIN_MS = 45 * 60_000;

/**
 * Keeps reminding a Reviewer to write (Andy, 2026-11-11): a few minutes after they start looking around, and again
 * every 45 minutes, until they have written a review that day. Also says when Mr Andrew has answered one.
 */
export function ReviewerReminder() {
  const { profile } = useAuth();
  const { pathname } = useLocation();
  const { rows, loading } = useMyReviews(profile?.uid ?? '');
  const [due, setDue] = useState(false);
  const [snoozed, setSnoozed] = useState(0);
  const done = wroteToday(rows);
  const answered = rows.filter((r) => r.reply && !r.replySeen).length;

  useEffect(() => {
    if (loading || done) { setDue(false); return; }
    const t = window.setTimeout(() => setDue(true), snoozed ? AGAIN_MS : FIRST_MS);
    return () => window.clearTimeout(t);
  }, [loading, done, snoozed]);

  if (pathname.startsWith('/reviews')) return null;
  const to = `/reviews?from=${encodeURIComponent(pathname)}`;
  if (answered) {
    return (
      <div className="review-nudge" role="status">
        <span>💬 Mr Andrew answered {answered === 1 ? 'your review' : `${answered} of your reviews`}.</span>
        <Link to="/reviews" className="btn btn-primary btn-small">Read it</Link>
      </div>
    );
  }
  if (!due) return null;
  return (
    <div className="review-nudge" role="status">
      <span>✍️ What have you noticed so far? Mr Andrew would love your review.</span>
      <span className="row-actions">
        <Link to={to} className="btn btn-primary btn-small" onClick={() => setDue(false)}>Write it now</Link>
        <button type="button" className="btn btn-quiet btn-small" onClick={() => { setDue(false); setSnoozed((n) => n + 1); }}>Later</button>
      </span>
    </div>
  );
}
