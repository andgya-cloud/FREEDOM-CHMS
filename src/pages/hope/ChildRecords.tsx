import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../state/AuthContext';
import { useToast } from '../../state/ToastContext';
import { CleanupButton } from '../../components/CleanupDialog';
import { cleanupError } from '../../lib/cleanup';
import { friendlyError } from '../../lib/errors';
import { startChat, type StoredChat } from '../../lib/hopeChats';
import { ChatRow, useChats } from './HopeChatsPage';
import type { Organization } from '../../state/OrgContext';
import { addFee, addNote, feeReceipt, listFees, listNotes, setTermFee, type FeesView, type StoredNote } from '../../lib/hopeRecords';
import { formatDateKey } from '../../../functions/src/shared/datetime';
import { CHAT_TEXT_MAX, chatColour, chatTime, isUnread } from '../../../functions/src/shared/hopeChats';
import {
  CARE_NOTE_KINDS, canKeepFees, canReadNotes, FEE_METHOD_LABELS, FEE_METHODS, formatKes, NOTE_KIND_EMOJI, NOTE_KIND_LABELS, recentTerms, termBalance, termLabel, termOf,
  type FeeMethod, type NoteKind,
} from '../../../functions/src/shared/hopeRecords';
import { shrinkPhoto } from './registerParts';

/** One note as a signed card, in its writer's colour (the same colours as the conversations). */
export function NoteCard({ n, orgId, onRemoved }: { n: StoredNote; orgId: string; onRemoved?: () => void }) {
  const [bubble, ink] = chatColour(n.byUid || n.byName);
  return (
    <li className="note-card" style={{ background: bubble, borderLeftColor: ink }}>
      <div className="note-top">
        <span className="badge">{NOTE_KIND_EMOJI[n.kind]} {NOTE_KIND_LABELS[n.kind]}</span>
        <span className="small muted">{formatDateKey(n.day)}</span>
        {onRemoved && <CleanupButton orgId={orgId} kind="childNote" id={n.id} hope onDone={onRemoved} />}
      </div>
      <p className="note-text">{n.text}</p>
      <span className="chat-sig" style={{ color: ink }}>{[n.byName, n.byRole, chatTime(n.at)].filter(Boolean).join(' · ')}</span>
    </li>
  );
}

/**
 * The Care tab (Andy, 2026-11-05, v173 3A): one timeline for everything about a child's wellbeing — welfare,
 * health, home, visit, referral and leaving notes, and the conversations — newest first. The Director, Andy and
 * Doreen write a note or start an urgent conversation; other staff raise a worry, which only the readers see.
 */
export function ChildCare({ org, childId, firstName, today }: { org: Organization; childId: string; firstName: string; today: string }) {
  const { profile } = useAuth();
  const toast = useToast();
  const navigate = useNavigate();
  const reader = canReadNotes(profile, org.id);
  const me = profile?.uid ?? '';
  const chats = useChats(org.id, childId);
  const [notes, setNotes] = useState<StoredNote[] | null>(reader ? null : []);
  const [mode, setMode] = useState<'' | 'note' | 'urgent'>('');
  const [kind, setKind] = useState<NoteKind>('welfare');
  const [text, setText] = useState('');
  const [day, setDay] = useState(today);
  const [busy, setBusy] = useState(false);
  const load = useCallback(() => { listNotes(org.id, childId).then((r) => setNotes(r.notes), (err) => toast.show(cleanupError(err))); }, [org.id, childId, toast]);
  useEffect(() => { if (reader) load(); }, [reader, load]);
  const list = chats.list;
  const raiser = !reader && !!list?.raiser;

  const timeline = useMemo(() => {
    const rows: { key: string; at: string; note?: StoredNote; chat?: StoredChat }[] = [];
    for (const n of notes ?? []) rows.push({ key: `n${n.id}`, at: `${n.day}${n.at}`, note: n });
    for (const c of list?.chats ?? []) rows.push({ key: `c${c.id}`, at: `${c.lastAt.slice(0, 10)}${c.lastAt}`, chat: c });
    return rows.sort((x, y) => y.at.localeCompare(x.at));
  }, [notes, list]);

  async function saveNote() {
    setBusy(true);
    try {
      await addNote(org.id, childId, kind, text.trim(), kind === 'visit' || kind === 'referral' ? day : undefined);
      setText(''); setMode('');
      toast.show('Note saved');
      load();
    } catch (err) { toast.show(cleanupError(err)); }
    finally { setBusy(false); }
  }
  async function start() {
    setBusy(true);
    try {
      const r = await startChat(org.id, childId, text.trim(), !reader);
      setText(''); setMode('');
      toast.show(reader ? `Started. ${r.emailed.length ? `${r.emailed.length} were emailed that their urgent response is needed.` : ''}` : 'Sent. The Director and the board have been told it is urgent.');
      if (reader) navigate(`/hope/chats/${r.id}`); else chats.reload();
    } catch (err) { toast.show(friendlyError(err)); }
    finally { setBusy(false); }
  }

  if (!reader && !raiser) return <section className="card"><p className="muted small">Only the Director, Andy and Doreen see {firstName}'s care records.</p></section>;
  return (
    <section className="card stack">
      <h2>Care</h2>
      {mode === '' && (
        <div className="chips">
          {reader && <button type="button" className="btn btn-primary" onClick={() => { setMode('note'); setText(''); }}>✍️ Write a note</button>}
          <button type="button" className="btn btn-danger" onClick={() => { setMode('urgent'); setText(''); }}>🔴 {reader ? 'Urgent: start a conversation' : `Worried about ${firstName}?`}</button>
        </div>
      )}
      {mode === 'note' && (
        <div className="stack hr-sub">
          <div className="field-row">
            <label className="field"><span>Kind of note</span>
              <select value={kind} onChange={(e) => setKind(e.target.value as NoteKind)}>
                {CARE_NOTE_KINDS.map((k) => <option key={k} value={k}>{NOTE_KIND_EMOJI[k]} {NOTE_KIND_LABELS[k]}</option>)}
              </select>
            </label>
            {(kind === 'visit' || kind === 'referral') && <label className="field"><span>{kind === 'visit' ? 'Day of the visit' : 'Day referred'}</span><input type="date" value={day} max={today} onChange={(e) => setDay(e.target.value)} /></label>}
          </div>
          <label className="field"><span>Note</span><textarea rows={3} maxLength={4000} value={text} onChange={(e) => setText(e.target.value)} placeholder={kind === 'referral' ? 'Referred to whom, and why' : 'What you saw, heard or did'} /></label>
          <div className="chips">
            <button type="button" className="btn btn-primary" disabled={busy || !text.trim()} onClick={() => void saveNote()}>{busy ? 'Saving…' : 'Save note'}</button>
            <button type="button" className="btn btn-quiet" onClick={() => setMode('')}>Cancel</button>
          </div>
          <p className="small muted">Notes are never changed once saved, so the record stays true.</p>
        </div>
      )}
      {mode === 'urgent' && (
        <div className="stack hr-sub">
          <p className="small">{reader ? 'Start a conversation with the Director, the board, Andy and Doreen. They are emailed that their URGENT response is needed.' : <>Write what you saw or heard. <strong>Only the Director, the board, Andy and Doreen will read it</strong>, and they are told it is urgent. Do not talk to others about it.</>}</p>
          <label className="field"><span>{reader ? 'First message' : 'What are you worried about?'}</span><textarea rows={3} maxLength={CHAT_TEXT_MAX} value={text} onChange={(e) => setText(e.target.value)} /></label>
          <div className="chips">
            <button type="button" className="btn btn-primary" disabled={busy || !text.trim()} onClick={() => void start()}>{busy ? 'Sending…' : reader ? 'Start the conversation' : 'Send to the Director and the board'}</button>
            <button type="button" className="btn btn-quiet" onClick={() => setMode('')}>Cancel</button>
          </div>
        </div>
      )}
      {(notes === null || !list) && !chats.error ? <p className="muted small">Loading…</p> : timeline.length === 0 ? <p className="muted small">Nothing written about {firstName} yet.</p> : (
        <ul className="note-list">
          {timeline.map((r) => r.note ? <NoteCard key={r.key} n={r.note} orgId={org.id} onRemoved={load} />
            : <ChatRow key={r.key} c={r.chat!} reader={!!list?.reader} unread={!!list?.reader && isUnread(r.chat!, me)} />)}
        </ul>
      )}
    </section>
  );
}

/** Writes the leaving note when a child is marked departing or departed (4A): kept in Records with the welfare notes. */
export function saveLeavingNote(orgId: string, childId: string, text: string) {
  return addNote(orgId, childId, 'leaving', text);
}

/**
 * School fees paid (Andy, 2026-11-05, 7A 8): each payment with the date, term, amount, M-Pesa code and a receipt
 * photo, and the balance against the term fee. The Director, Daniel Ojwang' (the accountant), Andy and Doreen.
 */
export function FeesPaid({ orgId, childId }: { orgId: string; childId: string }) {
  const { profile } = useAuth();
  const toast = useToast();
  const keeper = canKeepFees(profile, orgId);
  const [view, setView] = useState<FeesView | null>(null);
  const [opened, setOpened] = useState(true);
  const [adding, setAdding] = useState(false);
  const [busy, setBusy] = useState(false);
  const [date, setDate] = useState('');
  const [term, setTerm] = useState('');
  const [amount, setAmount] = useState('');
  const [method, setMethod] = useState<FeeMethod>('mpesa');
  const [code, setCode] = useState('');
  const [note, setNote] = useState('');
  const [receipt, setReceipt] = useState<string | null>(null);
  const [feeText, setFeeText] = useState('');
  const [editFee, setEditFee] = useState(false);
  const [shown, setShown] = useState<string | null>(null);
  const load = useCallback(() => {
    listFees(orgId, childId).then((v) => { setView(v); setDate((d) => d || v.today); setTerm((t) => t || termOf(v.today)); setFeeText(v.termFee ? String(v.termFee) : ''); }, (err) => toast.show(cleanupError(err)));
  }, [orgId, childId, toast]);
  useEffect(() => { if (keeper && opened) load(); }, [keeper, opened, load]);
  if (!keeper) return null;

  const today = view?.today ?? '';
  const thisTerm = today ? termOf(today) : '';
  const bal = view ? termBalance(view.payments, thisTerm, view.termFee) : null;

  async function save() {
    setBusy(true);
    try {
      await addFee(orgId, childId, { date, term, amount: Number(amount.replace(/[^0-9.]/g, '')), method, code, note, receipt });
      toast.show('Payment saved');
      setAdding(false); setAmount(''); setCode(''); setNote(''); setReceipt(null);
      load();
    } catch (err) { toast.show(cleanupError(err)); }
    finally { setBusy(false); }
  }
  async function saveTermFee() {
    try { await setTermFee(orgId, childId, Number(feeText.replace(/[^0-9.]/g, '')) || 0); setEditFee(false); toast.show('Term fee saved'); load(); }
    catch (err) { toast.show(cleanupError(err)); }
  }
  async function takeReceipt(f: File | undefined) {
    if (!f) return;
    try { setReceipt(await shrinkPhoto(f, 1100)); } catch (err) { toast.show(cleanupError(err)); }
  }
  async function openReceipt(id: string) {
    try { setShown((await feeReceipt(orgId, id)).photo); } catch (err) { toast.show(cleanupError(err)); }
  }

  return (
    <details className="card hr-fold" open onToggle={(e) => { if ((e.target as HTMLDetailsElement).open) setOpened(true); }}>
      <summary><h2>Fees paid</h2><span className="small muted">{bal ? (bal.fee ? `${termLabel(thisTerm)}: ${formatKes(bal.paid)} of ${formatKes(bal.fee)}` : `${termLabel(thisTerm)}: ${formatKes(bal.paid)} paid`) : 'Each payment, with the balance'}</span></summary>
      {!view ? <p className="muted small">Loading…</p> : (
        <div className="stack">
          <div className="fee-balance">
            <div><span className="small muted">Term fee</span><b>{view.termFee ? formatKes(view.termFee) : 'Not set'}</b>{!view.termFeeSaved && view.termFee > 0 && <span className="small muted">from the payment details</span>}</div>
            <div><span className="small muted">Paid in {termLabel(thisTerm)}</span><b>{formatKes(bal!.paid)}</b></div>
            <div className={bal!.left ? 'warn' : 'ok'}><span className="small muted">Balance</span><b>{bal!.fee ? (bal!.over ? `${formatKes(bal!.over)} over` : bal!.left ? formatKes(bal!.left) : 'Fully paid ✓') : '–'}</b></div>
          </div>
          {editFee ? (
            <div className="field-row">
              <label className="field"><span>Fee for each term (KES)</span><input inputMode="numeric" value={feeText} onChange={(e) => setFeeText(e.target.value)} /></label>
              <button type="button" className="btn align-end" onClick={() => void saveTermFee()}>Save</button>
            </div>
          ) : <button type="button" className="btn btn-quiet align-start" onClick={() => setEditFee(true)}>✏️ Set the term fee</button>}

          {!adding ? <button type="button" className="btn btn-primary align-start" onClick={() => setAdding(true)}>➕ Record a payment</button> : (
            <section className="stack hr-sub">
              <h3>Record a payment</h3>
              <div className="field-row">
                <label className="field"><span>Date paid</span><input type="date" value={date} max={today} onChange={(e) => setDate(e.target.value)} /></label>
                <label className="field"><span>Term</span>
                  <select value={term} onChange={(e) => setTerm(e.target.value)}>{recentTerms(today).map((t) => <option key={t} value={t}>{termLabel(t)}</option>)}</select>
                </label>
              </div>
              <div className="field-row">
                <label className="field"><span>Amount (KES)</span><input inputMode="numeric" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="2000" /></label>
                <label className="field"><span>Paid by</span>
                  <select value={method} onChange={(e) => setMethod(e.target.value as FeeMethod)}>{FEE_METHODS.map((m) => <option key={m} value={m}>{FEE_METHOD_LABELS[m]}</option>)}</select>
                </label>
              </div>
              <div className="field-row">
                <label className="field"><span>{method === 'mpesa' ? 'M-Pesa code' : 'Reference (optional)'}</span><input value={code} maxLength={30} onChange={(e) => setCode(e.target.value.toUpperCase())} placeholder={method === 'mpesa' ? 'SKD4XXXXXX' : ''} /></label>
                <label className="field"><span>Note (optional)</span><input value={note} maxLength={300} onChange={(e) => setNote(e.target.value)} /></label>
              </div>
              <div className="chips">
                <label className="btn btn-quiet">📷 {receipt ? 'Retake receipt' : 'Receipt photo'}<input type="file" hidden accept="image/*" capture="environment" onChange={(e) => { void takeReceipt(e.target.files?.[0]); e.target.value = ''; }} /></label>
                {receipt && <img src={receipt} alt="Receipt" className="fee-receipt-thumb" />}
              </div>
              <div className="chips">
                <button type="button" className="btn btn-primary" disabled={busy || !(Number(amount.replace(/[^0-9.]/g, '')) > 0) || !date} onClick={() => void save()}>{busy ? 'Saving…' : 'Save payment'}</button>
                <button type="button" className="btn btn-quiet" onClick={() => setAdding(false)}>Cancel</button>
              </div>
            </section>
          )}

          {view.payments.length === 0 ? <p className="muted small">No payments recorded yet.</p> : (
            <ul className="link-list">
              {view.payments.map((p) => (
                <li key={p.id}><div className="fee-row">
                  <span className="grow"><span className="link-title">{formatKes(p.amount)} · {termLabel(p.term)}</span>
                    <span className="link-detail">{[formatDateKey(p.date), FEE_METHOD_LABELS[p.method], p.code, p.note, `by ${p.byName}`].filter(Boolean).join(' · ')}</span></span>
                  {p.hasReceipt && <button type="button" className="btn btn-quiet" onClick={() => void openReceipt(p.id)}>🧾 Receipt</button>}
                  <CleanupButton orgId={orgId} kind="hopeFee" id={p.id} hope onDone={load} />
                </div></li>
              ))}
            </ul>
          )}
          {shown && (
            <div className="fee-receipt-big">
              <img src={shown} alt="Receipt" />
              <button type="button" className="btn btn-quiet" onClick={() => setShown(null)}>Close</button>
            </div>
          )}
        </div>
      )}
    </details>
  );
}
