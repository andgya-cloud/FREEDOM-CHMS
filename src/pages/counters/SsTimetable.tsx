import { useEffect, useMemo, useState } from 'react';
import { collection, onSnapshot, orderBy, query } from 'firebase/firestore';
import { db } from '../../firebase';
import { useToast } from '../../state/ToastContext';
import { friendlyError } from '../../lib/errors';
import {
  copySsYear, downloadSsFile, downloadSsTimetable, fillSsSeries, removeSsDay, removeSsFile, saveSsDay, saveSsDrive, ssReminders, uploadSsFile, waLink, waShare,
  type SsReminders,
} from '../../lib/ssTimetable';
import {
  addDays, cleanLink, LESSON_FIELDS, lessonLine, openingYear, ssDayLabel, sundayFrom, SS_FIRST_DAY, SS_MAX_FILES, timetableYears, yearRows,
  type SsDay, type SsFile, type SsLesson,
} from '../../../functions/src/shared/ssTimetable';
import type { SsClass } from '../../../functions/src/shared/sundaySchool';

/**
 * The Sunday school teaching timetable (Andy, 2026-11-24, 1A-10A): "This Sunday" at the top, the year as one list
 * of Sundays with the special days in between, and for Dorothy, Andy and Doreen the editing, the series fill, copy
 * last year and the WhatsApp reminders to send by hand.
 */
export interface TtProps { org: { id: string; name: string; type?: string }; classes: SsClass[]; mine: SsClass | null; edits: boolean; today: string; driveFolder: string }

export function useSsDays(orgId: string): SsDay[] | null {
  const [days, setDays] = useState<SsDay[] | null>(null);
  useEffect(() => onSnapshot(query(collection(db, 'organizations', orgId, 'ssTimetable'), orderBy('date')),
    (s) => setDays(s.docs.map((d) => d.data() as SsDay)), () => setDays([])), [orgId]);
  return days;
}

const emptyDay = (date: string): SsDay => ({ date, kind: new Date(`${date}T12:00:00Z`).getUTCDay() === 0 ? 'sunday' : 'special', title: '', noClass: false, theme: '', series: '', note: '', link: '', lessons: {}, files: [] });
const emptyLesson: SsLesson = { title: '', passage: '', verse: '', point: '', activity: '', teacher: '', link: '' };
const sizeText = (n: number) => (n > 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);

/** This Sunday's theme and lessons (10A), with the files and the Drive folder. */
export function ThisSunday({ org, classes, mine, today, driveFolder, days }: TtProps & { days: SsDay[] }) {
  const date = sundayFrom(today);
  const day = days.find((d) => d.date === date) ?? null;
  const special = days.filter((d) => d.kind === 'special' && d.date >= today && d.date <= addDays(today, 21));
  const show = mine ? classes.filter((c) => c.id === mine.id) : classes;
  return (
    <section className="card tt-this">
      <div className="tt-head">
        <h2>📖 This Sunday · {ssDayLabel(date, false)}</h2>
        <a className="btn" href={driveFolder} target="_blank" rel="noreferrer">📁 Lessons folder</a>
      </div>
      {day?.noClass ? <p className="tt-off">No Sunday school this Sunday{day.title ? ` · ${day.title}` : ''}.</p> : (
        <>
          {day?.title && <p className="tt-tag">{day.title}</p>}
          <p className="tt-theme">{day?.theme || <span className="muted">The theme is not on the timetable yet.</span>}</p>
          {show.map((c) => <LessonView key={c.id} c={c} day={day} orgId={org.id} open={!!mine} />)}
          <DayFiles orgId={org.id} day={day} classId={mine?.id} />
        </>
      )}
      {special.map((d) => <p key={d.date} className="tt-special">★ {ssDayLabel(d.date, false)}: <b>{d.title}</b>{d.note ? ` · ${d.note}` : ''}</p>)}
    </section>
  );
}

function LessonView({ c, day, orgId, open }: { c: SsClass; day: SsDay | null; orgId: string; open: boolean }) {
  const l = day?.lessons[c.id];
  const teacher = l?.teacher || c.leader;
  const rows = LESSON_FIELDS.filter((f) => f.key !== 'title' && f.key !== 'teacher' && f.key !== 'link' && l?.[f.key]);
  return (
    <details className="tt-lesson" open={open}>
      <summary><b>{c.name}</b>{teacher ? ` · ${teacher}` : ''} <span className="muted">{l?.title ? `· ${l.title}` : '· lesson to come'}</span></summary>
      {l && (
        <dl className="tt-dl">
          {rows.map((f) => <div key={f.key}><dt>{f.label}</dt><dd>{l[f.key]}</dd></div>)}
          {l.link && <div><dt>Lesson file</dt><dd><a href={l.link} target="_blank" rel="noreferrer">Open on Google Drive</a></dd></div>}
        </dl>
      )}
      {day && <DayFiles orgId={orgId} day={day} classId={c.id} only />}
    </details>
  );
}

/** The files kept with a day: the whole day's and the class's own. */
function DayFiles({ orgId, day, classId, only, onRemove }: { orgId: string; day: SsDay | null; classId?: string; only?: boolean; onRemove?: (f: SsFile) => void }) {
  const toast = useToast();
  const [busy, setBusy] = useState('');
  // Everything while editing; a class's own files under its lesson; otherwise the whole school's files.
  const files = (day?.files ?? []).filter((f) => (onRemove ? true : only ? f.classId === classId : !f.classId));
  if (!files.length && !day?.link) return null;
  return (
    <ul className="tt-files">
      {day?.link && !only && <li><a href={day.link} target="_blank" rel="noreferrer">📎 Lesson link for the day</a></li>}
      {files.map((f) => (
        <li key={f.id}>
          <button type="button" className="btn btn-quiet" disabled={busy === f.id}
            onClick={() => { setBusy(f.id); downloadSsFile(orgId, day!.date, f).catch((e) => toast.show(friendlyError(e))).finally(() => setBusy('')); }}>
            ⬇ {f.name}
          </button> <span className="small muted">{sizeText(f.size)}{busy === f.id ? ' · downloading…' : ''}</span>
          {onRemove && <button type="button" className="btn btn-quiet" aria-label={`Remove ${f.name}`} onClick={() => onRemove(f)}>✕</button>}
        </li>
      ))}
    </ul>
  );
}

/** The year (1A, 2A): every Sunday and the special days, month by month. */
export function Timetable(props: TtProps & { days: SsDay[] }) {
  const { org, classes, mine, edits, today, days } = props;
  const toast = useToast();
  const years = timetableYears(today);
  const [year, setYear] = useState(() => openingYear(today));
  const [openDate, setOpenDate] = useState('');
  const [editing, setEditing] = useState<SsDay | null>(null);
  const [tool, setTool] = useState<'' | 'special' | 'series' | 'drive'>('');
  const rows = useMemo(() => yearRows(year, days), [year, days]);
  const months = useMemo(() => {
    const m = new Map<string, typeof rows>();
    for (const r of rows) { const k = r.date.slice(0, 7); m.set(k, [...(m.get(k) ?? []), r]); }
    return [...m.entries()];
  }, [rows]);
  const lastYear = days.filter((d) => d.date.startsWith(String(year - 1))).length;
  const thisYear = days.filter((d) => d.date.startsWith(String(year))).length;
  const [dl, setDl] = useState(false);
  const download = (kind: 'pdf' | 'xlsx') => { setDl(true); downloadSsTimetable(org, year, days, classes, kind).catch((e) => toast.show(friendlyError(e))).finally(() => setDl(false)); };
  async function copyYear() {
    try { const r = await copySsYear(org.id, year - 1); toast.show(r.copied ? `${r.copied} days copied from ${year - 1}. Change any that differ.` : 'Nothing new to copy.'); } catch (e) { toast.show(friendlyError(e)); }
  }

  return (
    <section className="card tt-year" id="timetable">
      <div className="tt-head">
        <h2>📅 Teaching timetable</h2>
        <div className="btn-line">
          <select value={year} onChange={(e) => { setYear(Number(e.target.value)); setOpenDate(''); setEditing(null); }} aria-label="Year">
            {years.map((y) => <option key={y} value={y}>{y === 2026 ? 'December 2026' : y}</option>)}
          </select>
          <button type="button" className="btn" disabled={dl} onClick={() => download('pdf')}>PDF</button>
          <button type="button" className="btn" disabled={dl} onClick={() => download('xlsx')}>Excel</button>
        </div>
      </div>
      {edits && (
        <div className="btn-line tt-tools">
          <button type="button" className="btn" onClick={() => setTool(tool === 'special' ? '' : 'special')}>★ Add a special day</button>
          <button type="button" className="btn" onClick={() => setTool(tool === 'series' ? '' : 'series')}>Fill a series</button>
          {lastYear > 0 && thisYear < 4 && <button type="button" className="btn" onClick={() => void copyYear()}>Copy {year - 1} into {year}</button>}
          <button type="button" className="btn btn-quiet" onClick={() => setTool(tool === 'drive' ? '' : 'drive')}>Drive folder link</button>
        </div>
      )}
      {edits && tool === 'special' && <SpecialDayForm year={year} today={today} onPick={(date) => { setTool(''); setOpenDate(date); setEditing(days.find((d) => d.date === date) ?? emptyDay(date)); }} />}
      {edits && tool === 'series' && <SeriesForm orgId={org.id} year={year} today={today} onDone={() => setTool('')} />}
      {edits && tool === 'drive' && <DriveForm orgId={org.id} link={props.driveFolder} onDone={() => setTool('')} />}
      <p className="small muted" style={{ margin: 0 }}>{edits ? 'Tap a Sunday to plan it. Every teacher sees the timetable; only Dorothy, Andy and Doreen change it.' : 'Tap a Sunday to see its lessons and files.'}</p>
      {months.map(([m, list]) => (
        <div key={m} className="tt-month">
          <h3>{new Intl.DateTimeFormat('en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${m}-15T12:00:00Z`))}</h3>
          <ul className="tt-list">
            {list.map(({ date, day }) => {
              const isOpen = openDate === date;
              const planned = classes.filter((c) => day?.lessons[c.id]?.title).length;
              const past = date < today;
              return (
                <li key={date} className={`tt-row${day?.kind === 'special' ? ' tt-row-special' : ''}${past ? ' tt-past' : ''}${date === sundayFrom(today) ? ' tt-next' : ''}`}>
                  <button type="button" className="tt-rowbtn" aria-expanded={isOpen} onClick={() => { setOpenDate(isOpen ? '' : date); setEditing(null); }}>
                    <span className="tt-date">{ssDayLabel(date, false)}</span>
                    <span className="tt-what">
                      {day?.kind === 'special' ? <b>★ {day.title}</b> : day?.noClass ? <b className="tt-offtxt">No Sunday school{day.title ? ` · ${day.title}` : ''}</b>
                        : <>{day?.title && <b className="tt-tagtxt">{day.title} · </b>}{day?.theme ? <b>{day.theme}</b> : <span className="muted">Not planned yet</span>}</>}
                      {day?.kind === 'sunday' && !day.noClass && (
                        <small className="muted">{mine ? lessonLine(day.lessons[mine.id]) || 'Your lesson is to come' : `${planned} of ${classes.length} classes planned`}{day.files?.length ? ` · ${day.files.length} file${day.files.length === 1 ? '' : 's'}` : ''}</small>
                      )}
                    </span>
                  </button>
                  {isOpen && !editing && (
                    <div className="tt-open">
                      {day?.note && <p>{day.note}</p>}
                      {day && !day.noClass && day.kind === 'sunday' && classes.map((c) => <LessonView key={c.id} c={c} day={day} orgId={org.id} open={mine?.id === c.id} />)}
                      <DayFiles orgId={org.id} day={day} />
                      {edits && date >= SS_FIRST_DAY && <button type="button" className="btn btn-primary" onClick={() => setEditing(day ?? emptyDay(date))}>✏️ {day ? 'Change this day' : 'Plan this Sunday'}</button>}
                      {!day && !edits && <p className="muted">Nothing planned yet.</p>}
                    </div>
                  )}
                  {isOpen && editing && <DayEditor orgId={org.id} classes={classes} day={editing} onClose={() => setEditing(null)} />}
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </section>
  );
}

/** Plan one day (3A, 4A, 6A): the theme in its own box, then each class's lesson, then files (5A). */
function DayEditor({ orgId, classes, day, onClose }: { orgId: string; classes: SsClass[]; day: SsDay; onClose: () => void }) {
  const toast = useToast();
  const [d, setD] = useState<SsDay>(day);
  const [busy, setBusy] = useState(false);
  const [fileClass, setFileClass] = useState('');
  const [progress, setProgress] = useState<number | null>(null);
  const set = <K extends keyof SsDay>(k: K, v: SsDay[K]) => setD((x) => ({ ...x, [k]: v }));
  const setLesson = (id: string, k: keyof SsLesson, v: string) => setD((x) => ({ ...x, lessons: { ...x.lessons, [id]: { ...emptyLesson, ...x.lessons[id], [k]: v } } }));
  const badLink = [d.link, ...Object.values(d.lessons).map((l) => l.link)].some((l) => l && !cleanLink(l));
  async function save(close = true) {
    if (badLink) { toast.show('Paste the whole link, starting with https://'); return false; }
    setBusy(true);
    try { await saveSsDay(orgId, d); if (close) { toast.show('Saved. Every teacher can see it.'); onClose(); } return true; } catch (e) { toast.show(friendlyError(e)); return false; } finally { setBusy(false); }
  }
  async function addFiles(list: FileList | null) {
    if (!list?.length) return;
    // Keep what is typed first, so the files land on a saved day.
    if (!(await save(false))) return;
    for (const f of Array.from(list)) {
      try {
        setProgress(0);
        await uploadSsFile(orgId, d.date, fileClass, f, setProgress);
        setD((x) => ({ ...x, files: [...x.files, { id: `new-${f.name}`, name: f.name, contentType: f.type, size: f.size, classId: fileClass, uploadedOn: '' }] }));
        toast.show(`${f.name} added.`);
      } catch (e) { toast.show(friendlyError(e)); }
    }
    setProgress(null);
  }
  async function dropFile(f: SsFile) {
    if (f.id.startsWith('new-')) { toast.show('Close and open the day again to remove a file you just added.'); return; }
    try { await removeSsFile(orgId, d.date, f.id); setD((x) => ({ ...x, files: x.files.filter((y) => y.id !== f.id) })); } catch (e) { toast.show(friendlyError(e)); }
  }
  async function removeDay() {
    setBusy(true);
    try { await removeSsDay(orgId, d.date); toast.show('Removed.'); onClose(); } catch (e) { toast.show(friendlyError(e)); } finally { setBusy(false); }
  }
  const special = d.kind === 'special';
  return (
    <div className="tt-edit">
      <h3>{special ? '★ Special day' : 'Sunday'} · {ssDayLabel(d.date)}</h3>
      <label className="field"><span>{special ? 'Name of the day' : 'Special Sunday (optional)'}</span>
        <input value={d.title} maxLength={80} placeholder={special ? 'e.g. Vacation Bible School' : 'e.g. Easter Sunday, Children\'s Sunday'} onChange={(e) => set('title', e.target.value)} /></label>
      {special ? (
        <label className="field"><span>What, when and where</span>
          <textarea rows={3} value={d.note} maxLength={600} placeholder="e.g. 9 AM to 1 PM in the church hall. All teachers come." onChange={(e) => set('note', e.target.value)} /></label>
      ) : (
        <>
          <label className="check"><input type="checkbox" checked={d.noClass} onChange={(e) => set('noClass', e.target.checked)} /> No Sunday school this Sunday</label>
          {!d.noClass && (
            <>
              <label className="field tt-themebox"><span>Theme for the whole Sunday school</span>
                <input value={d.theme} maxLength={120} placeholder="e.g. Joseph forgives" onChange={(e) => set('theme', e.target.value)} /></label>
              <label className="field"><span>Series (optional)</span>
                <input value={d.series} maxLength={80} placeholder="e.g. Life of Joseph" onChange={(e) => set('series', e.target.value)} /></label>
              {classes.map((c) => (
                <fieldset key={c.id} className="tt-class">
                  <legend>{c.name}{c.leader ? ` · ${c.leader}` : ''}</legend>
                  {LESSON_FIELDS.map((f) => (
                    <label key={f.key} className="field"><span>{f.label}</span>
                      {f.long
                        ? <textarea rows={2} value={d.lessons[c.id]?.[f.key] ?? ''} placeholder={f.key === 'teacher' && c.leader ? c.leader : f.hint} onChange={(e) => setLesson(c.id, f.key, e.target.value)} />
                        : <input value={d.lessons[c.id]?.[f.key] ?? ''} inputMode={f.key === 'link' ? 'url' : undefined} placeholder={f.key === 'teacher' && c.leader ? c.leader : f.hint} onChange={(e) => setLesson(c.id, f.key, e.target.value)} />}
                    </label>
                  ))}
                </fieldset>
              ))}
            </>
          )}
        </>
      )}
      <label className="field"><span>Google Drive link for the whole day (optional)</span>
        <input value={d.link} inputMode="url" placeholder="https://drive.google.com/…" onChange={(e) => set('link', e.target.value)} /></label>
      <fieldset className="tt-class">
        <legend>Files ({d.files.length} of {SS_MAX_FILES})</legend>
        <DayFiles orgId={orgId} day={d} onRemove={(f) => void dropFile(f)} />
        {!special && !d.noClass && (
          <label className="field"><span>The file is for</span>
            <select value={fileClass} onChange={(e) => setFileClass(e.target.value)}>
              <option value="">The whole Sunday school</option>
              {classes.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select></label>
        )}
        <label className="btn">⬆ Add files (up to 20 MB each)
          <input type="file" multiple hidden disabled={progress !== null} onChange={(e) => { void addFiles(e.target.files); e.target.value = ''; }} /></label>
        {progress !== null && <p className="small muted">Uploading… {Math.round(progress * 100)}%</p>}
      </fieldset>
      <div className="btn-line">
        <button type="button" className="btn btn-primary" disabled={busy || progress !== null} onClick={() => void save()}>Save</button>
        <button type="button" className="btn" onClick={onClose}>Cancel</button>
        {day.theme || day.title || Object.keys(day.lessons).length || day.files.length || day.noClass ? <button type="button" className="btn btn-quiet" disabled={busy} onClick={() => void removeDay()}>Clear this day</button> : null}
      </div>
    </div>
  );
}

function SpecialDayForm({ year, today, onPick }: { year: number; today: string; onPick: (date: string) => void }) {
  const min = year === 2026 ? (today > SS_FIRST_DAY ? today : SS_FIRST_DAY) : `${year}-01-01`;
  const [date, setDate] = useState(min);
  return (
    <div className="tt-tool">
      <label className="field"><span>Date of the special day (Vacation Bible School, a teachers' meeting, a camp…)</span>
        <input type="date" value={date} min={min} max={`${year}-12-31`} onChange={(e) => setDate(e.target.value)} /></label>
      <button type="button" className="btn btn-primary" disabled={!date} onClick={() => onPick(date)}>Next</button>
    </div>
  );
}

function SeriesForm({ orgId, year, today, onDone }: { orgId: string; year: number; today: string; onDone: () => void }) {
  const toast = useToast();
  const first = sundayFrom(year === 2026 || `${year}` === today.slice(0, 4) ? (today > SS_FIRST_DAY ? today : SS_FIRST_DAY) : `${year}-01-01`);
  const [series, setSeries] = useState('');
  const [start, setStart] = useState(first);
  const [weeks, setWeeks] = useState('6');
  const [busy, setBusy] = useState(false);
  async function go() {
    setBusy(true);
    try { const r = await fillSsSeries(orgId, start, series, Number(weeks)); toast.show(`${series}: ${r.dates.length} Sundays filled, ${ssDayLabel(r.dates[0]!, false)} to ${ssDayLabel(r.dates.at(-1)!, false)}.`); onDone(); } catch (e) { toast.show(friendlyError(e)); } finally { setBusy(false); }
  }
  return (
    <div className="tt-tool">
      <label className="field"><span>Series name</span><input value={series} maxLength={80} placeholder="e.g. Life of Joseph" onChange={(e) => setSeries(e.target.value)} /></label>
      <label className="field"><span>First Sunday</span><input type="date" value={start} min={SS_FIRST_DAY} step={7} onChange={(e) => setStart(sundayFrom(e.target.value))} /></label>
      <label className="field"><span>How many Sundays</span><input type="number" inputMode="numeric" min={1} max={52} value={weeks} onChange={(e) => setWeeks(e.target.value)} /></label>
      <p className="small muted">Sundays marked "No Sunday school" are skipped. Each Sunday gets "{series || 'Series'}: week 1, 2…" as its theme until you type its own; lessons already planned stay.</p>
      <button type="button" className="btn btn-primary" disabled={busy || !series.trim()} onClick={() => void go()}>Fill the Sundays</button>
    </div>
  );
}

function DriveForm({ orgId, link, onDone }: { orgId: string; link: string; onDone: () => void }) {
  const toast = useToast();
  const [v, setV] = useState(link);
  return (
    <div className="tt-tool">
      <label className="field"><span>Sunday school folder on Google Drive</span><input value={v} inputMode="url" onChange={(e) => setV(e.target.value)} /></label>
      <p className="small muted">In Google Drive, share the folder as "Anyone with the link: Viewer", so teachers without a Google account can open it.</p>
      <button type="button" className="btn btn-primary" onClick={() => saveSsDrive(orgId, v).then(() => { toast.show('Saved. Reload the page to see it.'); onDone(); }).catch((e) => toast.show(friendlyError(e)))}>Save</button>
    </div>
  );
}

/** Thursday's reminders for Sunday (8A), sent by hand on WhatsApp (9A): one message for the group, or one per teacher. */
export function SsRemindersCard({ orgId, today }: { orgId: string; today: string }) {
  const toast = useToast();
  const [r, setR] = useState<SsReminders | null>(null);
  const [err, setErr] = useState('');
  const day = new Date(`${today}T12:00:00Z`).getUTCDay();
  const due = day >= 4 || day === 0;
  const load = () => ssReminders(orgId).then((x) => { setR(x); setErr(''); }).catch((e) => setErr(friendlyError(e)));
  useEffect(() => { if (due || window.location.hash === '#reminders') void load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [orgId]);
  const copy = async (t: string) => { try { await navigator.clipboard.writeText(t); toast.show('Copied. Paste it in WhatsApp.'); } catch { toast.show('Could not copy. Press and hold the message to copy it.'); } };
  return (
    <details className="card fold" id="reminders" open={due || window.location.hash === '#reminders'} onToggle={(e) => { if ((e.target as HTMLDetailsElement).open && !r) void load(); }}>
      <summary>📲 WhatsApp reminders for Sunday{r ? ` · ${ssDayLabel(r.date, false)}` : ''}</summary>
      {err && <p className="notice notice-warn">{err}</p>}
      {!r && !err && <p className="muted">Getting the reminders ready…</p>}
      {r && (
        <>
          <p className="small muted">Dorothy also gets these by email every Thursday at 6 PM. Press a green button to open WhatsApp with the message ready, then press Send.</p>
          <h3>The teachers' group</h3>
          <pre className="tt-msg">{r.group}</pre>
          <div className="btn-line">
            <a className="btn btn-primary" href={waShare(r.group)} target="_blank" rel="noreferrer">Send to the group on WhatsApp</a>
            <button type="button" className="btn" onClick={() => void copy(r.group)}>Copy</button>
          </div>
          <h3>Each teacher</h3>
          <ul className="link-list">
            {r.list.map((t) => (
              <li key={t.classId}>
                <span className="link-title">{t.className}{t.teacher ? ` · ${t.teacher}` : ''}</span>
                <span className="btn-line">
                  {t.phone ? <a className="btn btn-primary" href={waLink(t.phone, t.text)} target="_blank" rel="noreferrer">WhatsApp</a> : <span className="small muted">No WhatsApp number on their account</span>}
                  <button type="button" className="btn btn-quiet" onClick={() => void copy(t.text)}>Copy</button>
                </span>
              </li>
            ))}
          </ul>
        </>
      )}
    </details>
  );
}
