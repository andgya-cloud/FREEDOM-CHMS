import { useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useAuth } from '../../state/AuthContext';
import { useOrg, type Organization } from '../../state/OrgContext';
import { usePeople, type Person } from '../../state/PeopleContext';
import { useToast } from '../../state/ToastContext';
import { useEnrollments, useProgramMarks, usePrograms, useProgramSessions, type Enrollment, type Program } from '../../state/usePrograms';
import {
  APP_URL, blankStudentsExcel, importStudents, keepStudent, progressLinks, readStudentsFile, registerExcel, registerPdf, removeStudent, tickTopic,
  type GridRow, type StudentImportRow,
} from '../../lib/classRegister';
import { downloadFile } from '../../lib/givingPdf';
import { friendlyError } from '../../lib/errors';
import { ConfirmDialog } from '../../components/ConfirmDialog';
import { attended } from '../../../functions/src/shared/attendance';
import { formatDateKey, localDateKey } from '../../../functions/src/shared/datetime';
import { formatPhone, normalizePhone } from '../../../functions/src/shared/phone';
import { whatsappLink } from '../../../functions/src/shared/followups';
import { coverage, type Coverage } from '../../../functions/src/shared/programs';
import {
  clockLabel, F252_GRADUATION, F252_ID, groupReminderText, missedText, nextPlanned, percentOf, progressPath, reminderText,
} from '../../../functions/src/shared/classRegister';

interface Row { enrollment: Enrollment; person: Person; progress: Coverage; cells: ('class' | 'hand' | null)[] }

/**
 * The class register (Andy, 2026-11-09, 3A-7A): a row per student, a tick per topic, their %, who still needs
 * which topics, the "check these" list of people who joined by scanning, the WhatsApp reminders and the downloads.
 */
export function RegisterPage() {
  const { orgId = '', programId = '' } = useParams();
  const { organizations } = useOrg();
  const org = organizations.find((o) => o.id === orgId);
  const { programs, loading } = usePrograms(orgId);
  const program = programs.find((p) => p.id === programId);
  if (!org || !program) return <div className="page narrow"><p><Link to="/programs">← Programmes</Link></p><p>{loading ? 'Loading…' : 'This programme was not found.'}</p></div>;
  return <Register org={org} program={program} />;
}

function Register({ org, program }: { org: Organization; program: Program }) {
  const { can } = useAuth();
  const toast = useToast();
  const { byId } = usePeople();
  const { enrollments } = useEnrollments(org.id, { programId: program.id });
  const { sessions } = useProgramSessions(org.id, program.id);
  const marks = useProgramMarks(org.id, program.id);
  const [tick, setTick] = useState<{ row: Row; topicIndex: number } | null>(null);
  const [links, setLinks] = useState<Record<string, string>>({});
  const today = localDateKey(new Date(), org.timeZone);
  const topics = program.topics;
  const canWrite = can('programs.write');
  const graduation = program.id === F252_ID ? F252_GRADUATION : null;

  useEffect(() => { progressLinks(org.id, program.id).then(setLinks).catch(() => undefined); }, [org.id, program.id, enrollments.length]);

  const rows: Row[] = useMemo(() => enrollments
    .filter((e) => e.status !== 'dropped')
    .map((e) => {
      const person = byId(e.personId);
      if (!person) return null;
      const progress = coverage(topics, program.completionRule, sessions, marks.filter((m) => m.personId === e.personId), e.manualTopics);
      const viaClass = coverage(topics, program.completionRule, sessions, marks.filter((m) => m.personId === e.personId));
      const cells = topics.map((t) => (viaClass.covered.has(t.id) ? 'class' : progress.covered.has(t.id) ? 'hand' : null)) as Row['cells'];
      return { enrollment: e, person, progress, cells };
    })
    .filter((r): r is Row => r !== null)
    .sort((a, b) => b.progress.count - a.progress.count || a.person.fullName.localeCompare(b.person.fullName)), [enrollments, byId, topics, program.completionRule, sessions, marks]);

  const grid: GridRow[] = rows.map((r) => ({ name: r.person.fullName, phone: formatPhone(r.person.phone), cells: r.cells, done: r.progress.count }));
  const toCheck = rows.filter((r) => r.enrollment.selfAdded);
  const notDone = rows.filter((r) => r.progress.count < topics.length);
  const graduated = rows.length - notDone.length;

  async function download(kind: 'pdf' | 'xlsx') {
    try {
      downloadFile(kind === 'pdf' ? await registerPdf(org, program, grid, today, graduation) : await registerExcel(org, program, grid, today));
    } catch (err) {
      toast.show(friendlyError(err));
    }
  }

  function doTick() {
    if (!tick) return;
    const t = topics[tick.topicIndex]!;
    const had = tick.row.cells[tick.topicIndex] === 'hand';
    tickTopic(org.id, tick.row.enrollment.id, t.id, had ? null : today).catch((err) => toast.show(friendlyError(err)));
    toast.show(had ? `Tick taken back for ${tick.row.person.fullName}` : `${t.name} ticked for ${tick.row.person.fullName}`);
    setTick(null);
  }

  const tickTopicName = tick ? topics[tick.topicIndex]?.name ?? '' : '';
  const tickIsHand = tick ? tick.row.cells[tick.topicIndex] === 'hand' : false;

  return (
    <div className="page fin-wide">
      <p><Link to={`/programs/${org.id}/${program.id}`}>← {program.name}</Link></p>
      <div className="person-head">
        <div>
          <h1>{program.name} register</h1>
          <p className="muted">{rows.length} students · {graduated} at 100%{graduation ? ` · Graduation ${formatDateKey(graduation)}` : ''}</p>
        </div>
        <div className="cleanup-head-actions">
          {can('attendance.write') && <Link className="btn btn-primary" to={`/class-qr/${org.id}/${program.id}`}>Class check-in</Link>}
          <button type="button" className="btn" onClick={() => void download('pdf')}>PDF</button>
          <button type="button" className="btn" onClick={() => void download('xlsx')}>Excel</button>
        </div>
      </div>

      {toCheck.length > 0 && (
        <section className="card">
          <div className="card-head"><h2>Check these</h2><span className="muted small">Joined by scanning the QR code</span></div>
          <ul className="row-list">
            {toCheck.map((r) => (
              <li key={r.enrollment.id} className="row">
                <span className="row-main">
                  <Link className="row-title" to={`/people/${r.person.id}`}>{r.person.fullName}</Link>
                  <span className="row-detail">{formatPhone(r.person.phone)} · joined {formatDateKey(r.enrollment.enrolledDate)}</span>
                </span>
                {canWrite && (
                  <span className="cleanup-head-actions">
                    <button type="button" className="btn btn-quiet" onClick={() => void removeStudent(org.id, r.enrollment.id).catch((err) => toast.show(friendlyError(err)))}>Remove</button>
                    <button type="button" className="btn" onClick={() => void keepStudent(org.id, r.enrollment.id).catch((err) => toast.show(friendlyError(err)))}>OK</button>
                  </span>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="card">
        <div className="card-head">
          <h2>Register</h2>
          <span className="muted small"><span className="reg-dot" /> at class · <span className="reg-hand">H</span> ticked by hand{canWrite ? ' · tap a box to tick' : ''}</span>
        </div>
        {rows.length === 0 ? <p className="muted">No students yet.</p> : (
          <div className="reg-scroll">
            <table className="reg-grid">
              <thead>
                <tr>
                  <th className="reg-name">Student</th>
                  {topics.map((t, i) => <th key={t.id} title={t.name}>{i + 1}</th>)}
                  <th>%</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.enrollment.id}>
                    <th className="reg-name" scope="row">{r.person.fullName}</th>
                    {r.cells.map((c, i) => (
                      <td key={topics[i]!.id}>
                        <button type="button" className={`reg-cell ${c ?? ''}`} disabled={!canWrite || c === 'class'}
                          title={`${topics[i]!.name}${c === 'class' ? ': at class' : c === 'hand' ? ': ticked by hand' : ''}`}
                          aria-label={`${r.person.fullName}, ${topics[i]!.name}: ${c === 'class' ? 'done at class' : c === 'hand' ? 'ticked by hand' : 'not yet'}`}
                          onClick={() => setTick({ row: r, topicIndex: i })}>
                          {c === 'class' ? <span className="reg-dot" /> : c === 'hand' ? 'H' : ''}
                        </button>
                      </td>
                    ))}
                    <td className="reg-pct">{percentOf(r.progress.count, topics.length)}%</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <details className="fold">
          <summary>Topics 1 to {topics.length}</summary>
          <ol className="plain small">
            {topics.map((t) => {
              const p = program.plan?.find((x) => x.topicId === t.id);
              return <li key={t.id}>{t.name}{p ? <span className="muted"> · {formatDateKey(p.date)}</span> : null}</li>;
            })}
          </ol>
        </details>
      </section>

      {notDone.length > 0 && (
        <section className="card">
          <details className="fold">
            <summary><strong>Still to do before graduation</strong> <span className="muted">({notDone.length} students)</span></summary>
            <ul className="plain">
              {notDone.map((r) => (
                <li key={r.enrollment.id}>
                  <strong>{r.person.fullName}</strong> <span className="muted small">· {topics.length - r.progress.count} left: {topics.filter((_, i) => !r.cells[i]).map((t) => t.name).join(', ')}</span>
                </li>
              ))}
            </ul>
          </details>
        </section>
      )}

      <Reminders org={org} program={program} rows={rows} links={links} today={today} marks={marks} />

      {canWrite && <AddStudents org={org} program={program} />}

      <ConfirmDialog
        open={!!tick}
        title={tickIsHand ? 'Take the tick back?' : 'Tick this topic as done?'}
        body={tick ? (tickIsHand
          ? `${tick.row.person.fullName} will no longer have "${tickTopicName}" done.`
          : `Mark "${tickTopicName}" as done for ${tick.row.person.fullName}, for a special case such as catching up another way. A make-up class with the QR code is the usual way.`) : ''}
        confirmLabel={tickIsHand ? 'Take back' : 'Tick as done'}
        danger={tickIsHand}
        onConfirm={doTick}
        onCancel={() => setTick(null)}
      />
    </div>
  );
}

/** Monday and Wednesday WhatsApp messages (6A): tap Send for each person, or copy one message to the class group. */
function Reminders({ org, program, rows, links, today, marks }: { org: Organization; program: Program; rows: Row[]; links: Record<string, string>; today: string; marks: { eventId: string; personId: string; status: string; deletedAt: unknown }[] }) {
  const toast = useToast();
  const [sent, setSent] = useState<Set<string>>(new Set());
  const plan = program.plan ?? [];
  if (!plan.length) return null;
  const time = clockLabel(program.classStart);
  const next = nextPlanned(plan, today);
  const last = [...plan].sort((a, b) => b.date.localeCompare(a.date)).find((p) => p.date < today || (p.date === today && marks.some((m) => m.eventId.startsWith(`${today}_${program.id}_`))));
  const topicName = (id: string) => program.topics.find((t) => t.id === id)?.name ?? '';
  const linkFor = (r: Row) => (links[r.enrollment.id] ? `${APP_URL}${progressPath(org.id, links[r.enrollment.id]!)}` : '');
  const reachable = rows.filter((r) => (r.person.whatsapp || r.person.phone) && !r.person.whatsappConsent?.stoppedAt && r.progress.count < program.topics.length);
  const first = (r: Row) => r.person.fullName.split(' ')[0] ?? r.person.fullName;
  const when = (date: string) => (date === today ? 'today' : `on ${formatDateKey(date)}`);
  const missed = last ? reachable.filter((r) => !marks.some((m) => m.personId === r.person.id && !m.deletedAt && attended(m.status) && m.eventId.startsWith(`${last.date}_${program.id}_`))) : [];

  const send = (r: Row, text: string, key: string) => {
    window.open(whatsappLink(r.person.whatsapp || r.person.phone || '', text), '_blank', 'noopener');
    setSent((s) => new Set(s).add(key));
  };
  const copyGroup = async (text: string) => {
    try { await navigator.clipboard.writeText(text); toast.show('Copied. Paste it in the class WhatsApp group.'); }
    catch { window.open(`https://wa.me/?text=${encodeURIComponent(text)}`, '_blank', 'noopener'); }
  };

  return (
    <section className="card">
      <h2>WhatsApp reminders</h2>
      {next && (
        <details className="fold">
          <summary><strong>Before the class</strong> <span className="muted">· {formatDateKey(next.date)}: {topicName(next.topicId)}</span></summary>
          <button type="button" className="btn" onClick={() => void copyGroup(groupReminderText(program.name, when(next.date), topicName(next.topicId), time))}>Copy one message for the class group</button>
          <ul className="row-list">
            {reachable.map((r) => {
              const key = `next_${r.enrollment.id}`;
              return (
                <li key={key} className="row">
                  <span className="row-main"><span className="row-title">{r.person.fullName}</span><span className="row-detail">{percentOf(r.progress.count, program.topics.length)}%</span></span>
                  <button type="button" className={`btn ${sent.has(key) ? 'btn-quiet' : ''}`} onClick={() => send(r, reminderText(first(r), program.name, when(next.date), topicName(next.topicId), time, r.progress.count, program.topics.length, linkFor(r)), key)}>
                    {sent.has(key) ? 'Sent ✓' : 'Send'}
                  </button>
                </li>
              );
            })}
          </ul>
        </details>
      )}
      {last && (
        <details className="fold">
          <summary><strong>We missed you</strong> <span className="muted">· {formatDateKey(last.date)}: {missed.length} missed</span></summary>
          {missed.length === 0 ? <p className="muted">Everyone was there.</p> : (
            <ul className="row-list">
              {missed.map((r) => {
                const key = `missed_${r.enrollment.id}`;
                return (
                  <li key={key} className="row">
                    <span className="row-main"><span className="row-title">{r.person.fullName}</span><span className="row-detail">{percentOf(r.progress.count, program.topics.length)}%</span></span>
                    <button type="button" className={`btn ${sent.has(key) ? 'btn-quiet' : ''}`} onClick={() => send(r, missedText(first(r), program.name, formatDateKey(last.date), topicName(last.topicId), r.progress.count, program.topics.length, linkFor(r)), key)}>
                      {sent.has(key) ? 'Sent ✓' : 'Send'}
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </details>
      )}
    </section>
  );
}

/**
 * Add students from a list (Andy, 2026-11-09, 1A-5A): Excel, CSV or PDF. The list shows first so names and numbers
 * can be fixed and anyone unticked (2A); a number that is not right is flagged, and the person is still added (5A).
 */
function AddStudents({ org, program }: { org: Organization; program: Program }) {
  const toast = useToast();
  const [rows, setRows] = useState<(StudentImportRow & { on: boolean })[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ added: number; enrolled: number; already: number; problems: string[] } | null>(null);
  const chosen = rows?.filter((r) => r.on && r.name.trim()) ?? [];
  const badPhone = (p: string) => !!p.trim() && !normalizePhone(p);

  async function pick(file: File | undefined) {
    if (!file) return;
    setResult(null);
    setBusy(true);
    try {
      const found = await readStudentsFile(file);
      if (!found.length) throw new Error('No students found in this file.');
      setRows(found.map((r) => ({ ...r, on: true })));
    } catch (err) { toast.show(friendlyError(err)); }
    finally { setBusy(false); }
  }
  const edit = (i: number, change: Partial<StudentImportRow & { on: boolean }>) => setRows((rs) => rs?.map((r, j) => (j === i ? { ...r, ...change } : r)) ?? null);
  async function add() {
    if (!chosen.length) return;
    setBusy(true);
    try { setResult(await importStudents(org.id, program.id, chosen.map(({ on: _on, ...r }) => r))); setRows(null); }
    catch (err) { toast.show(friendlyError(err)); }
    finally { setBusy(false); }
  }
  async function blank() {
    try { downloadFile(await blankStudentsExcel(program.name)); } catch (err) { toast.show(friendlyError(err)); }
  }

  return (
    <section className="card">
      <details className="fold" open={rows || result ? true : undefined}>
        <summary><strong>Add students from a list</strong> <span className="muted">· Excel or PDF</span></summary>
        <p className="muted small">The list needs a Name column; Phone, Email, Preferred contact and Message are used if there. Anyone already in People is matched by phone or email, not added twice.</p>
        <div className="cleanup-head-actions class-actions">
          <label className="btn btn-primary">
            {busy && !rows ? 'Reading…' : 'Choose Excel or PDF file'}
            <input type="file" className="visually-hidden" accept=".xlsx,.csv,.pdf,application/pdf" onChange={(e) => { void pick(e.target.files?.[0]); e.target.value = ''; }} />
          </label>
          <button type="button" className="btn btn-quiet" onClick={() => void blank()}>Download blank Excel</button>
        </div>
        {rows && (
          <div className="stack">
            <p><strong>{rows.length} found.</strong> Check them, fix anything wrong, untick anyone to leave out.</p>
            <div className="reg-scroll">
              <table className="reg-grid import-check">
                <thead><tr><th /><th className="reg-name">Name</th><th>Phone</th><th>Email</th></tr></thead>
                <tbody>
                  {rows.map((r, i) => (
                    <tr key={i} className={r.on ? '' : 'muted'}>
                      <td><input type="checkbox" checked={r.on} aria-label={`Add ${r.name}`} onChange={(e) => edit(i, { on: e.target.checked })} /></td>
                      <td><input value={r.name} maxLength={120} onChange={(e) => edit(i, { name: e.target.value })} aria-label="Name" /></td>
                      <td>
                        <input type="tel" value={r.phone} maxLength={30} className={badPhone(r.phone) ? 'input-bad' : ''} onChange={(e) => edit(i, { phone: e.target.value })} aria-label="Phone" />
                        {badPhone(r.phone) && <small className="error">Number not right</small>}
                      </td>
                      <td className="small">{r.email}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="cleanup-head-actions">
              <button type="button" className="btn btn-quiet" onClick={() => setRows(null)}>Cancel</button>
              <button type="button" className="btn btn-primary" disabled={busy || !chosen.length} onClick={() => void add()}>{busy ? 'Adding…' : `Add and enrol ${chosen.length} students`}</button>
            </div>
          </div>
        )}
        {result && (
          <div className="notice">
            <p><strong>{result.enrolled} enrolled</strong> ({result.added} new in People){result.already ? `, ${result.already} were already enrolled` : ''}.</p>
            {result.problems.map((p) => <p key={p} className="small">{p}</p>)}
          </div>
        )}
      </details>
    </section>
  );
}
