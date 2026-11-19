import { useEffect, useState, type FormEvent } from 'react';
import { useParams } from 'react-router-dom';
import { httpsCallable } from 'firebase/functions';
import { functions } from '../../firebase';
import { friendlyError } from '../../lib/errors';
import { PoweredBy } from '../../components/PoweredBy';

interface Found { serial: string; name: string; admissionNo: string; programme: string; cohort: string; finalPoints: number | null; finalGrade: string; provisional: boolean; issuedOn: string; newer: string | null }
type Answer = { orgName: string; found: boolean; transcript?: Found };
const call = (data: Record<string, string>) => httpsCallable<Record<string, string>, Answer>(functions, 'verifyTranscript')(data).then((r) => r.data);
const pretty = (d: string) => { const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(d); return m ? `${Number(m[3])} ${['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][Number(m[2]) - 1]} ${m[1]}` : d; };

/**
 * The page behind each transcript's QR code (Andy, 2026-11-19, 7A): open to anyone, no sign-in. It confirms
 * the transcript is genuine and shows what it says. Without the QR code, type the number and admission number.
 */
export function VerifyTranscriptPage() {
  const { orgId = '', token = '' } = useParams();
  const [answer, setAnswer] = useState<Answer | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [serial, setSerial] = useState('');
  const [adm, setAdm] = useState('');

  const [org, setOrg] = useState('');
  useEffect(() => {
    setBusy(true);
    const job = token ? call({ orgId, token }).then((r) => { setAnswer(r); return r; }) : call({ orgId, action: 'info' });
    job.then((r) => setOrg(r.orgName), (err) => setError(friendlyError(err))).finally(() => setBusy(false));
  }, [orgId, token]);

  async function check(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try { setAnswer(await call({ orgId, serial, admissionNo: adm })); } catch (err) { setError(friendlyError(err)); } finally { setBusy(false); }
  }

  const t = answer?.transcript;
  return (
    <main className="verify-page">
      <section className="verify-card">
        <img src="/org/adia-crest.png" alt="" className="verify-crest" />
        <h1>{org || 'ADIA Training Centre'}</h1>
        <p className="verify-kicker">TRANSCRIPT CHECK</p>
        {busy && !answer && <p className="muted">Checking…</p>}
        {error && <p className="up-bad">{error}</p>}
        {answer && (answer.found && t ? (
          <div className="verify-result">
            <p className={`verify-badge${t.provisional ? ' verify-provisional' : ''}`}>{t.provisional ? '✓ Genuine provisional transcript' : '✓ Genuine transcript'}</p>
            <dl>
              <div><dt>Number</dt><dd>{t.serial}</dd></div>
              <div><dt>Name</dt><dd>{t.name}</dd></div>
              <div><dt>Admission no.</dt><dd>{t.admissionNo || '–'}</dd></div>
              <div><dt>Programme</dt><dd>{t.programme || '–'}</dd></div>
              <div><dt>Cohort</dt><dd>{t.cohort}</dd></div>
              <div><dt>Final result</dt><dd>{t.finalPoints != null ? `${t.finalPoints} · ${t.finalGrade}` : t.finalGrade || 'Not yet complete'}</dd></div>
              <div><dt>Printed</dt><dd>{pretty(t.issuedOn)}</dd></div>
            </dl>
            {t.provisional && <p className="small muted">Provisional: some results were still waiting for the principal's approval when it was printed.</p>}
            {t.newer && <p className="small notice">A newer transcript ({t.newer}) has been printed for this student since. Ask for that one.</p>}
          </div>
        ) : <p className="up-bad">No transcript matches. Check the number and admission number, or call the college.</p>)}
        {!token && (
          <form className="stack" onSubmit={(e) => void check(e)}>
            <label className="field"><span>Transcript number</span><input value={serial} onChange={(e) => setSerial(e.target.value)} placeholder="ADIA/TR/2026/0001" required /></label>
            <label className="field"><span>Admission number</span><input value={adm} onChange={(e) => setAdm(e.target.value)} required /></label>
            <button type="submit" className="btn btn-primary" disabled={busy}>{busy ? 'Checking…' : 'Check'}</button>
          </form>
        )}
      </section>
      <PoweredBy />
    </main>
  );
}
