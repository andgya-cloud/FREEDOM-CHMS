import { useMemo, useState, type FormEvent } from 'react';
import { CleanupButton } from '../../components/CleanupDialog';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useAuth } from '../../state/AuthContext';
import { useOrg, type Organization } from '../../state/OrgContext';
import { usePeople } from '../../state/PeopleContext';
import { useToast } from '../../state/ToastContext';
import {
  useCohorts,
  useEnrollments,
  useProgramMarks,
  usePrograms,
  useProgramSessions,
  type Cohort,
  type Enrollment,
  type Program,
} from '../../state/usePrograms';
import { addCohort, enrol, startProgramSession } from '../../lib/programWrites';
import { friendlyError } from '../../lib/errors';
import { useSavedMessage } from '../../lib/useSavedMessage';
import { PersonPicker } from '../../components/PersonPicker';
import { StudentSheet } from '../../components/StudentSheet';
import { formatDateKey, localDateKey } from '../../../functions/src/shared/datetime';
import { attended } from '../../../functions/src/shared/attendance';
import {
  coverage,
  enrollmentStatusLabel,
  nextEnrollmentState,
  programSessionIdFor,
  type Coverage,
  type EnrollmentStatus,
} from '../../../functions/src/shared/programs';

export interface StudentRow {
  enrollment: Enrollment;
  name: string;
  progress: Coverage;
  /** What the server will record once this device syncs: the same rule, applied here. */
  status: EnrollmentStatus;
  completedDate: string | null;
}

/** One programme: start a class, its cohorts, and every student's progress. */
export function ProgramPage() {
  const { orgId = '', programId = '' } = useParams();
  const { organizations, currentId, select } = useOrg();
  const org = organizations.find((o) => o.id === orgId);
  const { programs, loading } = usePrograms(orgId);
  const program = programs.find((p) => p.id === programId);

  if (org && currentId !== orgId) {
    return (
      <div className="page narrow">
        <p><Link to="/programs">← Programmes</Link></p>
        <div className="notice">
          <p>This belongs to {org.name}.</p>
          <button type="button" className="btn btn-primary" onClick={() => select(orgId)}>Switch to {org.name}</button>
        </div>
      </div>
    );
  }
  if (!org || !program) {
    return (
      <div className="page narrow">
        <p><Link to="/programs">← Programmes</Link></p>
        <p>{loading ? 'Loading…' : 'This programme was not found.'}</p>
      </div>
    );
  }
  return <ProgramView org={org} program={program} />;
}

function ProgramView({ org, program }: { org: Organization; program: Program }) {
  const { can } = useAuth();
  const { byId } = usePeople();
  const { cohorts } = useCohorts(org.id, program.id);
  const { enrollments, all } = useEnrollments(org.id, { programId: program.id });
  const { sessions } = useProgramSessions(org.id, program.id);
  const marks = useProgramMarks(org.id, program.id);
  const [cohortFilter, setCohortFilter] = useState<string>('all');
  const [statusFilter, setStatusFilter] = useState<EnrollmentStatus>('active');
  const [openId, setOpenId] = useState<string | null>(null);
  const [addingCohort, setAddingCohort] = useState(false);
  const canWrite = can('programs.write');
  const total = program.topics.length;
  const topicName = useMemo(() => new Map(program.topics.map((t) => [t.id, t.name])), [program.topics]);
  const cohortName = (id: string | null) => (id ? cohorts.find((c) => c.id === id)?.name ?? 'Cohort' : 'No cohort');

  const students: StudentRow[] = useMemo(() => enrollments
    .map((e) => {
      const person = byId(e.personId);
      if (!person) return null;
      const progress = coverage(program.topics, program.completionRule, sessions, marks.filter((m) => m.personId === e.personId));
      const next = nextEnrollmentState({ status: e.status, completedDate: e.completedDate, completedAuto: e.completedAuto }, progress);
      return { enrollment: e, name: person.fullName, progress, status: next.status, completedDate: next.completedDate };
    })
    .filter((r): r is StudentRow => r !== null)
    .sort((a, b) => a.name.localeCompare(b.name)), [enrollments, byId, program, sessions, marks]);

  const shown = students.filter((s) => s.status === statusFilter && (cohortFilter === 'all' || s.enrollment.cohortId === cohortFilter));
  const counts = { active: 0, completed: 0, dropped: 0 } as Record<EnrollmentStatus, number>;
  for (const s of students) counts[s.status]++;
  const open = students.find((s) => s.enrollment.id === openId);
  const presentAt = (eventId: string) => marks.filter((m) => m.eventId === eventId && !m.deletedAt && attended(m.status)).length;

  return (
    <div className="page narrow">
      <p><Link to="/programs">← Programmes</Link></p>
      <div className="person-head">
        <div>
          <h1>{program.name}</h1>
          {program.description && <p className="muted">{program.description}</p>}
          {program.schedule && <p className="muted small">Classes: {program.schedule}</p>}
        </div>
        <div className="cleanup-head-actions">
          {can('settings.manage') && <Link className="btn" to={`/programs/${org.id}/${program.id}/edit`}>Edit</Link>}
          <CleanupButton orgId={org.id} kind="programme" id={program.id} back="/programs" />
        </div>
      </div>

      {total === 0 && (
        <div className="notice notice-warn">
          <strong>No topics yet.</strong>
          <span>Classes can be recorded, but nobody can complete {program.name} until its topics are added{can('settings.manage') ? '' : ' by the pastor'}.</span>
          {can('settings.manage') && <Link className="btn align-start" to={`/programs/${org.id}/${program.id}/edit`}>Add topics</Link>}
        </div>
      )}

      {can('attendance.write') && <StartClass org={org} program={program} cohorts={cohorts.filter((c) => c.active)} sessions={sessions} />}

      <section className="card">
        <div className="card-head">
          <h2>Students</h2>
          <span className="muted small">{counts.active} enrolled · {counts.completed} {program.completedLabel.toLowerCase()}</span>
        </div>
        <div className="segmented wrap" role="group" aria-label="Show">
          {(['active', 'completed', 'dropped'] as const).map((s) => (
            <button key={s} type="button" className={statusFilter === s ? 'on' : ''} onClick={() => setStatusFilter(s)}>
              {enrollmentStatusLabel(s, program.completedLabel)} ({counts[s]})
            </button>
          ))}
        </div>
        {cohorts.length > 0 && (
          <div className="chips">
            <button type="button" className={`chip ${cohortFilter === 'all' ? 'chip-on' : ''}`} onClick={() => setCohortFilter('all')}>All cohorts</button>
            {cohorts.map((c) => (
              <button key={c.id} type="button" className={`chip ${cohortFilter === c.id ? 'chip-on' : ''}`} onClick={() => setCohortFilter(c.id)}>{c.name}</button>
            ))}
          </div>
        )}
        {shown.length === 0 ? <p className="muted">Nobody here yet.</p> : (
          <ul className="row-list">
            {shown.map((s) => (
              <li key={s.enrollment.id}>
                <button type="button" className="row row-button" onClick={() => setOpenId(s.enrollment.id)}>
                  <span className="row-main">
                    <span className="row-title">
                      {s.name}
                      {s.status === 'completed' && <span className="badge badge-regular">{program.completedLabel}</span>}
                    </span>
                    <span className="row-detail">
                      {cohortName(s.enrollment.cohortId)}{total ? ` · ${s.progress.count} of ${total} topics` : ''}
                      {s.status === 'completed' && s.completedDate ? ` · ${formatDateKey(s.completedDate)}` : ''}
                    </span>
                    {total > 0 && <span className="progress" aria-hidden="true"><span style={{ width: `${Math.round((s.progress.count / total) * 100)}%` }} /></span>}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
        {canWrite && <EnrolSomeone org={org} program={program} cohorts={cohorts.filter((c) => c.active)} all={all} />}
      </section>

      <section className="card">
        <div className="card-head">
          <h2>Cohorts</h2>
          {canWrite && !addingCohort && <button type="button" className="btn btn-quiet" onClick={() => setAddingCohort(true)}>New cohort</button>}
        </div>
        {addingCohort && <NewCohort org={org} program={program} onDone={() => setAddingCohort(false)} />}
        {cohorts.length === 0 && !addingCohort ? <p className="muted">No cohorts yet. A cohort is a group that starts together, for example "November 2026".</p> : (
          <ul className="plain">
            {cohorts.map((c) => (
              <li key={c.id}>
                <strong>{c.name}</strong>{!c.active && <span className="badge badge-muted"> Finished</span>}
                <span className="muted small"> · from {formatDateKey(c.startDate)}{c.schedule ? ` · ${c.schedule}` : ''} · {students.filter((s) => s.enrollment.cohortId === c.id && s.status !== 'dropped').length} students</span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="stack">
        <h2>Classes</h2>
        {sessions.length === 0 ? <p className="muted">No classes recorded yet.</p> : (
          <ul className="link-list">
            {sessions.map((s) => (
              <li key={s.id}>
                <Link to={`/attendance/${org.id}/${s.id}`}>
                  <span className="link-title">{formatDateKey(s.date)} · {s.cohortId ? cohortName(s.cohortId) : 'Make-up class'}</span>
                  <span className="link-detail">
                    {(s.topicIds ?? []).map((t) => topicName.get(t) ?? 'Removed topic').join(', ') || 'No topic chosen'}
                    {s.mentor ? ` · ${s.mentor}` : ''} · {presentAt(s.id)} present
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>

      {open && (
        <StudentSheet
          org={org}
          program={program}
          cohorts={cohorts}
          sessions={sessions}
          row={open}
          onClose={() => setOpenId(null)}
        />
      )}
    </div>
  );
}

/** Start (or open) today's class: pick the cohort, the topic and who is teaching. */
function StartClass({ org, program, cohorts, sessions }: { org: Organization; program: Program; cohorts: Cohort[]; sessions: { id: string; cohortId?: string | null; topicIds?: string[] }[] }) {
  const toast = useToast();
  const navigate = useNavigate();
  const today = localDateKey(new Date(), org.timeZone);
  const [date, setDate] = useState(today);
  // Cohorts can arrive after the page opens, so the first one is the default until staff choose.
  const [chosen, setCohortId] = useState<string | null | undefined>(undefined);
  const cohortId = chosen === undefined ? cohorts[0]?.id ?? null : chosen;
  const [picked, setPicked] = useState<string[] | null>(null);
  const [mentor, setMentor] = useState<{ id: string | null; name: string }>({ id: null, name: '' });
  const cohort = cohorts.find((c) => c.id === cohortId) ?? null;
  const id = programSessionIdFor(date, program.id, cohort?.id ?? null);
  const already = sessions.some((s) => s.id === id);

  // Suggest the first topic this cohort has not had yet.
  const taught = new Set(sessions.filter((s) => s.cohortId === cohortId).flatMap((s) => s.topicIds ?? []));
  const suggested = cohort ? program.topics.find((t) => !taught.has(t.id))?.id : undefined;
  const topicIds = picked ?? (suggested ? [suggested] : []);
  const toggle = (t: string) => setPicked(topicIds.includes(t) ? topicIds.filter((x) => x !== t) : [...topicIds, t].slice(0, 10));

  function start(e: FormEvent) {
    e.preventDefault();
    try {
      const { synced } = startProgramSession(org.id, program, cohort, date, topicIds, mentor, already);
      synced.catch((err) => toast.show(friendlyError(err)));
      navigate(`/attendance/${org.id}/${id}`);
    } catch (err) {
      toast.show(friendlyError(err));
    }
  }

  return (
    <form className="card form" onSubmit={start}>
      <div className="card-head">
        <h2>Take a class</h2>
        <label className="date-pick">
          <span className="visually-hidden">Date</span>
          <input type="date" value={date} max={today} onChange={(e) => setDate(e.target.value || today)} />
        </label>
      </div>
      <div className="field">
        <span>Which class?</span>
        <div className="chips">
          {cohorts.map((c) => (
            <button key={c.id} type="button" className={`chip ${cohortId === c.id ? 'chip-on' : ''}`} onClick={() => { setCohortId(c.id); setPicked(null); }}>{c.name}</button>
          ))}
          <button type="button" className={`chip ${cohortId === null ? 'chip-on' : ''}`} onClick={() => { setCohortId(null); setPicked(null); }}>Make-up class</button>
        </div>
        {cohortId === null && <small className="hint">Open to everyone enrolled, whatever their cohort.</small>}
      </div>
      {program.topics.length > 0 && !already && (
        <div className="field">
          <span>Topic covered</span>
          <div className="chips topic-chips">
            {program.topics.map((t) => (
              <button key={t.id} type="button" className={`chip ${topicIds.includes(t.id) ? 'chip-on' : ''}`} aria-pressed={topicIds.includes(t.id)} onClick={() => toggle(t.id)}>{t.name}</button>
            ))}
          </div>
        </div>
      )}
      {!already && <PersonPicker label="Mentor or teacher" value={mentor} onChange={setMentor} allowFreeText orgId={org.id} />}
      <button type="submit" className="btn btn-primary btn-lg">{already ? 'Open this class' : 'Start class'}</button>
    </form>
  );
}

function NewCohort({ org, program, onDone }: { org: Organization; program: Program; onDone: () => void }) {
  const toast = useToast();
  const saved = useSavedMessage();
  const [name, setName] = useState('');
  const [startDate, setStartDate] = useState(localDateKey(new Date(), org.timeZone));
  const [schedule, setSchedule] = useState(program.schedule);

  function submit(e: FormEvent) {
    e.preventDefault();
    if (!name.trim() || !startDate) return;
    try {
      const { synced } = addCohort(org.id, { programId: program.id, name: name.trim(), startDate, endDate: null, schedule: schedule.trim() });
      synced.catch((err) => toast.show(friendlyError(err)));
      toast.show(saved(`${name.trim()} added`));
      onDone();
    } catch (err) {
      toast.show(friendlyError(err));
    }
  }

  return (
    <form className="form" onSubmit={submit}>
      <label className="field"><span>Cohort name</span><input autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="For example November 2026" /></label>
      <div className="field-row">
        <label className="field"><span>Starts</span><input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} /></label>
        <label className="field"><span>Meets</span><input value={schedule} onChange={(e) => setSchedule(e.target.value)} placeholder="Tuesday 20:00" /></label>
      </div>
      <div className="dialog-actions">
        <button type="button" className="btn btn-quiet" onClick={onDone}>Cancel</button>
        <button type="submit" className="btn btn-primary" disabled={!name.trim()}>Add cohort</button>
      </div>
    </form>
  );
}

function EnrolSomeone({ org, program, cohorts, all }: { org: Organization; program: Program; cohorts: Cohort[]; all: Enrollment[] }) {
  const toast = useToast();
  const saved = useSavedMessage();
  const [who, setWho] = useState<{ id: string | null; name: string }>({ id: null, name: '' });
  const [chosen, setCohortId] = useState<string | null | undefined>(undefined);
  const cohortId = chosen === undefined ? cohorts[0]?.id ?? null : chosen;
  const existing = who.id ? all.find((e) => e.personId === who.id) : undefined;
  const alreadyIn = existing && !existing.deletedAt && existing.status !== 'dropped';

  function submit(e: FormEvent) {
    e.preventDefault();
    if (!who.id || alreadyIn) return;
    enrol(org.id, program.id, who.id, cohortId, localDateKey(new Date(), org.timeZone), existing)
      .catch((err) => toast.show(friendlyError(err)));
    toast.show(saved(`${who.name} enrolled in ${program.name}`));
    setWho({ id: null, name: '' });
  }

  return (
    <form className="form enrol-form" onSubmit={submit}>
      <PersonPicker label="Enrol someone" value={who} onChange={setWho} orgId={org.id} hint="Type a name or phone number." />
      {alreadyIn && <p className="hint">{who.name} is already in {program.name}.</p>}
      {cohorts.length > 0 && (
        <label className="field">
          <span>Cohort</span>
          <select value={cohortId ?? ''} onChange={(e) => setCohortId(e.target.value || null)}>
            {cohorts.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            <option value="">No cohort (joins any class)</option>
          </select>
        </label>
      )}
      <button type="submit" className="btn" disabled={!who.id || !!alreadyIn}>Enrol</button>
    </form>
  );
}
