import { useState, type ChangeEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../../state/AuthContext';
import { readSpreadsheetSheets } from '../../lib/statementFile';
import { holdPhotos, holdSheet } from '../../lib/pendingUpload';
import { isChampionManager } from '../../../functions/src/shared/hopeChampionPay';
import { whatFile, type HopeFileKind } from '../../../functions/src/shared/hopeRegister';
import { HopeGate } from './common';
import type { Organization } from '../../state/OrgContext';

export function HopeUploadPage() {
  return <HopeGate title="Upload">{(org) => <Upload org={org} />}</HopeGate>;
}

const WHERE: Record<HopeFileKind, { to: string; says: string }> = {
  sponsors: { to: '/hope/children/sponsors', says: 'This looks like the KE-014 Child Registration List.' },
  children: { to: '/hope/children/import', says: 'This looks like a list of children.' },
  champions: { to: '/hope/register?w=champions&tab=upload', says: 'This looks like the Child Champions list.' },
};

/**
 * One Upload button (v182, 7A): choose any file and the app tells what it is from its headings, then opens the page
 * that checks it before anything is saved. Photos go to the photo upload, matched by their names.
 */
function Upload({ org }: { org: Organization }) {
  const navigate = useNavigate();
  const { profile } = useAuth();
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [unsure, setUnsure] = useState<{ rows: (string | number | Date | null)[][]; name: string } | null>(null);
  const champions = isChampionManager(profile, org.id);

  function go(kind: HopeFileKind, rows: (string | number | Date | null)[][], name: string) {
    holdSheet(kind, rows, name);
    navigate(WHERE[kind].to);
  }
  async function choose(e: ChangeEvent<HTMLInputElement>) {
    const files = [...(e.target.files ?? [])];
    e.target.value = '';
    setError(''); setUnsure(null);
    if (!files.length) return;
    const pics = files.filter((f) => f.type.startsWith('image/') || /\.(jpe?g|png|heic|webp)$/i.test(f.name));
    if (pics.length === files.length) { holdPhotos(pics); navigate('/hope/children/photos'); return; }
    if (files.length > 1) { setError('Choose one Excel or CSV file, or only photos.'); return; }
    setBusy(true);
    try {
      const rows = (await readSpreadsheetSheets(files[0]!)).flatMap((s) => s.rows);
      const kind = whatFile(rows);
      if (kind === 'champions' && !champions) { setError('This looks like the Child Champions list. Only the Director and admins upload it.'); return; }
      if (kind) go(kind, rows, files[0]!.name);
      else setUnsure({ rows, name: files[0]!.name });
    } catch (err) {
      const msg = err instanceof Error ? err.message : '';
      setError(/cell value|xml|zip/i.test(msg) || !msg ? 'That file could not be read. Save it as .xlsx or CSV and choose it again.' : msg);
    } finally { setBusy(false); }
  }

  return (
    <div className="page narrow">
      <p><Link to="/hope/children">← Children</Link></p>
      <h1>⬆︎ Upload</h1>
      <section className="card stack">
        <p>Choose any file: the KE-014 list, a list of children, the champions list, or children's photos. The app tells what it is and shows you everything before it saves.</p>
        <label className="btn btn-primary align-start">{busy ? 'Reading…' : 'Choose a file'}<input type="file" hidden multiple disabled={busy}
          accept=".xlsx,.csv,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,image/*" onChange={(e) => void choose(e)} /></label>
        <p className="small muted">For photos, name each one with the child's code (HC-0042.jpg) or their full name, and choose them all at once.</p>
        {error && <p className="error" role="alert">{error}</p>}
      </section>
      {unsure && (
        <section className="card stack">
          <h2>What is this file?</h2>
          <p className="small">The headings did not say. Choose what it is:</p>
          <div className="chips">
            <button type="button" className="btn" onClick={() => go('sponsors', unsure.rows, unsure.name)}>🤝 KE-014 list</button>
            <button type="button" className="btn" onClick={() => go('children', unsure.rows, unsure.name)}>🧒 Children list</button>
            {champions && <button type="button" className="btn" onClick={() => go('champions', unsure.rows, unsure.name)}>🙌 Champions list</button>}
          </div>
        </section>
      )}
    </div>
  );
}
