import { useEffect, useState } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import { httpsCallable } from 'firebase/functions';
import { functions } from '../../firebase';
import { clock, dayLabel } from '../../../functions/src/shared/serviceHosts';
import { downloadFile } from '../../lib/givingPdf';
import { fromBase64 } from '../../lib/serviceHosts';
import './serviceHosts.css';

type Info = { church: string; firstName: string; mine: boolean; past: boolean; serviceName: string; date: string; time: string; answer: 'pending' | 'yes' | 'no'; hasDoc: boolean };
const call = <R,>(data: Record<string, unknown>) => httpsCallable<typeof data, R>(functions, 'serviceHosts')(data).then((r) => r.data);

/**
 * A Service Host's own page from their email or WhatsApp link (Andy, 2026-11-17, 5A): "Yes, I'll lead" or
 * "I can't". No sign-in. The email's buttons open this page with the choice ready; the host still presses it,
 * so an email program opening links on its own never answers for them.
 */
export function HostAnswerPage() {
  const { orgId = '', token = '' } = useParams();
  const [params] = useSearchParams();
  const [info, setInfo] = useState<Info | null>(null);
  const [error, setError] = useState('');
  const [saying, setSaying] = useState<'yes' | 'no' | null>(params.get('a') === 'no' ? 'no' : null);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    call<Info>({ action: 'answerInfo', orgId, token }).then(setInfo).catch(() => setError('This link is not working. Please ask the church office for a new one.'));
  }, [orgId, token]);

  async function answer(a: 'yes' | 'no') {
    setBusy(true);
    try {
      await call({ action: 'answer', orgId, token, answer: a, reason: a === 'no' ? reason : '' });
      setInfo((i) => (i ? { ...i, answer: a } : i));
      setSaying(null);
    } catch (e) {
      setError((e as { message?: string }).message || 'Something went wrong. Please try again.');
    } finally { setBusy(false); }
  }

  async function requirements() {
    setBusy(true);
    try {
      const r = await call<{ name: string; type: string; base64: string }>({ action: 'answerDoc', orgId, token });
      downloadFile(fromBase64(r.base64, r.name, r.type));
    } catch { setError('The requirements could not be opened. Please ask the church office.'); } finally { setBusy(false); }
  }

  if (error) return <div className="center-card welcome-card"><h1>Service Host</h1><p>{error}</p></div>;
  if (!info) return <div className="splash" aria-busy="true"><span className="splash-mark" />Loading…</div>;
  const when = `${dayLabel(info.date, false)}${info.time ? ` at ${clock(info.time)}` : ''}`;

  return (
    <div className="center-card welcome-card sh-answer">
      <img src="/org/freedom-church-logo.png" alt="" width={72} height={72} />
      <h1>Hello {info.firstName}</h1>
      {!info.mine ? (
        <p>This service is no longer on your list. Thank you for being ready to serve.</p>
      ) : (
        <>
          <p>You are the <strong>Service Host</strong> for the <strong>{info.serviceName}</strong></p>
          <p className="sh-answer-when">{when}</p>
          {info.answer === 'yes' && <p className="sh-answer-done sh-yes">✓ You said yes. Thank you! We will remind you before the day.</p>}
          {info.answer === 'no' && <p className="sh-answer-done sh-no">You said you can't host this one. Thank you for telling us. The pastor has been told.</p>}
          {!info.past && saying !== 'no' && (
            <div className="sh-answer-buttons">
              {info.answer !== 'yes' && <button type="button" className="btn btn-primary" disabled={busy} onClick={() => void answer('yes')}>✓ Yes, I'll lead</button>}
              {info.answer !== 'no' && <button type="button" className="btn" disabled={busy} onClick={() => setSaying('no')}>I can't</button>}
            </div>
          )}
          {!info.past && saying === 'no' && info.answer !== 'no' && (
            <div className="sh-answer-no">
              <label className="field"><span>Why not? (optional)</span><textarea rows={3} maxLength={300} value={reason} onChange={(e) => setReason(e.target.value)} /></label>
              <div className="sh-answer-buttons">
                <button type="button" className="btn btn-danger" disabled={busy} onClick={() => void answer('no')}>Yes, tell the pastor I can't</button>
                <button type="button" className="btn" disabled={busy} onClick={() => setSaying(null)}>Back</button>
              </div>
            </div>
          )}
          {info.hasDoc && <button type="button" className="btn btn-small" disabled={busy} onClick={() => void requirements()}>📄 Read the Service Host requirements</button>}
        </>
      )}
      <p className="muted small">{info.church}</p>
    </div>
  );
}
