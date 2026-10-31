import { useRef, useState, type ChangeEvent } from 'react';
import { useToast } from '../state/ToastContext';
import { friendlyError } from '../lib/errors';
import { downloadCertificate, emailCertificate, uploadCertificate } from '../lib/certificateFiles';
import type { CertificateRow } from '../state/useSchool';

/**
 * A graduate's certificate (Andy, 2026-10-26): Upload the PDF, then Download it or Send to email.
 * Nothing goes to the student until someone presses Send to email.
 */
export function CertificateActions({ orgId, cert, canManage, email, compact }: { orgId: string; cert: CertificateRow; canManage: boolean; email?: string | null; compact?: boolean }) {
  const toast = useToast();
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState<'' | 'upload' | 'download' | 'email'>('');
  const has = !!cert.file;
  async function run(kind: 'upload' | 'download' | 'email', job: () => Promise<string | void>) {
    setBusy(kind);
    try { const msg = await job(); if (msg) toast.show(msg); } catch (err) { toast.show(friendlyError(err)); } finally { setBusy(''); }
  }
  function chosen(e: ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    e.target.value = '';
    if (f) void run('upload', async () => { await uploadCertificate(orgId, cert.studentId, f); return 'Certificate uploaded'; });
  }
  const size = compact ? ' btn-small' : '';
  if (compact) {
    // In the register table the buttons fold into one dropdown, so the table stays clean.
    if (!has && !canManage) return <span className="small muted">Not uploaded</span>;
    const pick = (v: string) => {
      if (v === 'download') void run('download', () => downloadCertificate(orgId, cert.studentId));
      if (v === 'email') void run('email', async () => `Sent to ${await emailCertificate(orgId, cert.studentId)}`);
      if (v === 'upload') input.current?.click();
    };
    return (
      <>
        <select className="cert-select" value="" disabled={!!busy} aria-label="Certificate" onChange={(e) => pick(e.target.value)}>
          <option value="">{busy === 'upload' ? 'Uploading…' : busy === 'download' ? 'Downloading…' : busy === 'email' ? 'Sending…' : has ? 'Certificate ▾' : 'Not uploaded ▾'}</option>
          {has && <option value="download">Download</option>}
          {has && canManage && <option value="email" disabled={!email}>{email ? 'Send to email' : 'Send to email (no email on file)'}</option>}
          {canManage && <option value="upload">{has ? 'Replace the PDF' : 'Upload certificate'}</option>}
        </select>
        <input ref={input} type="file" accept="application/pdf,.pdf" hidden onChange={chosen} />
      </>
    );
  }
  return (
    <div className={`cert-actions${compact ? ' cert-actions-compact' : ''}`}>
      {has && <button type="button" className={`btn${size}`} disabled={!!busy} onClick={() => void run('download', () => downloadCertificate(orgId, cert.studentId))}>{busy === 'download' ? 'Downloading…' : 'Download'}</button>}
      {has && canManage && (
        <button type="button" className={`btn${size}`} disabled={!!busy || !email} title={email ? `Send to ${email}` : 'No email on file'}
          onClick={() => void run('email', async () => `Sent to ${await emailCertificate(orgId, cert.studentId)}`)}>
          {busy === 'email' ? 'Sending…' : 'Send to email'}
        </button>
      )}
      {canManage && (
        <>
          <button type="button" className={`btn${has ? ' btn-quiet' : ''}${size}`} disabled={!!busy} onClick={() => input.current?.click()}>{busy === 'upload' ? 'Uploading…' : has ? 'Replace' : 'Upload certificate'}</button>
          <input ref={input} type="file" accept="application/pdf,.pdf" hidden onChange={chosen} />
        </>
      )}
      {!compact && has && canManage && !email && <p className="small muted cert-note">No email on file. Add one on the student's details to send it.</p>}
      {!compact && cert.emailedTo && <p className="small muted cert-note">Last sent to {cert.emailedTo}.</p>}
      {!has && !canManage && <span className="small muted">Not uploaded yet</span>}
    </div>
  );
}
