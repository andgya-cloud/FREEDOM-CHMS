import { useEffect, useState, type FormEvent } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useOrg } from '../../state/OrgContext';
import { usePrograms } from '../../state/usePrograms';
import { usePipelineSettings } from '../../state/useSettingsDoc';
import { useToast } from '../../state/ToastContext';
import { saveProgram } from '../../lib/programWrites';
import { friendlyError } from '../../lib/errors';
import { useSavedMessage } from '../../lib/useSavedMessage';
import { programIdFor, topicIdFor, type ProgramConfig, type Topic } from '../../../functions/src/shared/programs';

const BLANK: ProgramConfig = {
  name: '', description: '', topics: [], completionRule: { type: 'all_topics' }, pipelineStageId: null,
  completedLabel: 'Completed', schedule: '', active: true,
};

/**
 * Set up a programme without code: its topics, what counts as finishing,
 * and which journey stage it moves people along.
 */
export function ProgramFormPage() {
  const { orgId = '', programId } = useParams();
  const { organizations } = useOrg();
  const org = organizations.find((o) => o.id === orgId);
  const { programs, loading } = usePrograms(orgId);
  const { stages } = usePipelineSettings();
  const toast = useToast();
  const saved = useSavedMessage();
  const navigate = useNavigate();
  const existing = programId ? programs.find((p) => p.id === programId) : undefined;
  const [form, setForm] = useState<ProgramConfig>(BLANK);
  const [loaded, setLoaded] = useState(!programId);
  const [newTopic, setNewTopic] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    if (existing && !loaded) {
      const { name, description, topics, completionRule, pipelineStageId, completedLabel, schedule, active } = existing;
      setForm({ name, description, topics, completionRule, pipelineStageId, completedLabel, schedule, active });
      setLoaded(true);
    }
  }, [existing, loaded]);

  if (!org || (programId && !existing)) {
    return <div className="page narrow"><p><Link to="/programs">← Programmes</Link></p><p>{loading ? 'Loading…' : 'This programme was not found.'}</p></div>;
  }

  const set = <K extends keyof ProgramConfig>(key: K, value: ProgramConfig[K]) => setForm((f) => ({ ...f, [key]: value }));
  const setTopics = (topics: Topic[]) => set('topics', topics);
  const move = (i: number, by: number) => {
    const next = [...form.topics];
    const [t] = next.splice(i, 1);
    next.splice(i + by, 0, t!);
    setTopics(next);
  };
  function addTopic() {
    const name = newTopic.trim();
    if (!name) return;
    setTopics([...form.topics, { id: topicIdFor(name, form.topics.map((t) => t.id)), name }]);
    setNewTopic('');
  }

  function submit(e: FormEvent) {
    e.preventDefault();
    const name = form.name.trim();
    if (name.length < 2) return setError('Give the programme a name.');
    if (form.topics.some((t) => !t.name.trim())) return setError('Every topic needs a name.');
    const rule = form.completionRule;
    if (rule.type === 'topic_count' && (!Number.isInteger(rule.count) || rule.count < 1)) return setError('Choose how many topics are needed.');
    const config: ProgramConfig = {
      ...form,
      name,
      description: form.description.trim().slice(0, 500),
      schedule: form.schedule.trim().slice(0, 80),
      completedLabel: form.completedLabel.trim() || 'Completed',
      topics: form.topics.map((t) => ({ id: t.id, name: t.name.trim() })),
    };
    const id = existing?.id ?? programIdFor(name, programs.map((p) => p.id));
    saveProgram(orgId, id, config, !!existing).catch((err) => toast.show(friendlyError(err)));
    toast.show(saved(`${name} saved`));
    navigate(`/programs/${orgId}/${id}`);
  }

  const removed = existing ? existing.topics.filter((t) => !form.topics.some((x) => x.id === t.id)) : [];

  return (
    <div className="page narrow">
      <p><Link to={existing ? `/programs/${orgId}/${existing.id}` : '/programs'}>← {existing ? existing.name : 'Programmes'}</Link></p>
      <h1>{existing ? `Edit ${existing.name}` : 'New programme'}</h1>
      <form className="form" onSubmit={submit} noValidate>
        <label className="field"><span>Name</span><input value={form.name} onChange={(e) => set('name', e.target.value)} placeholder="For example Marriage Course" /></label>
        <label className="field"><span>Description (optional)</span><textarea rows={2} value={form.description} onChange={(e) => set('description', e.target.value)} /></label>
        <label className="field"><span>Classes usually meet (optional)</span><input value={form.schedule} onChange={(e) => set('schedule', e.target.value)} placeholder="Tuesday 20:00" /></label>

        <fieldset className="field">
          <legend>Topics</legend>
          {form.topics.length === 0 && <p className="hint">No topics yet. Each class is marked with the topic it covered.</p>}
          <ol className="row-list stage-list">
            {form.topics.map((t, i) => (
              <li key={t.id} className="row">
                <div className="stage-move">
                  <button type="button" className="btn btn-quiet" aria-label={`Move ${t.name} up`} disabled={i === 0} onClick={() => move(i, -1)}>↑</button>
                  <button type="button" className="btn btn-quiet" aria-label={`Move ${t.name} down`} disabled={i === form.topics.length - 1} onClick={() => move(i, 1)}>↓</button>
                </div>
                <div className="row-main">
                  <input aria-label={`Topic ${i + 1} name`} value={t.name} onChange={(e) => setTopics(form.topics.map((x) => (x.id === t.id ? { ...x, name: e.target.value } : x)))} />
                </div>
                <button type="button" className="btn btn-quiet danger-text" aria-label={`Remove ${t.name}`} onClick={() => setTopics(form.topics.filter((x) => x.id !== t.id))}>Remove</button>
              </li>
            ))}
          </ol>
          <div className="input-with-button">
            <input placeholder="New topic" aria-label="New topic" value={newTopic} onChange={(e) => setNewTopic(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addTopic(); } }} />
            <button type="button" className="btn" onClick={addTopic}>Add topic</button>
          </div>
          {removed.length > 0 && <p className="hint">Removing {removed.map((t) => t.name).join(', ')} stops {removed.length === 1 ? 'it' : 'them'} counting towards anyone's progress. Renaming a topic keeps everyone's progress.</p>}
        </fieldset>

        <fieldset className="field">
          <legend>Finished when</legend>
          <label className="check"><input type="radio" name="rule" checked={form.completionRule.type === 'all_topics'} onChange={() => set('completionRule', { type: 'all_topics' })} /><span>Every topic is covered</span></label>
          <label className="check">
            <input type="radio" name="rule" checked={form.completionRule.type === 'topic_count'} onChange={() => set('completionRule', { type: 'topic_count', count: Math.max(1, form.topics.length) })} />
            <span>At least</span>
            <input
              type="number" min={1} inputMode="numeric" className="inline-number" aria-label="Number of topics"
              disabled={form.completionRule.type !== 'topic_count'}
              value={form.completionRule.type === 'topic_count' ? form.completionRule.count : ''}
              onChange={(e) => set('completionRule', { type: 'topic_count', count: Math.max(1, Math.floor(Number(e.target.value) || 1)) })}
            />
            <span>topics are covered</span>
          </label>
          <label className="field">
            <span>Call finishing</span>
            <select value={form.completedLabel} onChange={(e) => set('completedLabel', e.target.value)}>
              <option value="Completed">Completed</option>
              <option value="Graduated">Graduated</option>
            </select>
          </label>
        </fieldset>

        <label className="field">
          <span>Journey stage</span>
          <select value={form.pipelineStageId ?? ''} onChange={(e) => set('pipelineStageId', e.target.value || null)}>
            <option value="">None</option>
            {stages.filter((s) => s.active && !s.sensitive).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
          <small className="hint">Enrolling marks this stage in progress on the person's journey; finishing marks it completed.</small>
        </label>

        <label className="check"><input type="checkbox" checked={form.active} onChange={(e) => set('active', e.target.checked)} /><span>Running (untick to hide it from the list)</span></label>
        {error && <p className="error" role="alert">{error}</p>}
        <button type="submit" className="btn btn-primary btn-block">Save programme</button>
      </form>
    </div>
  );
}
