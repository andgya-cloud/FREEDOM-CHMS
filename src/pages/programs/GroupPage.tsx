import { useState, type FormEvent } from 'react';
import { CleanupButton } from '../../components/CleanupDialog';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useAuth } from '../../state/AuthContext';
import { useOrg, type Organization } from '../../state/OrgContext';
import { usePeople } from '../../state/PeopleContext';
import { useToast } from '../../state/ToastContext';
import { useGroupMarks, useGroupMeetings, useGroupMembers, useGroups, type Group, type GroupMember } from '../../state/usePrograms';
import { addGroupMember, leaveGroup, startGroupMeeting } from '../../lib/programWrites';
import { friendlyError } from '../../lib/errors';
import { useSavedMessage } from '../../lib/useSavedMessage';
import { PersonPicker } from '../../components/PersonPicker';
import { formatDateKey, localDateKey } from '../../../functions/src/shared/datetime';
import { attended } from '../../../functions/src/shared/attendance';
import { groupMeetingIdFor, MISSED_MEETINGS_FLAG, missedMeetings, WEEKDAY_LABELS } from '../../../functions/src/shared/programs';

/** One Freedom Group: members, this week's meeting and whether it has been meeting. */
export function GroupPage() {
  const { orgId = '', groupId = '' } = useParams();
  const { organizations } = useOrg();
  const org = organizations.find((o) => o.id === orgId);
  const { groups, loading } = useGroups(orgId);
  const group = groups.find((g) => g.id === groupId);
  if (!org || !group) {
    return <div className="page narrow"><p><Link to="/programs">← Programmes</Link></p><p>{loading ? 'Loading…' : 'This group was not found.'}</p></div>;
  }
  return <GroupView org={org} group={group} />;
}

const WEEKS_SHOWN = 12;
const RECENT_MEETINGS = 8;

function GroupView({ org, group }: { org: Organization; group: Group }) {
  const { can } = useAuth();
  const { byId } = usePeople();
  const toast = useToast();
  const navigate = useNavigate();
  const today = localDateKey(new Date(), org.timeZone);
  const { members, all } = useGroupMembers(org.id, { groupId: group.id });
  const meetings = useGroupMeetings(org.id, localDateKey(new Date(Date.now() - WEEKS_SHOWN * 7 * 86_400_000), org.timeZone))
    .filter((m) => m.groupId === group.id)
    .sort((a, b) => b.date.localeCompare(a.date));
  const marks = useGroupMarks(org.id, group.id);
  const [date, setDate] = useState(today);
  const missed = missedMeetings(meetings.map((m) => m.date), group.meetingDay, group.startDate, today);
  const recent = meetings.slice(0, RECENT_MEETINGS);
  const presentAt = (eventId: string) => marks.filter((m) => m.eventId === eventId && attended(m.status)).length;
  const cameTo = (personId: string) => recent.filter((e) => marks.some((m) => m.eventId === e.id && m.personId === personId && attended(m.status))).length;
  const current = members.filter((m) => m.status === 'active' && byId(m.personId)).sort((a, b) => byId(a.personId)!.fullName.localeCompare(byId(b.personId)!.fullName));
  const canWrite = can('programs.write');

  function record() {
    const id = groupMeetingIdFor(date, group.id);
    try {
      const { synced } = startGroupMeeting(org.id, group, date, meetings.some((m) => m.id === id));
      synced.catch((err) => toast.show(friendlyError(err)));
      navigate(`/attendance/${org.id}/${id}`);
    } catch (err) {
      toast.show(friendlyError(err));
    }
  }

  return (
    <div className="page narrow">
      <p><Link to="/programs">← Programmes</Link></p>
      <div className="person-head">
        <div>
          <h1>{group.name}</h1>
          <p className="muted">
            {WEEKDAY_LABELS[group.meetingDay]}{group.meetingTime ? ` ${group.meetingTime}` : ''}{group.place ? ` · ${group.place}` : ''}
            {group.leaderName ? ` · led by ${group.leaderName}` : ''}{!group.active ? ' · closed' : ''}
          </p>
        </div>
        <div className="cleanup-head-actions">
          {canWrite && <Link className="btn" to={`/groups/${org.id}/${group.id}/edit`}>Edit</Link>}
          <CleanupButton orgId={org.id} kind="group" id={group.id} back="/programs" />
        </div>
      </div>

      {group.active && missed.inARow >= MISSED_MEETINGS_FLAG && (
        <div className="notice notice-warn">
          <strong>No meeting recorded for {missed.inARow} weeks in a row.</strong>
          <span>The last one expected was {formatDateKey(missed.lastMissed)}. If the group met, record the meeting below with that date.</span>
        </div>
      )}

      {can('attendance.write') && group.active && (
        <section className="card">
          <div className="card-head">
            <h2>Record a meeting</h2>
            <label className="date-pick">
              <span className="visually-hidden">Date</span>
              <input type="date" value={date} max={today} onChange={(e) => setDate(e.target.value || today)} />
            </label>
          </div>
          <button type="button" className="btn btn-primary btn-lg" onClick={record}>
            {meetings.some((m) => m.date === date) ? 'Open this meeting' : `Take attendance for ${date === today ? 'today' : formatDateKey(date)}`}
          </button>
        </section>
      )}

      <section className="card">
        <div className="card-head">
          <h2>Members</h2>
          <span className="muted small">{current.length}</span>
        </div>
        {current.length === 0 ? <p className="muted">No members yet.</p> : (
          <ul className="row-list">
            {current.map((m) => (
              <MemberRow key={m.id} org={org} member={m} name={byId(m.personId)!.fullName} came={cameTo(m.personId)} of={recent.length} canWrite={canWrite} today={today} isLeader={m.personId === group.leaderId} />
            ))}
          </ul>
        )}
        {canWrite && <AddMember org={org} group={group} all={all} today={today} />}
      </section>

      <section className="stack">
        <h2>Meetings</h2>
        {meetings.length === 0 ? <p className="muted">No meetings recorded in the last {WEEKS_SHOWN} weeks.</p> : (
          <ul className="link-list">
            {meetings.map((m) => (
              <li key={m.id}>
                <Link to={`/attendance/${org.id}/${m.id}`}>
                  <span className="link-title">{formatDateKey(m.date)}</span>
                  <span className="link-detail">{presentAt(m.id)} present</span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function MemberRow({ org, member, name, came, of, canWrite, today, isLeader }: { org: Organization; member: GroupMember; name: string; came: number; of: number; canWrite: boolean; today: string; isLeader: boolean }) {
  const toast = useToast();
  return (
    <li className="row">
      <Link to={`/people/${org.id}/${member.personId}`} className="row-main">
        <span className="row-title">{name}{isLeader && <span className="badge badge-member">Leader</span>}</span>
        <span className="row-detail">Joined {formatDateKey(member.joinedDate)}{of ? ` · came to ${came} of the last ${of} meetings` : ''}</span>
      </Link>
      {canWrite && (
        <button type="button" className="btn btn-quiet" onClick={() => {
          leaveGroup(org.id, member.id, today).catch((err) => toast.show(friendlyError(err)));
          toast.show(`${name} has left the group.`, { label: 'Undo', onAction: () => { addGroupMember(org.id, member.groupId, member.personId, member.joinedDate, true).catch((err) => toast.show(friendlyError(err))); } });
        }}>Left</button>
      )}
    </li>
  );
}

function AddMember({ org, group, all, today }: { org: Organization; group: Group; all: GroupMember[]; today: string }) {
  const toast = useToast();
  const saved = useSavedMessage();
  const [who, setWho] = useState<{ id: string | null; name: string }>({ id: null, name: '' });
  const existing = who.id ? all.find((m) => m.personId === who.id) : undefined;
  const alreadyIn = existing && !existing.deletedAt && existing.status === 'active';

  function submit(e: FormEvent) {
    e.preventDefault();
    if (!who.id || alreadyIn) return;
    addGroupMember(org.id, group.id, who.id, today, !!existing).catch((err) => toast.show(friendlyError(err)));
    toast.show(saved(`${who.name} joined ${group.name}`));
    setWho({ id: null, name: '' });
  }

  return (
    <form className="form enrol-form" onSubmit={submit}>
      <PersonPicker label="Add a member" value={who} onChange={setWho} orgId={org.id} hint="Type a name or phone number." />
      {alreadyIn && <p className="hint">{who.name} is already in this group.</p>}
      <button type="submit" className="btn" disabled={!who.id || !!alreadyIn}>Add to {group.name}</button>
    </form>
  );
}
