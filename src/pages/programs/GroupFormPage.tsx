import { useEffect, useState, type FormEvent } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useOrg } from '../../state/OrgContext';
import { useGroups } from '../../state/usePrograms';
import { useToast } from '../../state/ToastContext';
import { addGroup, updateGroup, type GroupInput } from '../../lib/programWrites';
import { friendlyError } from '../../lib/errors';
import { useSavedMessage } from '../../lib/useSavedMessage';
import { PersonPicker } from '../../components/PersonPicker';
import { localDateKey } from '../../../functions/src/shared/datetime';
import { WEEKDAYS, WEEKDAY_LABELS, type Weekday } from '../../../functions/src/shared/programs';

/** Start a Freedom Group, or change its leader, meeting day or place. */
export function GroupFormPage() {
  const { orgId = '', groupId } = useParams();
  const { organizations } = useOrg();
  const org = organizations.find((o) => o.id === orgId);
  const { groups, loading } = useGroups(orgId);
  const existing = groupId ? groups.find((g) => g.id === groupId) : undefined;
  const toast = useToast();
  const saved = useSavedMessage();
  const navigate = useNavigate();
  const [form, setForm] = useState<GroupInput & { active: boolean }>({
    name: '', leaderId: null, leaderName: '', meetingDay: 'wednesday', meetingTime: '', place: '',
    startDate: localDateKey(new Date(), org?.timeZone), active: true,
  });
  const [loaded, setLoaded] = useState(!groupId);
  const [error, setError] = useState('');

  useEffect(() => {
    if (existing && !loaded) {
      const { name, leaderId, leaderName, meetingDay, meetingTime, place, startDate, active } = existing;
      setForm({ name, leaderId, leaderName, meetingDay, meetingTime, place, startDate, active });
      setLoaded(true);
    }
  }, [existing, loaded]);

  if (!org || (groupId && !existing)) {
    return <div className="page narrow"><p><Link to="/programs">← Programmes</Link></p><p>{loading ? 'Loading…' : 'This group was not found.'}</p></div>;
  }

  const set = <K extends keyof typeof form>(key: K, value: (typeof form)[K]) => setForm((f) => ({ ...f, [key]: value }));

  function submit(e: FormEvent) {
    e.preventDefault();
    if (!form.name.trim()) return setError('Give the group a name.');
    if (!form.startDate) return setError('Choose when the group started.');
    const input = { ...form, name: form.name.trim(), leaderName: form.leaderName.trim(), meetingTime: form.meetingTime.trim().slice(0, 20), place: form.place.trim() };
    try {
      if (existing) {
        updateGroup(orgId, existing.id, input).catch((err) => toast.show(friendlyError(err)));
        toast.show(saved(`${input.name} saved`));
        navigate(`/groups/${orgId}/${existing.id}`);
      } else {
        const { active: _active, ...fields } = input;
        const { id, synced } = addGroup(orgId, fields);
        synced.catch((err) => toast.show(friendlyError(err)));
        toast.show(saved(`${input.name} started`));
        navigate(`/groups/${orgId}/${id}`);
      }
    } catch (err) {
      toast.show(friendlyError(err));
    }
  }

  return (
    <div className="page narrow">
      <p><Link to={existing ? `/groups/${orgId}/${existing.id}` : '/programs'}>← {existing ? existing.name : 'Programmes'}</Link></p>
      <h1>{existing ? `Edit ${existing.name}` : 'New Freedom Group'}</h1>
      <form className="form" onSubmit={submit} noValidate>
        <label className="field"><span>Group name</span><input value={form.name} onChange={(e) => set('name', e.target.value)} placeholder="For example Kilimani young adults" /></label>
        <PersonPicker
          label="Leader"
          value={{ id: form.leaderId, name: form.leaderName }}
          onChange={(v) => setForm((f) => ({ ...f, leaderId: v.id, leaderName: v.name }))}
          allowFreeText
          orgId={orgId}
          hint={existing ? undefined : 'Picking someone from the list also adds them as a member.'}
        />
        <div className="field-row">
          <label className="field">
            <span>Meets on</span>
            <select value={form.meetingDay} onChange={(e) => set('meetingDay', e.target.value as Weekday)}>
              {WEEKDAYS.map((d) => <option key={d} value={d}>{WEEKDAY_LABELS[d]}</option>)}
            </select>
          </label>
          <label className="field"><span>At (optional)</span><input type="time" value={form.meetingTime} onChange={(e) => set('meetingTime', e.target.value)} /></label>
        </div>
        <label className="field"><span>Place (optional)</span><input value={form.place} onChange={(e) => set('place', e.target.value)} placeholder="Estate, home or venue" /></label>
        <label className="field"><span>Started</span><input type="date" value={form.startDate} onChange={(e) => set('startDate', e.target.value)} /></label>
        {existing && <label className="check"><input type="checkbox" checked={form.active} onChange={(e) => set('active', e.target.checked)} /><span>Still meeting (untick to close the group)</span></label>}
        {error && <p className="error" role="alert">{error}</p>}
        <button type="submit" className="btn btn-primary btn-block">{existing ? 'Save group' : 'Start group'}</button>
      </form>
    </div>
  );
}
