import { useState, type FormEvent, type ReactNode } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useAuth } from '../../state/AuthContext';
import { useToast } from '../../state/ToastContext';
import { useChampions } from '../../state/useHope';
import { friendlyError } from '../../lib/errors';
import { markChampion, markMany, type ChampionInput } from '../../lib/hopeWrites';
import { championChange, saveChampionChanges } from '../../lib/championEdit';
import { useTwoSignatures } from '../../components/TwoSignatures';
import { useChampionPay } from '../../state/useHope';
import { isChampionManager } from '../../../functions/src/shared/hopeChampionPay';
import {
  CHAMPION_TEMPLATE_EXAMPLE, CHAMPION_TEMPLATE_HEAD, championSummary, dayTrend, hoursText, minutesBetween,
  planChampionImport, saturdayOnOrBefore, type Champion, type ChampionEntry, type ChampionImportRow, type ChampionMark,
} from '../../../functions/src/shared/hopeRegister';
import { useHopePage } from './common';
import { RemoveDialog } from '../../components/CleanupDialog';
import { cameOf, useCanReset, countMarks, Empty, Field, Frame, MoreMenu, RegRow, RgIcon, SessionStrip, sessionDays, SubTabs, SummaryBand, Toolbar, type Chip, type MenuItem, type RgStatus } from './RegisterKit';
import { Avatar, nowTime, PctBadge, SheetPicker, TemplateButtons, TrendCard } from './registerParts';
import type { Organization } from '../../state/OrgContext';
import { ChampionPay } from './ChampionPay';
import { DoorScan } from './DoorScan';
import { qrCardsPdf } from '../../lib/hopeAttendanceFiles';
import { downloadFile } from '../../lib/givingPdf';
import { setChampionCodes } from '../../lib/hopeWrites';
import { arrivalMark, newChampionCodes } from '../../../functions/src/shared/hopeChampionPay';


type Tab = 'register' | 'people' | 'pay' | 'upload';

/**
 * The Child Champions register (Andy, 2026-11-04): the people who teach and serve the Hope Centre children.
 * The Director or an admin marks it (6A). Calm layout from the Registers brief (2026-11-06): Register, The champions
 * and Pay are quiet underline tabs; Upload from Excel and Scan champion cards sit in the header; Champion QR cards
 * and Reset this day are in the "..." menu.
 */
export function ChampionsPanel({ org, ptabs }: { org: Organization; ptabs?: ReactNode }) {
  const h = useHopePage(org);
  const { profile } = useAuth();
  const c = useChampions(org.id);
  const manager = isChampionManager(profile, org.id);
  const [params] = useSearchParams();
  const [tab, setTab] = useState<Tab>(() => (manager && (params.get('tab') === 'pay' || params.get('tab') === 'upload') ? params.get('tab') as Tab : 'register'));
  const subs: { id: Tab; label: string }[] = [{ id: 'register', label: 'Register' }, { id: 'people', label: 'The champions' }, ...(manager ? [{ id: 'pay' as Tab, label: 'Pay' }] : [])];
  const subtabs = <SubTabs value={tab} options={subs} onChange={setTab} />;
  const upload = manager && <button type="button" className="btn rg-ghost" aria-pressed={tab === 'upload'} onClick={() => setTab('upload')}><RgIcon name="up" />Upload from Excel</button>;
  if (tab === 'register') return <ChampionRegister org={org} today={h.today} data={c} manager={manager} onAdd={() => setTab(manager ? 'people' : 'register')} ptabs={ptabs} subtabs={subtabs} upload={upload} />;
  return (
    <Frame ptabs={ptabs} subtabs={subtabs} actions={upload}>
      {tab === 'people' && <ChampionList org={org} today={h.today} data={c} manager={manager} />}
      {tab === 'pay' && manager && <ChampionPay org={org} today={h.today} data={c} />}
      {tab === 'upload' && manager && <ChampionUpload org={org} today={h.today} existing={c.champions} ready={!c.loading} done={() => setTab('people')} />}
    </Frame>
  );
}

type Data = ReturnType<typeof useChampions>;

function ChampionRegister({ org, today, data, manager, onAdd, ptabs, subtabs, upload }: {
  org: Organization; today: string; data: Data; manager: boolean; onAdd: () => void; ptabs?: ReactNode; subtabs: ReactNode; upload: ReactNode;
}) {
  const toast = useToast();
  const [date, setDate] = useState(() => saturdayOnOrBefore(today));
  const [q, setQ] = useState('');
  const [only, setOnly] = useState(false);
  const [chip, setChip] = useState('all');
  const [resetting, setResetting] = useState(false);
  const canReset = useCanReset(org.id);
  const fail = (err: unknown) => toast.show(friendlyError(err));
  const day = data.days.find((d) => d.date === date);
  const marks = day?.marks ?? {};
  const onReg = (d: string, m: Record<string, unknown>) => data.champions.filter((x) => m[x.id] || (x.status === 'active' && (!x.joinedOn || x.joinedOn <= d)));
  const everyone = onReg(date, marks);
  const dutyOf = (x: Champion) => (marks[x.id]?.duty || x.duty || '').trim();
  const duties = [...new Set(everyone.map(dutyOf).filter(Boolean))].sort();
  const chips: Chip[] = [{ id: 'all', label: 'All', count: everyone.length }, ...duties.map((d) => ({ id: d, label: d, count: everyone.filter((x) => dutyOf(x) === d).length }))];
  const group = chip === 'all' || duties.includes(chip) ? chip : 'all';
  const inGroup = everyone.filter((x) => group === 'all' || dutyOf(x) === group);
  const counts = countMarks(inGroup.map((x) => x.id), marks);
  const text = q.trim().toLowerCase();
  const list = inGroup.filter((x) => (!only || !marks[x.id]) && (!text || x.name.toLowerCase().includes(text) || (x.code ?? '').toLowerCase().includes(text)));
  const totalMinutes = Object.values(marks).reduce((n, e) => n + (minutesBetween(e.in, e.out) ?? 0), 0);
  const pctOf = (d: string) => {
    const m = data.days.find((x) => x.date === d)?.marks ?? {};
    return Object.keys(m).length ? cameOf(countMarks(onReg(d, m).map((x) => x.id), m)) : null;
  };

  function mark(x: Champion, s0: ChampionMark | null, extra: Partial<ChampionEntry> = {}) {
    if (!s0) { markChampion(org.id, date, x.id, null).catch(fail); return; }
    const old = marks[x.id];
    let s = s0;
    // Checking someone in now marks them late after 8:30am (Andy, 2026-11-05, 12).
    if (s === 'present' && !old && date === today) s = arrivalMark(nowTime());
    const there = s === 'present' || s === 'late';
    // Time in fills in only when marking on the day itself (brief).
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
      if (Object.keys(codes).length) await setChampionCodes(org.id, codes);
      const list = data.champions.filter((c) => c.status === 'active').map((c) => ({ name: c.name, code: c.code || codes[c.id]!, role: c.duty ? `Child Champion · ${c.duty}` : 'Child Champion' }));
      downloadFile(await qrCardsPdf(org, list, 'champion-cards'));
    } catch (err) { fail(err); } finally { setBusy(false); }
  }
  function bulkAbsent() {
    const ids = inGroup.filter((x) => !marks[x.id]);
    markMany(org.id, 'championDays', date, Object.fromEntries(ids.map((x) => [x.id, { s: 'absent', in: null, out: null, duty: x.duty || null, r: null }]))).catch(fail);
  }

  const menu: MenuItem[] = [];
  if (manager) menu.push({ label: busy ? 'Making the cards…' : 'Champion QR cards', hint: 'A PDF of cards to print', onClick: () => { if (!busy) void cards(); } });
  if (canReset && day && Object.keys(marks).length) menu.push({ label: 'Reset this day', hint: 'Moves every mark for this day to the Bin', danger: true, onClick: () => setResetting(true) });
  const actions = (
    <>
      {upload}
      <button type="button" className="btn btn-primary" aria-pressed={scan} onClick={() => setScan(!scan)}><RgIcon name="cam" />Scan champion cards</button>
      <MoreMenu items={menu} />
    </>
  );
  const hours = totalMinutes ? ` · ${hoursText(totalMinutes)} served` : '';

  return (
    <Frame date={date} actions={actions} ptabs={ptabs} subtabs={subtabs}>
      {scan && <DoorScan onCode={scanned} onClose={() => setScan(false)} />}
      <SessionStrip days={sessionDays(saturdayOnOrBefore(today), 6, [date])} value={date} onChange={setDate} pctOf={pctOf} today={today} />
      <SummaryBand title={`${group === 'all' ? 'All champions' : group}${hours}`} counts={counts} onBulk={manager ? bulkAbsent : undefined}
        note={manager ? undefined : 'Only the Director or an admin marks this register.'} />
      <Toolbar q={q} onQ={setQ} placeholder="Search champions" only={only} onOnly={setOnly} chips={chips} chip={group} onChip={setChip} chipsLabel="Filter by duty" />

      {data.loading ? <p className="muted">Loading…</p> : everyone.length === 0 ? (
        <div className="card"><Empty title="No champions yet">{manager && <button type="button" className="btn rg-ghost rg-sm" onClick={onAdd}>Add the champions</button>}</Empty></div>
      ) : list.length === 0 ? (
        <div className="card"><Empty title={only && !q ? 'Everyone is marked' : 'No match'}>{only && !q ? 'Nothing left to do in this view.' : 'Try a different name or filter.'}</Empty></div>
      ) : (
        <ul className="card rg-list">
          {list.map((x) => {
            const e = marks[x.id];
            const sum = championSummary(x.id, data.days);
            const mins = minutesBetween(e?.in, e?.out);
            const there = e && (e.s === 'present' || e.s === 'late');
            const sub = [dutyOf(x), sum.rate.pct != null ? `${sum.rate.pct}%` : null, there && e.in ? `in ${e.in}${e.out ? `, out ${e.out}` : ''}` : null].filter(Boolean).join(' · ');
            return (
              <RegRow key={x.id} name={x.name} sub={sub} status={(e?.s as RgStatus | undefined) ?? null} disabled={!manager} onMark={(s) => mark(x, s)}
                details={!e ? undefined : (
                  <>
                    {there && <Field label="Time in"><input type="time" disabled={!manager} defaultValue={e.in ?? ''} key={`i${date}${e.in}`} onBlur={(ev) => ev.target.value !== (e.in ?? '') && mark(x, e.s, { in: ev.target.value || null })} /></Field>}
                    {there && <Field label="Time out"><input type="time" disabled={!manager} defaultValue={e.out ?? ''} key={`o${date}${e.out}`} onBlur={(ev) => ev.target.value !== (e.out ?? '') && mark(x, e.s, { out: ev.target.value || null })} /></Field>}
                    {there && date === today && !e.out && manager && <button type="button" className="btn rg-ghost rg-sm" onClick={() => mark(x, e.s, { out: nowTime() })}>Check out now</button>}
                    {there && mins != null && <span className="small muted">{hoursText(mins)}</span>}
                    {there && <Field label="Duty"><input disabled={!manager} maxLength={80} defaultValue={e.duty ?? ''} key={`d${date}${e.duty}`} placeholder="Teaching, kitchen, football…" onBlur={(ev) => ev.target.value.trim() !== (e.duty ?? '') && mark(x, e.s, { duty: ev.target.value.trim() || null })} /></Field>}
                    <Field label="Notes" wide><input disabled={!manager} maxLength={200} defaultValue={e.r ?? ''} key={`r${date}${e.r}`} placeholder={e.s === 'excused' ? 'Why they could not come' : 'Anything to remember'} onBlur={(ev) => ev.target.value.trim() !== (e.r ?? '') && mark(x, e.s, { r: ev.target.value.trim() || null })} /></Field>
                  </>
                )} />
            );
          })}
        </ul>
      )}
      <div className="rg-trend"><TrendCard title="Champions' attendance as time goes" trend={dayTrend(data.days)} /></div>
      <p className="rg-foot">Late counts as came. Excused days are not held against a champion.</p>
      <RemoveDialog orgId={org.id} items={[{ kind: 'championDay', id: date }]} open={resetting} onClose={() => setResetting(false)} onDone={() => setResetting(false)} />
    </Frame>
  );
}

const EMPTY: ChampionInput = { name: '', phone: '', email: '', duty: '', status: 'active', joinedOn: null };

function ChampionList({ org, today, data, manager }: { org: Organization; today: string; data: Data; manager: boolean }) {
  const toast = useToast();
  const { sign, dialog } = useTwoSignatures(org.id);
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
    const id = editing, reason = extra.reason.trim();
    sign(`Add ${kes(n)} for ${form.name || 'this champion'}.`, (proofs) => saveChampionChanges(org.id, proofs, { addExtras: [{ championId: id, month, amount: n, reason }] })
      .then(() => { setExtra({ amount: '', reason: '' }); toast.show('Extra amount added'); }));
  }
  function submit(e: FormEvent) {
    e.preventDefault();
    const n = amount.trim() === '' ? null : Math.round(Number(amount.replace(/[^\d.]/g, '')));
    if (n != null && !Number.isFinite(n)) return setError('The appreciation amount does not look right.');
    const clean = { ...form, name: form.name.trim().slice(0, 120), phone: form.phone.trim().slice(0, 30), email: form.email.trim().slice(0, 120), duty: form.duty.trim().slice(0, 80), joinedOn: form.joinedOn || null,
      weeklyPay: fixed ? null : n, monthlyPay: fixed ? n : null };
    if (clean.name.length < 2) return setError('Enter the champion\'s name.');
    if (clean.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(clean.email)) return setError('The email does not look right.');
    const id = editing === 'new' ? undefined : editing ?? undefined;
    sign(id ? `Change ${clean.name}'s details.` : `Add ${clean.name}.`, (proofs) => saveChampionChanges(org.id, proofs, { champions: [{ ...clean, id }] })
      .then(() => { toast.show('Saved'); setEditing(null); }));
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
              <button type="button" className="btn btn-quiet btn-small" onClick={() => sign(`Remove ${kes(x.amount)} for ${form.name}.`, (proofs) => saveChampionChanges(org.id, proofs, { removeExtras: [x.id] }).then(() => toast.show('Removed')))}>Remove</button></li>)}</ul>
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
      {dialog}
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

function ChampionUpload({ org, today, existing, ready: loaded, done }: { org: Organization; today: string; existing: Champion[]; ready: boolean; done: () => void }) {
  const toast = useToast();
  const { sign, dialog } = useTwoSignatures(org.id);
  const [plan, setPlan] = useState<ChampionImportRow[] | null>(null);
  const [error, setError] = useState('');
  const ready = plan?.filter((r) => !r.skip) ?? [];
  const updates = ready.filter((r) => r.updateId).length;
  const adds = ready.length - updates;
  const payText = (r: ChampionImportRow) => (r.monthlyPay != null ? `KES ${r.monthlyPay.toLocaleString('en-KE')} a month, fixed` : r.weeklyPay != null ? `KES ${r.weeklyPay.toLocaleString('en-KE')} a week` : '');
  return (
    <section className="card stack">
      {dialog}
      <h2>Upload champions from Excel or CSV</h2>
      <p className="small">Choose your list: a name column and, if you have them, phone and weekly amount. New names are added; champions already here are updated. Or download a template.</p>
      <TemplateButtons name="Hope-champions-template" head={CHAMPION_TEMPLATE_HEAD} example={CHAMPION_TEMPLATE_EXAMPLE} />
      <SheetPicker kind="champions" ready={loaded} onRows={(rows) => { const p = planChampionImport(rows, existing, today); setError(p ? '' : 'No "Name" column was found. Use the template\'s headings.'); setPlan(p); }} />
      {error && <p className="error" role="alert">{error}</p>}
      {plan && (
        <>
          <p><b>{adds}</b> to add, <b>{updates}</b> to update{plan.length > ready.length ? `, ${plan.length - ready.length} unchanged or skipped` : ''}.</p>
          <ul className="link-list">
            {plan.slice(0, 150).map((r) => <li key={r.line}><div><span className="link-title">{r.name || `Row ${r.line}`}</span><span className="link-detail">{r.skip ? (r.skip === 'already up to date' ? 'Already up to date' : `Skipped: ${r.skip}`)
              : r.updateId ? `Update: ${r.changes.join(' · ')}` : `New · ${[r.phone, r.email, r.duty, payText(r)].filter(Boolean).join(' · ')}`}</span></div></li>)}
          </ul>
          <button type="button" className="btn btn-primary align-start" disabled={!ready.length} onClick={() => {
            const pay = (r: ChampionImportRow) => (r.monthlyPay != null ? { monthlyPay: r.monthlyPay, weeklyPay: null } : r.weeklyPay != null ? { weeklyPay: r.weeklyPay, monthlyPay: null } : {});
            const champions = ready.map((r) => {
              const old = r.updateId ? existing.find((x) => x.id === r.updateId) : undefined;
              if (old) return championChange(old, { ...(r.phone ? { phone: r.phone } : {}), ...(r.email ? { email: r.email } : {}), ...(r.duty ? { duty: r.duty } : {}), ...pay(r) });
              return { name: r.name, phone: r.phone, email: r.email, duty: r.duty, status: 'active' as const, joinedOn: r.joinedOn, weeklyPay: null, monthlyPay: null, ...pay(r) };
            });
            sign(`Save ${ready.length} champions from the list.`, (proofs) => saveChampionChanges(org.id, proofs, { champions })
              .then(() => { toast.show(`${adds} added, ${updates} updated`); setPlan(null); done(); }));
          }}>Save {ready.length} {ready.length === 1 ? 'champion' : 'champions'}</button>
        </>
      )}
    </section>
  );
}
