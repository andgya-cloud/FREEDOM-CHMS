import { useState } from 'react';
import { Link } from 'react-router-dom';
import type { Organization } from '../../state/OrgContext';
import { usePeople, type Person } from '../../state/PeopleContext';
import { useCohorts, useEnrollments, usePrograms } from '../../state/usePrograms';
import { OrgGate } from '../../components/OrgGate';
import { WhatsAppSheet } from '../../components/WhatsAppSheet';
import { recipientFor } from '../../../functions/src/shared/followups';

/**
 * Programme reminders (Growth Track, Freedom 252 and the rest): everyone
 * taking the programme now, each with a WhatsApp button that opens the
 * reminder ready to send.
 */
export function RemindersPage() {
  return <OrgGate title="Programme reminders">{(org) => <Reminders org={org} />}</OrgGate>;
}

function Reminders({ org }: { org: Organization }) {
  const { programs } = usePrograms(org.id);
  const active = programs.filter((p) => p.active);
  const [programId, setProgramId] = useState('');
  const program = active.find((p) => p.id === programId) ?? active[0];
  const { cohorts } = useCohorts(org.id, program?.id);
  const { enrollments } = useEnrollments(org.id, program ? { programId: program.id } : null);
  const { byId } = usePeople();
  const [sendTo, setSendTo] = useState<{ person: Person; classTime: string } | null>(null);
  const [sent, setSent] = useState<Set<string>>(new Set());

  const students = enrollments
    .filter((e) => e.status === 'active')
    .map((e) => ({ enrollment: e, person: byId(e.personId), cohort: cohorts.find((c) => c.id === e.cohortId) }))
    .filter((r): r is typeof r & { person: Person } => !!r.person && !r.person.deletedAt)
    .sort((a, b) => a.person.fullName.localeCompare(b.person.fullName));

  return (
    <div className="page narrow">
      <p><Link to="/follow-ups">← Follow-ups</Link></p>
      <h1>Programme reminders</h1>

      {active.length === 0 ? <p className="muted">No programmes are running. Add them under Programmes.</p> : (
        <>
          <div className="chips">
            {active.map((p) => (
              <button key={p.id} type="button" className={`chip${program?.id === p.id ? ' chip-on' : ''}`} onClick={() => setProgramId(p.id)}>{p.name}</button>
            ))}
          </div>
          {program && (
            <p className="muted small">
              {students.length} taking {program.name} now{program.schedule ? `, meeting ${program.schedule}` : ''}. Each message is recorded on the person's page.
            </p>
          )}
          {students.length === 0 ? <p className="muted">Nobody is taking this programme right now.</p> : (
            <ul className="row-list">
              {students.map(({ person, cohort }) => {
                const guardian = person.guardianId ? byId(person.guardianId) : null;
                const recipient = recipientFor(person, guardian);
                return (
                  <li key={person.id} className="row">
                    <Link to={`/people/${org.id}/${person.id}`} className="row-main">
                      <span className="row-title">{person.fullName}</span>
                      <span className="row-detail">
                        {cohort ? cohort.name : 'No class group'}
                        {!recipient.ok && ' · No WhatsApp'}
                        {sent.has(person.id) && ' · Reminder sent'}
                      </span>
                    </Link>
                    <button type="button" className="btn btn-quiet" onClick={() => setSendTo({ person, classTime: cohort?.schedule || program!.schedule || '' })}>
                      WhatsApp
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </>
      )}

      {sendTo && program && (
        <WhatsAppSheet
          org={org}
          person={sendTo.person}
          templateId="program_reminder"
          templateIds={['program_reminder']}
          fields={{ programme: program.name, class_time: sendTo.classTime }}
          onSent={() => setSent(new Set([...sent, sendTo.person.id]))}
          onClose={() => setSendTo(null)}
        />
      )}
    </div>
  );
}
