/**
 * The calm Registers page (Insight-IQ Registers design brief, 2026-11-06): one primary tab row, a session strip in
 * place of the big calendar, one summary band, a sticky toolbar, and one line per person. These parts are shared by
 * the children's, the Child Champions' and the clubs' registers so all three look and work the same.
 */
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { addDays } from '../../../functions/src/shared/metrics';
import { HOPE_CLASSES, type HopeClass } from '../../../functions/src/shared/hopeClasses';
import { Avatar } from './registerParts';
import { useAuth } from '../../state/AuthContext';
import { canKeepAccounts } from '../../../functions/src/shared/permissions';
import { isHopeDirector } from '../../../functions/src/shared/hopePhotos';
import './registers.css';

export type RgStatus = 'present' | 'late' | 'absent' | 'excused';
export const RG_MARKS: [RgStatus, string][] = [['present', 'Present'], ['late', 'Late'], ['absent', 'Absent'], ['excused', 'Excused']];
const LABEL: Record<string, string> = { present: 'Present', late: 'Late', absent: 'Absent', excused: 'Excused', departing: 'Present', departed: 'Departed' };
/** The four marks shown; Departing (an old mark) counts as Present. */
export const shown = (s: string | undefined): RgStatus | null =>
  s === 'present' || s === 'departing' ? 'present' : s === 'late' || s === 'absent' || s === 'excused' ? s : null;

export interface Counts { present: number; late: number; absent: number; excused: number; none: number; total: number }
export function countMarks(ids: readonly string[], marks: Record<string, { s: string } | undefined>): Counts {
  const c: Counts = { present: 0, late: 0, absent: 0, excused: 0, none: 0, total: ids.length };
  for (const id of ids) {
    const s = shown(marks[id]?.s);
    if (s) c[s] += 1; else c.none += 1;
  }
  return c;
}
/** "% came" is measured against everyone on the register, not only those already marked (brief). */
export const cameOf = (c: Counts) => (c.total ? Math.round(((c.present + c.late) / c.total) * 100) : 0);

/** The last few session days (Saturdays, or a club's day) up to today, plus any day already chosen. */
export function sessionDays(latest: string, n = 6, extra: readonly string[] = []): string[] {
  const days = Array.from({ length: n }, (_, i) => addDays(latest, -7 * (n - 1 - i)));
  return [...new Set([...days, ...extra])].sort();
}

const MON = new Intl.DateTimeFormat('en-GB', { month: 'short', timeZone: 'UTC' });
const LONG = new Intl.DateTimeFormat('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });
export const longDate = (d: string) => LONG.format(new Date(`${d}T12:00:00Z`));

// ---- Page head ---------------------------------------------------------------------------------------

export function RgIcon({ name }: { name: 'cam' | 'up' | 'dots' | 'cal' | 'down' | 'warn' | 'search' }) {
  const p = {
    cam: <><path d="M4 8h3l2-3h6l2 3h3v11H4z" /><circle cx="12" cy="13" r="3.5" /></>,
    up: <path d="M12 16V4M7 9l5-5 5 5M5 20h14" />,
    dots: <><circle cx="5" cy="12" r="1.4" /><circle cx="12" cy="12" r="1.4" /><circle cx="19" cy="12" r="1.4" /></>,
    cal: <><rect x="4" y="5" width="16" height="15" rx="2" /><path d="M8 3v4M16 3v4M4 10h16" /></>,
    down: <path d="M6 9l6 6 6-6" />,
    warn: <><path d="M12 4 2.5 20h19z" /><path d="M12 10v4M12 17v.5" /></>,
    search: <><circle cx="11" cy="11" r="6.5" /><path d="M16 16l4.5 4.5" /></>,
  }[name];
  return <svg className="rg-ic" viewBox="0 0 24 24" aria-hidden="true">{p}</svg>;
}

export interface MenuItem { label: string; hint?: string; danger?: boolean; onClick: () => void }
/** The "..." menu for the actions used less often (Champion QR cards, Reset this day). */
export function MoreMenu({ items }: { items: MenuItem[] }) {
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: Event) => { if (!box.current?.contains(e.target as Node)) setOpen(false); };
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('pointerdown', close);
    document.addEventListener('keydown', esc);
    return () => { document.removeEventListener('pointerdown', close); document.removeEventListener('keydown', esc); };
  }, [open]);
  if (!items.length) return null;
  return (
    <div className="rg-pop" ref={box}>
      <button type="button" className="btn rg-more" aria-label="More actions" aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen(!open)}><RgIcon name="dots" /></button>
      {open && (
        <div className="rg-menu" role="menu">
          {items.map((x, i) => (
            <button key={x.label} type="button" role="menuitem" className={`${x.danger ? 'dng' : ''}${x.danger && i > 0 ? ' sep' : ''}`} onClick={() => { setOpen(false); x.onClick(); }}>
              {x.label}{x.hint && <small>{x.hint}</small>}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export function PrimaryTabs<T extends string>({ value, options, onChange }: { value: T; options: [T, string][]; onChange: (v: T) => void }) {
  if (options.length < 2) return null;
  return (
    <div className="rg-ptabs" role="tablist" aria-label="Which register">
      {options.map(([k, label]) => <button key={k} type="button" role="tab" aria-selected={value === k} onClick={() => onChange(k)}>{label}</button>)}
    </div>
  );
}

/** Quiet underline tabs. A tab with `to` is a link to another page. */
export function SubTabs<T extends string>({ value, options, onChange }: { value: T; options: { id: T; label: string; to?: string }[]; onChange: (v: T) => void }) {
  if (options.length < 2) return null;
  return (
    <div className="rg-stabs" role="tablist">
      {options.map((o) => o.to
        ? <Link key={o.id} to={o.to} className="rg-stab">{o.label}</Link>
        : <button key={o.id} type="button" role="tab" className="rg-stab" aria-selected={value === o.id} onClick={() => onChange(o.id)}>{o.label}</button>)}
    </div>
  );
}

// ---- Session strip -------------------------------------------------------------------------------------

/** The session days with each day's attendance, in place of the big month calendar; "Other date" picks any day. */
export function SessionStrip({ days, value, onChange, pctOf, today }: { days: string[]; value: string; onChange: (d: string) => void; pctOf: (d: string) => number | null; today: string }) {
  const strip = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = strip.current?.querySelector<HTMLElement>('[aria-pressed="true"]');
    if (el && strip.current) strip.current.scrollLeft = el.offsetLeft - 80;
  }, [value]);
  return (
    <div className="rg-strip-wrap">
      <div className="rg-strip" ref={strip} role="group" aria-label="Session days">
        {days.map((d) => {
          const p = pctOf(d);
          return (
            <button key={d} type="button" className="rg-sess" aria-pressed={d === value} aria-label={`${longDate(d)}${p != null ? `, ${p}% came` : ', not marked'}`} onClick={() => onChange(d)}>
              <small>{d === today ? 'Today' : MON.format(new Date(`${d}T12:00:00Z`))}</small>
              <b>{Number(d.slice(8))}</b>
              <span>{p != null ? `${p}%` : '–'}</span>
            </button>
          );
        })}
      </div>
      <label className="btn rg-other">
        <RgIcon name="cal" />Other date
        <input type="date" max={today} value={value} aria-label="Pick another date" onChange={(e) => e.target.value && e.target.value <= today && onChange(e.target.value)} />
      </label>
    </div>
  );
}

// ---- Summary band --------------------------------------------------------------------------------------

/**
 * One summary: came, late, absent, excused, not marked, a progress bar and the percentage. It follows the chosen
 * class or duty chip. "Mark the N not marked as absent" asks first, inline.
 */
export function SummaryBand({ title, counts, showPct = true, onBulk, note }: { title: string; counts: Counts; showPct?: boolean; onBulk?: () => void; note?: ReactNode }) {
  const [asking, setAsking] = useState(false);
  useEffect(() => setAsking(false), [title, counts.none]);
  const came = counts.present + counts.late;
  const pct = cameOf(counts);
  const w = (n: number) => `${counts.total ? (n / counts.total) * 100 : 0}%`;
  return (
    <section className="card rg-band" aria-live="polite">
      <div className="rg-band-top">
        <div><h2>{title}</h2><div className="rg-sub">{came} of {counts.total} here</div></div>
        {showPct && <div className="rg-pct">{pct}%<small>came</small></div>}
      </div>
      <div className="rg-bar" role="img" aria-label={`${came} of ${counts.total} came`}>
        <i style={{ width: w(counts.present), background: 'var(--rg-ok)' }} />
        <i style={{ width: w(counts.late), background: 'var(--rg-late)' }} />
        <i style={{ width: w(counts.absent), background: 'var(--rg-abs)' }} />
        <i style={{ width: w(counts.excused), background: 'var(--rg-exc)' }} />
      </div>
      <div className="rg-stats">
        <div style={{ ['--c' as string]: 'var(--rg-ok)' }}><b>{counts.present}</b><span>came</span></div>
        <div style={{ ['--c' as string]: 'var(--rg-late)' }}><b>{counts.late}</b><span>late</span></div>
        <div style={{ ['--c' as string]: 'var(--rg-abs)' }}><b>{counts.absent}</b><span>absent</span></div>
        <div style={{ ['--c' as string]: 'var(--rg-exc)' }}><b>{counts.excused}</b><span>excused</span></div>
        <div><b>{counts.none}</b><span>not marked</span></div>
      </div>
      {(note || onBulk) && (
        <div className="rg-bulk">
          {note ? <span className="rg-txt">{note}</span>
            : counts.none === 0 ? <span className="rg-txt">Everyone here is marked.</span>
              : asking ? (
                <>
                  <span className="rg-txt"><b>Mark {counts.none} as absent?</b> Anyone already marked stays as they are.</span>
                  <button type="button" className="btn btn-danger rg-sm" onClick={() => { setAsking(false); onBulk?.(); }}>Yes, mark absent</button>
                  <button type="button" className="btn rg-sm" onClick={() => setAsking(false)}>Cancel</button>
                </>
              ) : (
                <>
                  <span className="rg-txt">{counts.none} not marked yet.</span>
                  <button type="button" className="btn rg-ghost rg-sm" onClick={() => setAsking(true)}>Mark the {counts.none} not marked as absent</button>
                </>
              )}
        </div>
      )}
    </section>
  );
}

// ---- Toolbar -------------------------------------------------------------------------------------------

export interface Chip { id: string; label: string; count: number; colour?: string; title?: string }
export type View = 'list' | 'photos';

/** Sticky toolbar: search, All / Not marked, List / Photos, and the filter chips. */
export function Toolbar({ q, onQ, placeholder, only, onOnly, view, onView, chips, chip, onChip, chipsLabel, hideSearch }: {
  q: string; onQ: (v: string) => void; placeholder: string; only: boolean; onOnly: (v: boolean) => void;
  view?: View; onView?: (v: View) => void; chips: Chip[]; chip: string; onChip: (id: string) => void; chipsLabel: string; hideSearch?: boolean;
}) {
  return (
    <div className="rg-tools">
      <div className="rg-trow">
        {!hideSearch && (
          <label className="rg-search"><RgIcon name="search" />
            <input type="search" placeholder={placeholder} aria-label={placeholder} value={q} onChange={(e) => onQ(e.target.value)} />
          </label>
        )}
        <div className="rg-mini" role="group" aria-label="Show">
          <button type="button" aria-pressed={!only} onClick={() => onOnly(false)}>All</button>
          <button type="button" aria-pressed={only} onClick={() => onOnly(true)}>Not marked</button>
        </div>
        {view && onView && (
          <div className="rg-mini" role="group" aria-label="View">
            <button type="button" aria-pressed={view === 'list'} onClick={() => onView('list')}>List</button>
            <button type="button" aria-pressed={view === 'photos'} onClick={() => onView('photos')}>Photos</button>
          </div>
        )}
      </div>
      {chips.length > 1 && (
        <div className="rg-chips" role="group" aria-label={chipsLabel}>
          {chips.map((c) => (
            <button key={c.id} type="button" className="rg-chip" aria-pressed={chip === c.id} title={c.title} onClick={() => onChip(c.id)}>
              {c.colour && <i className="rg-gem" style={{ background: c.colour }} />}{c.label}<em>{c.count}</em>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/** The class chips (precious stones by age), the same on every register. */
export function classChips<T>(rows: readonly T[], classOfRow: (r: T) => HopeClass | null, total = true): Chip[] {
  const chips: Chip[] = total ? [{ id: 'all', label: 'All', count: rows.length }] : [];
  for (const k of HOPE_CLASSES) {
    const n = rows.filter((r) => classOfRow(r)?.id === k.id).length;
    if (n) chips.push({ id: k.id, label: k.name, count: n, colour: k.colour, title: k.to >= 99 ? `Ages ${k.from} and over` : `Ages ${k.from} to ${k.to}` });
  }
  const none = rows.filter((r) => !classOfRow(r)).length;
  if (none) chips.push({ id: 'none', label: 'No birth date', count: none });
  return chips;
}
export const chipTitle = (chip: string, all: string) => {
  if (chip === 'all') return all;
  if (chip === 'none') return 'No birth date';
  const k = HOPE_CLASSES.find((x) => x.id === chip);
  return k ? `${k.name} · ${k.to >= 99 ? `ages ${k.from} and over` : `ages ${k.from} to ${k.to}`}` : chip;
};

// ---- Rows and tiles ------------------------------------------------------------------------------------

/** The four status buttons. Tapping the chosen one again clears the mark. */
export function StatusSeg({ name, value, disabled, onChange }: { name: string; value: RgStatus | null; disabled?: boolean; onChange: (s: RgStatus | null) => void }) {
  return (
    <div className={`rg-seg${disabled ? ' ro' : ''}`} role="group" aria-label={`Status for ${name}`}>
      {RG_MARKS.map(([s, label]) => (
        <button key={s} type="button" data-s={s} aria-pressed={value === s} disabled={disabled} onClick={() => onChange(value === s ? null : s)}>{label}</button>
      ))}
    </div>
  );
}

/** One line per person: avatar, name, status. Time in, Time out, Duty and Notes open only when the row is expanded. */
export function RegRow({ photo, name, sub, allergy, to, status, disabled, onMark, details }: {
  photo?: string | null; name: string; sub?: string; allergy?: string | null; to?: string; status: RgStatus | null; disabled?: boolean;
  onMark: (s: RgStatus | null) => void; details?: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const who = (
    <>
      <strong>{name}</strong>
      {sub && <small>{sub}</small>}
      {allergy && <span className="rg-alg"><RgIcon name="warn" />Allergy: {allergy}</span>}
    </>
  );
  return (
    <li className={`rg-row${status ? ` s-${status}` : ''}`}>
      <div className="rg-rm">
        <Avatar photo={photo} name={name} size={42} />
        {to ? <Link to={to} className="rg-nm">{who}</Link> : <div className="rg-nm">{who}</div>}
        <StatusSeg name={name} value={status} disabled={disabled} onChange={onMark} />
        {details ? (
          <button type="button" className="rg-chev" aria-expanded={open} aria-label={`Details for ${name}`} onClick={() => setOpen(!open)}><RgIcon name="down" /></button>
        ) : <span className="rg-chev" aria-hidden="true" />}
      </div>
      {open && details && <div className="rg-more-f">{details}</div>}
    </li>
  );
}

/** A field inside an expanded row. */
export function Field({ label, wide, children }: { label: string; wide?: boolean; children: ReactNode }) {
  return <label className={`rg-fld${wide ? ' wide' : ''}`}><span>{label}</span>{children}</label>;
}

/** Photos view: tap a photo to mark Present (tap again to clear); the small "..." gives Late, Absent, Excused. */
export function PhotoTile({ photo, name, status, time, allergy, disabled, onMark, extra }: {
  photo?: string | null; name: string; status: RgStatus | null; time?: string | null; allergy?: string | null; disabled?: boolean;
  onMark: (s: RgStatus | null) => void; extra?: ReactNode;
}) {
  const [menu, setMenu] = useState(false);
  const box = useRef<HTMLLIElement>(null);
  useEffect(() => {
    if (!menu) return;
    const close = (e: Event) => { if (!box.current?.contains(e.target as Node)) setMenu(false); };
    document.addEventListener('pointerdown', close);
    return () => document.removeEventListener('pointerdown', close);
  }, [menu]);
  const label = status ? `${LABEL[status]}${time && (status === 'present' || status === 'late') ? ` · ${time}` : ''}` : 'Tap when here';
  return (
    <li className="rg-tile" data-s={status ?? ''} ref={box}>
      <button type="button" className="rg-tbtn" disabled={disabled} aria-pressed={status === 'present'}
        aria-label={`${name}, ${status ? LABEL[status] : 'not marked'}. Tap to mark present`} onClick={() => onMark(status === 'present' ? null : 'present')}>
        <span className="rg-tphoto"><Avatar photo={photo} name={name} size={120} />{extra}</span>
        <strong>{name}</strong>
        <span className="rg-tpill">{label}</span>
      </button>
      {allergy && <span className="rg-talg" title={`Allergy: ${allergy}`}><RgIcon name="warn" /><span className="visually-hidden">Allergy: {allergy}</span></span>}
      {!disabled && <button type="button" className="rg-tmore" aria-label={`Late, absent or excused for ${name}`} aria-expanded={menu} onClick={() => setMenu(!menu)}><RgIcon name="dots" /></button>}
      {menu && (
        <div className="rg-tmenu" role="menu">
          {RG_MARKS.filter(([s]) => s !== 'present').map(([s, l]) => (
            <button key={s} type="button" role="menuitem" aria-pressed={status === s} onClick={() => { setMenu(false); onMark(status === s ? null : s); }}>{l}</button>
          ))}
        </div>
      )}
    </li>
  );
}

export function Empty({ title, children }: { title: string; children?: ReactNode }) {
  return <div className="rg-empty"><b>{title}</b>{children}</div>;
}

/** The page frame: title and date, the header actions, then the primary tabs and the quiet underline tabs. */
export function Frame({ date, actions, ptabs, subtabs, children }: { date?: string; actions?: ReactNode; ptabs?: ReactNode; subtabs?: ReactNode; children: ReactNode }) {
  return (
    <>
      <header className="rg-head">
        <div><h1>Registers</h1>{date && <p>{longDate(date)}</p>}</div>
        {actions && <div className="rg-actions">{actions}</div>}
      </header>
      {(ptabs || subtabs) && <div className="rg-levels">{ptabs}{subtabs}</div>}
      {children}
    </>
  );
}

/** Who may reset a day: Andy and Doreen, and the Hope Director (brief: Diana resets a day). */
export function useCanReset(orgId: string) {
  const { profile } = useAuth();
  return canKeepAccounts(profile) || isHopeDirector(profile, orgId);
}
