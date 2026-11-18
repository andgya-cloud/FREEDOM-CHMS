import { useMemo, useState } from 'react';
import type { Organization } from '../../state/OrgContext';
import { formatDateKey, localDateKey } from '../../../functions/src/shared/datetime';
import { POWERED_BY } from '../../../functions/src/shared/poweredBy';
import {
  cleanAmount, DEFAULT_NEEDS, MAX_NEEDS, MAX_STARS, NEED_GROUPS, needCost, needId, type NeedGroup, type SponsorNeed, type SponsorSettings,
} from '../../../functions/src/shared/hopeSponsorPage';
import { downloadFile } from '../../lib/givingPdf';
import { saveSponsorSettings, sponsorError, type Pledge, type SponsorAdmin } from '../../lib/hopeSponsor';

type Show = (m: string) => void;
const groupLabel = (id: string) => NEED_GROUPS.find((g) => g.id === id)?.label ?? '';

interface Row { id: string; label: string; group: string; cost: number | null; per: string; waiting: number; received: number; givers: number }

/** What was promised and what was received, per item (Andy, 2026-11-18, 10A). */
function needsReport(settings: SponsorSettings, pledges: readonly Pledge[]) {
  const rows = new Map<string, Row>(settings.needs.map((n) => [n.id, { id: n.id, label: n.label, group: n.group, cost: n.cost, per: n.per, waiting: 0, received: 0, givers: 0 }]));
  const others: { p: Pledge; text: string }[] = [];
  const most: { p: Pledge; amount: number | null; often: string }[] = [];
  for (const p of pledges) {
    if (!p.gift || (p.state !== 'waiting' && p.state !== 'received')) continue;
    for (const n of p.gift.needs) {
      // An item taken off the list later still counts under the name it had.
      const r = rows.get(n.id) ?? { id: n.id, label: n.label, group: '', cost: n.cost, per: '', waiting: 0, received: 0, givers: 0 };
      r[p.state] += n.qty ?? 1;
      r.givers += 1;
      rows.set(n.id, r);
    }
    if (p.gift.other) others.push({ p, text: p.gift.other });
    if (p.gift.mostNeeded) most.push({ p, amount: p.gift.mostNeeded.amount, often: p.gift.mostNeeded.often === 'monthly' ? 'Every month' : 'Once' });
  }
  return { rows: [...rows.values()].filter((r) => r.givers), others, most };
}

async function needsExcel(org: Organization, report: ReturnType<typeof needsReport>): Promise<File> {
  const writeXlsxFile = (await import('write-excel-file')).default;
  const bold = (value: string) => ({ value, fontWeight: 'bold' as const });
  const band = (value: string) => ({ value, fontWeight: 'bold' as const, color: '#FFFFFF', backgroundColor: '#5B3F8F', height: 22 });
  const state = (p: Pledge) => (p.state === 'received' ? 'Received' : 'Waiting');
  const rows: unknown[][] = [
    [bold(`${org.name} · Hope Centre needs · ${formatDateKey(localDateKey())}`)],
    [],
    [band('ITEM'), band('GROUP'), band('TYPICAL COST'), band('PROMISED, WAITING'), band('RECEIVED'), band('GIVERS')],
    ...report.rows.map((r) => [
      { value: r.label, type: String }, { value: groupLabel(r.group), type: String }, { value: needCost(r).replace(/^about /, ''), type: String },
      { value: r.waiting, type: Number }, { value: r.received, type: Number }, { value: r.givers, type: Number },
    ]),
  ];
  if (report.most.length) {
    rows.push([], [band('WHERE MOST NEEDED'), band('GIVER'), band('AMOUNT (KES)'), band('HOW OFTEN'), band('STATE'), band('DATE')]);
    for (const m of report.most) rows.push([{ value: m.p.ref, type: String }, { value: m.p.name, type: String }, m.amount ? { value: m.amount, type: Number } : null, { value: m.often, type: String }, { value: state(m.p), type: String }, { value: formatDateKey(m.p.date), type: String }]);
  }
  if (report.others.length) {
    rows.push([], [band('OTHERS'), band('GIVER'), band('WHAT THEY WROTE'), band(''), band('STATE'), band('DATE')]);
    for (const o of report.others) rows.push([{ value: o.p.ref, type: String }, { value: o.p.name, type: String }, { value: o.text, type: String, wrap: true }, null, { value: state(o.p), type: String }, { value: formatDateKey(o.p.date), type: String }]);
  }
  rows.push([], [{ value: POWERED_BY, type: String }]);
  const blob = await writeXlsxFile(rows as never, { columns: [{ width: 36 }, { width: 22 }, { width: 30 }, { width: 18 }, { width: 12 }, { width: 14 }] }) as unknown as Blob;
  return new File([blob], `Hope-Centre-needs-${localDateKey()}.xlsx`, { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
}

/**
 * The Needs tab (Andy, 2026-11-18): what givers promised and what has arrived, per item, with an Excel download (10A),
 * and the list itself for Diana, Andy or Doreen to change (1A), with costs (2A), "how many" boxes (4A) and up to three
 * stars for "Most needed now" (5A).
 */
export function NeedsTab({ org, data, onSaved, toast }: { org: Organization; data: SponsorAdmin; onSaved: (s: SponsorSettings) => void; toast: Show }) {
  const report = useMemo(() => needsReport(data.settings, data.pledges), [data]);
  const download = async () => {
    try { downloadFile(await needsExcel(org, report)); } catch (err) { toast(err instanceof Error ? err.message : 'The file could not be made.'); }
  };
  return (
    <>
      <section className="card">
        <div className="sps-pledge-head">
          <h2>What givers chose</h2>
          <button type="button" className="btn btn-small" onClick={() => void download()} disabled={!report.rows.length && !report.others.length && !report.most.length}>⬇ Excel</button>
        </div>
        {!report.rows.length && !report.others.length && !report.most.length ? <p className="muted">Nothing yet. When someone ticks a need under &ldquo;Support the Hope Centre&rdquo;, it shows here.</p> : (
          <div className="exam-table-wrap">
            <table className="table sps-needs-table">
              <thead><tr><th>Item</th><th className="num">Waiting</th><th className="num">Received</th></tr></thead>
              <tbody>
                {report.rows.map((r) => <tr key={r.id}><td>{r.label}<br /><span className="small muted">{[groupLabel(r.group), `${r.givers} ${r.givers === 1 ? 'giver' : 'givers'}`].filter(Boolean).join(' · ')}</span></td><td className="num">{r.waiting || ''}</td><td className="num">{r.received || ''}</td></tr>)}
              </tbody>
            </table>
          </div>
        )}
        {report.most.length > 0 && <>
          <h3>Where most needed</h3>
          <ul className="sps-plain">{report.most.map((m) => <li key={m.p.id}><b>{m.p.ref}</b> {m.p.name}: {m.amount ? `KES ${m.amount.toLocaleString('en-US')}` : 'any amount'}, {m.often.toLowerCase()} <span className="muted">· {m.p.state === 'received' ? 'received' : 'waiting'}</span></li>)}</ul>
        </>}
        {report.others.length > 0 && <>
          <h3>Others</h3>
          <ul className="sps-plain">{report.others.map((o) => <li key={o.p.id}><b>{o.p.ref}</b> {o.p.name}: &ldquo;{o.text}&rdquo; <span className="muted">· {o.p.state === 'received' ? 'received' : 'waiting'}</span></li>)}</ul>
        </>}
      </section>
      <details className="card sps-done">
        <summary>Change the list ({data.settings.needs.length} items)</summary>
        <NeedsEditor org={org} settings={data.settings} onSaved={onSaved} toast={toast} />
      </details>
    </>
  );
}

interface Draft { id: string; group: NeedGroup; label: string; cost: string; per: string; count: boolean; star: boolean }
const toDraft = (n: SponsorNeed): Draft => ({ ...n, cost: n.cost ? String(n.cost) : '' });

function NeedsEditor({ org, settings, onSaved, toast }: { org: Organization; settings: SponsorSettings; onSaved: (s: SponsorSettings) => void; toast: Show }) {
  const [list, setList] = useState<Draft[]>(() => settings.needs.map(toDraft));
  const [busy, setBusy] = useState(false);
  const stars = list.filter((n) => n.star).length;
  const set = (i: number, patch: Partial<Draft>) => setList((l) => l.map((n, j) => (j === i ? { ...n, ...patch } : n)));
  const add = (group: NeedGroup) => setList((l) => [...l, { id: '', group, label: '', cost: '', per: '', count: true, star: false }]);
  const save = async () => {
    setBusy(true);
    try {
      const needs = list.filter((n) => n.label.trim()).map((n) => ({ ...n, id: n.id || needId(n.label), cost: cleanAmount(n.cost) }));
      const r = await saveSponsorSettings(org.id, { ...settings, needs });
      onSaved(r.settings); setList(r.settings.needs.map(toDraft));
      toast('Saved. The public page shows the new list now.');
    } catch (err) { toast(sponsorError(err)); }
    setBusy(false);
  };
  return (
    <div className="sps-needs-edit">
      <p className="small muted">Givers see these under &ldquo;Support the Hope Centre&rdquo;, with the typical cost. Tick &ldquo;How many&rdquo; for things you count, like shoes. Star up to {MAX_STARS} as Most needed now ({stars} of {MAX_STARS}). &ldquo;Others&rdquo; and &ldquo;Where most needed&rdquo; are always there.</p>
      {NEED_GROUPS.map((g) => (
        <section key={g.id} className="sps-need-group">
          <h3>{g.icon} {g.label}</h3>
          {list.map((n, i) => n.group !== g.id ? null : (
            <div key={i} className="sps-need-row">
              <input aria-label="Item" value={n.label} maxLength={80} onChange={(e) => set(i, { label: e.target.value })} placeholder="Item" />
              <input aria-label="Typical cost in KES" inputMode="numeric" value={n.cost} onChange={(e) => set(i, { cost: e.target.value })} placeholder="KES" />
              <input aria-label="Cost is for" value={n.per} maxLength={30} onChange={(e) => set(i, { per: e.target.value })} placeholder="a pair" />
              <select aria-label="Group" value={n.group} onChange={(e) => set(i, { group: e.target.value as NeedGroup })}>{NEED_GROUPS.map((x) => <option key={x.id} value={x.id}>{x.label}</option>)}</select>
              <label className="check"><input type="checkbox" checked={n.count} onChange={(e) => set(i, { count: e.target.checked })} /> How many</label>
              <label className="check"><input type="checkbox" checked={n.star} disabled={!n.star && stars >= MAX_STARS} onChange={(e) => set(i, { star: e.target.checked })} /> ⭐</label>
              <button type="button" className="btn btn-quiet btn-small" onClick={() => setList((l) => l.filter((_, j) => j !== i))} aria-label={`Remove ${n.label || 'item'}`}>Remove</button>
            </div>
          ))}
          {list.length < MAX_NEEDS && <button type="button" className="btn btn-quiet btn-small" onClick={() => add(g.id)}>+ Add to {g.label}</button>}
        </section>
      ))}
      <div className="dialog-actions">
        <button type="button" className="btn btn-quiet btn-small" onClick={() => setList(DEFAULT_NEEDS.map(toDraft))}>Use the suggested list</button>
        <button type="button" className="btn btn-primary" onClick={() => void save()} disabled={busy}>{busy ? 'Saving…' : 'Save the list'}</button>
      </div>
    </div>
  );
}
