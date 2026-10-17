import { useState } from 'react';
import { collection, query, where, type Timestamp } from 'firebase/firestore';
import { db } from '../firebase';
import { useAuth } from '../state/AuthContext';
import { usePipelineSettings } from '../state/useSettingsDoc';
import { useToast } from '../state/ToastContext';
import { useLiveQuery } from '../lib/useQuery';
import { saveStage } from '../lib/peopleWrites';
import { friendlyError } from '../lib/errors';
import { useSavedMessage } from '../lib/useSavedMessage';
import { PersonPicker } from './PersonPicker';
import { STAGE_STATUSES, STAGE_STATUS_LABELS, type PipelineStage, type StageStatus } from '../../functions/src/shared/people';
import { formatDateKey, localDateKey } from '../../functions/src/shared/datetime';

interface Entry {
  id: string;
  stageId: string;
  status: StageStatus;
  date: string | null;
  notes: string;
  sensitive: boolean;
  details?: { prayedWith?: string; prayedWithId?: string | null; followUpBy?: string; followUpById?: string | null };
  updatedAt?: Timestamp;
}

/**
 * A person's journey through the pipeline. The order is a guide, not a gate:
 * any stage can be recorded at any time, and several can be in progress.
 */
export function PipelineTimeline({ orgId, personId }: { orgId: string; personId: string }) {
  const { can } = useAuth();
  const { stages } = usePipelineSettings();
  const pastoral = can('pastoral.read');
  const canWrite = can('people.write');
  const { rows } = useLiveQuery<Entry>(() => {
    const base = collection(db, 'organizations', orgId, 'pipeline');
    return pastoral
      ? query(base, where('personId', '==', personId))
      : query(base, where('personId', '==', personId), where('sensitive', '==', false));
  }, [orgId, personId, pastoral]);
  const [editing, setEditing] = useState<PipelineStage | null>(null);
  const visible = stages.filter((s) => s.active && (!s.sensitive || pastoral));
  const entryFor = (stageId: string) => rows.find((r) => r.stageId === stageId && !('deletedAt' in r && (r as { deletedAt?: unknown }).deletedAt));

  return (
    <section className="card" aria-labelledby="pipeline-h">
      <h2 id="pipeline-h">Journey</h2>
      <ol className="timeline">
        {visible.map((stage) => {
          const e = entryFor(stage.id);
          const status: StageStatus = e?.status ?? 'not_started';
          return (
            <li key={stage.id} className={`timeline-item status-${status}`}>
              <span className="timeline-dot" aria-hidden="true" />
              <button type="button" className="timeline-body" onClick={() => canWrite && setEditing(stage)} disabled={!canWrite}>
                <span className="timeline-title">{stage.name}{stage.sensitive && <span className="badge badge-muted">Pastoral</span>}</span>
                <span className="timeline-meta">
                  {STAGE_STATUS_LABELS[status]}{e?.date ? ` · ${formatDateKey(e.date)}` : ''}
                </span>
                {e?.notes && <span className="timeline-notes">{e.notes}</span>}
                {stage.id === 'salvation' && e?.details?.prayedWith && (
                  <span className="timeline-notes">Prayed with {e.details.prayedWith}{e.details.followUpBy ? ` · follow-up by ${e.details.followUpBy}` : ''}</span>
                )}
              </button>
            </li>
          );
        })}
      </ol>
      {!pastoral && <p className="muted small">Salvation and baptism records are visible to the pastor only.</p>}
      {editing && (
        <StageDialog
          stage={editing}
          entry={entryFor(editing.id)}
          orgId={orgId}
          personId={personId}
          onClose={() => setEditing(null)}
        />
      )}
    </section>
  );
}

function StageDialog({ stage, entry, orgId, personId, onClose }: { stage: PipelineStage; entry?: Entry; orgId: string; personId: string; onClose: () => void }) {
  const toast = useToast();
  const saved = useSavedMessage();
  const [status, setStatus] = useState<StageStatus>(entry?.status ?? 'completed');
  const [date, setDate] = useState(entry?.date ?? localDateKey());
  const [notes, setNotes] = useState(entry?.notes ?? '');
  const [prayedWith, setPrayedWith] = useState({ id: entry?.details?.prayedWithId ?? null, name: entry?.details?.prayedWith ?? '' });
  const [followUpBy, setFollowUpBy] = useState({ id: entry?.details?.followUpById ?? null, name: entry?.details?.followUpBy ?? '' });

  function save() {
    const details = stage.id === 'salvation'
      ? { prayedWith: prayedWith.name.trim(), prayedWithId: prayedWith.id, followUpBy: followUpBy.name.trim(), followUpById: followUpBy.id }
      : {};
    saveStage(orgId, personId, stage.id, stage.sensitive, { status, date: status === 'not_started' ? null : date || null, notes: notes.trim(), details }, !!entry)
      .catch((err) => toast.show(friendlyError(err)));
    toast.show(saved(`${stage.name} updated`));
    onClose();
  }

  return (
    <div className="sheet-backdrop" role="presentation" onClick={onClose}>
      <div className="sheet" role="dialog" aria-modal="true" aria-labelledby="stage-h" onClick={(e) => e.stopPropagation()}>
        <h2 id="stage-h">{stage.name}</h2>
        <div className="segmented wrap" role="group" aria-label="Status">
          {STAGE_STATUSES.map((s) => (
            <button key={s} type="button" className={status === s ? 'on' : ''} onClick={() => setStatus(s)}>{STAGE_STATUS_LABELS[s]}</button>
          ))}
        </div>
        {status !== 'not_started' && (
          <label className="field">
            <span>Date</span>
            <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </label>
        )}
        {stage.id === 'salvation' && (
          <>
            <PersonPicker label="Who prayed with them?" value={prayedWith} onChange={setPrayedWith} allowFreeText orgId={orgId} />
            <PersonPicker label="Who will follow up?" value={followUpBy} onChange={setFollowUpBy} allowFreeText orgId={orgId} />
          </>
        )}
        <label className="field">
          <span>Notes</span>
          <textarea rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} />
        </label>
        <div className="dialog-actions">
          <button type="button" className="btn btn-quiet" onClick={onClose}>Cancel</button>
          <button type="button" className="btn btn-primary" onClick={save}>Save</button>
        </div>
      </div>
    </div>
  );
}
