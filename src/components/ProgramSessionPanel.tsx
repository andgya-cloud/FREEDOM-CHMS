import { useState } from 'react';
import { useToast } from '../state/ToastContext';
import type { ChurchEvent } from '../state/useAttendance';
import type { Program } from '../state/usePrograms';
import { updateSessionDetails } from '../lib/programWrites';
import { friendlyError } from '../lib/errors';
import { PersonPicker } from './PersonPicker';

/** A programme class's topic and mentor, which staff can change after starting it. */
export function ProgramSessionPanel({ orgId, event, program, canEdit }: { orgId: string; event: ChurchEvent; program: Program; canEdit: boolean }) {
  const toast = useToast();
  const [mentor, setMentor] = useState<{ id: string | null; name: string }>({ id: event.mentorId ?? null, name: event.mentor ?? '' });
  const topicIds = event.topicIds ?? [];
  const known = new Map(program.topics.map((t) => [t.id, t.name]));

  function toggle(id: string) {
    const next = topicIds.includes(id) ? topicIds.filter((t) => t !== id) : [...topicIds, id].slice(0, 10);
    updateSessionDetails(orgId, event.id, { topicIds: next }).catch((err) => toast.show(friendlyError(err)));
  }

  function saveMentor(value: { id: string | null; name: string }) {
    setMentor(value);
    // Save once a person is picked, or when typing stops (on leaving the box).
    if (value.id) updateSessionDetails(orgId, event.id, { mentor: value.name, mentorId: value.id }).catch((err) => toast.show(friendlyError(err)));
  }

  return (
    <section className="card">
      <h2>Topic and mentor</h2>
      {program.topics.length === 0 ? <p className="muted">{program.name} has no topics yet.</p> : canEdit ? (
        <div className="chips topic-chips" role="group" aria-label="Topics covered">
          {program.topics.map((t) => (
            <button key={t.id} type="button" className={`chip ${topicIds.includes(t.id) ? 'chip-on' : ''}`} aria-pressed={topicIds.includes(t.id)} onClick={() => toggle(t.id)}>{t.name}</button>
          ))}
        </div>
      ) : (
        <p>{topicIds.map((t) => known.get(t) ?? 'Removed topic').join(', ') || 'No topic chosen'}</p>
      )}
      {topicIds.length === 0 && program.topics.length > 0 && <p className="hint">Choose the topic covered, so it counts towards everyone's progress.</p>}
      {canEdit ? (
        <div onBlur={() => {
          if (!mentor.id && mentor.name.trim() !== (event.mentor ?? '')) {
            updateSessionDetails(orgId, event.id, { mentor: mentor.name.trim() || null, mentorId: null }).catch((err) => toast.show(friendlyError(err)));
          }
        }}>
          <PersonPicker label="Mentor or teacher" value={mentor} onChange={saveMentor} allowFreeText orgId={orgId} />
        </div>
      ) : event.mentor && <p className="muted">Mentor: {event.mentor}</p>}
    </section>
  );
}
