import { Link } from 'react-router-dom';
import type { Organization } from '../state/OrgContext';
import { useEnrollments, useGroupMembers, useGroups, usePrograms, useTeamMembers, useTeams } from '../state/usePrograms';
import { formatDateKey } from '../../functions/src/shared/datetime';
import { enrollmentStatusLabel } from '../../functions/src/shared/programs';

/** On a person's record: their programmes, Dream Team departments and Freedom Group. */
export function InvolvementForPerson({ org, personId }: { org: Organization; personId: string }) {
  const { programs } = usePrograms(org.id);
  const { enrollments } = useEnrollments(org.id, { personId });
  const { teams } = useTeams(org.id);
  const { members: serving } = useTeamMembers(org.id, { personId });
  const { groups } = useGroups(org.id);
  const { members: inGroups } = useGroupMembers(org.id, { personId });

  const rows: { key: string; to: string; title: string; detail: string }[] = [];
  for (const e of enrollments) {
    const p = programs.find((x) => x.id === e.programId);
    if (!p) continue;
    const progress = p.topics.length ? ` · ${e.topicsCovered.filter((t) => p.topics.some((x) => x.id === t)).length} of ${p.topics.length} topics` : '';
    const when = e.status === 'completed' && e.completedDate ? ` on ${formatDateKey(e.completedDate)}` : '';
    rows.push({ key: e.id, to: `/programs/${org.id}/${p.id}`, title: p.name, detail: `${enrollmentStatusLabel(e.status, p.completedLabel)}${when}${progress}` });
  }
  for (const m of serving) {
    const t = teams.find((x) => x.id === m.teamId);
    if (!t) continue;
    rows.push({ key: m.id, to: `/teams/${org.id}/${t.id}`, title: `Dream Team: ${t.name}`, detail: `${m.role ? `${m.role} · ` : ''}${m.status === 'active' ? 'since' : 'served from'} ${formatDateKey(m.startDate)}${m.status !== 'active' && m.endDate ? ` to ${formatDateKey(m.endDate)}` : ''}` });
  }
  for (const m of inGroups) {
    const g = groups.find((x) => x.id === m.groupId);
    if (!g) continue;
    rows.push({ key: m.id, to: `/groups/${org.id}/${g.id}`, title: g.name, detail: m.status === 'active' ? `Member since ${formatDateKey(m.joinedDate)}` : `Left ${formatDateKey(m.leftDate)}` });
  }

  return (
    <section className="card">
      <h2>Programmes and groups</h2>
      {rows.length === 0 ? <p className="muted">Not in a programme, Dream Team department or Freedom Group yet. Add people from the <Link to="/programs">Programmes</Link> tab.</p> : (
        <ul className="plain">
          {rows.map((r) => (
            <li key={r.key}><Link to={r.to}>{r.title}</Link> <span className="muted small">· {r.detail}</span></li>
          ))}
        </ul>
      )}
    </section>
  );
}
