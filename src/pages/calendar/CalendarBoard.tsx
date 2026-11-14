import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useAuth } from '../../state/AuthContext';
import { useOrg, type Organization } from '../../state/OrgContext';
import { AUTO_LAYERS, expandEvents, orgColour, orgShort, sortItems, useAutoItems, useCalendarEvents, type AutoKind, type CalItem } from '../../state/useCalendar';
import { canAccessOrg } from '../../../functions/src/shared/permissions';
import { localDateKey } from '../../../functions/src/shared/datetime';
import { addDays, dayLabel, daysInMonth, EVENT_TYPE_INFO, minutesOf, weekdayOf } from '../../../functions/src/shared/calendar';
import { readPref, writePref } from '../../lib/storage';
import { refreshPush } from '../../lib/push';
import { setCalendarName } from '../../lib/calendarWrites';
import { addCalendar2027, CALENDAR_2027, CALENDAR_2027_PREFIX } from '../../lib/calendar2027';
import { EventSheet } from './EventSheet';
import { EventForm } from './EventForm';
import { RemindersSheet } from './RemindersSheet';
import './calendar.css';

type View = 'month' | 'week' | 'day' | 'list';
const VIEWS: { id: View; label: string }[] = [{ id: 'month', label: 'Month' }, { id: 'week', label: 'Week' }, { id: 'day', label: 'Day' }, { id: 'list', label: 'Coming up' }];
const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const HOUR = 44;

/** Monday of the week a day falls in. */
const weekStart = (d: string) => addDays(d, -((weekdayOf(d) + 6) % 7));
const monthStart = (d: string) => `${d.slice(0, 7)}-01`;

function shiftMonth(d: string, n: number): string {
  let y = Number(d.slice(0, 4));
  let m = Number(d.slice(5, 7)) + n;
  while (m > 12) { m -= 12; y += 1; }
  while (m < 1) { m += 12; y -= 1; }
  return `${y}-${String(m).padStart(2, '0')}-01`;
}

function readSet(key: string, fallback: string[]): Set<string> {
  const raw = readPref(key);
  return new Set(raw == null ? fallback : raw.split(',').filter(Boolean));
}

export interface Opened { item: CalItem }
export interface Editing { orgId: string; day: string; start: string | null; item?: CalItem }

/**
 * The events calendar (Andy, 2026-11-14): Month, Week, Day and Coming up (7A), each place in its own colour (1A),
 * events coloured by type (10A), dates the app already knows (8A), and reminders (4A, 5A). Shown at /calendar and as
 * the Calendar tab of Reports.
 */
export function CalendarBoard({ embedded = false }: { embedded?: boolean }) {
  const { profile, can } = useAuth();
  const { organizations, current } = useOrg();
  const [params, setParams] = useSearchParams();
  const orgs = useMemo(() => organizations.filter((o) => o.active !== false && !o.deletedAt && (!o.training || current?.id === o.id)), [organizations, current]);
  const tz = orgs[0]?.timeZone || 'Africa/Nairobi';
  const today = localDateKey(new Date(), tz);

  const [view, setViewState] = useState<View>(() => (readPref('calView') as View | null) ?? (window.innerWidth < 700 ? 'list' : 'month'));
  const setView = (v: View) => { setViewState(v); writePref('calView', v); };
  const [cursor, setCursor] = useState(() => params.get('day') || today);
  const [hidden, setHidden] = useState<Set<string>>(() => readSet('calHiddenOrgs', []));
  const [layers, setLayers] = useState<Set<string>>(() => readSet('calLayers', ['services', 'classes', 'birthdays', 'close']));
  const [opened, setOpened] = useState<CalItem | null>(null);
  const [editing, setEditing] = useState<Editing | null>(null);
  const [bell, setBell] = useState(false);

  useEffect(() => { refreshPush(profile?.uid); setCalendarName(profile?.displayName ?? ''); }, [profile?.uid, profile?.displayName]);

  const shown = useMemo(() => orgs.filter((o) => !hidden.has(o.id)), [orgs, hidden]);
  const shownIds = useMemo(() => shown.map((o) => o.id), [shown]);
  const { events, loading, error } = useCalendarEvents(shownIds);
  const managed = orgs.filter((o) => (can('calendar.manage') || can('users.manage')) && canAccessOrg(profile, o.id));
  const many = orgs.length > 1;

  // The days the current view covers.
  const range = useMemo(() => {
    if (view === 'month') {
      const first = monthStart(cursor);
      const start = weekStart(first);
      const weeks = Math.ceil((daysBetweenKeys(start, first) + daysInMonth(Number(first.slice(0, 4)), Number(first.slice(5, 7)))) / 7);
      return { from: start, to: addDays(start, weeks * 7 - 1) };
    }
    if (view === 'week') { const s = weekStart(cursor); return { from: s, to: addDays(s, 6) }; }
    if (view === 'day') return { from: cursor, to: cursor };
    return { from: today, to: addDays(today, 120) };
  }, [view, cursor, today]);

  const layerSet = useMemo(() => layers as Set<AutoKind>, [layers]);
  const auto = useAutoItems(shown, range.from, range.to, layerSet);
  const items = useMemo(() => sortItems([...expandEvents(events, range.from, range.to), ...auto]), [events, auto, range]);
  const orgById = useMemo(() => new Map(organizations.map((o) => [o.id, o])), [organizations]);

  // A reminder's link opens its event (…/calendar?event=…&day=…).
  const wanted = params.get('event');
  useEffect(() => {
    if (!wanted || loading) return;
    const e = events.find((x) => x.id === wanted);
    const day = params.get('day') || e?.date || today;
    if (e) setOpened(expandEvents([e], day, day)[0] ?? expandEvents([e], e.date, e.date)[0] ?? null);
    const next = new URLSearchParams(params);
    next.delete('event');
    next.delete('org');
    setParams(next, { replace: true });
  }, [wanted, loading, events, params, setParams, today]);

  function move(n: number) {
    if (view === 'month') setCursor(shiftMonth(cursor, n));
    else if (view === 'week') setCursor(addDays(cursor, 7 * n));
    else if (view === 'day') setCursor(addDays(cursor, n));
  }
  const title = view === 'month' ? `${MONTHS[Number(cursor.slice(5, 7)) - 1]} ${cursor.slice(0, 4)}`
    : view === 'week' ? weekTitle(range.from, range.to)
    : view === 'day' ? dayLabel(cursor)
    : 'Coming up';

  function toggle(set: Set<string>, id: string, key: string, save: (s: Set<string>) => void) {
    const next = new Set(set);
    if (next.has(id)) next.delete(id); else next.add(id);
    writePref(key, [...next].join(','));
    save(next);
  }

  function add(day: string, start: string | null = null) {
    const preferred = managed.find((o) => o.id === current?.id) ?? managed[0];
    if (!preferred) return;
    setEditing({ orgId: preferred.id, day, start });
  }

  // Freedom Church's 2027 calendar, added in one tap by Andy (2026-11-14). Hidden once it is in.
  const church = shown.find((o) => o.type === 'church_campus' && !o.training && managed.some((m) => m.id === o.id));
  const [adding2027, setAdding2027] = useState<'' | 'busy' | 'done' | 'failed'>('');
  const offer2027 = can('users.manage') && !!church && !loading && !error && adding2027 !== 'done'
    && !events.some((e) => e.orgId === church.id && e.id.startsWith(CALENDAR_2027_PREFIX));
  async function add2027() {
    if (!church) return;
    setAdding2027('busy');
    try {
      await addCalendar2027(church.id, profile?.displayName ?? '');
      setAdding2027('done');
      setCursor('2027-01-01');
    } catch { setAdding2027('failed'); }
  }

  const invites = events.filter((e) => profile && e.invited?.includes(profile.uid) && !e.responses?.[profile.uid] && e.endsOn >= today).length;

  return (
    <div className={`cal${embedded ? ' cal-embedded' : ''}`}>
      <div className="cal-bar">
        <div className="cal-nav">
          <button type="button" className="btn btn-quiet" onClick={() => setCursor(today)}>Today</button>
          {view !== 'list' && <>
            <button type="button" className="cal-arrow" aria-label="Back" onClick={() => move(-1)}>‹</button>
            <button type="button" className="cal-arrow" aria-label="Forward" onClick={() => move(1)}>›</button>
          </>}
          <h2 className="cal-title">{title}</h2>
        </div>
        <div className="cal-tools">
          <div className="segmented" role="tablist" aria-label="View">
            {VIEWS.map((v) => <button key={v.id} type="button" role="tab" aria-selected={view === v.id} className={view === v.id ? 'on' : ''} onClick={() => setView(v.id)}>{v.label}</button>)}
          </div>
          <button type="button" className="btn btn-quiet cal-bell" onClick={() => setBell(true)} aria-label="Reminders">🔔 Reminders</button>
          {managed.length > 0 && <button type="button" className="btn btn-primary" onClick={() => add(view === 'list' ? today : cursor)}>＋ New event</button>}
        </div>
      </div>

      {offer2027 && (
        <div className="notice cal-invites">
          <p>📅 Freedom Church's 2027 calendar is ready to add: {CALENDAR_2027.length} entries, from New Year's Day to Boxing Day, with Bible study, Communion, prayer and fasting, special Sundays and public holidays.</p>
          <button type="button" className="btn btn-primary" disabled={adding2027 === 'busy'} onClick={add2027}>{adding2027 === 'busy' ? 'Adding…' : 'Add the 2027 calendar'}</button>
          {adding2027 === 'failed' && <p className="small">That did not go through. Check the internet and try again.</p>}
        </div>
      )}
      {invites > 0 && <p className="notice cal-invites">✉️ You have {invites === 1 ? 'an invitation' : `${invites} invitations`} to answer. Open the event{invites === 1 ? '' : 's'} marked “Answer” and tap Yes or No.</p>}

      <div className="cal-filters">
        {many && orgs.map((o) => (
          <button key={o.id} type="button" className={`cal-filter${hidden.has(o.id) ? '' : ' on'}`} style={{ '--org': orgColour(o) } as CSSProperties} onClick={() => toggle(hidden, o.id, 'calHiddenOrgs', setHidden)}>
            <i aria-hidden="true" />{orgShort(o)}
          </button>
        ))}
        <details className="cal-layers">
          <summary>Also show</summary>
          <div className="cal-layer-list">
            {AUTO_LAYERS.map((l) => (
              <label key={l.id} className="check"><input type="checkbox" checked={layers.has(l.id)} onChange={() => toggle(layers, l.id, 'calLayers', setLayers)} /> {l.label}</label>
            ))}
          </div>
        </details>
      </div>

      {error && <p className="error">The calendar could not be loaded ({error}).</p>}

      {view === 'month' && <MonthGrid from={range.from} to={range.to} month={cursor.slice(0, 7)} today={today} items={items} orgById={orgById} many={many}
        onOpen={setOpened} onDay={(d) => { setCursor(d); setView('day'); }} onAdd={managed.length ? (d) => add(d) : undefined} />}
      {(view === 'week' || view === 'day') && <TimeGrid from={range.from} days={view === 'week' ? 7 : 1} today={today} items={items} orgById={orgById} many={many} tz={tz}
        onOpen={setOpened} onDay={(d) => { setCursor(d); setView('day'); }} onAdd={managed.length ? add : undefined} />}
      {view === 'list' && <ComingUp items={items} today={today} orgById={orgById} many={many} onOpen={setOpened} loading={loading} canAdd={managed.length > 0} onAdd={() => add(today)} />}

      {!embedded && <p className="small muted cal-foot">Tap a day to add an event{managed.length ? '' : ' (ask Mr Andrew if you need to add events)'}. <Link to="/manual">How the calendar works</Link></p>}

      {opened && <EventSheet item={opened} org={orgById.get(opened.orgId)} all={events} canEdit={!!managed.find((o) => o.id === opened.orgId)}
        onClose={() => setOpened(null)} onEdit={(it) => { setOpened(null); setEditing({ orgId: it.orgId, day: it.date, start: it.start, item: it }); }} />}
      {editing && <EventForm editing={editing} orgs={managed} onClose={() => setEditing(null)} />}
      {bell && <RemindersSheet org={orgById.get(current?.id ?? '') ?? orgs[0]} onClose={() => setBell(false)} />}
    </div>
  );
}

function daysBetweenKeys(a: string, b: string) {
  return Math.round((Date.UTC(+b.slice(0, 4), +b.slice(5, 7) - 1, +b.slice(8, 10)) - Date.UTC(+a.slice(0, 4), +a.slice(5, 7) - 1, +a.slice(8, 10))) / 86_400_000);
}

function weekTitle(from: string, to: string) {
  const sameMonth = from.slice(0, 7) === to.slice(0, 7);
  const m = (k: string) => MONTHS[Number(k.slice(5, 7)) - 1]!.slice(0, 3);
  return sameMonth ? `${Number(from.slice(8))} – ${Number(to.slice(8))} ${m(to)} ${to.slice(0, 4)}` : `${Number(from.slice(8))} ${m(from)} – ${Number(to.slice(8))} ${m(to)} ${to.slice(0, 4)}`;
}

function itemStyle(it: CalItem, orgById: Map<string, Organization>): CSSProperties {
  return { '--ev': EVENT_TYPE_INFO[it.type]?.colour ?? '#64748b', '--org': orgColour(orgById.get(it.orgId)) } as CSSProperties;
}

function needsAnswer(it: CalItem, uid: string | undefined) {
  return !!uid && !!it.event?.invited?.includes(uid) && !it.event.responses?.[uid];
}

interface GridProps {
  items: CalItem[];
  today: string;
  orgById: Map<string, Organization>;
  many: boolean;
  onOpen: (it: CalItem) => void;
  onDay: (d: string) => void;
}

function Chip({ it, orgById, many, onOpen }: { it: CalItem; orgById: Map<string, Organization>; many: boolean; onOpen: (it: CalItem) => void }) {
  const { profile } = useAuth();
  return (
    <button type="button" className={`cal-chip${it.allDay || it.endDate !== it.date ? ' cal-chip-solid' : ''}${it.auto ? ' cal-chip-auto' : ''}`} style={itemStyle(it, orgById)}
      onClick={(e) => { e.stopPropagation(); onOpen(it); }} title={it.title}>
      {many && <i className="cal-org-dot" aria-hidden="true" />}
      {!it.allDay && it.start && <b>{it.start}</b>} {it.title}{needsAnswer(it, profile?.uid) ? ' · Answer' : ''}
    </button>
  );
}

function MonthGrid({ from, to, month, items, today, orgById, many, onOpen, onDay, onAdd }: GridProps & { from: string; to: string; month: string; onAdd?: (d: string) => void }) {
  const days: string[] = [];
  for (let d = from; d <= to; d = addDays(d, 1)) days.push(d);
  const byDay = new Map<string, CalItem[]>();
  for (const it of items) for (let d = it.date < from ? from : it.date; d <= it.endDate && d <= to; d = addDays(d, 1)) byDay.set(d, [...(byDay.get(d) ?? []), it]);
  return (
    <div className="cal-month" role="grid" aria-label="Month">
      {WEEKDAYS.map((w) => <div key={w} className="cal-wd" role="columnheader">{w}</div>)}
      {days.map((d) => {
        const list = byDay.get(d) ?? [];
        const outside = d.slice(0, 7) !== month;
        return (
          <div key={d} role="gridcell" className={`cal-cell${outside ? ' cal-out' : ''}${d === today ? ' cal-today' : ''}`} onClick={() => (onAdd && !list.length ? onAdd(d) : onDay(d))}>
            <button type="button" className="cal-num" onClick={(e) => { e.stopPropagation(); onDay(d); }} aria-label={dayLabel(d)}>{Number(d.slice(8))}</button>
            <div className="cal-chips">
              {list.slice(0, 3).map((it) => <Chip key={it.key} it={it} orgById={orgById} many={many} onOpen={onOpen} />)}
              {list.length > 3 && <button type="button" className="cal-more" onClick={(e) => { e.stopPropagation(); onDay(d); }}>+{list.length - 3} more</button>}
            </div>
            <div className="cal-dots" aria-hidden="true">{list.slice(0, 4).map((it) => <i key={it.key} style={itemStyle(it, orgById)} />)}</div>
          </div>
        );
      })}
    </div>
  );
}

interface Placed { it: CalItem; top: number; height: number; col: number; cols: number }

/** Side by side when events overlap, the way a paper diary would. */
function place(list: CalItem[]): Placed[] {
  const timed = list.map((it) => {
    const s = minutesOf(it.start!);
    const e = it.end && minutesOf(it.end) > s ? minutesOf(it.end) : s + 60;
    return { it, s, e };
  }).sort((a, b) => a.s - b.s || b.e - a.e);
  const out: Placed[] = [];
  let group: { it: CalItem; s: number; e: number; col: number }[] = [];
  let groupEnd = -1;
  const flush = () => {
    const cols = Math.max(1, ...group.map((g) => g.col + 1));
    for (const g of group) out.push({ it: g.it, top: (g.s / 60) * HOUR, height: Math.max(22, ((g.e - g.s) / 60) * HOUR - 2), col: g.col, cols });
    group = [];
  };
  for (const t of timed) {
    if (t.s >= groupEnd && group.length) flush();
    const used = new Set(group.filter((g) => g.e > t.s).map((g) => g.col));
    let col = 0;
    while (used.has(col)) col += 1;
    group.push({ ...t, col });
    groupEnd = Math.max(groupEnd, t.e);
  }
  if (group.length) flush();
  return out;
}

function TimeGrid({ from, days: count, items, today, orgById, many, tz, onOpen, onDay, onAdd }: GridProps & { from: string; days: number; tz: string; onAdd?: (d: string, start: string | null) => void }) {
  const days: string[] = [];
  for (let i = 0; i < count; i++) days.push(addDays(from, i));
  const scroller = useRef<HTMLDivElement>(null);
  useEffect(() => { if (scroller.current) scroller.current.scrollTop = 7 * HOUR; }, [from, count]);
  const [now, setNow] = useState(() => new Date());
  useEffect(() => { const t = setInterval(() => setNow(new Date()), 60_000); return () => clearInterval(t); }, []);
  const nowMin = (() => { const p = new Intl.DateTimeFormat('en-GB', { timeZone: tz, hour: '2-digit', minute: '2-digit', hour12: false }).format(now); return minutesOf(p); })();
  const allDay = (d: string) => items.filter((it) => (it.allDay || !it.start || it.endDate !== it.date) && it.date <= d && it.endDate >= d);
  const timed = (d: string) => items.filter((it) => !it.allDay && it.start && it.endDate === it.date && it.date === d);
  const anyAllDay = days.some((d) => allDay(d).length);
  const cols = { gridTemplateColumns: `52px repeat(${count}, minmax(0, 1fr))` } as CSSProperties;

  return (
    <div className={`cal-time${count === 1 ? ' cal-time-day' : ''}`}>
      <div className="cal-time-head" style={cols}>
        <span />
        {days.map((d) => (
          <button key={d} type="button" className={`cal-time-day-head${d === today ? ' cal-today' : ''}`} onClick={() => onDay(d)}>
            <small>{WEEKDAYS[(weekdayOf(d) + 6) % 7]}</small><b>{Number(d.slice(8))}</b>
          </button>
        ))}
      </div>
      {anyAllDay && (
        <div className="cal-allday" style={cols}>
          <span className="cal-hour-label">All day</span>
          {days.map((d) => <div key={d} className="cal-allday-cell">{allDay(d).map((it) => <Chip key={it.key} it={it} orgById={orgById} many={many} onOpen={onOpen} />)}</div>)}
        </div>
      )}
      <div className="cal-time-body" ref={scroller}>
        <div className="cal-time-grid" style={{ ...cols, height: 24 * HOUR }}>
          <div className="cal-hours">
            {Array.from({ length: 24 }, (_, h) => <span key={h} style={{ top: h * HOUR }}>{h === 0 ? '' : `${String(h).padStart(2, '0')}:00`}</span>)}
          </div>
          {days.map((d) => (
            <div key={d} className="cal-day-col" onClick={(e) => {
              if (!onAdd) return;
              const y = e.clientY - (e.currentTarget as HTMLElement).getBoundingClientRect().top;
              const h = Math.max(0, Math.min(23, Math.floor(y / HOUR)));
              onAdd(d, `${String(h).padStart(2, '0')}:00`);
            }}>
              {Array.from({ length: 24 }, (_, h) => <i key={h} className="cal-line" style={{ top: h * HOUR }} />)}
              {d === today && <i className="cal-now" style={{ top: (nowMin / 60) * HOUR }} />}
              {place(timed(d)).map((p) => (
                <button key={p.it.key} type="button" className={`cal-block${p.it.auto ? ' cal-chip-auto' : ''}`} style={{ ...itemStyle(p.it, orgById), top: p.top, height: p.height, left: `calc(${(p.col / p.cols) * 100}% + 2px)`, width: `calc(${100 / p.cols}% - 4px)` }}
                  onClick={(e) => { e.stopPropagation(); onOpen(p.it); }}>
                  <b>{p.it.title}</b>
                  <span>{p.it.start}{p.it.end ? ` – ${p.it.end}` : ''}{p.it.place ? ` · ${p.it.place}` : ''}</span>
                  {many && p.height >= 56 && <i className="cal-org-tag">{orgShort(orgById.get(p.it.orgId))}</i>}
                </button>
              ))}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function ComingUp({ items, today, orgById, many, onOpen, loading, canAdd, onAdd }: Omit<GridProps, 'onDay'> & { loading: boolean; canAdd: boolean; onAdd: () => void }) {
  const { profile } = useAuth();
  const [limit, setLimit] = useState(40);
  const upcoming = items.filter((it) => it.endDate >= today);
  const shown = upcoming.slice(0, limit);
  const groups: { day: string; list: CalItem[] }[] = [];
  for (const it of shown) {
    const day = it.date < today ? today : it.date;
    const g = groups[groups.length - 1];
    if (g && g.day === day) g.list.push(it); else groups.push({ day, list: [it] });
  }
  if (loading && !items.length) return <p className="muted">Loading…</p>;
  if (!groups.length) {
    return (
      <div className="card cal-empty">
        <p>Nothing coming up in the next four months.</p>
        {canAdd && <button type="button" className="btn btn-primary align-start" onClick={onAdd}>＋ Add the first event</button>}
      </div>
    );
  }
  return (
    <div className="cal-list">
      {groups.map((g) => (
        <section key={g.day} className="cal-list-day">
          <h3>{g.day === today ? 'Today' : g.day === addDays(today, 1) ? 'Tomorrow' : dayLabel(g.day, g.day.slice(0, 4) !== today.slice(0, 4))}<small>{g.day === today || g.day === addDays(today, 1) ? ` · ${dayLabel(g.day, false)}` : ''}</small></h3>
          <ul>
            {g.list.map((it) => (
              <li key={it.key}>
                <button type="button" className="cal-row" style={itemStyle(it, orgById)} onClick={() => onOpen(it)}>
                  <span className="cal-row-time">{it.allDay || !it.start ? (it.endDate !== it.date ? 'Days' : 'All day') : it.start}</span>
                  <span className="cal-row-main">
                    <b>{EVENT_TYPE_INFO[it.type]?.icon} {it.title}</b>
                    <small>{[it.end && !it.allDay ? `until ${it.end}` : '', it.endDate !== it.date ? `to ${dayLabel(it.endDate, false)}` : '', it.place, many ? orgShort(orgById.get(it.orgId)) : ''].filter(Boolean).join(' · ')}</small>
                  </span>
                  {needsAnswer(it, profile?.uid) && <span className="cal-answer">Answer</span>}
                </button>
              </li>
            ))}
          </ul>
        </section>
      ))}
      {upcoming.length > limit && <button type="button" className="btn btn-quiet align-start" onClick={() => setLimit(limit + 40)}>Show more</button>}
    </div>
  );
}
