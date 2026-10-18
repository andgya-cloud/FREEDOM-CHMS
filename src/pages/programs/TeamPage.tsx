import { useState, type FormEvent } from 'react';
import { Link, useParams } from 'react-router-dom';
import { doc } from 'firebase/firestore';
import { db } from '../../firebase';
import { useAuth } from '../../state/AuthContext';
import { useOrg, type Organization } from '../../state/OrgContext';
import { usePeople } from '../../state/PeopleContext';
import { useToast } from '../../state/ToastContext';
import { useTeamMembers, useTeams, type Team, type TeamMember } from '../../state/usePrograms';
import { addTeamMember, removeTeamMember, updateTeam, updateTeamMember } from '../../lib/programWrites';
import { restoreRecord } from '../../lib/records';
import { friendlyError } from '../../lib/errors';
import { useSavedMessage } from '../../lib/useSavedMessage';
import { PersonPicker } from '../../components/PersonPicker';
import { formatDateKey, localDateKey } from '../../../functions/src/shared/datetime';

/** One Dream Team department: who serves, in what role, and since when. */
export function TeamPage() {
  const { orgId = '', teamId = '' } = useParams();
  const { organizations } = useOrg();
  const org = organizations.find((o) => o.id === orgId);
  const { teams, loading } = useTeams(orgId);
  const team = teams.find((t) => t.id === teamId);
  if (!org || !team) {
    return <div className="page narrow"><p><Link to="/programs">← Programmes</Link></p><p>{loading ? 'Loading…' : 'This department was not found.'}</p></div>;
  }
  return <TeamView org={org} team={team} />;
}

const RETENTION_DAYS = 90;

function TeamView({ org, team }: { org: Organization; team: Team }) {
  const { can } = useAuth();
  const { byId } = usePeople();
  const { members, all } = useTeamMembers(org.id, { teamId: team.id });
  const [editing, setEditing] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);
  const canWrite = can('programs.write');
  const today = localDateKey(new Date(), org.timeZone);
  const rows = members.filter((m) => byId(m.personId)).sort((a, b) => (a.status === b.status ? byId(a.personId)!.fullName.localeCompare(byId(b.personId)!.fullName) : a.status === 'active' ? -1 : 1));
  const active = rows.filter((m) => m.status === 'active');
  // Of those who started more than 90 days ago, how many still serve.
  const cutoff = localDateKey(new Date(Date.now() - RETENTION_DAYS * 86_400_000), org.timeZone);
  const longAgo = rows.filter((m) => m.startDate <= cutoff);
  const stayed = longAgo.filter((m) => m.status === 'active').length;
  const open = rows.find((m) => m.id === openId);

  return (
    <div className="page narrow">
      <p><Link to="/programs">← Programmes</Link></p>
      <div className="person-head">
        <div>
          <h1>{team.name}</h1>
          <p className="muted">Dream Team{team.leaderName ? ` · led by ${team.leaderName}` : ''}{!team.active ? ' · not active' : ''}</p>
        </div>
        {canWrite && <button type="button" className="btn" onClick={() => setEditing(true)}>Edit</button>}
      </div>

      <section className="card">
        <div className="card-head">
          <h2>Serving</h2>
          <span className="muted small">{active.length} active</span>
        </div>
        {longAgo.length > 0 && <p className="muted small">{stayed} of {longAgo.length} who joined over {RETENTION_DAYS} days ago are still serving.</p>}
        {rows.length === 0 ? <p className="muted">Nobody yet.</p> : (
          <ul className="row-list">
            {rows.map((m) => (
              <li key={m.id}>
                <button type="button" className="row row-button" onClick={() => canWrite && setOpenId(m.id)} disabled={!canWrite}>
                  <span className="row-main">
                    <span className="row-title">{byId(m.personId)!.fullName}{m.status === 'inactive' && <span className="badge badge-muted">Not serving</span>}</span>
                    <span className="row-detail">{m.role || 'No role given'} · since {formatDateKey(m.startDate)}{m.endDate ? ` · until ${formatDateKey(m.endDate)}` : ''}</span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
        {canWrite && <AddMember org={org} team={team} all={all} today={today} />}
      </section>

      {editing && <TeamSheet org={org} team={team} onClose={() => setEditing(false)} />}
      {open && <MemberSheet org={org} member={open} name={byId(open.personId)!.fullName} today={today} onClose={() => setOpenId(null)} />}
    </div>
  );
}

function AddMember({ org, team, all, today }: { org: Organization; team: Team; all: TeamMember[]; today: string }) {
  const toast = useToast();
  const saved = useSavedMessage();
  const [who, setWho] = useState<{ id: string | null; name: string }>({ id: null, name: '' });
  const [role, setRole] = useState('');
  const [startDate, setStartDate] = useState(today);
  const existing = who.id ? all.find((m) => m.personId === who.id) : undefined;
  const alreadyIn = existing && !existing.deletedAt && existing.status === 'active';

  function submit(e: FormEvent) {
    e.preventDefault();
    if (!who.id || alreadyIn) return;
    addTeamMember(org.id, team.id, who.id, role, startDate || today, !!existing).catch((err) => toast.show(friendlyError(err)));
    toast.show(saved(`${who.name} added to ${team.name}`));
    setWho({ id: null, name: '' });
    setRole('');
  }

  return (
    <form className="form enrol-form" onSubmit={submit}>
      <PersonPicker label="Add someone" value={who} onChange={setWho} orgId={org.id} hint="Type a name or phone number." />
      {alreadyIn && <p className="hint">{who.name} already serves in {team.name}.</p>}
      <div className="field-row">
        <label className="field"><span>Role (optional)</span><input value={role} onChange={(e) => setRole(e.target.value)} placeholder="For example Usher" /></label>
        <label className="field"><span>Started</span><input type="date" value={startDate} max={today} onChange={(e) => setStartDate(e.target.value)} /></label>
      </div>
      <button type="submit" className="btn" disabled={!who.id || !!alreadyIn}>Add to {team.name}</button>
    </form>
  );
}

function TeamSheet({ org, team, onClose }: { org: Organization; team: Team; onClose: () => void }) {
  const toast = useToast();
  const [name, setName] = useState(team.name);
  const [leader, setLeader] = useState<{ id: string | null; name: string }>({ id: team.leaderId, name: team.leaderName });
  const [active, setActive] = useState(team.active);

  function save() {
    if (!name.trim()) return;
    updateTeam(org.id, team.id, { name: name.trim(), leaderId: leader.id, leaderName: leader.name.trim(), active }).catch((err) => toast.show(friendlyError(err)));
    onClose();
  }

  return (
    <div className="sheet-backdrop" role="presentation" onClick={onClose}>
      <div className="sheet" role="dialog" aria-modal="true" aria-labelledby="team-h" onClick={(e) => e.stopPropagation()}>
        <h2 id="team-h">Edit department</h2>
        <label className="field"><span>Name</span><input value={name} onChange={(e) => setName(e.target.value)} /></label>
        <PersonPicker label="Leader" value={leader} onChange={setLeader} allowFreeText orgId={org.id} />
        <label className="check"><input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} /><span>Active department</span></label>
        <div className="dialog-actions">
          <button type="button" className="btn btn-quiet" onClick={onClose}>Cancel</button>
          <button type="button" className="btn btn-primary" onClick={save}>Save</button>
        </div>
      </div>
    </div>
  );
}

function MemberSheet({ org, member, name, today, onClose }: { org: Organization; member: TeamMember; name: string; today: string; onClose: () => void }) {
  const toast = useToast();
  const [role, setRole] = useState(member.role);
  const [startDate, setStartDate] = useState(member.startDate);

  function save(changes: Parameters<typeof updateTeamMember>[2]) {
    updateTeamMember(org.id, member.id, { role: role.trim(), startDate: startDate || member.startDate, ...changes }).catch((err) => toast.show(friendlyError(err)));
    onClose();
  }

  function remove() {
    const ref = doc(db, 'organizations', org.id, 'teamMembers', member.id);
    removeTeamMember(org.id, member.id).catch((err) => toast.show(friendlyError(err)));
    toast.show(`${name} taken off the list.`, { label: 'Undo', onAction: () => { restoreRecord(ref).catch((err) => toast.show(friendlyError(err))); } });
    onClose();
  }

  return (
    <div className="sheet-backdrop" role="presentation" onClick={onClose}>
      <div className="sheet" role="dialog" aria-modal="true" aria-labelledby="member-h" onClick={(e) => e.stopPropagation()}>
        <h2 id="member-h">{name}</h2>
        <div className="field-row">
          <label className="field"><span>Role</span><input value={role} onChange={(e) => setRole(e.target.value)} /></label>
          <label className="field"><span>Started</span><input type="date" value={startDate} max={today} onChange={(e) => setStartDate(e.target.value)} /></label>
        </div>
        <div className="sheet-actions">
          <button type="button" className="btn btn-primary" onClick={() => save({})}>Save</button>
          {member.status === 'active'
            ? <button type="button" className="btn" onClick={() => save({ status: 'inactive', endDate: today })}>Stopped serving</button>
            : <button type="button" className="btn" onClick={() => save({ status: 'active', endDate: null })}>Serving again</button>}
          <button type="button" className="btn btn-quiet danger-text" onClick={remove}>Added by mistake</button>
        </div>
        <button type="button" className="btn btn-quiet" onClick={onClose}>Close</button>
      </div>
    </div>
  );
}
