import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { doc, setDoc } from 'firebase/firestore';
import { db } from '../../firebase';
import { useAuth } from '../../state/AuthContext';
import { useOrg } from '../../state/OrgContext';
import { usePeople } from '../../state/PeopleContext';
import { useToast } from '../../state/ToastContext';
import { requestData, useBackupStatus, useRetentionDays, waitForRequest } from '../../state/useData';
import { createStamps, updateRecord } from '../../lib/records';
import { trackWrite } from '../../lib/sync';
import { friendlyError } from '../../lib/errors';
import { downloadJson, readOrganization, readPerson, safeName } from '../../lib/exportData';
import { MAX_RETENTION_DAYS, MIN_RETENTION_DAYS, DEFAULT_RETENTION_DAYS } from '../../../functions/src/shared/dataset';
import { TRAINING_ORG_ID } from '../../../functions/src/shared/organizations';

/** Backups, "download everything", one person's data, how long deleted records are kept, and practice mode. Pastor only. */
export function DataPage() {
  return (
    <div className="page narrow">
      <div className="page-head"><h1>Data and backups</h1></div>
      <BackupCard />
      <ExportAll />
      <OnePerson />
      <Retention />
      <PracticeMode />
    </div>
  );
}

function BackupCard() {
  const status = useBackupStatus();
  const when = status?.lastAt?.toDate().toLocaleString('en-KE', { dateStyle: 'full', timeStyle: 'short' });
  return (
    <section className="card stack">
      <h2>Weekly backup</h2>
      <p className="small">Every Sunday at 11 pm, a full copy of all records is saved in Firebase Storage. The last 12 weeks are kept. The practice organization is not included.</p>
      {!status ? <p className="notice notice-warn small">No backup has run yet. The first one runs on Sunday night. If Storage is not switched on in Firebase, switch it on first (steps are in the README).</p>
        : status.ok ? <p className="small">Last backup: <strong>{when}</strong> ({status.records?.toLocaleString()} records, {Math.round((status.bytes ?? 0) / 1024).toLocaleString()} KB).</p>
          : <p className="notice notice-warn small">{status.error ?? 'The last backup did not work.'} {when ? `(${when})` : ''}</p>}
    </section>
  );
}

function ExportAll() {
  const { user } = useAuth();
  const { organizations } = useOrg();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const real = organizations.filter((o) => !o.training);

  async function run() {
    if (!user || busy) return;
    setBusy(true);
    try {
      const out: Record<string, unknown> = { takenAt: new Date().toISOString(), organizations: {} };
      const skipped: string[] = [];
      for (const org of real) {
        // The server logs each export; the file is built only after it has.
        await waitForRequest(org.id, requestData(org.id, user.uid, 'export_all'));
        const { collections, skipped: s } = await readOrganization(org.id);
        (out.organizations as Record<string, unknown>)[org.id] = { name: org.name, collections };
        skipped.push(...s.map((n) => `${org.name}: ${n}`));
      }
      if (skipped.length) out.notIncluded = skipped;
      downloadJson(`freedom-chms-everything-${new Date().toISOString().slice(0, 10)}.json`, out);
      toast.show(skipped.length ? 'Downloaded. Some records were not available to this account.' : 'Everything is downloaded.');
    } catch (err) {
      toast.show(friendlyError(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="card stack">
      <h2>Download everything</h2>
      <p className="small">One file with every organization's records: people, attendance, giving, notes and follow-ups. <strong>It holds private information.</strong> Keep it somewhere safe and delete it when you are done. Each download is written to the audit log.</p>
      <button type="button" className="btn btn-primary align-start" disabled={busy || real.length === 0} onClick={() => void run()}>{busy ? 'Preparing…' : 'Download everything'}</button>
    </section>
  );
}

function OnePerson() {
  const { user } = useAuth();
  const { current } = useOrg();
  const { people } = usePeople();
  const toast = useToast();
  const [search, setSearch] = useState('');
  const [personId, setPersonId] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);

  const matches = useMemo(() => {
    const q = search.trim().toLowerCase();
    return q.length < 2 ? [] : people.filter((p) => p.fullName.toLowerCase().includes(q)).slice(0, 8);
  }, [people, search]);
  const person = people.find((p) => p.id === personId);

  if (!current) return <section className="card"><h2>One person's data</h2><p className="small muted">Choose an organization at the top first.</p></section>;

  async function exportPerson() {
    if (!user || !person || busy) return;
    setBusy(true);
    try {
      await waitForRequest(current!.id, requestData(current!.id, user.uid, 'export_person', person.id));
      downloadJson(`${safeName(person.fullName)}-data-${new Date().toISOString().slice(0, 10)}.json`, await readPerson(current!.id, person.id));
      toast.show('Downloaded.');
    } catch (err) {
      toast.show(friendlyError(err));
    } finally {
      setBusy(false);
    }
  }

  async function erase() {
    if (!user || !person || busy) return;
    setBusy(true);
    try {
      await waitForRequest(current!.id, requestData(current!.id, user.uid, 'erase_person', person.id));
      toast.show(`${person.fullName} has been erased.`);
      setPersonId('');
      setSearch('');
      setConfirm('');
    } catch (err) {
      toast.show(friendlyError(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="card stack">
      <h2>One person's data</h2>
      <p className="small">For a person who asks to see or remove what you hold about them. Searching in {current.name}.</p>
      {!person ? (
        <>
          <label className="field"><span>Find the person</span><input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Type at least 2 letters" /></label>
          {matches.length > 0 && (
            <ul className="link-list">
              {matches.map((p) => <li key={p.id}><button type="button" className="btn btn-quiet" onClick={() => setPersonId(p.id)}>{p.fullName}</button></li>)}
            </ul>
          )}
        </>
      ) : (
        <>
          <p><strong>{person.fullName}</strong> <button type="button" className="btn btn-quiet" onClick={() => { setPersonId(''); setConfirm(''); }}>Choose someone else</button></p>
          <button type="button" className="btn align-start" disabled={busy} onClick={() => void exportPerson()}>Download their data</button>
          <div className="notice notice-warn stack">
            <p className="small"><strong>Erase this person.</strong> Their record, attendance, notes, prayer requests, follow-ups, messages, programme and group records are removed for good and cannot be brought back (a backup may still hold them until it is replaced, within 12 weeks). Gifts and receipts stay in the accounts, but no longer carry their name or phone number.</p>
            <label className="field"><span>Type their full name to confirm</span><input value={confirm} onChange={(e) => setConfirm(e.target.value)} /></label>
            <button type="button" className="btn btn-danger align-start" disabled={busy || confirm.trim() !== person.fullName} onClick={() => void erase()}>Erase for good</button>
          </div>
        </>
      )}
    </section>
  );
}

function Retention() {
  const { days, exists } = useRetentionDays();
  const toast = useToast();
  const [value, setValue] = useState(String(DEFAULT_RETENTION_DAYS));
  useEffect(() => { setValue(String(days ?? DEFAULT_RETENTION_DAYS)); }, [days]);
  const n = Number(value);
  const valid = Number.isInteger(n) && n >= MIN_RETENTION_DAYS && n <= MAX_RETENTION_DAYS;

  function save() {
    if (!valid) return;
    const ref = doc(db, 'settings', 'retention');
    (exists ? updateRecord(ref, { deletedDays: n }) : trackWrite(setDoc(ref, { deletedDays: n, ...createStamps() }))).catch((err) => toast.show(friendlyError(err)));
    toast.show('Saved');
  }

  return (
    <section className="card stack">
      <h2>Keeping deleted records</h2>
      <p className="small">When someone deletes a record it can be brought back for this long. After that it is removed for good, every night.</p>
      <label className="field"><span>Days to keep (between {MIN_RETENTION_DAYS} and {MAX_RETENTION_DAYS})</span>
        <input type="number" inputMode="numeric" min={MIN_RETENTION_DAYS} max={MAX_RETENTION_DAYS} value={value} onChange={(e) => setValue(e.target.value)} />
      </label>
      <button type="button" className="btn align-start" disabled={!valid} onClick={save}>Save</button>
    </section>
  );
}

function PracticeMode() {
  const { user } = useAuth();
  const { organizations, select } = useOrg();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const exists = organizations.some((o) => o.id === TRAINING_ORG_ID);

  async function reset() {
    if (!user || busy) return;
    setBusy(true);
    try {
      await waitForRequest(TRAINING_ORG_ID, requestData(TRAINING_ORG_ID, user.uid, 'reset_training'));
      toast.show('The practice organization is ready.');
    } catch (err) {
      toast.show(friendlyError(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="card stack">
      <h2>Practice mode</h2>
      <p className="small">A separate "Practice Church" with made-up people, services and check-ins, so new staff can learn without touching real records. It never shows up in your reports, backups, downloads or the combined view, and it is safe to reset at any time.</p>
      <div className="chips">
        <button type="button" className="btn btn-primary" disabled={busy} onClick={() => void reset()}>{busy ? 'Working…' : exists ? 'Reset the practice data' : 'Set up practice mode'}</button>
        {exists && <button type="button" className="btn" onClick={() => select(TRAINING_ORG_ID)}>Open practice mode</button>}
      </div>
      <p className="small muted">To let a staff member practise, give them access to "Practice Church (training)" in <Link to="/settings/users">Staff accounts</Link>.</p>
    </section>
  );
}
