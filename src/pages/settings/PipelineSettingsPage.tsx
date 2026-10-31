import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { doc, getDoc, setDoc } from 'firebase/firestore';
import { db } from '../../firebase';
import { usePipelineSettings } from '../../state/useSettingsDoc';
import { useToast } from '../../state/ToastContext';
import { createStamps, updateRecord } from '../../lib/records';
import { trackWrite } from '../../lib/sync';
import { friendlyError } from '../../lib/errors';
import { useSavedMessage } from '../../lib/useSavedMessage';
import { stageIdFromName, type PipelineStage } from '../../../functions/src/shared/people';

/** Rename, reorder, add and switch off pipeline stages. No code needed. */
export function PipelineSettingsPage() {
  const settings = usePipelineSettings();
  const toast = useToast();
  const saved = useSavedMessage();
  const [stages, setStages] = useState<PipelineStage[]>(settings.stages);
  const [newName, setNewName] = useState('');
  const [dirty, setDirty] = useState(false);

  useEffect(() => { if (!dirty) setStages(settings.stages); }, [settings.stages, dirty]);

  const update = (next: PipelineStage[]) => { setStages(next); setDirty(true); };
  const move = (i: number, by: number) => {
    const next = [...stages];
    const [item] = next.splice(i, 1);
    next.splice(i + by, 0, item!);
    update(next);
  };

  function add() {
    const name = newName.trim();
    if (!name) return;
    let id = stageIdFromName(name) || `stage_${Date.now()}`;
    while (stages.some((s) => s.id === id)) id = `${id}_2`;
    update([...stages, { id, name, sensitive: false, active: true }]);
    setNewName('');
  }

  function save() {
    if (stages.some((s) => !s.name.trim())) return toast.show('Every stage needs a name.');
    const clean = stages.map((s) => ({ ...s, name: s.name.trim() }));
    // Sensitive stages stay sensitive (the server enforces this too).
    const sensitiveStageIds = [...new Set([...settings.sensitiveStageIds, ...clean.filter((s) => s.sensitive).map((s) => s.id)])];
    const ref = doc(db, 'settings', 'pipeline');
    const write = getDoc(ref).then((snap) => snap.exists()
      ? updateRecord(ref, { stages: clean, sensitiveStageIds })
      : trackWrite(setDoc(ref, { stages: clean, sensitiveStageIds, ...createStamps() })));
    write.catch((err) => toast.show(friendlyError(err)));
    setDirty(false);
    toast.show(saved('Stages saved'));
  }

  return (
    <div className="page narrow">
      <p><Link to="/settings/group/people">← People settings</Link></p>
      <h1>Journey stages</h1>
      <p className="muted">The steps a person moves through. The order is a guide: people can skip stages or be in several at once.</p>
      <ol className="row-list stage-list">
        {stages.map((s, i) => (
          <li key={s.id} className="row">
            <div className="stage-move">
              <button type="button" className="btn btn-quiet" aria-label={`Move ${s.name} up`} disabled={i === 0} onClick={() => move(i, -1)}>↑</button>
              <button type="button" className="btn btn-quiet" aria-label={`Move ${s.name} down`} disabled={i === stages.length - 1} onClick={() => move(i, 1)}>↓</button>
            </div>
            <div className="row-main">
              <input aria-label="Stage name" value={s.name} onChange={(e) => update(stages.map((x) => (x.id === s.id ? { ...x, name: e.target.value } : x)))} />
              <span className="row-detail">
                {s.sensitive ? 'Pastor only (records religious belief)' : 'Visible to staff'}
              </span>
            </div>
            <label className="check small">
              <input type="checkbox" checked={s.active} onChange={(e) => update(stages.map((x) => (x.id === s.id ? { ...x, active: e.target.checked } : x)))} />
              <span>In use</span>
            </label>
          </li>
        ))}
      </ol>
      <div className="input-with-button">
        <input placeholder="New stage name" aria-label="New stage name" value={newName} onChange={(e) => setNewName(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); add(); } }} />
        <button type="button" className="btn" onClick={add}>Add stage</button>
      </div>
      <button type="button" className="btn btn-primary btn-block" disabled={!dirty} onClick={save}>Save stages</button>
    </div>
  );
}
