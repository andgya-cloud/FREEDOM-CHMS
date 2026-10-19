import { useEffect, useState } from 'react';
import { useAuth } from '../../state/AuthContext';
import { useToast } from '../../state/ToastContext';
import { friendlyError } from '../../lib/errors';
import { saveAssessment, saveMark } from '../../lib/schoolWrites';
import { csvFile } from '../../lib/schoolPdf';
import { downloadFile } from '../../lib/givingPdf';
import { formatDateKey } from '../../../functions/src/shared/datetime';
import { ASSESSMENT_TYPE_LABELS, ASSESSMENT_TYPES, STUDENT_STATUS_LABELS, type AssessmentType } from '../../../functions/src/shared/school';
import { SchoolGate, SchoolNav, useSchoolPage } from './common';
import type { Organization } from '../../state/OrgContext';

export function ResultsPage() {
  return <SchoolGate title="Results">{(org) => <Results org={org} />}</SchoolGate>;
}

function Results({ org }: { org: Organization }) {
  const s = useSchoolPage(org);
  const { can } = useAuth();
  const toast = useToast();
  const [courseId, setCourseId] = useState('');
  const [assessmentId, setAssessmentId] = useState('');
  const course = s.courses.find((c) => c.id === courseId);
  const assessments = s.assessments.filter((a) => a.courseId === courseId);
  const assessment = assessments.find((a) => a.id === assessmentId);
  const unit = course?.units.find((u) => u.id === assessment?.unitId);
  const roster = s.students
    .filter((st) => st.courseId === courseId && st.status === 'enrolled' && (!unit?.level || st.level === unit.level))
    .map((st) => ({ st, name: s.nameOf(st.id) }))
    .sort((a, b) => a.name.localeCompare(b.name));
  const editable = can('programs.write');

  const [form, setForm] = useState<{ unitId: string; type: AssessmentType; name: string; maxMarks: string; date: string }>({ unitId: '', type: 'continuous', name: '', maxMarks: '100', date: s.today });
  const [exam, setExam] = useState('');

  function create() {
    const max = Number(form.maxMarks);
    if (!courseId || !form.unitId || !form.name.trim() || !(max > 0 && max <= 1000)) return toast.show('Choose the unit, give the assessment a name and a maximum mark (1 to 1000).');
    const { id, synced } = saveAssessment(org.id, null, { courseId, unitId: form.unitId, type: form.type, name: form.name.trim().slice(0, 120), maxMarks: max, date: form.date || s.today });
    synced.catch((err) => toast.show(friendlyError(err)));
    setAssessmentId(id);
    setForm((f) => ({ ...f, name: '' }));
    toast.show('Assessment added');
  }

  function candidates() {
    const rows = s.students
      .filter((st) => st.courseId === courseId && st.status === 'enrolled' && (!exam || st.intakeId === exam))
      .map((st) => [st.admissionNo ?? '', s.nameOf(st.id), course?.name ?? '', st.level, s.intakeName(st.intakeId), STUDENT_STATUS_LABELS[st.status]])
      .sort((a, b) => String(a[1]).localeCompare(String(b[1])));
    downloadFile(csvFile(`Exam candidates ${course?.name ?? ''}.csv`, [['Admission number', 'Name', 'Programme', 'Level', 'Intake', 'Status'], ...rows]));
  }

  return (
    <div className="page narrow">
      <div className="page-head"><h1>Results</h1></div>
      <SchoolNav feesAllowed={s.feesAllowed} />
      <label className="field"><span>Programme</span>
        <select value={courseId} onChange={(e) => { setCourseId(e.target.value); setAssessmentId(''); setForm((f) => ({ ...f, unitId: '' })); }}>
          <option value="">Choose…</option>
          {s.courses.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
      </label>
      {course && (
        <>
          {course.units.length === 0 && <p className="notice notice-warn small">This programme has no units yet. Add them under Courses first.</p>}
          {editable && course.units.length > 0 && (
            <section className="card stack">
              <h2>New assessment</h2>
              <div className="field-row">
                <label className="field"><span>Unit</span>
                  <select value={form.unitId} onChange={(e) => setForm({ ...form, unitId: e.target.value })}>
                    <option value="">Choose…</option>
                    {course.units.map((u) => <option key={u.id} value={u.id}>{u.name}{u.level ? ` (${u.level})` : ''}</option>)}
                  </select>
                </label>
                <label className="field"><span>Type</span>
                  <select value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value as AssessmentType })}>
                    {ASSESSMENT_TYPES.map((t) => <option key={t} value={t}>{ASSESSMENT_TYPE_LABELS[t]}</option>)}
                  </select>
                </label>
              </div>
              <label className="field"><span>Name</span><input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Cat 1, Practical test, End exam" /></label>
              <div className="field-row">
                <label className="field"><span>Out of</span><input type="number" inputMode="numeric" value={form.maxMarks} onChange={(e) => setForm({ ...form, maxMarks: e.target.value })} /></label>
                <label className="field"><span>Date</span><input type="date" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} /></label>
              </div>
              <button type="button" className="btn btn-primary align-start" onClick={create}>Add assessment</button>
            </section>
          )}
          <section className="card stack">
            <h2>Enter marks</h2>
            <label className="field"><span>Assessment</span>
              <select value={assessmentId} onChange={(e) => setAssessmentId(e.target.value)}>
                <option value="">Choose…</option>
                {assessments.map((a) => <option key={a.id} value={a.id}>{a.name} · {course.units.find((u) => u.id === a.unitId)?.name ?? 'unit'} · {formatDateKey(a.date)}</option>)}
              </select>
            </label>
            {assessment && (
              <>
                <p className="small muted">{ASSESSMENT_TYPE_LABELS[assessment.type]}, out of {assessment.maxMarks}. {unit?.level ? `Students at ${unit.level}.` : 'All enrolled students.'}</p>
                {roster.length === 0 ? <p className="muted">No enrolled students for this unit.</p> : (
                  <ul className="row-list">
                    {roster.map(({ st, name }) => (
                      <MarkRow key={st.id} name={name} max={assessment.maxMarks} disabled={!editable}
                        existing={s.marks.find((m) => m.assessmentId === assessment.id && m.studentId === st.id)?.marks ?? null}
                        onSave={(v) => saveMark(org.id, assessment.id, st.id, v, s.marks.some((m) => m.assessmentId === assessment.id && m.studentId === st.id)).catch((err) => toast.show(friendlyError(err)))} />
                    ))}
                  </ul>
                )}
              </>
            )}
          </section>
          <section className="card stack">
            <h2>Exam candidate list</h2>
            <p className="small muted">A spreadsheet of enrolled students. The exact layout your exam body asks for can be added once you send the template.</p>
            <label className="field"><span>Intake</span>
              <select value={exam} onChange={(e) => setExam(e.target.value)}>
                <option value="">All intakes</option>
                {s.intakes.filter((i) => i.courseId === courseId).map((i) => <option key={i.id} value={i.id}>{i.name}</option>)}
              </select>
            </label>
            <button type="button" className="btn align-start" onClick={candidates}>Download the list</button>
          </section>
        </>
      )}
    </div>
  );
}

function MarkRow({ name, max, existing, disabled, onSave }: { name: string; max: number; existing: number | null; disabled: boolean; onSave: (v: number) => void }) {
  const [value, setValue] = useState(existing == null ? '' : String(existing));
  useEffect(() => { setValue(existing == null ? '' : String(existing)); }, [existing]);
  const n = Number(value);
  const bad = value.trim() !== '' && !(Number.isFinite(n) && n >= 0 && n <= max);
  return (
    <li className="row">
      <span className="row-main"><span className="row-title">{name}</span>{bad && <span className="row-detail danger-text">Enter 0 to {max}</span>}</span>
      <input className="inline-number" type="number" inputMode="decimal" min={0} max={max} aria-label={`Mark for ${name}`} value={value} disabled={disabled}
        onChange={(e) => setValue(e.target.value)}
        onBlur={() => { if (value.trim() !== '' && !bad && n !== existing) onSave(n); }} />
    </li>
  );
}
