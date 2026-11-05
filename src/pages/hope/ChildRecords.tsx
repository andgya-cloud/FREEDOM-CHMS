import { useCallback, useEffect, useState } from 'react';
import { useAuth } from '../../state/AuthContext';
import { useToast } from '../../state/ToastContext';
import { CleanupButton } from '../../components/CleanupDialog';
import { cleanupError } from '../../lib/cleanup';
import { addFee, addNote, feeReceipt, listFees, listNotes, setTermFee, type FeesView, type StoredNote } from '../../lib/hopeRecords';
import { formatDateKey } from '../../../functions/src/shared/datetime';
import { chatColour, chatTime } from '../../../functions/src/shared/hopeChats';
import {
  canKeepFees, canReadNotes, FEE_METHOD_LABELS, FEE_METHODS, formatKes, NOTE_KIND_EMOJI, NOTE_KIND_LABELS, recentTerms, termBalance, termLabel, termOf,
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
 * Welfare notes on the child's page (Andy, 2026-11-05, 4A 5A): every note is a new dated, signed entry, never
 * overwritten. The Director, Andy and Doreen read and write them; they are also kept in Reports → Records.
 */
export function ChildNotes({ orgId, childId, today }: { orgId: string; childId: string; today: string }) {
  const { profile } = useAuth();
  const toast = useToast();
  const reader = canReadNotes(profile, orgId);
  const [notes, setNotes] = useState<StoredNote[] | null>(null);
  const [kind, setKind] = useState<NoteKind>('welfare');
  const [text, setText] = useState('');
  const [day, setDay] = useState(today);
  const [busy, setBusy] = useState(false);
  const load = useCallback(() => { listNotes(orgId, childId).then((r) => setNotes(r.notes), (err) => toast.show(cleanupError(err))); }, [orgId, childId, toast]);
  const [opened, setOpened] = useState(false);
  useEffect(() => { if (reader && opened) load(); }, [reader, opened, load]);
  if (!reader) return null;

  async function save() {
    setBusy(true);
    try {
      await addNote(orgId, childId, kind, text.trim(), kind === 'visit' ? day : undefined);
      setText('');
      toast.show('Note saved');
      load();
    } catch (err) { toast.show(cleanupError(err)); }
    finally { setBusy(false); }
  }
  return (
    <details className="card hr-fold" onToggle={(e) => { if ((e.target as HTMLDetailsElement).open) setOpened(true); }}>
      <summary><h2>Welfare notes</h2><span className="small muted">Director, Andy and Doreen{notes ? ` · ${notes.length} ${notes.length === 1 ? 'note' : 'notes'}` : ''}</span></summary>
      <div className="stack">
        <div className="field-row">
          <label className="field"><span>Kind of note</span>
            <select value={kind} onChange={(e) => setKind(e.target.value as NoteKind)}>
              {(['welfare', 'health', 'home', 'visit'] as NoteKind[]).map((k) => <option key={k} value={k}>{NOTE_KIND_EMOJI[k]} {NOTE_KIND_LABELS[k]}</option>)}
            </select>
          </label>
          {kind === 'visit' && <label className="field"><span>Day of the visit</span><input type="date" value={day} max={today} onChange={(e) => setDay(e.target.value)} /></label>}
        </div>
        <label className="field"><span>Note</span><textarea rows={3} maxLength={4000} value={text} onChange={(e) => setText(e.target.value)} placeholder="What you saw, heard or did" /></label>
        <button type="button" className="btn btn-primary align-start" disabled={busy || !text.trim()} onClick={() => void save()}>{busy ? 'Saving…' : 'Save note'}</button>
        <p className="small muted">Notes are never changed once saved, so the record stays true. They are kept in Reports → Records.</p>
        {notes === null ? <p className="muted small">Loading…</p> : notes.length === 0 ? <p className="muted small">No notes yet.</p> : (
          <ul className="note-list">{notes.map((n) => <NoteCard key={n.id} n={n} orgId={orgId} onRemoved={load} />)}</ul>
        )}
      </div>
    </details>
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
  const [opened, setOpened] = useState(false);
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
    <details className="card hr-fold" onToggle={(e) => { if ((e.target as HTMLDetailsElement).open) setOpened(true); }}>
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
