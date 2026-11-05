import { useEffect, useState, type ChangeEvent, type ReactNode } from 'react';
import { takeSheet } from '../../lib/pendingUpload';
import { formatDateKey } from '../../../functions/src/shared/datetime';
import { monthGrid, shiftMonth, STREAK_SHOWN } from '../../../functions/src/shared/hopeRegister';
import { LineChart } from '../../components/charts';
import { readSpreadsheetSheets } from '../../lib/statementFile';
import { toCsv } from '../../lib/analytics';

const MONTH = new Intl.DateTimeFormat('en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' });
const short = (d: string) => new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' }).format(new Date(`${d}T12:00:00Z`));

/** A month calendar (Andy 5A): Saturdays stand out, days with a register have a dot, tap a day to open it. */
export function RegisterCalendar({ value, onChange, marked, today }: { value: string; onChange: (d: string) => void; marked: ReadonlySet<string>; today: string }) {
  const [month, setMonth] = useState(value.slice(0, 7));
  const weeks = monthGrid(month);
  return (
    <div className="hr-cal" role="group" aria-label="Pick a day">
      <div className="hr-cal-head">
        <button type="button" className="btn btn-quiet" aria-label="Previous month" onClick={() => setMonth(shiftMonth(month, -1))}>‹</button>
        <b>{MONTH.format(new Date(`${month}-01T12:00:00Z`))}</b>
        <button type="button" className="btn btn-quiet" aria-label="Next month" disabled={month >= today.slice(0, 7)} onClick={() => setMonth(shiftMonth(month, 1))}>›</button>
      </div>
      <div className="hr-cal-grid">
        {['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su'].map((d) => <span key={d} className={`hr-cal-dow${d === 'Sa' ? ' sat' : ''}`}>{d}</span>)}
        {weeks.flat().map((d, i) => d ? (
          <button key={d} type="button" disabled={d > today} aria-pressed={d === value} aria-label={`${formatDateKey(d)}${marked.has(d) ? ', register taken' : ''}`}
            className={`hr-cal-day${i % 7 === 5 ? ' sat' : ''}${d === value ? ' on' : ''}${marked.has(d) ? ' has' : ''}${d === today ? ' today' : ''}`}
            onClick={() => onChange(d)}>{Number(d.slice(8))}</button>
        ) : <span key={`x${i}`} />)}
      </div>
    </div>
  );
}

/** The centre's attendance percentage on each register day. */
export function TrendCard({ title, trend }: { title: string; trend: { date: string; pct: number | null; came: number }[] }) {
  if (trend.length < 2) return null;
  return (
    <details className="card hr-fold">
      <summary><h2>{title}</h2><span className="small muted">{trend[trend.length - 1]!.pct ?? '–'}% on the latest day</span></summary>
      <TrendChart label={title} trend={trend} />
    </details>
  );
}
export function TrendChart({ label, trend }: { label: string; trend: { date: string; pct: number | null }[] }) {
  return <LineChart label={label} labels={trend.map((t) => short(t.date))} series={[{ name: 'Attendance %', values: trend.map((t) => t.pct) }]} format={(v) => `${Math.round(v)}%`} axis={(v) => `${Math.round(v)}%`} height={170} />;
}

/** A soft "tick" when a child is marked present (Andy 8A). Quiet, short, and skipped where sound can't play. */
export function tick() {
  try {
    const W = window as unknown as { AudioContext?: typeof AudioContext; webkitAudioContext?: typeof AudioContext; __hrAudio?: AudioContext };
    const Ctx = W.AudioContext ?? W.webkitAudioContext;
    if (!Ctx) return;
    const ctx = W.__hrAudio ?? (W.__hrAudio = new Ctx());
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = 'sine';
    o.frequency.setValueAtTime(880, ctx.currentTime);
    o.frequency.exponentialRampToValueAtTime(1320, ctx.currentTime + 0.06);
    g.gain.setValueAtTime(0.0001, ctx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.12, ctx.currentTime + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.14);
    o.connect(g).connect(ctx.destination);
    o.start();
    o.stop(ctx.currentTime + 0.15);
  } catch { /* no sound on this device */ }
}

/** "86%" with a colour: green from 75%, amber from 50%, red below. */
export function PctBadge({ pct }: { pct: number | null }) {
  if (pct == null) return <span className="badge badge-muted">New</span>;
  return <span className={`badge hr-pct ${pct >= 75 ? 'ok' : pct >= 50 ? 'mid' : 'low'}`} title="Attendance">{pct}%</span>;
}

export const nowTime = () => new Date().toTimeString().slice(0, 5);

/** Makes a small JPEG from a photo or camera picture, so it fits in the record. */
export async function shrinkPhoto(file: File, size = 320): Promise<string> {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((ok, fail) => { const i = new Image(); i.onload = () => ok(i); i.onerror = () => fail(new Error('That picture could not be read. Try another photo.')); i.src = url; });
    const scale = Math.min(1, size / Math.max(img.width, img.height));
    const c = document.createElement('canvas');
    c.width = Math.round(img.width * scale); c.height = Math.round(img.height * scale);
    c.getContext('2d')!.drawImage(img, 0, 0, c.width, c.height);
    return c.toDataURL('image/jpeg', 0.75);
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** A round photo, or the child's initials. */
export function Avatar({ photo, name, size = 40 }: { photo?: string | null; name: string; size?: number }) {
  const initials = name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]!.toUpperCase()).join('');
  return photo
    ? <img className="hr-avatar" src={photo} alt="" width={size} height={size} />
    : <span className="hr-avatar hr-avatar-none" style={{ width: size, height: size }} aria-hidden="true">{initials}</span>;
}

function save(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = name; a.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** The two templates (Andy 11A): CSV and Excel, with one example row. */
export function TemplateButtons({ name, head, example }: { name: string; head: string[]; example: string[] }) {
  async function excel() {
    const { default: writeXlsxFile } = await import('write-excel-file');
    const rows = [head.map((value) => ({ value, fontWeight: 'bold' as const })), example.map((value) => ({ value, type: String }))];
    const blob = await writeXlsxFile(rows, { columns: head.map(() => ({ width: 20 })) }) as unknown as Blob;
    save(blob, `${name}.xlsx`);
  }
  return (
    <div className="chips">
      <button type="button" className="btn" onClick={() => void excel()}>Excel template</button>
      <button type="button" className="btn" onClick={() => save(new Blob(['﻿', toCsv(head, [example])], { type: 'text/csv;charset=utf-8' }), `${name}.csv`)}>CSV template</button>
    </div>
  );
}

/** Choose an Excel (.xlsx) or CSV file; every sheet's rows are handed back together. */
export function SheetPicker({ onRows, children, kind, ready = true }: { onRows: (rows: (string | number | Date | null)[][], fileName: string) => void; children?: ReactNode; kind?: string; ready?: boolean }) {
  const [error, setError] = useState('');
  // A file chosen on the one Upload page opens here already read (v182, 7A).
  useEffect(() => {
    const held = kind && ready ? takeSheet(kind) : null;
    if (held) onRows(held.rows, held.fileName);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kind, ready]);
  async function choose(e: ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    e.target.value = '';
    if (!f) return;
    setError('');
    try {
      const sheets = await readSpreadsheetSheets(f);
      onRows(sheets.flatMap((s) => s.rows), f.name);
    } catch (err) {
      const msg = err instanceof Error ? err.message : '';
      setError(/cell value|xml|zip/i.test(msg) || !msg ? 'That file could not be read. Save it as .xlsx or CSV and choose it again.' : msg);
    }
  }
  return (
    <div className="stack">
      <label className="btn btn-primary align-start">{children ?? 'Choose the filled-in file'}<input type="file" hidden accept=".xlsx,.csv,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" onChange={(e) => void choose(e)} /></label>
      {error && <p className="error" role="alert">{error}</p>}
    </div>
  );
}

/** 🎈 in a child's birthday week, 🔥 with the number of Saturdays in a row they came (from 4). */
export function Delights({ birthday, streak }: { birthday: boolean; streak: number }) {
  return (
    <>
      {birthday && <span className="hr-delight" title="Birthday this week" aria-label="Birthday this week">🎈</span>}
      {streak >= STREAK_SHOWN && <span className="hr-delight hr-streak" title={`Came ${streak} Saturdays in a row`} aria-label={`Came ${streak} times in a row`}>🔥{streak}</span>}
    </>
  );
}
