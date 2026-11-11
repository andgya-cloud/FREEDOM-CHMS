import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { collection, onSnapshot, query, where } from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import { db, functions } from '../firebase';
import { generateTemporaryPassword } from '../lib/generatePassword';
import { useAuth } from '../state/AuthContext';
import { useOrg } from '../state/OrgContext';
import { useToast } from '../state/ToastContext';
import { friendlyError } from '../lib/errors';
import { helpFor } from '../lib/pageHelp';
import { isDirectorProfile, isReviewer, REVIEWER_ROLE_ID } from '../../functions/src/shared/permissions';
import { markNote, markReplySeen, replyToNote, sendReviewerNote, sortNewest, useMyReviews, useReviewerNotes, type ReviewerNote } from '../lib/reviewerNotes';
import { VoiceButton } from '../components/VoiceButton';

const when = (n: { toDate(): Date } | undefined) => (n ? n.toDate().toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : 'just now');

/**
 * The review window (Andy, 2026-11-11). A Reviewer writes what they noticed and reads Mr Andrew's answers; Mr
 * Andrew reads every review and answers it here. Nothing else in the app can be changed by a Reviewer.
 */
export function ReviewsPage() {
  const { profile, can } = useAuth();
  if (isReviewer(profile)) return <MyReviews />;
  if (can('users.manage')) return <AllReviews />;
  return <div className="page narrow"><h1>Reviews</h1><p>Only Mr Andrew reads the reviews.</p></div>;
}

function MyReviews() {
  const { profile } = useAuth();
  const { current } = useOrg();
  const toast = useToast();
  const [params] = useSearchParams();
  const from = params.get('from') || '/';
  const kind = current?.type;
  const pageName = `${current?.name ?? 'The app'} › ${helpFor(from, kind === 'college', kind === 'church_campus').title}`;
  const [text, setText] = useState('');
  const [about, setAbout] = useState<'page' | 'all'>(params.get('from') ? 'page' : 'all');
  const [busy, setBusy] = useState(false);
  const { rows, loading } = useMyReviews(profile?.uid ?? '');
  const list = sortNewest(rows);

  // Opening the window marks Mr Andrew's new answers as read.
  useEffect(() => {
    rows.filter((r) => r.reply && !r.replySeen).forEach((r) => { markReplySeen(r.id).catch(() => undefined); });
  }, [rows]);

  if (!profile || !current) return null;
  const send = (e: React.FormEvent) => {
    e.preventDefault();
    if (text.trim().length < 3 || busy) return;
    setBusy(true);
    sendReviewerNote({ uid: profile.uid, name: profile.displayName ?? '', orgId: current.id, path: about === 'page' ? from : '/', page: about === 'page' ? pageName : `${current.name} › The whole app`, text })
      .then(() => { setText(''); toast.show('✅ Thank you! Mr Andrew will read it.'); })
      .catch((err) => toast.show(friendlyError(err)))
      .finally(() => setBusy(false));
  };

  return (
    <div className="page narrow">
      <h1>✍️ My reviews</h1>
      <p className="muted small">Look around everything, then tell Mr Andrew what was hard, unclear, missing or good. You can't change anything in the app; your reviews are how you help make it better.</p>
      <form className="card stack" onSubmit={send}>
        <label className="field"><span>About</span>
          <select value={about} onChange={(e) => setAbout(e.target.value as 'page' | 'all')}>
            {params.get('from') && <option value="page">{pageName}</option>}
            <option value="all">The whole app</option>
          </select>
        </label>
        <label className="field"><span>Your review</span>
          <textarea rows={5} value={text} maxLength={2000} onChange={(e) => setText(e.target.value)} placeholder="What did you notice? What would make it simpler?" />
        </label>
        <div className="row-actions">
          <VoiceButton value={text} onChange={setText} label="Speak" />
          <button type="submit" className="btn btn-primary" disabled={text.trim().length < 3 || busy}>{busy ? 'Sending…' : 'Send to Mr Andrew'}</button>
        </div>
      </form>

      <h2>Your reviews</h2>
      {loading && list.length === 0 ? <p className="muted">Loading…</p> : list.length === 0 ? (
        <p className="muted">🌱 Nothing yet. Your first review will show here, with Mr Andrew's answer.</p>
      ) : (
        <ul className="plain stack">
          {list.map((n) => (
            <li key={n.id} className="card stack">
              <span className="small muted">{when(n.createdAt)} · <Link to={n.path}>{n.page}</Link></span>
              <p className="review-text">{n.text}</p>
              {n.reply ? <Answer n={n} /> : <span className="small muted">⏳ Waiting for Mr Andrew's answer</span>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function Answer({ n }: { n: ReviewerNote }) {
  return (
    <div className="review-reply">
      <span className="small"><b>{n.replyBy || 'Mr Andrew'}</b> · {when(n.replyAt)}{n.replySeen === false && <span className="badge"> New</span>}</span>
      <p className="review-text">{n.reply}</p>
    </div>
  );
}

function AllReviews() {
  const { profile } = useAuth();
  const toast = useToast();
  const { rows, loading } = useReviewerNotes(true);
  const [show, setShow] = useState<'new' | 'done'>('new');
  const [open, setOpen] = useState('');
  const [reply, setReply] = useState('');
  const list = rows.filter((n) => n.status === show);
  const waiting = rows.filter((n) => n.status === 'new').length;
  const answer = (n: ReviewerNote) => {
    if (reply.trim().length < 2) return;
    replyToNote(n.id, reply, profile?.displayName || 'Mr Andrew')
      .then(() => { setOpen(''); setReply(''); toast.show('✅ Answer sent. They will see it in My reviews.'); })
      .catch((err) => toast.show(friendlyError(err)));
  };
  return (
    <div className="page narrow">
      <p><Link to="/settings">← Settings</Link></p>
      <h1>✍️ Reviews</h1>
      <p className="muted small">What the reviewers noticed, newest first. Tap the page name to see it. Your answer shows in their review window.</p>
      {isDirectorProfile(profile) && <Reviewers />}
      <label className="field">
        <span className="visually-hidden">Show</span>
        <select className="filter-select" value={show} onChange={(e) => setShow(e.target.value as 'new' | 'done')}>
          <option value="new">Waiting for you ({waiting})</option>
          <option value="done">Answered or done ({rows.length - waiting})</option>
        </select>
      </label>
      {loading && rows.length === 0 ? <p className="muted">Loading…</p> : list.length === 0 ? (
        <p className="muted">{show === 'new' ? '🌱 No new reviews. When a reviewer writes one, it shows here and on Today.' : 'Nothing answered yet.'}</p>
      ) : (
        <ul className="plain stack">
          {list.map((n) => (
            <li key={n.id} className="card stack">
              <span className="small muted">{n.name || 'A reviewer'} · {when(n.createdAt)} · <Link to={n.path}>{n.page}</Link></span>
              <p className="review-text">{n.text}</p>
              {n.reply && <Answer n={{ ...n, replySeen: true }} />}
              {open === n.id ? (
                <div className="stack">
                  <textarea rows={3} value={reply} maxLength={2000} onChange={(e) => setReply(e.target.value)} placeholder="Your answer" aria-label="Your answer" />
                  <div className="row-actions">
                    <VoiceButton value={reply} onChange={setReply} label="Speak" />
                    <button type="button" className="btn btn-primary btn-small" disabled={reply.trim().length < 2} onClick={() => answer(n)}>Send answer</button>
                    <button type="button" className="btn btn-quiet btn-small" onClick={() => setOpen('')}>Cancel</button>
                  </div>
                </div>
              ) : (
                <div className="row-actions">
                  <button type="button" className="btn btn-small" onClick={() => { setOpen(n.id); setReply(n.reply ?? ''); }}>💬 {n.reply ? 'Change answer' : 'Answer'}</button>
                  <button type="button" className="btn btn-quiet btn-small" onClick={() => { markNote(n.id, show === 'new' ? 'done' : 'new').catch((err) => toast.show(friendlyError(err))); }}>
                    {show === 'new' ? '✓ Done, no answer' : 'Move back'}
                  </button>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

interface ReviewerRow { uid: string; displayName: string; email: string; active: boolean; orgIds?: string[]; allOrgs?: boolean }

/** Mr Andrew adds as many reviewers as he likes, and switches each off or on (Andy, 2026-11-11). */
function Reviewers() {
  const { organizations } = useOrg();
  const toast = useToast();
  const [people, setPeople] = useState<ReviewerRow[]>([]);
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const real = organizations.filter((o) => !o.training);
  const [places, setPlaces] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [made, setMade] = useState<{ name: string; email: string; password: string } | null>(null);

  useEffect(() => onSnapshot(query(collection(db, 'users'), where('roleId', '==', REVIEWER_ROLE_ID)), (snap) => {
    setPeople(snap.docs.map((d) => ({ uid: d.id, ...(d.data() as Omit<ReviewerRow, 'uid'>) })).sort((a, b) => a.displayName.localeCompare(b.displayName)));
  }, () => setPeople([])), []);

  const open = () => { setAdding(true); setError(''); setMade(null); setName(''); setEmail(''); setPlaces(real.map((o) => o.id)); };
  const add = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    if (name.trim().length < 2) return setError('Type their name.');
    if (!/^\S+@\S+\.\S+$/.test(email.trim())) return setError('Type a real email address.');
    if (!places.length) return setError('Tick at least one place they review.');
    const password = generateTemporaryPassword();
    setBusy(true);
    try {
      await httpsCallable(functions, 'createUser')({ displayName: name.trim(), email: email.trim(), password, roleId: REVIEWER_ROLE_ID, allOrgs: false, orgIds: places, extraPermissions: [], pettyTitle: '', phone: '', departments: [], inventoryDepartments: [], hopeClasses: [] });
      setMade({ name: name.trim(), email: email.trim().toLowerCase(), password });
      setAdding(false);
    } catch (err) {
      setError(friendlyError(err));
    } finally {
      setBusy(false);
    }
  };
  const switchTo = (u: ReviewerRow, active: boolean) =>
    httpsCallable(functions, 'updateUser')({ uid: u.uid, active })
      .then(() => toast.show(active ? `${u.displayName} can review again.` : `${u.displayName} is switched off.`))
      .catch((err) => toast.show(friendlyError(err)));

  return (
    <details className="card stack">
      <summary><b>👥 Reviewers ({people.filter((p) => p.active).length} on)</b></summary>
      {people.length === 0 ? <p className="muted small">No reviewers yet.</p> : (
        <ul className="plain stack">
          {people.map((u) => (
            <li key={u.uid} className="row-actions">
              <span>{u.displayName} <span className="small muted">· {u.email}{!u.active && ' · Off'}</span></span>
              <button type="button" className="btn btn-quiet btn-small" onClick={() => switchTo(u, !u.active)}>{u.active ? 'Switch off' : 'Switch on'}</button>
            </li>
          ))}
        </ul>
      )}
      {made && (
        <p className="notice small">✅ {made.name} is a reviewer. Send them: sign in at freedom-chms.web.app with <b>{made.email}</b> and the temporary password <b>{made.password}</b>. They choose their own password on the first sign-in.</p>
      )}
      {!adding ? (
        <button type="button" className="btn btn-primary btn-small align-start" onClick={open}>➕ Add a reviewer</button>
      ) : (
        <form className="stack" onSubmit={add}>
          <label className="field"><span>Name</span><input value={name} maxLength={80} onChange={(e) => setName(e.target.value)} /></label>
          <label className="field"><span>Email</span><input type="email" value={email} onChange={(e) => setEmail(e.target.value)} /></label>
          <fieldset className="field">
            <legend>Places they review</legend>
            {real.map((o) => (
              <label key={o.id} className="check">
                <input type="checkbox" checked={places.includes(o.id)} onChange={() => setPlaces((p) => (p.includes(o.id) ? p.filter((x) => x !== o.id) : [...p, o.id]))} />
                <span>{o.name}</span>
              </label>
            ))}
          </fieldset>
          {error && <p className="error small">{error}</p>}
          <div className="row-actions">
            <button type="submit" className="btn btn-primary btn-small" disabled={busy}>{busy ? 'Adding…' : 'Add reviewer'}</button>
            <button type="button" className="btn btn-quiet btn-small" onClick={() => setAdding(false)}>Cancel</button>
          </div>
        </form>
      )}
    </details>
  );
}
