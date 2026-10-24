import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { collection, type Timestamp } from 'firebase/firestore';
import { db } from '../../firebase';
import { useLiveQuery } from '../../lib/useQuery';
import { useToast } from '../../state/ToastContext';
import { friendlyError } from '../../lib/errors';
import { binSign } from '../../lib/pettyPin';
import { usePettyCashAccess } from '../../state/usePettyCash';
import {
  BIN_ACTION_LABELS, BIN_DONE_LABELS, BIN_SIGNATURES_NEEDED, pettyCashBase,
  type BinAction, type BinEntry, type BinKind, type BinSignature,
} from '../../../functions/src/shared/pettyCash';
import { money } from './common';
import { PettyGate, PettyNav } from './PettyCashPage';
import { PettySignBox } from './PettySignBox';
import type { Organization } from '../../state/OrgContext';

/*
 * The petty cash bin (Andy, 2026-10-23). Nothing is deleted by one person: moving an entry to the bin,
 * putting it back, or deleting it forever each needs two stakeholders, and every finished step is kept
 * in the deletion register with the signers' names, titles, date and reason.
 */
type BinRow = BinEntry & { id: string; updatedAt?: Timestamp };

const stamp = (t: unknown) => (t && typeof (t as Timestamp).toDate === 'function'
  ? (t as Timestamp).toDate().toLocaleString('en-KE', { dateStyle: 'medium', timeStyle: 'short' }) : '');
const signers = (sigs: BinSignature[]) => sigs.map((s) => `${s.name} (${s.title})`).join(' and ');
const toastFor = (outcome: string, action: BinAction, count = BIN_SIGNATURES_NEEDED) => outcome === 'done'
  ? `${BIN_DONE_LABELS[action]}.${count < BIN_SIGNATURES_NEEDED ? ' Recorded in the deletion register.' : ' Two stakeholders approved it.'}`
  : `Signed. One more stakeholder must approve "${BIN_ACTION_LABELS[action]}" in the Bin.`;

/** Explains a refusal from the server in the person's words. */
function binError(err: unknown) {
  const e = err as { code?: string; message?: string };
  return e?.code?.startsWith('functions/') && e.message ? e.message.replace(/\s*\[\d+\]$/, '') : friendlyError(err);
}

export function usePettyBin(org: Organization) {
  const p = usePettyCashAccess();
  const on = !!org.id && p.any && !!p.uid;
  const res = useLiveQuery<BinRow>(() => (on ? collection(db, 'organizations', org.id, 'pettyBin') : null), [org.id, on]);
  return res;
}

/** Asks to move an entry to the bin: the person signed in signs first and gives a reason. */
export function AskDeleteDialog({ org, kind, targetId, title, body, open, onClose, onDone }: {
  org: Organization; kind: BinKind; targetId: string; title: string; body: string; open: boolean; onClose: () => void; onDone?: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const toast = useToast();
  const { isPastor } = usePettyCashAccess();
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);
  async function go() {
    setBusy(true);
    try {
      const res = await binSign({ orgId: org.id, kind, targetId, action: 'delete', reason });
      toast.show(toastFor(res.outcome, 'delete', res.count));
      setReason('');
      onClose();
      onDone?.();
    } catch (err) {
      toast.show(binError(err));
    } finally {
      setBusy(false);
    }
  }
  return (
    <dialog ref={ref} className="dialog" onCancel={(e) => { e.preventDefault(); onClose(); }}>
      <h2>{title}</h2>
      <p>{body}</p>
      <p className="small muted">{isPastor ? 'It moves to the Bin straight away and is recorded in the deletion register. You can put it back from the Bin.' : 'You sign first. It moves to the Bin once one more stakeholder approves, and can be put back from there.'}</p>
      <label className="field"><span>{isPastor ? 'Reason (optional)' : 'Reason for deleting'}</span>
        <input value={reason} maxLength={300} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Entered twice by mistake" disabled={busy} />
      </label>
      <div className="dialog-actions">
        <button type="button" className="btn btn-quiet" onClick={onClose} disabled={busy}>Cancel</button>
        <button type="button" className="btn btn-danger" onClick={() => void go()} disabled={busy || (!isPastor && reason.trim().length < 3)}>{busy ? (isPastor ? 'Deleting…' : 'Signing…') : isPastor ? 'Delete' : 'Sign and ask'}</button>
      </div>
    </dialog>
  );
}

/** The small bin icon on a list row that starts a delete. */
export function BinButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button type="button" className="petty-row-del no-print" aria-label={label} title={label} onClick={(e) => { e.preventDefault(); e.stopPropagation(); onClick(); }}>
      <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13M10 11v6M14 11v6" /></svg>
    </button>
  );
}

/** On the overview: how many bin steps wait for a second stakeholder. */
export function BinNotice({ org }: { org: Organization }) {
  const p = usePettyCashAccess();
  const { rows } = usePettyBin(org);
  const waiting = rows.filter((r) => r.motion && !r.motion.signatures.some((s) => s.uid === p.uid)).length;
  if (!waiting) return null;
  return (
    <Link to={`${pettyCashBase(org.type)}/bin`} className="card petty-bin-notice">
      {waiting} deletion{waiting === 1 ? '' : 's'} waiting for your approval in the Bin
    </Link>
  );
}

export function PettyBinPage() {
  return <PettyGate title="Bin">{(org) => <BinView org={org} />}</PettyGate>;
}

function BinView({ org }: { org: Organization }) {
  const p = usePettyCashAccess();
  const toast = useToast();
  const { rows, loading } = usePettyBin(org);
  const [asking, setAsking] = useState<{ row: BinRow; action: BinAction } | null>(null);
  const [reason, setReason] = useState('');
  const waiting = useMemo(() => rows.filter((r) => r.motion), [rows]);
  const inBin = useMemo(() => rows.filter((r) => r.state === 'in-bin' && !r.motion), [rows]);
  const register = useMemo(() => rows.flatMap((r) => r.history.map((h) => ({ row: r, h })))
    .sort((a, b) => ((b.h.doneAt as Timestamp)?.toMillis?.() ?? 0) - ((a.h.doneAt as Timestamp)?.toMillis?.() ?? 0)), [rows]);

  async function act(row: BinRow, action: BinAction, extra: { reason?: string; withdraw?: boolean } = {}) {
    try {
      const res = await binSign({ orgId: org.id, kind: row.kind, targetId: row.targetId, action, ...extra });
      toast.show(res.outcome === 'withdrawn' ? 'Withdrawn.' : toastFor(res.outcome, action, res.count));
    } catch (err) {
      toast.show(binError(err));
    }
  }
  const what = (r: BinRow) => `${r.label}${r.amountCents != null ? ` · ${money(org, r.amountCents)}` : ''}`;
  const openLink = (r: BinRow) => (r.kind === 'request' && r.state !== 'purged' ? `${pettyCashBase(org.type)}/${r.targetId}` : r.kind === 'receipt' && r.reqId ? `${pettyCashBase(org.type)}/${r.reqId}` : null);

  return (
    <div className="page narrow wide-table">
      <div className="page-head">
        <h1>Bin</h1>
        {p.isPastor && <button type="button" className="btn btn-quiet no-print" onClick={() => window.print()}>Print register</button>}
      </div>
      <PettyNav org={org} />
      <p className="muted small no-print">{p.isPastor ? 'You can put back or delete forever on your own. For other stakeholders each step needs any two of them.' : 'Deleting, putting back and deleting forever each need any two stakeholders. Whoever asks signs first.'}{p.isPastor ? ' Every step is recorded below.' : ''}</p>

      <section className="card stack no-print">
        <h2>Waiting for a second stakeholder</h2>
        {loading ? <p className="muted small">Loading…</p> : waiting.length === 0 ? <p className="muted small">Nothing is waiting.</p> : (
          <ul className="petty-bin-list">
            {waiting.map((r) => {
              const m = r.motion!;
              const mine = m.signatures.some((s) => s.uid === p.uid);
              return (
                <li key={r.id} className="petty-bin-item petty-bin-waiting">
                  <div className="petty-bin-what"><strong>{BIN_ACTION_LABELS[m.action]}</strong>: {what(r)}</div>
                  <p className="small">Asked by {signers(m.signatures)} · {m.signatures.length} of {BIN_SIGNATURES_NEEDED} signatures{m.reason ? ` · Reason: ${m.reason}` : ''}</p>
                  <div className="row-actions">
                    {p.canSign && !mine && <button type="button" className="btn btn-primary" onClick={() => void act(r, m.action)}>Approve as me</button>}
                    {(m.startedBy === p.uid || p.isPastor) && <button type="button" className="btn btn-quiet" onClick={() => void act(r, m.action, { withdraw: true })}>Withdraw</button>}
                  </div>
                  <PettySignBox label="Or another stakeholder approves on this device with their name and PIN." orgId={org.id} exclude={m.signatures.map((s) => s.uid)} confirmLabel="✓ Approve"
                    sign={async (uid, pin) => toastFor((await binSign({ orgId: org.id, kind: r.kind, targetId: r.targetId, action: m.action, signerUid: uid, pin })).outcome, m.action)} />
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <section className="card stack no-print">
        <h2>In the bin</h2>
        {inBin.length === 0 ? <p className="muted small">The bin is empty.</p> : (
          <ul className="petty-bin-list">
            {inBin.map((r) => {
              const last = r.history[r.history.length - 1];
              const link = openLink(r);
              return (
                <li key={r.id} className="petty-bin-item">
                  <div className="petty-bin-what">{what(r)}{link && <> · <Link to={link} className="small">Open</Link></>}</div>
                  {last && <p className="small muted">Deleted {stamp(last.doneAt)} by {signers(last.signatures)}. Reason: {last.reason}</p>}
                  {p.canSign && (
                    <div className="row-actions">
                      <button type="button" className="btn btn-quiet" onClick={() => { setReason(''); setAsking({ row: r, action: 'restore' }); }}>Put back</button>
                      <button type="button" className="btn btn-quiet danger-text" onClick={() => { setReason(''); setAsking({ row: r, action: 'purge' }); }}>Delete forever</button>
                    </div>
                  )}
                  {asking?.row.id === r.id && (
                    <div className="petty-bin-ask">
                      <p className="small">{asking.action === 'purge' ? 'Deleting forever cannot be undone. The record below keeps its name, amount and who approved it.' : 'It comes back exactly as it was.'} {p.isPastor ? 'This happens straight away.' : 'You sign first; one more stakeholder must approve.'}</p>
                      <label className="field"><span>Reason (optional)</span><input value={reason} maxLength={300} onChange={(e) => setReason(e.target.value)} /></label>
                      <div className="row-actions">
                        <button type="button" className="btn btn-quiet" onClick={() => setAsking(null)}>Cancel</button>
                        <button type="button" className={asking.action === 'purge' ? 'btn btn-danger' : 'btn btn-primary'} onClick={() => { void act(r, asking.action, { reason }); setAsking(null); }}>{p.isPastor ? '' : 'Sign and ask: '}{BIN_ACTION_LABELS[asking.action]}</button>
                      </div>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {/* Only the Director (pastor) sees the register (Andy, 2026-10-24). */}
      {p.isPastor && (
      <section className="card stack">
        <h2>Deletion register</h2>
        <p className="small muted">{org.name}. Every entry moved to the bin, put back or deleted forever, with the two stakeholders who approved it.</p>
        {register.length === 0 ? <p className="muted small">Nothing has been deleted.</p> : (
          <div className="table-scroll">
            <table className="table petty-register">
              <thead><tr><th>Date</th><th>Entry</th><th>Action</th><th>Reason</th><th>Approved by</th></tr></thead>
              <tbody>
                {register.map(({ row, h }, i) => (
                  <tr key={`${row.id}-${i}`}>
                    <td>{stamp(h.doneAt)}</td>
                    <td>{what(row)}</td>
                    <td>{BIN_DONE_LABELS[h.action]}</td>
                    <td>{h.reason || '—'}</td>
                    <td>{h.signatures.map((s) => <div key={s.uid}>{s.name}, {s.title}<span className="small muted"> · {stamp(s.at)}</span></div>)}{h.sole && <div className="small muted">Sole approval</div>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
      )}
    </div>
  );
}
