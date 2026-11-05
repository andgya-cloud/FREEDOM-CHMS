import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../../state/AuthContext';
import { useToast } from '../../state/ToastContext';
import { friendlyError } from '../../lib/errors';
import { saveConsents } from '../../lib/hopeWrites';
import { consentMissing } from '../../../functions/src/shared/hope';
import { useHopePage } from './common';
import { Avatar } from './registerParts';
import type { Organization } from '../../state/OrgContext';


type Tick = { guardian: boolean; photo: boolean };

/**
 * Record consent for many children at once (Andy, 2026-11-04, 5A): tick the parents who agreed, then Save. Only
 * the children still missing a consent are listed. Shown on Children under Show → Consent missing (v182, 10A).
 */
export function ConsentTicks({ org, q }: { org: Organization; q: string }) {
  const h = useHopePage(org);
  const { can } = useAuth();
  const toast = useToast();
  const [ticks, setTicks] = useState<Record<string, Tick>>({});
  const canEdit = can('people.write');

  const rows = useMemo(() => h.children.filter(consentMissing)
    .map((c) => ({ c, name: h.nameOf(c.id), guardian: c.guardianConsent?.given === true, photo: c.photoConsent?.given === true }))
    .sort((a, b) => a.name.localeCompare(b.name)), [h.children, h.nameOf]);
  const shown = rows.filter((r) => !q.trim() || r.name.toLowerCase().includes(q.trim().toLowerCase()) || (r.c.code ?? '').toLowerCase().includes(q.trim().toLowerCase()));
  const value = (id: string, base: Tick): Tick => ticks[id] ?? base;
  const changed = rows.filter((r) => { const t = ticks[r.c.id]; return t && (t.guardian !== r.guardian || t.photo !== r.photo); });

  function set(id: string, base: Tick, key: keyof Tick, on: boolean) {
    setTicks((t) => ({ ...t, [id]: { ...(t[id] ?? base), [key]: on } }));
  }
  function all(key: keyof Tick) {
    setTicks((t) => {
      const next = { ...t };
      for (const r of shown) next[r.c.id] = { ...(t[r.c.id] ?? { guardian: r.guardian, photo: r.photo }), [key]: true };
      return next;
    });
  }
  function save() {
    const yes = { given: true, date: h.today };
    const list = changed.map((r) => {
      const t = ticks[r.c.id]!;
      return { childId: r.c.id, ...(t.guardian && !r.guardian ? { guardian: yes } : {}), ...(t.photo && !r.photo ? { photo: yes } : {}) };
    }).filter((x) => x.guardian || x.photo);
    if (list.length === 0) return;
    const n = `${list.length} ${list.length === 1 ? 'child' : 'children'}`;
    toast.show(`Saving consent for ${n}…`);
    saveConsents(org.id, list).then(() => toast.show(`✅ Consent saved for ${n}.`)).catch((err) => toast.show(friendlyError(err)));
    setTicks({});
  }

  return (
    <div className="stack">
      <p className="small muted">Tick what each parent agreed to, then tap Save.</p>
      {h.loading ? <p className="muted">Loading…</p> : rows.length === 0 ? <div className="card"><p>✅ Every child's consent is recorded.</p></div> : (
        <>
          {canEdit && (
            <div className="chips">
              <button type="button" className="btn btn-quiet" onClick={() => all('guardian')}>Tick all: keep details</button>
              <button type="button" className="btn btn-quiet" onClick={() => all('photo')}>Tick all: photos</button>
            </div>
          )}
          <ul className="ck-list">
            {shown.map((r) => {
              const base = { guardian: r.guardian, photo: r.photo };
              const t = value(r.c.id, base);
              return (
                <li key={r.c.id} className="card ck-row">
                  <Link to={`/hope/children/${r.c.id}`} className="ck-tick"><Avatar name={r.name} size={40} /><span className="grow"><b>{r.name}</b><span className="small muted">{h.codeOf(r.c)}</span></span></Link>
                  <label className="check"><input type="checkbox" disabled={!canEdit || r.guardian} checked={t.guardian} onChange={(e) => set(r.c.id, base, 'guardian', e.target.checked)} /><span>Keep details</span></label>
                  <label className="check"><input type="checkbox" disabled={!canEdit || r.photo} checked={t.photo} onChange={(e) => set(r.c.id, base, 'photo', e.target.checked)} /><span>Photos</span></label>
                </li>
              );
            })}
          </ul>
          {canEdit && changed.length > 0 && (
            <div className="ck-finish"><span><b>{changed.length}</b> changed</span><button type="button" className="btn btn-primary" onClick={save}>Save</button></div>
          )}
        </>
      )}
    </div>
  );
}
