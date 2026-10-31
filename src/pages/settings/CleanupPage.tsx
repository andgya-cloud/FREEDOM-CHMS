import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import { useOrg } from '../../state/OrgContext';
import { useToast } from '../../state/ToastContext';
import { RemoveDialog } from '../../components/CleanupDialog';
import { cleanupError, findEntries, loadBin, restoreEntries, when, type BinRow, type FoundRow, type Item } from '../../lib/cleanup';
import { kindLabel, kindsFor, type CleanupKind } from '../../../functions/src/shared/cleanup';

/*
 * Clean-up (Andy, 2026-10-30): Andrew Guya and Doreen find test data and clutter, tick it and remove it to the
 * Recycle Bin; put it back within 30 days, after which it moves to Forever (still only they see it, and it can
 * still come back). The Director also sees the deletion register: what was removed, by whom, when and why.
 */
type Tab = 'find' | 'bin' | 'forever' | 'register';

export function CleanupPage() {
  // The organization chosen at the top of the app (Andy's one switcher), never a second picker here.
  const { current } = useOrg();
  const org = current;
  const orgId = org?.id ?? '';
  const [tab, setTab] = useState<Tab>('find');
  const [bin, setBin] = useState<{ entries: BinRow[]; isDirector: boolean } | null>(null);
  const toast = useToast();

  const refreshBin = useCallback(() => {
    if (!orgId) return;
    loadBin({ orgId }).then(setBin, (err) => toast.show(cleanupError(err)));
  }, [orgId, toast]);
  useEffect(() => { setBin(null); refreshBin(); }, [refreshBin]);

  const inBin = bin?.entries.filter((e) => e.state === 'bin') ?? [];
  const forever = bin?.entries.filter((e) => e.state === 'forever') ?? [];

  return (
    <div className="page cleanup-page">
      <h1>Clean-up</h1>
      <p className="muted">Remove test data and clutter. Nothing is lost: removed entries can be put back. Petty cash keeps its own Bin.</p>
      {org ? <p className="small">Working in <strong>{org.name}</strong>. Switch organization at the top to clean up another.</p>
        : <p className="notice">Choose one organization at the top first.</p>}
      <div className="segmented wrap" role="tablist" aria-label="Show">
        <button type="button" className={tab === 'find' ? 'on' : ''} onClick={() => setTab('find')}>Find and remove</button>
        <button type="button" className={tab === 'bin' ? 'on' : ''} onClick={() => setTab('bin')}>Recycle Bin{inBin.length ? ` (${inBin.length})` : ''}</button>
        <button type="button" className={tab === 'forever' ? 'on' : ''} onClick={() => setTab('forever')}>Forever{forever.length ? ` (${forever.length})` : ''}</button>
        {bin?.isDirector && <button type="button" className={tab === 'register' ? 'on' : ''} onClick={() => setTab('register')}>Register</button>}
      </div>
      {org && tab === 'find' && <FindTab key={org.id} orgId={org.id} type={org.type} onRemoved={refreshBin} />}
      {org && tab === 'bin' && <BinList orgId={org.id} rows={inBin} loading={!bin} onChange={refreshBin}
        empty="The Recycle Bin is empty." note="Entries stay here for 30 days, then move to Forever." />}
      {org && tab === 'forever' && <BinList orgId={org.id} rows={forever} loading={!bin} onChange={refreshBin}
        empty="Nothing in Forever yet." note="Kept for good. Only Andrew Guya and Doreen see this, and anything here can still be put back." />}
      {org && tab === 'register' && bin?.isDirector && <Register rows={bin.entries} type={org.type} />}
    </div>
  );
}

function FindTab({ orgId, type, onRemoved }: { orgId: string; type: Parameters<typeof kindsFor>[0]; onRemoved: () => void }) {
  const kinds = kindsFor(type);
  const toast = useToast();
  const [kind, setKind] = useState<CleanupKind>(kinds[0]);
  const [text, setText] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [testOnly, setTestOnly] = useState(false);
  const [result, setResult] = useState<{ total: number; rows: FoundRow[] } | null>(null);
  const [busy, setBusy] = useState(false);
  const [ticked, setTicked] = useState<Set<string>>(new Set());
  const [removing, setRemoving] = useState<Item[] | null>(null);

  const search = useCallback(async (opts?: { testOnly?: boolean }) => {
    setBusy(true);
    try {
      const r = await findEntries({ orgId, kind, text, from, to, testOnly: opts?.testOnly ?? testOnly });
      setResult(r);
      setTicked(new Set());
    } catch (err) {
      toast.show(cleanupError(err));
    } finally {
      setBusy(false);
    }
  }, [orgId, kind, text, from, to, testOnly, toast]);

  useEffect(() => { setResult(null); setTicked(new Set()); }, [kind]);

  const rows = result?.rows ?? [];
  const allTicked = rows.length > 0 && rows.every((r) => ticked.has(r.id));
  const toggle = (id: string) => setTicked((t) => { const n = new Set(t); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const items = useMemo(() => rows.filter((r) => ticked.has(r.id)).map((r) => ({ kind, id: r.id })), [rows, ticked, kind]);

  function submit(e: FormEvent) {
    e.preventDefault();
    void search();
  }

  return (
    <>
      <form className="card stack cleanup-filters" onSubmit={submit}>
        <label className="field"><span>Type of entry</span>
          <select value={kind} onChange={(e) => setKind(e.target.value as CleanupKind)}>
            {kinds.map((k) => <option key={k} value={k}>{kindLabel(k, type)}</option>)}
          </select>
        </label>
        <label className="field"><span>Name or words</span>
          <input type="search" value={text} onChange={(e) => setText(e.target.value)} placeholder="e.g. Test, or a name" />
        </label>
        <details className="cleanup-more">
          <summary>More filters</summary>
          <div className="field-row">
            <label className="field"><span>Made from</span><input type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></label>
            <label className="field"><span>Made up to</span><input type="date" value={to} onChange={(e) => setTo(e.target.value)} /></label>
          </div>
          <label className="check"><input type="checkbox" checked={testOnly} onChange={(e) => setTestOnly(e.target.checked)} /> Only names with “test”, “demo”, “sample” or “dummy”</label>
        </details>
        <div className="cleanup-actions">
          <button type="submit" className="btn btn-primary" disabled={busy}>{busy ? 'Searching…' : 'Search'}</button>
          <button type="button" className="btn" disabled={busy} onClick={() => { setTestOnly(true); void search({ testOnly: true }); }}>Find test data</button>
        </div>
      </form>

      {result && (
        <section className="stack">
          <div className="cleanup-head">
            <strong>{result.total === 0 ? 'Nothing found' : result.total > rows.length ? `${result.total} found, showing the newest ${rows.length}` : `${result.total} found`}</strong>
            {rows.length > 0 && (
              <label className="check"><input type="checkbox" checked={allTicked} onChange={() => setTicked(allTicked ? new Set() : new Set(rows.map((r) => r.id)))} /> Tick all</label>
            )}
          </div>
          {rows.length > 0 && (
            <ul className="row-list cleanup-list">
              {rows.map((r) => (
                <li key={r.id}>
                  <label className="cleanup-row">
                    <input type="checkbox" checked={ticked.has(r.id)} onChange={() => toggle(r.id)} />
                    <span className="cleanup-text">
                      <span className="row-title">{r.label}{r.official && <span className="badge badge-warn">Official</span>}</span>
                      {r.detail && <span className="small muted">{r.detail}</span>}
                      <span className="small muted">Made {when(r.createdAt) || 'earlier'}{r.createdByName ? ` by ${r.createdByName}` : ''}</span>
                    </span>
                  </label>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      {items.length > 0 && (
        <div className="cleanup-bar">
          <span>{items.length} ticked</span>
          <button type="button" className="btn btn-danger" onClick={() => setRemoving(items)}>Remove {items.length === 1 ? 'it' : `all ${items.length}`}</button>
        </div>
      )}
      {removing && <RemoveDialog orgId={orgId} items={removing} open onClose={() => setRemoving(null)} onDone={() => { onRemoved(); void search(); }} />}
    </>
  );
}

function BinList({ orgId, rows, loading, onChange, empty, note }: { orgId: string; rows: BinRow[]; loading: boolean; onChange: () => void; empty: string; note: string }) {
  const toast = useToast();
  const [ticked, setTicked] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  useEffect(() => { setTicked((t) => new Set([...t].filter((id) => rows.some((r) => r.id === id)))); }, [rows]);
  if (loading) return <p className="muted">Loading…</p>;
  if (!rows.length) return <p className="muted">{empty}</p>;
  const allTicked = rows.every((r) => ticked.has(r.id));
  const toggle = (id: string) => setTicked((t) => { const n = new Set(t); if (n.has(id)) n.delete(id); else n.add(id); return n; });

  async function putBack() {
    setBusy(true);
    try {
      const res = await restoreEntries({ orgId, binIds: [...ticked] });
      toast.show(res.restored === 1 ? 'Put back, with everything linked to it.' : `${res.restored} entries put back, with everything linked to them.`);
      setTicked(new Set());
      onChange();
    } catch (err) {
      toast.show(cleanupError(err));
      onChange();
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="stack">
      <div className="cleanup-head">
        <span className="small muted">{note}</span>
        <label className="check"><input type="checkbox" checked={allTicked} onChange={() => setTicked(allTicked ? new Set() : new Set(rows.map((r) => r.id)))} /> Tick all</label>
      </div>
      <ul className="row-list cleanup-list">
        {rows.map((r) => (
          <li key={r.id}>
            <label className="cleanup-row">
              <input type="checkbox" checked={ticked.has(r.id)} onChange={() => toggle(r.id)} />
              <span className="cleanup-text">
                <span className="row-title">{r.label}{r.daysLeft != null && <span className="badge">{r.daysLeft === 1 ? '1 day left' : `${r.daysLeft} days left`}</span>}</span>
                {r.detail && <span className="small muted">{r.detail}</span>}
                {r.linkedText && <span className="small muted">With {r.linkedText}</span>}
                <span className="small muted">Removed by {r.deletedByName} on {when(r.deletedAt)}{r.reason ? `. Reason: ${r.reason}` : ''}</span>
              </span>
            </label>
          </li>
        ))}
      </ul>
      {ticked.size > 0 && (
        <div className="cleanup-bar">
          <span>{ticked.size} ticked</span>
          <button type="button" className="btn btn-primary" disabled={busy} onClick={() => void putBack()}>{busy ? 'Putting back…' : 'Put back'}</button>
        </div>
      )}
    </section>
  );
}

function Register({ rows, type }: { rows: BinRow[]; type: Parameters<typeof kindLabel>[1] }) {
  if (!rows.length) return <p className="muted">Nothing has been removed yet.</p>;
  const state = (r: BinRow) => (r.state === 'restored' ? `Put back by ${r.restoredByName ?? ''} on ${when(r.restoredAt)}` : r.state === 'forever' ? 'In Forever' : 'In the Recycle Bin');
  return (
    <section className="stack">
      <p className="small muted">Every removal, newest first. Only you can see this.</p>
      <ul className="row-list cleanup-list">
        {rows.map((r) => (
          <li key={r.id} className="cleanup-row">
            <span className="cleanup-text">
              <span className="row-title">{r.label}<span className="badge">{kindLabel(r.kind, type)}</span>{r.official && <span className="badge badge-warn">Official</span>}</span>
              <span className="small muted">Removed by {r.deletedByName} on {when(r.deletedAt)}{r.reason ? `. Reason: ${r.reason}` : ''}</span>
              {r.linkedText && <span className="small muted">With {r.linkedText}</span>}
              <span className="small">{state(r)}</span>
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}
