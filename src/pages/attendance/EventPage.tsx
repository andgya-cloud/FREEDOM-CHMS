import { useEffect, useState } from 'react';
import { CleanupButton } from '../../components/CleanupDialog';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useAuth } from '../../state/AuthContext';
import { useOrg } from '../../state/OrgContext';
import { useToast } from '../../state/ToastContext';
import { useEvent, useEventAttendance, type ChurchEvent } from '../../state/useAttendance';
import { deleteEvent, eventRef, saveEventNotes } from '../../lib/attendanceWrites';
import { restoreRecord } from '../../lib/records';
import { friendlyError } from '../../lib/errors';
import { ConfirmDialog } from '../../components/ConfirmDialog';
import { HeadcountEditor } from '../../components/HeadcountEditor';
import { CheckInPanel } from '../../components/CheckInPanel';
import { ClassRegister, type RosterSpec } from '../../components/ClassRegister';
import { ProgramSessionPanel } from '../../components/ProgramSessionPanel';
import { useSchool } from '../../state/useSchool';
import { useAllExamSheets, useExamCohorts } from '../../state/useExams';
import { useChildren } from '../../state/useHope';
import { updateChild } from '../../lib/hopeWrites';
import { MEALS_PROGRAMME, normalizeCode, programmeOf } from '../../../functions/src/shared/hope';
import { activitiesFor } from '../../../functions/src/shared/attendance';
import { useEnrollments, useGroupMembers, useGroups, usePrograms } from '../../state/usePrograms';
import { enrol } from '../../lib/programWrites';
import { EVENT_TYPE_LABELS } from '../../../functions/src/shared/attendance';
import { formatDateKey, localDateKey } from '../../../functions/src/shared/datetime';
import { TRAINER_ROLE_ID } from '../../../functions/src/shared/permissions';
import { cohortOfCommonClass } from '../../../functions/src/shared/commonCourses';
import type { Person } from '../../state/PeopleContext';
import type { Program } from '../../state/usePrograms';

/** One service, class or session: the headcount, who came, and the door tablet. */
export function EventPage() {
  const { orgId = '', eventId = '' } = useParams();
  const { can, profile } = useAuth();
  const { organizations, currentId, select } = useOrg();
  const toast = useToast();
  const navigate = useNavigate();
  const { event, missing } = useEvent(orgId, eventId);
  const { byPerson } = useEventAttendance(orgId, eventId);
  const [notes, setNotes] = useState('');
  const [confirmDelete, setConfirmDelete] = useState(false);
  const org = organizations.find((o) => o.id === orgId);
  // A trainer marks the register of their own classes only, and changes nothing else (Andy, 2026-10-26).
  const trainer = profile?.roleId === TRAINER_ROLE_ID;
  const mine = !!event && event.type === 'class' && (profile?.registerClasses ?? []).includes(event.name);
  const canRecord = trainer ? mine : can('attendance.write');
  const linked = useLinkedRoster(orgId, event);

  useEffect(() => { setNotes(event?.notes ?? ''); }, [event?.id, event?.notes]);

  // Names come from the selected organization's people on this device.
  if (org && currentId !== orgId) {
    return (
      <div className="page narrow">
        <p><Link to="/attendance">← Attendance</Link></p>
        <div className="notice">
          <p>This belongs to {org.name}.</p>
          <button type="button" className="btn btn-primary" onClick={() => select(orgId)}>Switch to {org.name}</button>
        </div>
      </div>
    );
  }
  if (!org || !event || event.deletedAt) {
    return (
      <div className="page narrow">
        <p><Link to="/attendance">← Attendance</Link></p>
        <p>{missing || event?.deletedAt ? 'This was not found. It may have been deleted.' : 'Loading…'}</p>
      </div>
    );
  }

  if (trainer && !mine) {
    return (
      <div className="page narrow">
        <p><Link to="/attendance">← Attendance</Link></p>
        <p>This isn't one of your classes.</p>
      </div>
    );
  }

  function remove() {
    setConfirmDelete(false);
    const ref = eventRef(orgId, eventId);
    deleteEvent(orgId, eventId).catch((err) => toast.show(friendlyError(err)));
    toast.show(`${event!.name} deleted.`, { label: 'Undo', onAction: () => { restoreRecord(ref).catch((err) => toast.show(friendlyError(err))); } });
    navigate(linked.back.to);
  }

  const isClass = event.type === 'class' || event.type === 'group' || !!linked.roster;
  return (
    <div className="page narrow">
      <p><Link to={linked.back.to}>← {linked.back.label}</Link></p>
      <div className="person-head">
        <div>
          <h1>{event.name}</h1>
          <p className="muted">{formatDateKey(event.date)} · {EVENT_TYPE_LABELS[event.type]}</p>
        </div>
        {canRecord && !isClass && (
          <Link className="btn btn-gold" to={`/door/${orgId}/${eventId}`}>Door mode</Link>
        )}
        <CleanupButton orgId={orgId} kind="event" id={eventId} back={linked.back.to} />
      </div>

      {linked.program && <ProgramSessionPanel key={event.id} orgId={orgId} event={event} program={linked.program} canEdit={canRecord} />}
      {!trainer && <HeadcountEditor event={event} canEdit={canRecord} />}
      {isClass
        ? <ClassRegister org={org} event={event} byPerson={byPerson} canRecord={canRecord} roster={linked.roster} rosterOnly={trainer} names={trainer ? linked.names : undefined} />
        : <CheckInPanel org={org} event={event} byPerson={byPerson} canRecord={canRecord} />}

      <section className="card">
        <label className="field">
          <span>Notes (optional)</span>
          <textarea
            rows={2}
            value={notes}
            disabled={!canRecord}
            placeholder={isClass ? 'Unit or topic covered, trainer' : 'Anything worth remembering about today'}
            onChange={(e) => setNotes(e.target.value)}
            onBlur={() => { if (notes !== (event.notes ?? '')) saveEventNotes(orgId, eventId, notes).catch((err) => toast.show(friendlyError(err))); }}
          />
        </label>
      </section>

      {canRecord && !trainer && (
        <button type="button" className="btn btn-quiet danger-text align-start" onClick={() => setConfirmDelete(true)}>Delete this {EVENT_TYPE_LABELS[event.type].toLowerCase()}</button>
      )}
      <ConfirmDialog
        open={confirmDelete}
        title={`Delete ${event.name} on ${formatDateKey(event.date)}?`}
        body="It will be moved to the bin with its headcount. You can undo straight away, and the pastor can restore it for 30 days."
        confirmLabel="Delete"
        danger
        onConfirm={remove}
        onCancel={() => setConfirmDelete(false)}
      />
    </div>
  );
}

/**
 * For a programme class or a group meeting: who belongs on the register,
 * and where "back" goes. Ordinary services and ADIA classes get nothing extra.
 */
function useLinkedRoster(orgId: string, event: ChurchEvent | null): { roster?: RosterSpec; program?: Program; back: { to: string; label: string }; names?: Map<string, string> } {
  const { can } = useAuth();
  const { organizations } = useOrg();
  const toast = useToast();
  const programId = event?.programId ?? '';
  const groupId = event?.groupId ?? '';
  const { programs } = usePrograms(programId ? orgId : '');
  const { enrollments, all } = useEnrollments(programId ? orgId : '', { programId });
  const { groups } = useGroups(groupId ? orgId : '');
  const { members } = useGroupMembers(groupId ? orgId : '', { groupId });
  const program = programs.find((p) => p.id === programId);
  const group = groups.find((g) => g.id === groupId);
  const orgInfo = organizations.find((o) => o.id === orgId);
  const tz = orgInfo?.timeZone;
  const isClass = orgInfo?.type === 'college' && event?.type === 'class' && !programId && !groupId;
  const school = useSchool(isClass ? orgId : '');
  const commonSheets = useAllExamSheets(isClass ? orgId : '');
  const commonCohorts = useExamCohorts(isClass ? orgId : '');
  const isHope = orgInfo?.type === 'ministry' && (event?.type === 'session' || event?.type === 'meal') && !programId && !groupId;
  const hope = useChildren(isHope ? orgId : '');

  if (event && program) {
    const isMakeUp = !event.cohortId;
    const active = enrollments.filter((e) => e.status === 'active' && (isMakeUp || e.cohortId === event.cohortId || !e.cohortId));
    const topics = event.topicIds ?? [];
    return {
      program,
      back: { to: `/programs/${orgId}/${program.id}`, label: program.name },
      roster: {
        ids: new Set(active.map((e) => e.personId)),
        title: isMakeUp ? 'Make-up class register' : 'Class register',
        empty: `Nobody is enrolled${isMakeUp ? '' : ' in this cohort'} yet. Search above to enrol someone.`,
        // At a make-up class, show who is missing today's topic (as last counted by the server).
        note: isMakeUp && topics.length ? (personId) => {
          const has = new Set(enrollments.find((e) => e.personId === personId)?.topicsCovered ?? []);
          return topics.some((t) => !has.has(t)) ? 'Needs this topic' : null;
        } : undefined,
        addLabel: can('programs.write') ? 'Enrol' : 'Add',
        onAddOther: can('programs.write') ? (p: Person) => {
          const existing = all.find((e) => e.personId === p.id);
          if (existing && !existing.deletedAt && existing.status !== 'dropped') return;
          enrol(orgId, program.id, p.id, event.cohortId ?? null, localDateKey(new Date(), tz), existing).catch((err) => toast.show(friendlyError(err)));
          toast.show(`${p.fullName} enrolled in ${program.name}.`);
        } : undefined,
      },
    };
  }
  if (event && group) {
    return {
      back: { to: `/groups/${orgId}/${group.id}`, label: group.name },
      roster: {
        ids: new Set(members.filter((m) => m.status === 'active').map((m) => m.personId)),
        title: 'Who came',
        empty: 'This group has no members yet. Search above to add a guest, or add members on the group page.',
        addLabel: 'Add guest',
      },
    };
  }
  if (event && isClass) {
    // An ADIA class: the register lists the enrolled students of the course named on the class.
    const course = school.courses.find((c) => c.name === (event.activity ?? event.name));
    if (course) {
      return {
        back: { to: '/attendance', label: 'Attendance' },
        names: school.rosterNames,
        roster: {
          ids: new Set(school.students.filter((st) => st.courseId === course.id && st.status === 'enrolled').map((st) => st.id)),
          title: `${course.name} register`,
          empty: 'No students are enrolled in this programme yet. Enrol them under School → Students.',
          addLabel: 'Add guest',
        },
      };
    }
    // A common course's register, "Communication Skills · Cohort 4": every enrolled student of that cohort (Andy, 2026-10-28).
    // A register named only by the course ("Leadership") takes the one open cohort that has that common course.
    const named = [...new Set(commonSheets.sheets.filter((sh) => sh.courseId == null && sh.courseName.trim().toLowerCase() === event.name.trim().toLowerCase()
      && commonCohorts.byName[sh.cohort]?.closed !== true).map((sh) => sh.cohort))];
    const cohort = cohortOfCommonClass(event.name) || (named.length === 1 ? named[0]! : '');
    const intakeIds = new Set(school.intakes.filter((i) => i.name === cohort).map((i) => i.id));
    if (cohort && intakeIds.size) {
      return {
        back: { to: '/attendance', label: 'Attendance' },
        names: school.rosterNames,
        roster: {
          ids: new Set(school.students.filter((st) => intakeIds.has(st.intakeId) && st.status === 'enrolled').map((st) => st.id)),
          title: event.name.includes(' · ') ? `${event.name} register` : `${event.name} · ${cohort} register`,
          empty: `No students are enrolled in ${cohort} yet.`,
          addLabel: 'Add guest',
        },
      };
    }
  }
  if (event && isHope && orgInfo) {
    // Freedom Hope Center: the register lists the active children of this session's programme (everyone for Saturday meals).
    const programmes = activitiesFor({ type: orgInfo.type, activities: orgInfo.activities });
    const name = programmeOf(event, programmes);
    const isMeals = name?.toLowerCase() === MEALS_PROGRAMME.toLowerCase() || event.type === 'meal';
    const mine = hope.children.filter((c) => c.status === 'active' && (isMeals || (name && c.programmes.some((p) => p.name.toLowerCase() === name.toLowerCase()))));
    const byId = new Map(hope.children.map((c) => [c.id, c]));
    return {
      back: { to: '/hope', label: 'Hope Center' },
      roster: {
        ids: new Set(mine.map((c) => c.id)),
        title: `${event.name} register`,
        empty: isMeals ? 'No children are registered yet. Use the headcount above, or register children first.' : `No children have joined ${name ?? 'this programme'} yet. Search above to add one, or register children first.`,
        note: (personId) => {
          const c = byId.get(personId);
          if (!c) return null;
          const prog = name ? c.programmes.find((p) => p.name.toLowerCase() === name.toLowerCase()) : undefined;
          return [c.code ?? 'code pending', prog?.group].filter(Boolean).join(' · ');
        },
        // Typing or scanning HC-0042 (or just 42 after "HC") finds the child; names work as usual.
        search: (p, text) => {
          const c = byId.get(p.id);
          const code = normalizeCode(text);
          return p.fullName.toLowerCase().includes(text.trim().toLowerCase()) || (!!c?.code && (!!code && c.code === code || c.code.toLowerCase().includes(text.trim().toLowerCase())));
        },
        checkInOnEnter: true,
        addLabel: 'Add',
        onAddOther: !isMeals && name && can('people.write') ? (p: Person) => {
          const c = byId.get(p.id);
          if (!c) return;
          updateChild(orgId, c.id, { programmes: [...c.programmes, { name, group: '', level: '' }] }).catch((err) => toast.show(friendlyError(err)));
          toast.show(`${p.fullName} added to ${name}.`);
        } : undefined,
      },
    };
  }
  return { back: { to: '/attendance', label: 'Attendance' } };
}
