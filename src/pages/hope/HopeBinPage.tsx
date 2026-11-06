import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../../state/AuthContext';
import { useToast } from '../../state/ToastContext';
import { ConfirmDialog } from '../../components/ConfirmDialog';
import { cleanupError, loadBin, startFresh, type BinRow } from '../../lib/cleanup';
import { canKeepAccounts } from '../../../functions/src/shared/permissions';
import { START_FRESH_KINDS, START_FRESH_LABELS, type StartFreshKind } from '../../../functions/src/shared/cleanup';
import { BinList } from '../settings/CleanupPage';
import { friendlyError } from '../../lib/errors';
import { listPhotoReports, restorePhotoReport, restoreStoryFile, type PhotoList } from '../../lib/hopePhotos';
import { PHOTO_REPORT_EMOJI } from '../../../functions/src/shared/hopePhotos';
import { formatDateKey } from '../../../functions/src/shared/datetime';
import { HopeGate } from './common';
import type { Organization } from '../../state/OrgContext';

export function HopeBinPage() {
  return <HopeGate title="Bin">{(org) => <Bin org={org} />}</HopeGate>;
}

/**
 * The Hope Centre's Bin (Andy, 2026-11-05, 6A and 6B): what the Director, Andy or Doreen removed. Put it back, or
 * remove it from the Bin to Dormant (also after 30 days). Dormant is kept for good; only Andy and Doreen see it and
 * can put things back from it. "Start fresh" (3B) is for Andy and Doreen, to clear test data before going live.
 */
function Bin({ org }: { org: Organization }) {
  const { profile } = useAuth();
  const toast = useToast();
  const keeper = canKeepAccounts(profile);
  // Only Andy and Doreen open the Bin (Andy, 2026-11-05); the Director still removes things to it.
  const allowed = keeper;
  const [tab, setTab] = useState<'bin' | 'dormant' | 'fresh'>('bin');
  const [bin, setBin] = useState<BinRow[] | null>(null);
  const refresh = useCallback(() => {
    loadBin({ orgId: org.id }).then((r) => setBin(r.entries), (err) => toast.show(cleanupError(err)));
  }, [org.id, toast]);
  useEffect(() => { if (allowed) refresh(); }, [allowed, refresh]);

  if (!allowed) return <div className="page narrow"><h1>Bin</h1><p className="muted">Only Andrew Guya and Doreen can open the Bin.</p></div>;
  const inBin = bin?.filter((e) => e.state === 'bin') ?? [];
  const dormant = bin?.filter((e) => e.state === 'forever') ?? [];
  return (
    <div className="page narrow">
      <div className="page-head"><h1>🗑 Bin</h1>{keeper && <Link to="/settings/cleanup" className="btn btn-quiet">Find and remove</Link>}</div>
      <p className="muted small">Nothing is ever erased. What is removed comes here first.</p>
      {keeper && (
        <div className="segmented wrap" role="tablist" aria-label="Show">
          <button type="button" className={tab === 'bin' ? 'on' : ''} onClick={() => setTab('bin')}>Bin{inBin.length ? ` (${inBin.length})` : ''}</button>
          <button type="button" className={tab === 'dormant' ? 'on' : ''} onClick={() => setTab('dormant')}>Dormant{dormant.length ? ` (${dormant.length})` : ''}</button>
          <button type="button" className={tab === 'fresh' ? 'on' : ''} onClick={() => setTab('fresh')}>Start fresh</button>
        </div>
      )}
      {tab === 'bin' && <BinList orgId={org.id} rows={inBin} loading={!bin} onChange={refresh} canDormant
        empty="The Bin is empty." note="Put it back, or remove it from the Bin. After 30 days it moves to Dormant by itself." />}
      {tab === 'bin' && <PhotoBin org={org} />}
      {tab === 'dormant' && keeper && <BinList orgId={org.id} rows={dormant} loading={!bin} onChange={refresh}
        empty="Nothing in Dormant." note="Kept for good. Only you and Doreen see this, and anything here can be put back." />}
      {tab === 'fresh' && keeper && <StartFresh org={org} onDone={() => { refresh(); setTab('bin'); }} />}
    </div>
  );
}

/** v173 (5A): deleted photo reports are in the one Bin too (they keep their own record, so they are listed here). */
function PhotoBin({ org }: { org: Organization }) {
  const toast = useToast();
  const [list, setList] = useState<PhotoList | null>(null);
  const [busy, setBusy] = useState('');
  const load = useCallback(() => { listPhotoReports(org.id).then(setList, () => setList(null)); }, [org.id]);
  useEffect(() => { load(); }, [load]);
  const taken = (list?.reports ?? []).flatMap((r) => (r.removed ?? []).map((x) => ({ r, x })));
  if (!list?.deletes || (list.deleted.length === 0 && taken.length === 0)) return null;
  async function fileBack(id: string, key: string) {
    setBusy(key);
    try { await restoreStoryFile(org.id, id, key); toast.show('Put back in the conversation.'); load(); }
    catch (err) { toast.show(friendlyError(err)); } finally { setBusy(''); }
  }
  async function back(id: string) {
    setBusy(id);
    try { await restorePhotoReport(org.id, id); toast.show('Put back in Photo reports.'); load(); }
    catch (err) { toast.show(friendlyError(err)); } finally { setBusy(''); }
  }
  return (
    <section className="card stack">
      <h2>📷 Photo reports</h2>
      {taken.length > 0 && (
        <ul className="link-list">
          {taken.map(({ r, x }) => (
            <li key={x.file.key}><div className="fee-row">
              <span className="grow"><span className="link-title">{x.file.photo ? '🖼' : '📄'} {x.file.name}</span>
                <span className="link-detail">Taken out by {x.removedByName} on {formatDateKey(x.removedAt.slice(0, 10))} · from "{r.title}"</span></span>
              <Link to={`/hope/photos?report=${r.id}`} className="btn btn-quiet">Open</Link>
              <button type="button" className="btn" disabled={busy === x.file.key} onClick={() => void fileBack(r.id, x.file.key)}>↩︎ Put back</button>
            </div></li>
          ))}
        </ul>
      )}
      <ul className="link-list">
        {list.deleted.map((r) => (
          <li key={r.id}><div className="fee-row">
            <span className="grow"><span className="link-title">{PHOTO_REPORT_EMOJI[r.kind]} {r.title}</span>
              <span className="link-detail">Removed by {r.deletedByName} on {formatDateKey(r.deletedOn)}{r.deleteReason ? ` · ${r.deleteReason}` : ''} · sent by {r.senderName}</span></span>
            <Link to={`/hope/photos?report=${r.id}`} className="btn btn-quiet">Open</Link>
            <button type="button" className="btn" disabled={busy === r.id} onClick={() => void back(r.id)}>↩︎ Put back</button>
          </div></li>
        ))}
      </ul>
    </section>
  );
}

function StartFresh({ org, onDone }: { org: Organization; onDone: () => void }) {
  const toast = useToast();
  const [ticks, setTicks] = useState<Set<StartFreshKind>>(new Set());
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const toggle = (k: StartFreshKind) => setTicks((t) => { const n = new Set(t); if (n.has(k)) n.delete(k); else n.add(k); return n; });
  async function go() {
    setConfirm(false);
    setBusy(true);
    try {
      const r = await startFresh({ orgId: org.id, items: [], startFresh: [...ticks], reason: 'Start fresh (test data)' });
      toast.show(r.removed ? `${r.removed} ${r.removed === 1 ? 'entry' : 'entries'} moved to the Bin.` : 'There was nothing to clear.');
      setTicks(new Set());
      onDone();
    } catch (err) { toast.show(cleanupError(err)); }
    finally { setBusy(false); }
  }
  return (
    <section className="card stack">
      <h2>Start fresh</h2>
      <p className="small">Clear the test entries before the Hope Centre goes live. Everything you tick moves to the Bin, so it can still be put back. The children themselves are not touched.</p>
      <ul className="plain-list stack-sm">
        {START_FRESH_KINDS.map((k) => (
          <li key={k}><label className="check"><input type="checkbox" checked={ticks.has(k)} onChange={() => toggle(k)} /> {START_FRESH_LABELS[k]}</label></li>
        ))}
      </ul>
      <p className="small muted">To remove test children, use the Remove button on the child's page, or "Find and remove".</p>
      <button type="button" className="btn btn-danger align-start" disabled={!ticks.size || busy} onClick={() => setConfirm(true)}>{busy ? 'Clearing…' : 'Clear what is ticked'}</button>
      <ConfirmDialog open={confirm} title="Clear these for a fresh start?" danger confirmLabel="Yes, clear them"
        body={`${[...ticks].map((k) => START_FRESH_LABELS[k]).join(', ')}. They move to the Bin and can be put back.`}
        onConfirm={() => void go()} onCancel={() => setConfirm(false)} />
    </section>
  );
}
