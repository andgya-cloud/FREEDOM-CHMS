import { useMemo, useState, type FormEvent } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useAuth } from '../../state/AuthContext';
import { useToast } from '../../state/ToastContext';
import { useChampions } from '../../state/useHope';
import { friendlyError } from '../../lib/errors';
import { addChampion, addChampionExtra, importChampions, markChampion, markMany, removeChampionExtra, updateChampion, type ChampionInput } from '../../lib/hopeWrites';
import { useChampionPay } from '../../state/useHope';
import { formatDateKey } from '../../../functions/src/shared/datetime';
import { isChampionManager } from '../../../functions/src/shared/hopeChampionPay';
import {
  CHAMPION_MARKS, CHAMPION_MARK_LABELS, CHAMPION_TEMPLATE_EXAMPLE, CHAMPION_TEMPLATE_HEAD, championSummary, dayTrend, hoursText, minutesBetween,
  planChampionImport, rateFrom, saturdayOnOrBefore, type Champion, type ChampionEntry, type ChampionImportRow, type ChampionMark, type ExistingChampion,
} from '../../../functions/src/shared/hopeRegister';
import { useHopePage } from './common';
import { CleanupButton } from '../../components/CleanupDialog';
import { Avatar, nowTime, PctBadge, RegisterCalendar, SheetPicker, TemplateButtons, TrendCard } from './registerParts';
import type { Organization } from '../../state/OrgContext';
import { ChampionPay } from './ChampionPay';
import { DoorScan } from './DoorScan';
import { qrCardsPdf } from '../../lib/hopeAttendanceFiles';
import { downloadFile } from '../../lib/givingPdf';
import { setChampionFields } from '../../lib/hopeWrites';
import { arrivalMark, newChampionCodes } from '../../../functions/src/shared/hopeChampionPay';


type Tab = 'register' | 'people' | 'pay' | 'upload';

/**
 * The Child Champions register (Andy, 2026-11-04): the people who teach and serve the Hope Centre children.
 * The Director or an admin marks it (6A): time in, time out, duty and notes, with each champion's percentage.
 */
export function ChampionsPanel({ org }: { org: Organization }) {
  const h = useHopePage(org);
  const { profile } = useAuth();
  const c = useChampions(org.id);
  const manager = isChampionManager(profile, org.id);
  const [params] = useSearchParams();
  const [tab, setTab] = useState<Tab>(() => (params.get('tab') === 'pay' && manager ? 'pay' : 'register'));
  const tabs: [Tab, string][] = [['register', 'Register'], ['people', 'The champions'], ...(manager ? [['pay', 'Pay'], ['upload', 'Upload from Excel']] as [Tab, string][] : [])];
  return (
    <>
      <div className="chips hr-subtabs" role="tablist">
        {tabs.map(([k, label]) => <button key={k} type="button" role="tab" aria-selected={tab === k} className={`chip${tab === k ? ' chip-on' : ''}`} onClick={() => setTab(k)}>{label}</button>)}
      </div>
      {tab === 'register' && <ChampionRegister org={org} today={h.today} data={c} manager={manager} onAdd={() => setTab(manager ? 'people' : 'register')} />}
      {tab === 'people' && <ChampionList org={org} today={h.today} data={c} manager={manager} />}
      {tab === 'pay' && manager && <ChampionPay org={org} today={h.today} data={c} />}
      {tab === 'upload' && manager && <ChampionUpload org={org} today={h.today} existing={c.champions} done={() => setTab('people')} />}
    </>
  );
}

type Data = ReturnType<typeof useChampions>;

function ChampionRegister({ org, today, data, manager, onAdd }: { org: Organization; today: string; data: Data; manager: boolean; onAdd: () => void }) {
  const toast = useToast();
  const [date, setDate] = useState(() => saturdayOnOrBefore(today));
  const fail = (err: unknown) => toast.show(friendlyError(err));
  const day = data.days.find((d) => d.date === date);
  const marks = day?.marks ?? {};
  const markedDays = useMemo(() => new Set(data.days.filter((d) => Object.keys(d.marks ?? {}).length).map((d) => d.date)), [data.days]);
  const list = data.champions.filter((x) => marks[x.id] || (x.status === 'active' && (!x.joinedOn || x.joinedOn <= date)));
  const unmarked = list.filter((x) => !marks[x.id]);
  const rate = rateFrom(Object.values(marks));
  const totalMinutes = Object.values(marks).reduce((n, e) => n + (minutesBetween(e.in, e.out) ?? 0), 0);

  function mark(x: Champion, s0: ChampionMark, extra: Partial<ChampionEntry> = {}) {
    const old = marks[x.id];
    let s = s0;
    const there = s === 'present' || s === 'late';
    // Checking someone in now marks them late after 8:30am (Andy, 2026-11-05, 12).
    if (s === 'present' && !old && date === today) s = arrivalMark(nowTime());
    const entry: ChampionEntry = {
      s, in: there ? (old?.in ?? (date === today ? nowTime() : null)) : null, out: there ? (old?.out ?? null) : null,
      duty: old?.duty ?? (x.duty || null), r: old?.r ?? null, ...extra,
    };
    markChampion(org.id, date, x.id, entry).catch(fail);
  }

  const [scan, setScan] = useState(false);
  const [busy, setBusy] = useState(false);
  /** A champion's card read at the door (11A): checks them in with the time, late after 8:30am. */
  function scanned(code: string): string {
    const x = data.champions.find((c) => c.code === code);
    if (!x) return `No champion has the code ${code}.`;
    const e = marks[x.id];
    if (e && (e.s === 'present' || e.s === 'late')) return `✓ ${x.name} is already checked in${e.in ? ` (${e.in})` : ''}.`;
    const t = date === today ? nowTime() : null;
    const s = arrivalMark(t);
    markChampion(org.id, date, x.id, { s, in: t, out: null, duty: x.duty || null, r: null }).catch(fail);
    return `✓ ${x.name} checked in${t ? ` at ${t}` : ''}${s === 'late' ? ' · late' : ''}`;
  }
  async function cards() {
    setBusy(true);
    try {
      const codes = newChampionCodes(data.champions);
      if (Object.keys(codes).length) await setChampionFields(org.id, Object.fromEntries(Object.entries(codes).map(([id, code]) => [id, { code }])));
      const list = data.champions.filter((c) => c.status === 'active').map((c) => ({ name: c.name, code: c.code || codes[c.id]!, role: c.duty ? `Child Champion · ${c.duty}` : 'Child Champion' }));
      downloadFile(await qrCardsPdf(org, list, 'champion-cards'));
    } catch (err) { fail(err); } finally { setBusy(false); }
  }

  return (
    <>
      <div className="chips">
        <button type="button" className="btn btn-primary" onClick={() => setScan(!scan)}>📷 Scan champion cards</button>
        {manager && <button type="button" className="btn" disabled={busy} onClick={() => void cards()}>🪪 Champion QR cards</button>}
      </div>
      {scan && <DoorScan onCode={scanned} onClose={() => setScan(false)} />}
      <section className="card hr-top">
        <RegisterCalendar value={date} onChange={setDate} marked={markedDays} today={today} />
        <div className="stack">
          <h2>{formatDateKey(date)}</h2>
          {day && <CleanupButton orgId={org.id} kind="championDay" id={date} label="Reset this day" />}
          <div className="hr-counts">
            <span><b>{rate.present}</b> came</span>
            <span><b>{Object.values(marks).filter((e) => e.s === 'late').length}</b> late</span>
            <span><b>{rate.absent}</b> absent</span>
            <span><b>{rate.excused}</b> excused</span>
          </div>
          {rate.pct != null && <p className="lead">{rate.pct}% came{totalMinutes ? ` · ${hoursText(totalMinutes)} served` : ''}</p>}
          {manager && unmarked.length > 0 && Object.keys(marks).length > 0 && (
            <button type="button" className="btn btn-quiet align-start" onClick={() => { markMany(org.id, 'championDays', date, Object.fromEntries(unmarked.map((x) => [x.id, { s: 'absent', in: null, out: null, duty: x.duty || null, r: null }]))).catch(fail); }}>
              Mark the {unmarked.length} not marked as absent
            </button>
          )}
          {!manager && <p className="small muted">Only the Director or an admin marks this register.</p>}
        </div>
      </section>

      {data.loading ? <p className="muted">Loading…</p> : list.length === 0 ? (
        <div className="card"><p>No champions yet.{manager && <> <button type="button" className="btn btn-quiet" onClick={onAdd}>Add the champions</button></>}</p></div>
      ) : (
        <ul className="hr-list">
          {list.map((x) => {
            const e = marks[x.id];
            const sum = championSummary(x.id, data.days);
            const mins = minutesBetween(e?.in, e?.out);
            return (
              <li key={x.id} className={`card hr-row${e ? ` m-${e.s}` : ''}`}>
                <div className="hr-who">
                  <Avatar name={x.name} />
                  <div><b>{x.name}</b><span className="small muted"> {x.duty}</span></div>
                  <PctBadge pct={sum.rate.pct} />
                </div>
                <div className="hr-marks" role="group" aria-label={`Mark ${x.name}`}>
                  {CHAMPION_MARKS.map((s) => (
                    <button key={s} type="button" disabled={!manager} aria-pressed={e?.s === s} className={`hr-mark c-${s}${e?.s === s ? ' on' : ''}`} onClick={() => mark(x, s)}>{CHAMPION_MARK_LABELS[s]}</button>
                  ))}
                </div>
                {e && (e.s === 'present' || e.s === 'late') && (
                  <div className="hr-fields">
                    <label className="hr-inline"><span>Time in</span><input type="time" disabled={!manager} defaultValue={e.in ?? ''} key={`i${date}${e.in}`} onBlur={(ev) => ev.target.value !== (e.in ?? '') && mark(x, e.s, { in: ev.target.value || null })} /></label>
                    <label className="hr-inline"><span>Time out</span><input type="time" disabled={!manager} defaultValue={e.out ?? ''} key={`o${date}${e.out}`} onBlur={(ev) => ev.target.value !== (e.out ?? '') && mark(x, e.s, { out: ev.target.value || null })} /></label>
                    {date === today && !e.out && manager && <button type="button" className="btn btn-quiet" onClick={() => mark(x, e.s, { out: nowTime() })}>Check out now</button>}
                    {mins != null && <span className="small muted">{hoursText(mins)}</span>}
                    <label className="hr-inline grow"><span>Duty</span><input disabled={!manager} maxLength={80} defaultValue={e.duty ?? ''} key={`d${date}${e.duty}`} placeholder="Teaching, kitchen, football…" onBlur={(ev) => ev.target.value.trim() !== (e.duty ?? '') && mark(x, e.s, { duty: ev.target.value.trim() || null })} /></label>
                  </div>
                )}
                {e && (
                  <label className="hr-inline grow"><span>{e.s === 'excused' ? 'Reason' : 'Notes'}</span>
                    <input disabled={!manager} maxLength={200} defaultValue={e.r ?? ''} key={`r${date}${e.r}`} placeholder={e.s === 'excused' ? 'Why they could not come' : 'Anything to remember'} onBlur={(ev) => ev.target.value.trim() !== (e.r ?? '') && mark(x, e.s, { r: ev.target.value.trim() || null })} />
                  </label>
                )}
              </li>
            );
          })}
        </ul>
      )}
      <TrendCard title="Champions' attendance as time goes" trend={dayTrend(data.days)} />
      <p className="small muted">Late counts as came. Excused days are not held against a champion.</p>
    </>
  );
}

const EMPTY: ChampionInput = { name: '', phone: '', email: '', duty: '', status: 'active', joinedOn: null };

function ChampionList({ org, today, data, manager }: { org: Organization; today: string; data: Data; manager: boolean }) {
  const toast = useToast();
  const [editing, setEditing] = useState<string | 'new' | null>(null);
  const [form, setForm] = useState<ChampionInput>(EMPTY);
  const [showLeft, setShowLeft] = useState(false);
  const [error, setError] = useState('');
  const rows = data.champions.filter((x) => showLeft || x.status === 'active');
  // Appreciation per week, or a fixed amount a month, and this month's extra amounts (Andy, 2026-11-05).
  const pay = useChampionPay(org.id);
  const month = today.slice(0, 7);
  const [amount, setAmount] = useState('');
  const [fixed, setFixed] = useState(false);
  const [extra, setExtra] = useState({ amount: '', reason: '' });
  const mine = pay.extras.filter((x) => x.championId === editing && x.month === month);
  const kes = (n: number) => `KES ${n.toLocaleString('en-KE')}`;
  const MONTH_NAME = new Intl.DateTimeFormat('en-GB', { month: 'long', timeZone: 'UTC' }).format(new Date(`${month}-15T12:00:00Z`));

  function open(x: Champion | null) {
    setError('');
    setEditing(x ? x.id : 'new');
    setForm(x ? { name: x.name, phone: x.phone, email: x.email, duty: x.duty, status: x.status, joinedOn: x.joinedOn } : { ...EMPTY, joinedOn: today });
    setFixed(!!x?.monthlyPay);
    setAmount(x?.monthlyPay ? String(x.monthlyPay) : x?.weeklyPay ? String(x.weeklyPay) : '');
    setExtra({ amount: '', reason: '' });
  }
  function addExtra() {
    const n = Math.round(Number(extra.amount.replace(/[^\d.]/g, '')));
    if (!editing || editing === 'new' || !(n > 0) || extra.reason.trim().length < 2) { toast.show('Type the amount and the reason.'); return; }
    addChampionExtra(org.id, editing, month, n, extra.reason).catch((err) => toast.show(friendlyError(err)));
    setExtra({ amount: '', reason: '' });
    toast.show('Extra amount added');
  }
  function submit(e: FormEvent) {
    e.preventDefault();
    const n = amount.trim() === '' ? null : Math.round(Number(amount.replace(/[^\d.]/g, '')));
    if (n != null && !Number.isFinite(n)) return setError('The appreciation amount does not look right.');
    const clean = { ...form, name: form.name.trim().slice(0, 120), phone: form.phone.trim().slice(0, 30), email: form.email.trim().slice(0, 120), duty: form.duty.trim().slice(0, 80), joinedOn: form.joinedOn || null,
      weeklyPay: fixed ? null : n, monthlyPay: fixed ? n : null };
    if (clean.name.length < 2) return setError('Enter the champion\'s name.');
    if (clean.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(clean.email)) return setError('The email does not look right.');
    try {
      if (editing === 'new') addChampion(org.id, clean);
      else if (editing) updateChampion(org.id, editing, clean).catch((err) => toast.show(friendlyError(err)));
      toast.show('Saved');
      setEditing(null);
    } catch (err) { toast.show(friendlyError(err)); }
  }

  const formCard = (
    <form className="card form" onSubmit={submit} noValidate>
      <h2>{editing === 'new' ? 'Add a champion' : 'Edit champion'}</h2>
      <label className="field"><span>Name</span><input value={form.name} maxLength={120} onChange={(e) => setForm({ ...form, name: e.target.value })} /></label>
      <div className="field-row">
        <label className="field"><span>Phone</span><input inputMode="tel" value={form.phone} maxLength={30} onChange={(e) => setForm({ ...form, phone: e.target.value })} /></label>
        <label className="field"><span>Email</span><input type="email" value={form.email} maxLength={120} onChange={(e) => setForm({ ...form, email: e.target.value })} /></label>
      </div>
      <div className="field-row">
        <label className="field"><span>Usual duty</span><input value={form.duty} maxLength={80} placeholder="Football coach, teacher, kitchen…" onChange={(e) => setForm({ ...form, duty: e.target.value })} /></label>
        <label className="field"><span>Joined on</span><input type="date" value={form.joinedOn ?? ''} max={today} onChange={(e) => setForm({ ...form, joinedOn: e.target.value || null })} /></label>
      </div>
      <div className="field-row">
        <label className="field"><span>Appreciation (KES)</span><input inputMode="numeric" value={amount} placeholder="1200" onChange={(e) => setAmount(e.target.value)} /></label>
        <label className="field"><span>Paid</span>
          <select value={fixed ? 'month' : 'week'} onChange={(e) => setFixed(e.target.value === 'month')}>
            <option value="week">Per week they come</option>
            <option value="month">Fixed, per month</option>
          </select>
        </label>
      </div>
      {editing && editing !== 'new' && (
        <fieldset className="stack cp-extras">
          <legend>Extra amounts for {MONTH_NAME}</legend>
          {mine.length > 0 && (
            <ul className="link-list">{mine.map((x) => <li key={x.id}><span className="grow"><b>{kes(x.amount)}</b><span className="small muted">{x.reason}</span></span>
              <button type="button" className="btn btn-quiet btn-small" onClick={() => removeChampionExtra(org.id, x.id).catch((err) => toast.show(friendlyError(err)))}>Remove</button></li>)}</ul>
          )}
          <div className="field-row">
            <label className="field"><span>Amount (KES)</span><input inputMode="numeric" value={extra.amount} placeholder="500" onChange={(e) => setExtra({ ...extra, amount: e.target.value })} /></label>
            <label className="field"><span>Reason</span><input maxLength={200} value={extra.reason} placeholder="Transport for the trip, extra day…" onChange={(e) => setExtra({ ...extra, reason: e.target.value })} /></label>
          </div>
          <button type="button" className="btn align-start" onClick={addExtra}>+ Add extra amount</button>
        </fieldset>
      )}
      {editing !== 'new' && <label className="check"><input type="checkbox" checked={form.status === 'left'} onChange={(e) => setForm({ ...form, status: e.target.checked ? 'left' : 'active' })} /><span>No longer serving (kept in the records)</span></label>}
      {error && <p className="error" role="alert">{error}</p>}
      <div className="chips"><button type="submit" className="btn btn-primary">Save</button><button type="button" className="btn btn-quiet" onClick={() => setEditing(null)}>Cancel</button></div>
    </form>
  );

  return (
    <>
      {manager && !editing && <button type="button" className="btn btn-primary align-start" onClick={() => open(null)}>Add a champion</button>}
      {editing === 'new' && formCard}
      <label className="check"><input type="checkbox" checked={showLeft} onChange={(e) => setShowLeft(e.target.checked)} /><span>Show champions who no longer serve</span></label>
      {rows.length === 0 ? <div className="card"><p className="muted">No champions yet.</p></div> : (
        <ul className="link-list">
          {rows.map((x) => {
            const s = championSummary(x.id, data.days);
            return editing === x.id ? <li key={x.id}>{formCard}</li> : (
              <li key={x.id}>
                <div className="hr-who">
                  <Avatar name={x.name} />
                  <div>
                    <span className="link-title">{x.name}{x.status === 'left' && <span className="badge badge-muted">No longer serving</span>}</span>
                    <span className="link-detail">{[x.duty, x.phone, x.email, x.monthlyPay ? `${kes(x.monthlyPay)} a month` : x.weeklyPay ? `${kes(x.weeklyPay)} a week` : ''].filter(Boolean).join(' · ') || 'No details yet'}</span>
                    <span className="link-detail">{s.rate.marked ? `${s.rate.present} of ${s.rate.present + s.rate.absent} days · ${s.late} late · ${s.hours} hours served` : 'Not marked yet'}</span>
                  </div>
                  <PctBadge pct={s.rate.pct} />
                  {manager && <button type="button" className="btn btn-quiet" onClick={() => open(x)}>Edit</button>}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </>
  );
}

function ChampionUpload({ org, today, existing, done }: { org: Organization; today: string; existing: ExistingChampion[]; done: () => void }) {
  const toast = useToast();
  const [plan, setPlan] = useState<ChampionImportRow[] | null>(null);
  const [error, setError] = useState('');
  const ready = plan?.filter((r) => !r.skip) ?? [];
  const updates = ready.filter((r) => r.updateId).length;
  const adds = ready.length - updates;
  const payText = (r: ChampionImportRow) => (r.monthlyPay != null ? `KES ${r.monthlyPay.toLocaleString('en-KE')} a month, fixed` : r.weeklyPay != null ? `KES ${r.weeklyPay.toLocaleString('en-KE')} a week` : '');
  return (
    <section className="card stack">
      <h2>Upload champions from Excel or CSV</h2>
      <p className="small">Choose your list: a name column and, if you have them, phone and weekly amount. New names are added; champions already here are updated. Or download a template.</p>
      <TemplateButtons name="Hope-champions-template" head={CHAMPION_TEMPLATE_HEAD} example={CHAMPION_TEMPLATE_EXAMPLE} />
      <SheetPicker onRows={(rows) => { const p = planChampionImport(rows, existing, today); setError(p ? '' : 'No "Name" column was found. Use the template\'s headings.'); setPlan(p); }} />
      {error && <p className="error" role="alert">{error}</p>}
      {plan && (
        <>
          <p><b>{adds}</b> to add, <b>{updates}</b> to update{plan.length > ready.length ? `, ${plan.length - ready.length} unchanged or skipped` : ''}.</p>
          <ul className="link-list">
            {plan.slice(0, 150).map((r) => <li key={r.line}><div><span className="link-title">{r.name || `Row ${r.line}`}</span><span className="link-detail">{r.skip ? (r.skip === 'already up to date' ? 'Already up to date' : `Skipped: ${r.skip}`)
              : r.updateId ? `Update: ${r.changes.join(' · ')}` : `New · ${[r.phone, r.email, r.duty, payText(r)].filter(Boolean).join(' · ')}`}</span></div></li>)}
          </ul>
          <button type="button" className="btn btn-primary align-start" disabled={!ready.length} onClick={() => {
            importChampions(org.id, ready).catch((err) => toast.show(friendlyError(err)));
            toast.show(`${adds} added, ${updates} updated`);
            setPlan(null); done();
          }}>Save {ready.length} {ready.length === 1 ? 'champion' : 'champions'}</button>
        </>
      )}
    </section>
  );
}
