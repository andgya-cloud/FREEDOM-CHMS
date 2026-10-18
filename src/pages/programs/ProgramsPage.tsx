import { useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../../state/AuthContext';
import { usePeople } from '../../state/PeopleContext';
import { useToast } from '../../state/ToastContext';
import type { Organization } from '../../state/OrgContext';
import {
  useAllGroupMembers,
  useAllTeamMembers,
  useEnrollments,
  useGroupMeetings,
  useGroups,
  usePrograms,
  useTeams,
} from '../../state/usePrograms';
import { addStandardPrograms, addTeam } from '../../lib/programWrites';
import { friendlyError } from '../../lib/errors';
import { useSavedMessage } from '../../lib/useSavedMessage';
import { CampusGate } from '../../components/CampusGate';
import { PersonPicker } from '../../components/PersonPicker';
import { localDateKey } from '../../../functions/src/shared/datetime';
import { MISSED_MEETINGS_FLAG, missedMeetings, WEEKDAY_LABELS } from '../../../functions/src/shared/programs';

/** Programmes, Dream Team and Freedom Groups for the selected campus. */
export function ProgramsPage() {
  return <CampusGate title="Programmes">{(org) => <Programs org={org} />}</CampusGate>;
}

const WEEKS_CHECKED = 12;

function Programs({ org }: { org: Organization }) {
  const { can } = useAuth();
  const toast = useToast();
  const saved = useSavedMessage();
  const navigate = useNavigate();
  const { programs, loading } = usePrograms(org.id);
  const { enrollments } = useEnrollments(org.id, null);
  const { teams } = useTeams(org.id);
  const teamMembers = useAllTeamMembers(org.id);
  const { groups } = useGroups(org.id);
  const groupMembers = useAllGroupMembers(org.id);
  const { byId } = usePeople();
  const today = localDateKey(new Date(), org.timeZone);
  const meetings = useGroupMeetings(org.id, localDateKey(new Date(Date.now() - WEEKS_CHECKED * 7 * 86_400_000), org.timeZone));
  const [addingTeam, setAddingTeam] = useState(false);
  const canSetUp = can('settings.manage');
  const canWrite = can('programs.write');

  const serving = new Set(teamMembers.filter((m) => m.status === 'active' && byId(m.personId)).map((m) => m.personId)).size;
  const inGroups = new Set(groupMembers.filter((m) => m.status === 'active' && byId(m.personId)).map((m) => m.personId)).size;

  function setUp() {
    addStandardPrograms(org.id, programs.map((p) => p.id)).catch((err) => toast.show(friendlyError(err)));
    toast.show(saved('Growth Track, Freedom 252 and Communication Master Class added'));
  }

  return (
    <div className="page narrow">
      <h1>Programmes</h1>

      <section className="stack">
        <div className="page-head">
          <h2>Discipleship</h2>
          {canSetUp && programs.length > 0 && <Link className="btn btn-quiet" to={`/programs/${org.id}/new`}>New programme</Link>}
        </div>
        {loading && programs.length === 0 ? <p className="muted">Loading…</p> : programs.length === 0 ? (
          <div className="card">
            <p>No programmes yet at {org.name}.</p>
            {canSetUp ? (
              <>
                <button type="button" className="btn btn-primary" onClick={setUp}>Add Growth Track, Freedom 252 and Communication Master Class</button>
                <p className="hint">You can rename topics and add more programmes afterwards. <Link to={`/programs/${org.id}/new`}>Or start a different programme.</Link></p>
              </>
            ) : <p className="muted">Ask the pastor to set up the programmes.</p>}
          </div>
        ) : (
          <ul className="link-list">
            {programs.map((p) => {
              const mine = enrollments.filter((e) => e.programId === p.id && byId(e.personId));
              const active = mine.filter((e) => e.status === 'active').length;
              const done = mine.filter((e) => e.status === 'completed').length;
              return (
                <li key={p.id}>
                  <Link to={`/programs/${org.id}/${p.id}`}>
                    <span className="link-title">{p.name}{!p.active && <span className="badge badge-muted">Not running</span>}</span>
                    <span className="link-detail">
                      {active} enrolled · {done} {p.completedLabel.toLowerCase()}{p.topics.length ? ` · ${p.topics.length} topics` : ' · no topics yet'}
                    </span>
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <section className="stack">
        <div className="page-head">
          <h2>Dream Team</h2>
          {canWrite && !addingTeam && <button type="button" className="btn btn-quiet" onClick={() => setAddingTeam(true)}>New department</button>}
        </div>
        <p className="muted small">{serving} {serving === 1 ? 'person' : 'people'} serving</p>
        {addingTeam && <NewTeam orgId={org.id} onDone={(id) => { setAddingTeam(false); if (id) navigate(`/teams/${org.id}/${id}`); }} />}
        {teams.length === 0 && !addingTeam ? (
          <p className="muted">No departments yet{canWrite ? ', for example Ushers, Worship or Kids' : ''}.</p>
        ) : teams.length > 0 && (
          <ul className="link-list">
            {teams.map((t) => {
              const count = teamMembers.filter((m) => m.teamId === t.id && m.status === 'active' && byId(m.personId)).length;
              return (
                <li key={t.id}>
                  <Link to={`/teams/${org.id}/${t.id}`}>
                    <span className="link-title">{t.name}{!t.active && <span className="badge badge-muted">Not active</span>}</span>
                    <span className="link-detail">{count} serving{t.leaderName ? ` · led by ${t.leaderName}` : ''}</span>
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <section className="stack">
        <div className="page-head">
          <h2>Freedom Groups</h2>
          {canWrite && <Link className="btn btn-quiet" to={`/groups/${org.id}/new`}>New group</Link>}
        </div>
        <p className="muted small">{inGroups} {inGroups === 1 ? 'person' : 'people'} in a group</p>
        {groups.length === 0 ? (
          <p className="muted">No groups yet.</p>
        ) : (
          <ul className="link-list">
            {groups.map((g) => {
              const count = groupMembers.filter((m) => m.groupId === g.id && m.status === 'active' && byId(m.personId)).length;
              const missed = g.active ? missedMeetings(meetings.filter((m) => m.groupId === g.id).map((m) => m.date), g.meetingDay, g.startDate, today).inARow : 0;
              return (
                <li key={g.id}>
                  <Link to={`/groups/${org.id}/${g.id}`}>
                    <span className="link-title">
                      {g.name}
                      {missed >= MISSED_MEETINGS_FLAG && <span className="badge badge-warn">Missed {missed} in a row</span>}
                      {!g.active && <span className="badge badge-muted">Closed</span>}
                    </span>
                    <span className="link-detail">
                      {WEEKDAY_LABELS[g.meetingDay]}{g.meetingTime ? ` ${g.meetingTime}` : ''}{g.place ? ` · ${g.place}` : ''} · {count} {count === 1 ? 'member' : 'members'}
                    </span>
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}

function NewTeam({ orgId, onDone }: { orgId: string; onDone: (id?: string) => void }) {
  const toast = useToast();
  const [name, setName] = useState('');
  const [leader, setLeader] = useState<{ id: string | null; name: string }>({ id: null, name: '' });

  function submit(e: FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    try {
      const { id, synced } = addTeam(orgId, name, leader);
      synced.catch((err) => toast.show(friendlyError(err)));
      onDone(id);
    } catch (err) {
      toast.show(friendlyError(err));
    }
  }

  return (
    <form className="card form" onSubmit={submit}>
      <label className="field">
        <span>Department name</span>
        <input autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="For example Ushers" />
      </label>
      <PersonPicker label="Leader (optional)" value={leader} onChange={setLeader} allowFreeText orgId={orgId} />
      <div className="dialog-actions">
        <button type="button" className="btn btn-quiet" onClick={() => onDone()}>Cancel</button>
        <button type="submit" className="btn btn-primary" disabled={!name.trim()}>Add department</button>
      </div>
    </form>
  );
}
