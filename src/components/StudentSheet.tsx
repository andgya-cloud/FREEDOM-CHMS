import { useState } from 'react';
import { Link } from 'react-router-dom';
import { doc } from 'firebase/firestore';
import { db } from '../firebase';
import { useAuth } from '../state/AuthContext';
import { useToast } from '../state/ToastContext';
import type { Organization } from '../state/OrgContext';
import type { Cohort, Program } from '../state/usePrograms';
import type { StudentRow } from '../pages/programs/ProgramPage';
import { removeEnrollment, setEnrollmentStatus, updateEnrollment } from '../lib/programWrites';
import { restoreRecord } from '../lib/records';
import { friendlyError } from '../lib/errors';
import { useSavedMessage } from '../lib/useSavedMessage';
import { formatDateKey, localDateKey } from '../../functions/src/shared/datetime';
import { enrollmentStatusLabel, type EnrollmentStatus } from '../../functions/src/shared/programs';

interface Props {
  org: Organization;
  program: Program;
  cohorts: Cohort[];
  sessions: { id: string; date: string; topicIds?: string[] }[];
  row: StudentRow;
  onClose: () => void;
}

/** One student in a programme: which topics they have covered and which are left. */
export function StudentSheet({ org, program, cohorts, sessions, row, onClose }: Props) {
  const { can } = useAuth();
  const toast = useToast();
  const saved = useSavedMessage();
  const { enrollment, progress } = row;
  const [notes, setNotes] = useState(enrollment.notes ?? '');
  const canWrite = can('programs.write');
  const today = localDateKey(new Date(), org.timeZone);
  const label = program.completedLabel;
  const sessionOn = (topicId: string, date: string) => sessions.find((s) => s.date === date && s.topicIds?.includes(topicId));

  function setStatus(status: EnrollmentStatus) {
    setEnrollmentStatus(org.id, enrollment, status, today).catch((err) => toast.show(friendlyError(err)));
    toast.show(saved(`${row.name}: ${enrollmentStatusLabel(status, label).toLowerCase()}`));
    onClose();
  }

  function remove() {
    const ref = doc(db, 'organizations', org.id, 'enrollments', enrollment.id);
    removeEnrollment(org.id, enrollment.id).catch((err) => toast.show(friendlyError(err)));
    toast.show(`${row.name} taken off ${program.name}.`, { label: 'Undo', onAction: () => { restoreRecord(ref).catch((err) => toast.show(friendlyError(err))); } });
    onClose();
  }

  return (
    <div className="sheet-backdrop" role="presentation" onClick={onClose}>
      <div className="sheet" role="dialog" aria-modal="true" aria-labelledby="student-h" onClick={(e) => e.stopPropagation()}>
        <div className="card-head">
          <h2 id="student-h"><Link to={`/people/${org.id}/${enrollment.personId}`}>{row.name}</Link></h2>
          <span className={`badge ${row.status === 'completed' ? 'badge-regular' : row.status === 'dropped' ? 'badge-muted' : 'badge-member'}`}>
            {enrollmentStatusLabel(row.status, label)}
          </span>
        </div>
        <p className="muted">
          {program.topics.length > 0 ? `${progress.count} of ${progress.total} topics covered` : 'This programme has no topics yet'}
          {row.status === 'completed' && row.completedDate ? ` · ${label.toLowerCase()} on ${formatDateKey(row.completedDate)}` : ''}
          {` · enrolled ${formatDateKey(enrollment.enrolledDate)}`}
        </p>

        {canWrite && cohorts.length > 0 && (
          <label className="field">
            <span>Cohort</span>
            <select
              value={enrollment.cohortId ?? ''}
              onChange={(e) => { updateEnrollment(org.id, enrollment.id, { cohortId: e.target.value || null }).catch((err) => toast.show(friendlyError(err))); }}
            >
              {cohorts.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              <option value="">No cohort (joins any class)</option>
            </select>
          </label>
        )}

        {program.topics.length > 0 && (
          <ol className="topic-list">
            {program.topics.map((t) => {
              const date = progress.covered.get(t.id);
              const session = date ? sessionOn(t.id, date) : undefined;
              return (
                <li key={t.id} className={date ? 'covered' : ''}>
                  <span className="topic-tick" aria-hidden="true">{date ? '✓' : ''}</span>
                  <span className="topic-name">{t.name}</span>
                  <span className="muted small">
                    {date ? (session ? <Link to={`/attendance/${org.id}/${session.id}`}>{formatDateKey(date)}</Link> : formatDateKey(date)) : 'Not yet'}
                  </span>
                </li>
              );
            })}
          </ol>
        )}

        {canWrite && (
          <label className="field">
            <span>Notes</span>
            <textarea
              rows={2}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              onBlur={() => { if (notes !== (enrollment.notes ?? '')) updateEnrollment(org.id, enrollment.id, { notes: notes.slice(0, 1000) }).catch((err) => toast.show(friendlyError(err))); }}
            />
          </label>
        )}

        {canWrite && (
          <div className="sheet-actions">
            {row.status === 'active' && (
              <>
                <button type="button" className="btn btn-primary" onClick={() => setStatus('completed')}>Mark as {label.toLowerCase()}</button>
                <button type="button" className="btn" onClick={() => setStatus('dropped')}>Dropped out</button>
              </>
            )}
            {(row.status === 'dropped' || (row.status === 'completed' && !progress.complete)) && (
              <button type="button" className="btn" onClick={() => setStatus('active')}>{row.status === 'dropped' ? 'Back in the programme' : 'Not finished yet'}</button>
            )}
            <button type="button" className="btn btn-quiet danger-text" onClick={remove}>Enrolled by mistake</button>
          </div>
        )}
        {row.status === 'active' && progress.complete === false && program.topics.length > 0 && (
          <p className="hint">{label} happens by itself when {row.name.split(' ')[0]} has covered {program.completionRule.type === 'topic_count' ? `${Math.min(program.completionRule.count, progress.total)} topics` : 'every topic'}.</p>
        )}
        <button type="button" className="btn btn-quiet" onClick={onClose}>Close</button>
      </div>
    </div>
  );
}
