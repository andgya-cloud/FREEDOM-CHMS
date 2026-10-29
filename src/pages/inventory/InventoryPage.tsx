import { useEffect, useMemo, useRef, useState, type ChangeEvent } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useOrg } from '../../state/OrgContext';
import { useToast } from '../../state/ToastContext';
import { useSchool } from '../../state/useSchool';
import { useExamCohorts } from '../../state/useExams';
import { countStatus, dayOf, today } from './InventoryBanner';
import { useInventoryAccess, useInventoryCount, useInventoryCounts, useInventoryPhoto, type InventoryCountRow } from '../../state/useInventory';
import {
  askInventoryReopen, emailInventory, openInventoryCount, reopenInventory, returnInventory, saveInventoryItems, saveInventoryPhoto,
  setInventoryDeadline, submitInventory, verifyInventory,
} from '../../lib/inventoryWrites';
import { inventoryPdf } from '../../lib/inventoryPdf';
import { downloadFile, shareOrDownload } from '../../lib/givingPdf';
import { readSpreadsheetSheets } from '../../lib/statementFile';
import { friendlyError } from '../../lib/errors';
import { formatDateKey, localDateKey } from '../../../functions/src/shared/datetime';
import {
  CATEGORIES, CONDITIONS, CONDITION_LABELS, INVENTORY_PHASES, INVENTORY_TEMPLATE_HEAD, MAX_ITEMS, UNITS, canEditCount, carryForward, compareCounts,
  conditionCounts, countdownText, daysLeft, defaultDeadline, inventoryCountId, itemsFromSheet, lateNote, phaseTitle,
  type InventoryCondition, type InventoryItem, type InventoryPhase,
} from '../../../functions/src/shared/inventory';

const plusDays = (key: string, n: number) => { const d = new Date(`${key}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const newId = () => crypto.randomUUID().slice(0, 10);

/** Inventory home: Admin sees every department's counts by cohort; the people in charge see their own forms. */
export function InventoryPage() {
  const { current } = useOrg();
  const a = useInventoryAccess();
  const orgId = current?.type === 'college' ? current.id : '';
  const { counts, loading } = useInventoryCounts(orgId);
  const now = today();
  if (!orgId) return <div className="page narrow"><h1>Inventory</h1><p className="muted">Inventory is kept at ADIA Training Centre. Switch to ADIA first.</p></div>;
  if (!a.counts) return <div className="page narrow"><h1>Inventory</h1><p className="muted">Your account is not in charge of any department's inventory.</p></div>;
  if (!a.manager) {
    const mine = [...counts].sort((x, y) => Number(x.status !== 'open') - Number(y.status !== 'open') || y.deadline.localeCompare(x.deadline));
    return (
      <div className="page narrow">
        <h1>Inventory</h1>
        {loading && !mine.length ? <p className="muted">Loading…</p> : !mine.length ? (
          <p className="muted">No inventory form yet. Admin opens one at the start and at the end of each cohort, with its deadline.</p>
        ) : (
          <ul className="link-list inv-list">
            {mine.map((c) => { const s = countStatus(c, now); return (
              <li key={c.id}><Link to={`/inventory/${c.id}`}>
                <span className="link-title">{c.courseName} · {phaseTitle(c.phase, c.cohort)}</span>
                <span className="link-detail">{c.items.length} items · deadline {formatDateKey(c.deadline)} <span className={`inv-chip inv-${s.tone}`}>{s.text}</span></span>
              </Link></li>
            ); })}
          </ul>
        )}
      </div>
    );
  }
  return <ManagerHome orgId={orgId} counts={counts} loading={loading} />;
}

function ManagerHome({ orgId, counts, loading }: { orgId: string; counts: InventoryCountRow[]; loading: boolean }) {
  const toast = useToast();
  const school = useSchool(orgId);
  const examCohorts = useExamCohorts(orgId);
  const now = today();
  const departments = school.courses.filter((c) => c.active !== false).sort((x, y) => x.name.localeCompare(y.name));
  const cohorts = useMemo(() => {
    const start = new Map<string, string>();
    for (const i of school.intakes) { const n = i.name.trim(); if (n && (!start.has(n) || i.startDate < start.get(n)!)) start.set(n, i.startDate); }
    for (const c of counts) if (!start.has(c.cohort)) start.set(c.cohort, '');
    return [...start.entries()].filter(([n]) => examCohorts.byName[n]?.closed !== true).sort((x, y) => (y[1] || y[0]).localeCompare(x[1] || x[0], undefined, { numeric: true }));
  }, [school.intakes, counts, examCohorts.byName]);
  const [cohort, setCohort] = useState('');
  const chosen = cohort || cohorts[0]?.[0] || '';
  const startDate = cohorts.find(([n]) => n === chosen)?.[1] || null;
  const graduation = examCohorts.byName[chosen]?.graduationDate ?? null;
  const needs = counts.filter((c) => (c.status === 'open' && c.reopenRequest) || c.status === 'submitted');

  return (
    <div className="page">
      <div className="page-head inv-head">
        <h1>Inventory</h1>
        {cohorts.length > 0 && (
          <label className="field inv-cohort"><span className="visually-hidden">Cohort</span>
            <select value={chosen} onChange={(e) => setCohort(e.target.value)}>{cohorts.map(([n]) => <option key={n} value={n}>{n}</option>)}</select>
          </label>
        )}
      </div>
      {needs.length > 0 && (
        <section className="card inv-needs">
          <h2>Needs you</h2>
          <ul className="link-list">
            {needs.map((c) => (
              <li key={c.id}><Link to={`/inventory/${c.id}`}>
                <span className="link-title">{c.courseName} · {phaseTitle(c.phase, c.cohort)}</span>
                <span className="link-detail">{c.reopenRequest ? `${c.reopenRequest.byName} asks to reopen: "${c.reopenRequest.reason}"` : `Submitted by ${c.signedName ?? 'them'}${lateNote(c, dayOf(c.submittedAt)) ? ', late' : ''}. Check and verify it.`}</span>
              </Link></li>
            ))}
          </ul>
        </section>
      )}
      {loading && !counts.length ? <p className="muted">Loading…</p> : !chosen ? <p className="muted">Start a cohort under School first.</p> : INVENTORY_PHASES.map((phase) => (
        <PhaseCard key={phase} orgId={orgId} cohort={chosen} phase={phase} departments={departments} counts={counts} now={now}
          suggested={defaultDeadline(phase, now, startDate, graduation)} onError={(err) => toast.show(friendlyError(err))} />
      ))}
    </div>
  );
}

/** One cohort's start or end count across the departments, or the button that opens it. */
function PhaseCard({ orgId, cohort, phase, departments, counts, now, suggested, onError }: {
  orgId: string; cohort: string; phase: InventoryPhase; departments: { id: string; name: string }[]; counts: InventoryCountRow[]; now: string; suggested: string; onError: (err: unknown) => void;
}) {
  const toast = useToast();
  const [deadline, setDeadline] = useState('');
  const rows = departments.map((d) => ({ d, c: counts.find((c) => c.id === inventoryCountId(cohort, d.id, phase)) }));
  const missing = rows.filter((r) => !r.c);
  const due = deadline || suggested;

  function openAll() {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(due)) return toast.show('Pick the deadline.');
    for (const { d } of missing) {
      // Each count starts from the department's last count (Andy, 2026-10-29, 4A).
      const last = counts.filter((c) => c.courseId === d.id && c.status !== 'open' && c.items.length)
        .sort((x, y) => (y.submittedAt?.toMillis?.() ?? 0) - (x.submittedAt?.toMillis?.() ?? 0))[0];
      openInventoryCount(orgId, inventoryCountId(cohort, d.id, phase), { cohort, courseId: d.id, courseName: d.name, phase, deadline: due, items: last ? carryForward(last.items) : [] }).catch(onError);
    }
    toast.show(`${phaseTitle(phase, cohort)} inventory opened for ${missing.length} ${missing.length === 1 ? 'department' : 'departments'}, due ${formatDateKey(due)}.`);
  }

  return (
    <section className="card inv-phase">
      <div className="card-head"><h2>{phaseTitle(phase, cohort)}</h2></div>
      {rows.some((r) => r.c) && (
        <ul className="link-list">
          {rows.filter((r) => r.c).map(({ d, c }) => { const s = countStatus(c!, now); return (
            <li key={d.id}><Link to={`/inventory/${c!.id}`}>
              <span className="link-title">{d.name}</span>
              <span className="link-detail">{c!.items.length} items · deadline {formatDateKey(c!.deadline)}{c!.signedName || c!.preparedByName ? ` · ${c!.signedName || c!.preparedByName}` : ''} <span className={`inv-chip inv-${s.tone}`}>{s.text}</span></span>
            </Link></li>
          ); })}
        </ul>
      )}
      {missing.length > 0 && (
        <div className="inv-open">
          <p className="small muted">{rows.some((r) => r.c) ? `Not opened yet for ${missing.map((r) => r.d.name).join(', ')}.` : `Open the ${phase === 'start' ? 'start-of-cohort' : 'end-of-cohort'} count for every department. Each one starts from the department's last count.`}</p>
          <div className="row-actions">
            <label className="field"><span>Deadline</span><input type="date" value={due} min={now} onChange={(e) => setDeadline(e.target.value)} /></label>
            <button type="button" className="btn btn-primary align-end" onClick={openAll}>Open for {missing.length === departments.length ? 'all ' : ''}{missing.length} {missing.length === 1 ? 'department' : 'departments'}</button>
          </div>
        </div>
      )}
    </section>
  );
}

/** Makes a photo small enough to keep in the database: at most 900 px, JPEG. */
async function shrinkPhoto(file: File): Promise<string> {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((ok, fail) => { const i = new Image(); i.onload = () => ok(i); i.onerror = () => fail(new Error('That photo could not be read.')); i.src = url; });
    for (const [max, q] of [[900, 0.72], [700, 0.62], [520, 0.55]] as const) {
      const scale = Math.min(1, max / Math.max(img.width, img.height));
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(img.width * scale);
      canvas.height = Math.round(img.height * scale);
      canvas.getContext('2d')!.drawImage(img, 0, 0, canvas.width, canvas.height);
      const data = canvas.toDataURL('image/jpeg', q);
      if (data.length < 380_000) return data;
    }
    throw new Error('That photo is too large. Try again a little further away.');
  } finally { URL.revokeObjectURL(url); }
}

function ItemPhoto({ orgId, photo, onPick, editable }: { orgId: string; photo: string | null | undefined; onPick: (f: File) => void; editable: boolean }) {
  const data = useInventoryPhoto(orgId, photo);
  const [big, setBig] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  return (
    <div className="inv-photo">
      {data ? <button type="button" className="inv-thumb" onClick={() => setBig(!big)} aria-label="Show the photo"><img src={data} alt="" /></button>
        : editable ? <button type="button" className="inv-thumb inv-thumb-add" onClick={() => input.current?.click()} aria-label="Add a photo">+ Photo</button> : null}
      {editable && data && <button type="button" className="btn-link small" onClick={() => input.current?.click()}>Change</button>}
      {editable && <input ref={input} type="file" accept="image/*" capture="environment" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) onPick(f); e.target.value = ''; }} />}
      {big && data && <button type="button" className="inv-big" onClick={() => setBig(false)} aria-label="Close the photo"><img src={data} alt="" /></button>}
    </div>
  );
}

/** One department's inventory form: the items, the countdown, submitting, and Admin's checks. */
export function InventoryCountPage() {
  const { countId = '' } = useParams();
  const { current } = useOrg();
  const a = useInventoryAccess();
  const toast = useToast();
  const navigate = useNavigate();
  const orgId = current?.type === 'college' ? current.id : '';
  const { count, loading } = useInventoryCount(orgId, countId);
  const { counts } = useInventoryCounts(orgId);
  const now = today();
  const [items, setItems] = useState<InventoryItem[] | null>(null);
  const dirty = useRef(false);
  const [saved, setSaved] = useState<'saved' | 'saving' | ''>('');
  const [confirm, setConfirm] = useState(false);
  const [sign, setSign] = useState('');
  const [reason, setReason] = useState('');
  const [note, setNote] = useState('');
  const [reopenDays, setReopenDays] = useState('3');
  const [emailTo, setEmailTo] = useState('');
  const [busy, setBusy] = useState('');
  const fileInput = useRef<HTMLInputElement>(null);

  // The form shows the saved items until the person changes something; then their copy is saved a moment later.
  useEffect(() => { if (count && !dirty.current) setItems(count.items); }, [count]);
  useEffect(() => {
    if (!dirty.current || !items || !count) return;
    setSaved('saving');
    const t = window.setTimeout(() => {
      dirty.current = false;
      saveInventoryItems(orgId, count.id, items, a.myName).then(() => setSaved('saved'), (err) => { setSaved(''); toast.show(friendlyError(err)); });
    }, 900);
    return () => window.clearTimeout(t);
  }, [items]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!orgId) return <div className="page narrow"><p className="muted">Switch to ADIA Training Centre first.</p></div>;
  if (loading && !count) return <div className="page narrow"><p className="muted">Loading…</p></div>;
  if (!count) return <div className="page narrow"><p className="muted">This inventory form is not there, or it is not yours to see.</p><Link to="/inventory">← Inventory</Link></div>;

  const c = count;
  const list = items ?? c.items;
  const mine = a.mine.includes(c.courseId);
  const open = canEditCount(c, now);
  const editable = open && (mine || a.manager);
  const submittedOn = dayOf(c.submittedAt);
  const late = lateNote(c, submittedOn);
  const start = c.phase === 'end' ? counts.find((x) => x.id === inventoryCountId(c.cohort, c.courseId, 'start')) : undefined;
  const changes = start ? compareCounts(start.items, list) : null;
  const sum = conditionCounts(list);
  const status = countStatus(c, now);
  const closesOn = c.reopenUntil && now > c.deadline ? c.reopenUntil : c.deadline;

  const change = (next: InventoryItem[]) => { dirty.current = true; setItems(next); };
  const setItem = (id: string, patch: Partial<InventoryItem>) => change(list.map((i) => (i.id === id ? { ...i, ...patch } : i)));
  const addItem = () => {
    if (list.length >= MAX_ITEMS) return toast.show(`A form holds up to ${MAX_ITEMS} items.`);
    change([...list, { id: newId(), name: '', category: '', quantity: 1, unit: 'pcs', condition: 'good', location: list[list.length - 1]?.location ?? '', tag: '', remarks: '', photo: null }]);
  };
  async function upload(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    try {
      const sheets = await readSpreadsheetSheets(file);
      const found = sheets.map((s) => itemsFromSheet(s.rows, newId)).find((r) => r && r.items.length);
      if (!found) return toast.show('No items found. The first row should name the columns, such as Item, Quantity, Condition, Location.');
      const key = (i: InventoryItem) => `${i.name.toLowerCase()}|${i.tag.toLowerCase()}`;
      const have = new Set(list.filter((i) => i.name.trim()).map(key));
      const fresh = found.items.filter((i) => !have.has(key(i))).slice(0, MAX_ITEMS - list.length);
      change([...list.filter((i) => i.name.trim()), ...fresh]);
      toast.show(`${fresh.length} ${fresh.length === 1 ? 'item' : 'items'} added from ${file.name}.${found.items.length - fresh.length ? ` ${found.items.length - fresh.length} already on the list were skipped.` : ''}`);
    } catch (err) { toast.show(friendlyError(err)); }
  }
  function template() {
    const csv = [INVENTORY_TEMPLATE_HEAD, ['Desktop computer', 'Electronics', '20', 'pcs', 'Good', 'Lab 1', 'ADIA-ICT-001', '']].map((r) => r.map((v) => `"${v}"`).join(',')).join('\r\n');
    downloadFile(new File([csv], `Inventory-template-${c.courseName.replace(/[^A-Za-z0-9]+/g, '-')}.csv`, { type: 'text/csv' }));
  }
  async function photo(id: string, file: File) {
    try { const data = await shrinkPhoto(file); setItem(id, { photo: saveInventoryPhoto(orgId, c.courseId, data) }); } catch (err) { toast.show(friendlyError(err)); }
  }
  function submit() {
    const named = list.filter((i) => i.name.trim());
    if (!named.length) return toast.show('Add the items first.');
    if (!confirm) return toast.show('Tick the box to confirm the count.');
    const who = (sign || a.myName).trim();
    if (who.length < 2) return toast.show('Type your name to sign.');
    dirty.current = false;
    submitInventory(orgId, c.id, named, who).then(() => toast.show('Submitted to Admin.'), (err) => toast.show(friendlyError(err)));
  }
  const pdf = () => inventoryPdf({ count: { ...c, items: list.filter((i) => i.name.trim()) }, submittedOn, verifiedOn: dayOf(c.verifiedAt), late, changes });
  async function share(kind: 'download' | 'whatsapp' | 'managers' | 'email') {
    setBusy(kind);
    try {
      const file = await pdf();
      if (kind === 'download') downloadFile(file);
      else if (kind === 'whatsapp') {
        const text = `${c.courseName} inventory, ${phaseTitle(c.phase, c.cohort)}: ${list.length} items.`;
        if ((await shareOrDownload(file, text)) === 'downloaded') {
          window.open(`https://wa.me/?text=${encodeURIComponent(`${text} The PDF is attached.`)}`, '_blank', 'noopener');
          toast.show('The PDF was downloaded. Attach it in the WhatsApp chat that opened.');
        }
      } else {
        const to = kind === 'managers' ? 'managers' : emailTo.trim();
        if (kind === 'email' && !/^\S+@\S+\.\S+$/.test(to)) { toast.show('Type the email address.'); return; }
        const n = await emailInventory(orgId, c.id, file, to);
        toast.show(kind === 'managers' ? `Emailed to Admin and the Principal (${n}).` : `Emailed to ${to}.`);
        setEmailTo('');
      }
    } catch (err) { toast.show(friendlyError(err)); } finally { setBusy(''); }
  }

  return (
    <div className="page inv-page">
      <Link to="/inventory" className="btn-link inv-back">← Inventory</Link>
      <div className="page-head inv-head">
        <h1>{c.courseName}<span className="inv-sub">{phaseTitle(c.phase, c.cohort)}</span></h1>
        {!(open && c.status === 'open') && <span className={`inv-chip inv-${status.tone}`}>{status.text}</span>}
      </div>

      {c.status === 'open' && open && (
        <div className={`inv-countdown${daysLeft(closesOn, now) <= 5 ? ' inv-countdown-due' : ''}`}>
          <strong>{countdownText(closesOn, now).replace(/^./, (x) => x.toUpperCase())}</strong>
          <span>Deadline {formatDateKey(closesOn)}{c.reopenUntil && now > c.deadline ? ` (reopened; first deadline ${formatDateKey(c.deadline)})` : ''}. Submit to Admin before then; after it the form closes.</span>
        </div>
      )}
      {c.status === 'open' && !open && (
        <div className="inv-countdown inv-countdown-late">
          <strong>Closed</strong>
          <span>The deadline was {formatDateKey(closesOn)}. {c.reopenRequest ? `${c.reopenRequest.byName} asked Admin to reopen it: "${c.reopenRequest.reason}".` : mine ? 'Ask Admin to reopen it. The late submission will be printed on the form.' : 'It was not submitted.'}</span>
          {mine && !c.reopenRequest && (
            <div className="input-with-button">
              <input value={reason} maxLength={300} placeholder="Why it is late, e.g. I was away on leave" onChange={(e) => setReason(e.target.value)} aria-label="Reason" />
              <button type="button" className="btn btn-primary" disabled={reason.trim().length < 3}
                onClick={() => askInventoryReopen(orgId, c.id, reason.trim(), a.myName).then(() => { setReason(''); toast.show('Admin has been asked to reopen it.'); }, (err) => toast.show(friendlyError(err)))}>Ask Admin to reopen</button>
            </div>
          )}
        </div>
      )}
      {c.status === 'open' && c.returnNote && <p className="inv-note">Admin sent it back: {c.returnNote}</p>}
      {c.status !== 'open' && (
        <div className="inv-countdown inv-countdown-done">
          <strong>{c.status === 'verified' ? `Verified by ${c.verifiedByName ?? 'Admin'}` : 'Submitted to Admin'}</strong>
          <span>Signed by {c.signedName} on {submittedOn ? formatDateKey(submittedOn) : '…'}.{late ? ` ${late}` : ''}{c.verifyNote ? ` Admin's note: ${c.verifyNote}` : ''}</span>
        </div>
      )}

      <div className="inv-summary">
        <span><strong>{list.filter((i) => i.name.trim()).length}</strong> items</span>
        {CONDITIONS.filter((k) => sum[k]).map((k) => <span key={k} className={`inv-cond inv-cond-${k}`}>{CONDITION_LABELS[k]} {sum[k]}</span>)}
        {editable && <span className="inv-saved muted small">{saved === 'saving' ? 'Saving…' : saved === 'saved' ? 'Saved' : ''}</span>}
      </div>

      {editable && (
        <div className="row-actions inv-tools">
          <button type="button" className="btn btn-primary" onClick={addItem}>+ Add item</button>
          <button type="button" className="btn" onClick={() => fileInput.current?.click()}>Upload Excel or CSV</button>
          <button type="button" className="btn btn-quiet" onClick={template}>Download template</button>
          <input ref={fileInput} type="file" accept=".xlsx,.csv,text/csv" hidden onChange={upload} />
        </div>
      )}

      <datalist id="inv-categories">{CATEGORIES.map((x) => <option key={x} value={x} />)}</datalist>
      <datalist id="inv-units">{UNITS.map((x) => <option key={x} value={x} />)}</datalist>
      {list.length === 0 ? <p className="muted">{editable ? 'No items yet. Add them one by one, or upload an Excel or CSV list.' : 'No items.'}</p> : (
        <ol className="inv-items">
          {list.map((it, n) => (
            <li key={it.id} className={`inv-item inv-item-${it.condition}`}>
              <span className="inv-no">{n + 1}</span>
              <ItemPhoto orgId={orgId} photo={it.photo} editable={editable} onPick={(f) => void photo(it.id, f)} />
              {editable ? (
                <div className="inv-fields">
                  <label className="field inv-name"><span>Item</span><input value={it.name} maxLength={120} placeholder="e.g. Sewing machine" onChange={(e) => setItem(it.id, { name: e.target.value })} /></label>
                  <label className="field"><span>Category</span><input value={it.category} maxLength={60} list="inv-categories" onChange={(e) => setItem(it.id, { category: e.target.value })} /></label>
                  <label className="field inv-qty"><span>Quantity</span><input type="number" min={0} step="any" inputMode="decimal" value={Number.isFinite(it.quantity) ? it.quantity : ''} onChange={(e) => setItem(it.id, { quantity: Math.max(0, Number(e.target.value) || 0) })} /></label>
                  <label className="field inv-unit"><span>Unit</span><input value={it.unit} maxLength={20} list="inv-units" onChange={(e) => setItem(it.id, { unit: e.target.value })} /></label>
                  <label className="field"><span>Condition</span>
                    <select value={it.condition} onChange={(e) => setItem(it.id, { condition: e.target.value as InventoryCondition })}>{CONDITIONS.map((k) => <option key={k} value={k}>{CONDITION_LABELS[k]}</option>)}</select>
                  </label>
                  <label className="field"><span>Location</span><input value={it.location} maxLength={80} placeholder="e.g. Lab 1" onChange={(e) => setItem(it.id, { location: e.target.value })} /></label>
                  <label className="field"><span>Serial/Tag No.</span><input value={it.tag} maxLength={60} onChange={(e) => setItem(it.id, { tag: e.target.value })} /></label>
                  <label className="field inv-remarks"><span>Remarks</span><input value={it.remarks} maxLength={300} onChange={(e) => setItem(it.id, { remarks: e.target.value })} /></label>
                  <button type="button" className="btn-link inv-remove" onClick={() => change(list.filter((x) => x.id !== it.id))} aria-label={`Remove ${it.name || 'this item'}`}>Remove</button>
                </div>
              ) : (
                <div className="inv-read">
                  <strong>{it.name}</strong>
                  <span>{it.quantity} {it.unit}{it.category ? ` · ${it.category}` : ''}{it.location ? ` · ${it.location}` : ''}{it.tag ? ` · ${it.tag}` : ''}</span>
                  <span className={`inv-cond inv-cond-${it.condition}`}>{CONDITION_LABELS[it.condition]}</span>
                  {it.remarks && <span className="muted small">{it.remarks}</span>}
                </div>
              )}
            </li>
          ))}
        </ol>
      )}
      {editable && list.length > 4 && <button type="button" className="btn" onClick={addItem}>+ Add item</button>}

      {changes && (
        <section className="card inv-changes">
          <h2>Changes since the start of {c.cohort}</h2>
          {([['Missing', changes.missing, true], ['Condition got worse', changes.worse, true], ['Fewer than at the start', changes.fewer, false], ['More than at the start', changes.more, false], ['New items', changes.added, false]] as const)
            .filter(([, l]) => l.length).map(([label, l, bad]) => (
              <div key={label}><h3 className={bad ? 'inv-bad' : ''}>{label} ({l.length})</h3>
                <ul>{l.map((x, i) => <li key={i}>{x.name}{x.tag ? ` [${x.tag}]` : ''}: {x.was ? `${x.was}, now ${x.now}` : x.now}</li>)}</ul></div>
            ))}
          {!Object.values(changes).some((l) => l.length) && <p className="muted small">Nothing changed since the start of the cohort.</p>}
        </section>
      )}

      {mine && editable && (
        <section className="card inv-submit">
          <h2>Submit to Admin</h2>
          <label className="check"><input type="checkbox" checked={confirm} onChange={(e) => setConfirm(e.target.checked)} /> I confirm I counted these items myself and this inventory is true and complete.</label>
          <div className="row-actions">
            <label className="field"><span>Signed (your name)</span><input value={sign || a.myName} maxLength={120} onChange={(e) => setSign(e.target.value)} /></label>
            <button type="button" className="btn btn-primary align-end" onClick={submit}>Submit to Admin</button>
          </div>
        </section>
      )}

      {a.manager && <AdminBox key={c.id} c={c} now={now} note={note} setNote={setNote} reopenDays={reopenDays} setReopenDays={setReopenDays} orgId={orgId} myName={a.myName} onDone={(m) => toast.show(m)} onRemoved={() => navigate('/inventory')} />}

      <section className="card inv-share">
        <h2>Print or send</h2>
        <div className="row-actions">
          <button type="button" className="btn" disabled={!!busy} onClick={() => void share('download')}>{busy === 'download' ? 'Making…' : 'Download PDF'}</button>
          <button type="button" className="btn" disabled={!!busy} onClick={() => void share('whatsapp')}>WhatsApp</button>
          <button type="button" className="btn" disabled={!!busy} onClick={() => void share('managers')}>{busy === 'managers' ? 'Sending…' : 'Email to Admin & Principal'}</button>
        </div>
        <div className="input-with-button">
          <input type="email" value={emailTo} placeholder="Or email to…" onChange={(e) => setEmailTo(e.target.value)} aria-label="Email address" />
          <button type="button" className="btn" disabled={!!busy || !emailTo.trim()} onClick={() => void share('email')}>{busy === 'email' ? 'Sending…' : 'Send'}</button>
        </div>
      </section>
    </div>
  );
}

/** Admin's checks on a form: the deadline, reopening, verifying or sending it back (Andy, 2026-10-29, 3, 6A and 8A). */
function AdminBox({ c, now, note, setNote, reopenDays, setReopenDays, orgId, myName, onDone }: {
  c: InventoryCountRow; now: string; note: string; setNote: (v: string) => void; reopenDays: string; setReopenDays: (v: string) => void;
  orgId: string; myName: string; onDone: (msg: string) => void; onRemoved: () => void;
}) {
  const err = (e: unknown) => onDone(friendlyError(e));
  const until = plusDays(now, Number(reopenDays) || 3);
  const closed = c.status === 'open' && !canEditCount(c, now);
  return (
    <section className="card inv-admin">
      <h2>Admin</h2>
      {c.status === 'open' && (
        <div className="row-actions">
          <label className="field"><span>Deadline</span><input type="date" defaultValue={c.deadline} key={c.deadline}
            onChange={(e) => { const v = e.target.value; if (/^\d{4}-\d{2}-\d{2}$/.test(v) && v !== c.deadline) setInventoryDeadline(orgId, c.id, v).then(() => onDone(`Deadline moved to ${formatDateKey(v)}.`), err); }} /></label>
        </div>
      )}
      {(closed || c.reopenRequest) && c.status === 'open' && (
        <div className="stack">
          {c.reopenRequest && <p><strong>{c.reopenRequest.byName}</strong> asks to reopen it: "{c.reopenRequest.reason}"</p>}
          <div className="row-actions">
            <label className="field"><span>Reopen for</span>
              <select value={reopenDays} onChange={(e) => setReopenDays(e.target.value)}>{['1', '2', '3', '5', '7'].map((d) => <option key={d} value={d}>{d} {d === '1' ? 'day' : 'days'} (until {formatDateKey(plusDays(now, Number(d)))})</option>)}</select>
            </label>
            <button type="button" className="btn btn-primary align-end" onClick={() => reopenInventory(orgId, c.id, c, until, myName, now).then(() => onDone(`Reopened until ${formatDateKey(until)}. The late submission will show on the form.`), err)}>Reopen</button>
          </div>
        </div>
      )}
      {c.status === 'submitted' && (
        <div className="stack">
          <label className="field"><span>Note (optional)</span><input value={note} maxLength={300} placeholder="e.g. Checked against the lab" onChange={(e) => setNote(e.target.value)} /></label>
          <div className="row-actions">
            <button type="button" className="btn btn-primary" onClick={() => verifyInventory(orgId, c.id, myName, note).then(() => { setNote(''); onDone('Verified. It now prints with your name.'); }, err)}>Received and verified</button>
            <button type="button" className="btn btn-quiet" onClick={() => { if (!note.trim()) return onDone('Write in the note what needs correcting.'); returnInventory(orgId, c.id, note, plusDays(now, 3)).then(() => { setNote(''); onDone('Sent back for correction, open for 3 days.'); }, err); }}>Send back for correction</button>
          </div>
        </div>
      )}
      {c.status === 'verified' && <p className="muted small">Verified by {c.verifiedByName}{c.verifiedAt?.toDate ? ` on ${formatDateKey(localDateKey(c.verifiedAt.toDate()))}` : ''}.</p>}
    </section>
  );
}
