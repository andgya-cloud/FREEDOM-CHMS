import { useState, type ChangeEvent } from 'react';
import { Link } from 'react-router-dom';
import { useToast } from '../../state/ToastContext';
import { friendlyError } from '../../lib/errors';
import { saveChildPhoto } from '../../lib/childPhoto';
import { ApprovePhoto } from '../../components/ApprovePhoto';
import { normalizeCode } from '../../../functions/src/shared/hope';
import { HopeGate, useHopePage } from './common';
import { shrinkPhoto } from './registerParts';
import type { Organization } from '../../state/OrgContext';

export function PhotoUploadPage() {
  return <HopeGate title="Upload photos">{(org) => <PhotoUpload org={org} />}</HopeGate>;
}

interface Match { file: File; childId: string | null; name: string; why: string | null }
const plain = (t: string) => t.toLowerCase().replace(/\.[a-z0-9]+$/, '').replace(/[^a-z]+/g, ' ').trim();

/**
 * Many children's photos at once (Andy, 2026-11-04, 8A). Each file is matched to a child by the code in its name
 * (HC-0042.jpg), or else by the child's name. Only children whose parents agreed to photos get one.
 */
function PhotoUpload({ org }: { org: Organization }) {
  const h = useHopePage(org);
  const toast = useToast();
  const [plan, setPlan] = useState<Match[] | null>(null);
  const [saving, setSaving] = useState<{ done: number; total: number } | null>(null);
  const [asking, setAsking] = useState(false);

  function choose(e: ChangeEvent<HTMLInputElement>) {
    const files = [...(e.target.files ?? [])].filter((f) => f.type.startsWith('image/'));
    e.target.value = '';
    const byName = new Map(h.children.map((c) => [plain(h.nameOf(c.id)), c]));
    const used = new Set<string>();
    setPlan(files.map((file) => {
      const code = /hc[-\s_]?\d{1,6}/i.exec(file.name)?.[0];
      const c = (code ? h.children.find((x) => x.code === normalizeCode(code.replace('_', '-'))) : undefined) ?? byName.get(plain(file.name));
      if (!c) return { file, childId: null, name: file.name, why: 'No child matches this file name' };
      const name = h.nameOf(c.id);
      if (used.has(c.id)) return { file, childId: null, name, why: 'Another photo is already chosen for this child' };
      used.add(c.id);
      if (c.photoConsent?.given !== true) return { file, childId: null, name, why: 'No photo consent yet' };
      return { file, childId: c.id, name, why: null };
    }));
  }

  // One password from the Director, Andy or Doreen approves the whole batch (Andy, 2026-11-05).
  async function add(proof: string) {
    const ready = (plan ?? []).filter((m) => m.childId);
    setSaving({ done: 0, total: ready.length });
    let done = 0;
    for (const m of ready) {
      try {
        await saveChildPhoto(org.id, m.childId!, await shrinkPhoto(m.file), proof);
      } catch (err) { toast.show(`${m.name}: ${friendlyError(err)}`); }
      done += 1;
      setSaving({ done, total: ready.length });
    }
    toast.show(`${done} ${done === 1 ? 'photo' : 'photos'} saved.`);
  }

  const ready = plan?.filter((m) => m.childId) ?? [];
  const skipped = plan?.filter((m) => !m.childId) ?? [];

  if (saving) {
    const finished = saving.done >= saving.total;
    const pc = saving.total ? Math.round((saving.done / saving.total) * 100) : 100;
    return (
      <div className="page narrow">
        <h1>{finished ? '✅ Photos saved' : 'Saving the photos…'}</h1>
        <section className="card stack" aria-live="polite">
          <p className="lead"><b>{saving.done}</b> of <b>{saving.total}</b> saved</p>
          <div className="up-bar" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pc}><i style={{ width: `${pc}%` }} /></div>
          {finished ? <Link to="/hope/children" className="btn btn-primary align-start">See the children</Link> : <p className="notice notice-warn small">Please keep this page open.</p>}
        </section>
      </div>
    );
  }

  return (
    <div className="page narrow">
      <p><Link to="/hope/children">← Children</Link></p>
      <h1>Upload photos</h1>
      <section className="card stack">
        <p className="small">Name each photo with the child's code, like HC-0042.jpg, or their full name. Then choose all the photos at once.</p>
        <label className="btn btn-primary align-start">📷 Choose the photos<input type="file" hidden multiple accept="image/*" onChange={choose} /></label>
      </section>
      {plan && (
        <section className="card stack">
          <p><b>{ready.length}</b> {ready.length === 1 ? 'photo' : 'photos'} ready{skipped.length ? `, ${skipped.length} not matched` : ''}.</p>
          {skipped.length > 0 && (
            <details className="hr-fold">
              <summary><span>See the {skipped.length} not matched</span></summary>
              <ul className="link-list">{skipped.map((m) => <li key={m.file.name}><div><span className="link-title">{m.file.name}</span><span className="link-detail">{m.why}{m.name !== m.file.name ? ` (${m.name})` : ''}</span></div></li>)}</ul>
            </details>
          )}
          <button type="button" className="btn btn-primary align-start" disabled={!ready.length} onClick={() => setAsking(true)}>Add {ready.length} {ready.length === 1 ? 'photo' : 'photos'}</button>
        </section>
      )}
      <ApprovePhoto open={asking} orgId={org.id} title={`Add ${ready.length} ${ready.length === 1 ? 'photo' : 'photos'}?`} confirmLabel="Add the photos"
        onCancel={() => setAsking(false)} onApproved={(proof) => { setAsking(false); void add(proof); }} />
    </div>
  );
}
