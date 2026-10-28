import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useToast } from '../../state/ToastContext';
import { useExamAccess, useExamSettings, useExamTrainers, type ExamSheetRow } from '../../state/useExams';
import { createExamSheet, logExam } from '../../lib/examWrites';
import { friendlyError } from '../../lib/errors';
import { COMMON_DEPARTMENT } from '../../../functions/src/shared/commonCourses';

const ADD = '__add';

/**
 * The Common courses panel on ADIA's Attendance page (Andy, 2026-10-28, 1A-5A): pick the cohort, then the course,
 * see its tutor, and mark the register or key in results. The principal and the pastor can add a course here too.
 */
export function CommonCoursesPanel({ orgId, cohorts, sheets, onRegister, onClose }: {
  orgId: string;
  /** Open cohorts, newest first. */
  cohorts: string[];
  /** Common-course sheets this person may open: every one for the principal, their own for a lecturer. */
  sheets: ExamSheetRow[];
  onRegister: (sheet: ExamSheetRow) => void;
  onClose: () => void;
}) {
  const a = useExamAccess();
  const navigate = useNavigate();
  const [cohort, setCohort] = useState(cohorts[0] ?? '');
  const [sheetId, setSheetId] = useState('');
  const inCohort = useMemo(() => sheets.filter((s) => s.cohort === cohort).sort((x, y) => x.courseName.localeCompare(y.courseName)), [sheets, cohort]);
  const chosen = inCohort.find((s) => s.id === sheetId) ?? (sheetId === '' && inCohort.length === 1 ? inCohort[0] : undefined);
  const adding = a.canManage && (sheetId === ADD || (inCohort.length === 0 && !!cohort));

  return (
    <div className="common-panel" role="region" aria-label="Common courses">
      <div className="common-panel-head">
        <h3>Common courses</h3>
        <button type="button" className="btn btn-quiet btn-small" onClick={onClose} aria-label="Close common courses">Close</button>
      </div>
      {cohorts.length === 0 ? <p className="muted small">{a.canManage ? 'No open cohort yet.' : 'You have no common course yet. The principal gives you one in Exam Records.'}</p> : (
        <>
          <div className="common-pick">
            <label className="field"><span>Cohort</span>
              <select value={cohort} onChange={(e) => { setCohort(e.target.value); setSheetId(''); }}>
                {cohorts.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
            </label>
            <label className="field"><span>Course</span>
              <select value={adding ? ADD : chosen?.id ?? ''} onChange={(e) => setSheetId(e.target.value)}>
                {inCohort.length !== 1 && !adding && <option value="">{inCohort.length ? 'Pick the course' : 'No common course yet'}</option>}
                {inCohort.map((s) => <option key={s.id} value={s.id}>{s.courseName}</option>)}
                {a.canManage && <option value={ADD}>+ Add a common course</option>}
              </select>
            </label>
          </div>
          {adding ? (
            <AddCommonCourse orgId={orgId} cohort={cohort} known={[...new Set(sheets.map((s) => s.courseName))].sort()}
              taken={inCohort.map((s) => s.courseName.toLowerCase())}
              onAdded={(id) => setSheetId(id)} onCancel={inCohort.length ? () => setSheetId('') : undefined} />
          ) : chosen ? (
            <>
              <p className="common-tutor"><span className="muted">Tutor</span> <strong>{chosen.teacherName || chosen.ownerName}</strong></p>
              <div className="common-actions">
                <button type="button" className="btn btn-primary" onClick={() => onRegister(chosen)}>Mark register</button>
                <button type="button" className="btn" onClick={() => navigate(`/school/exams/sheet/${chosen.id}`)}>Key in results</button>
              </div>
            </>
          ) : null}
        </>
      )}
    </div>
  );
}

function AddCommonCourse({ orgId, cohort, known, taken, onAdded, onCancel }: {
  orgId: string; cohort: string; known: string[]; taken: string[]; onAdded: (id: string) => void; onCancel?: () => void;
}) {
  const a = useExamAccess();
  const toast = useToast();
  const { settings } = useExamSettings(orgId);
  const { trainers, loading } = useExamTrainers(orgId);
  // Common courses go to lecturers with Common courses ticked, or to the principal or the pastor (Andy, 2026-10-28).
  const tutors = trainers.filter((t) => t.lecturer === false || t.departments?.includes(COMMON_DEPARTMENT));
  const [name, setName] = useState('');
  const [semester, setSemester] = useState<1 | 2>(1);
  const [tutor, setTutor] = useState('');

  function save() {
    const course = name.trim().replace(/\s+/g, ' ').slice(0, 120);
    const t = tutors.find((x) => x.uid === tutor);
    if (!course) return toast.show('Type the course name.');
    if (taken.includes(course.toLowerCase())) return toast.show(`${cohort} already has ${course}.`);
    if (!t) return toast.show('Pick the tutor.');
    try {
      const { ref, synced } = createExamSheet(orgId, {
        cohort, courseId: null, courseName: course, teacherName: t.name.slice(0, 120),
        weights: settings.weights, ownerUid: t.uid, ownerName: t.name.slice(0, 120), semester,
      });
      synced.catch((err) => toast.show(friendlyError(err)));
      void logExam(orgId, { action: 'setup', cohort, sheetId: ref.id, detail: `Added ${course} (Common courses, Semester ${semester}) for ${t.name}`, byName: a.myName }).catch(() => {});
      toast.show(`${course} added for ${cohort}.`);
      onAdded(ref.id);
    } catch (err) { toast.show(friendlyError(err)); }
  }

  return (
    <div className="common-add">
      <div className="common-pick">
        <label className="field"><span>Course name</span>
          <input value={name} maxLength={120} list="common-course-names" placeholder="e.g. Leadership" onChange={(e) => setName(e.target.value)} autoFocus />
          <datalist id="common-course-names">{known.map((k) => <option key={k} value={k} />)}</datalist>
        </label>
        <label className="field"><span>Semester</span>
          <select value={semester} onChange={(e) => setSemester(e.target.value === '2' ? 2 : 1)}><option value="1">Semester 1</option><option value="2">Semester 2</option></select>
        </label>
        <label className="field"><span>Tutor</span>
          <select value={tutor} onChange={(e) => setTutor(e.target.value)}>
            <option value="">{loading ? 'Loading…' : 'Pick the tutor'}</option>
            {tutors.map((t) => <option key={t.uid} value={t.uid}>{t.name}</option>)}
          </select>
        </label>
      </div>
      {!loading && tutors.length === 0 && <p className="small muted">No tutor yet. Tick Common courses on a lecturer's account under Settings, Staff accounts.</p>}
      <div className="common-actions">
        <button type="button" className="btn btn-primary" onClick={save}>Add course</button>
        {onCancel && <button type="button" className="btn btn-quiet" onClick={onCancel}>Cancel</button>}
      </div>
    </div>
  );
}
