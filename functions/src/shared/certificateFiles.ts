/**
 * Graduates' certificate files (Andy, 2026-10-26): the school uploads each graduate's certificate as a
 * PDF, then Download saves it and Send to email sends it from ADIA's Gmail. Nothing is sent on its own.
 */
import { poweredByHtml } from './poweredBy.js';

/** The largest certificate PDF accepted, so it fits in one upload and in an email. */
export const CERTIFICATE_MAX_BYTES = 5 * 1024 * 1024;

/** Where a graduate's certificate is kept in Storage. Only Cloud Functions read or write it. */
export function certificatePath(orgId: string, studentId: string): string {
  return `certificates/${orgId}/${studentId}.pdf`;
}

/** Admission numbers and file names compared without case, spaces, slashes or dashes. */
export function fileAdmissionKey(value: string): string {
  return value.toLowerCase().replace(/\.pdf$/i, '').replace(/[^a-z0-9]/g, '');
}

/** True for the first bytes of a PDF ("%PDF-"). */
export function looksLikePdf(bytes: Uint8Array): boolean {
  return bytes.length > 5 && bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46 && bytes[4] === 0x2d;
}

/** The PDF's name when downloaded or attached: "Certificate - Jane Achieng - ADIA-2025-014.pdf". */
export function certificateFileName(name: string, admissionNo?: string | null): string {
  const clean = (s: string) => s.replace(/[\\/:*?"<>|]+/g, '-').replace(/\s+/g, ' ').trim();
  return `Certificate - ${clean(name) || 'Graduate'}${admissionNo ? ` - ${clean(admissionNo).replace(/\s*-\s*/g, '-').replace(/\s+/g, '-')}` : ''}.pdf`;
}

export interface CertificateEmail { studentName: string; programme: string; serial?: string | null }

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const first = (name: string) => name.trim().split(/\s+/)[0] || 'Graduate';

export function certificateEmailSubject(e: CertificateEmail): string {
  return `Your ADIA Training Centre certificate${e.programme ? `: ${e.programme}` : ''}`;
}

function lead(e: CertificateEmail): string {
  return `Congratulations on completing ${e.programme || 'your course'} at ADIA Training Centre. Your certificate${e.serial ? ` (number ${e.serial})` : ''} is attached to this email. Please keep it safe.`;
}

export function certificateEmailText(e: CertificateEmail): string {
  return `Dear ${first(e.studentName)},\n\n${lead(e)}\n\nWe wish you every success.\n\nADIA Training Centre`;
}

export function certificateEmailHtml(e: CertificateEmail): string {
  return `<!doctype html><html><body style="margin:0;padding:0;background:#f3f4f6;font-family:Arial,Helvetica,sans-serif;color:#1f2937">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f3f4f6;padding:24px 12px"><tr><td align="center">
<table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background:#ffffff;border-radius:12px;overflow:hidden;border:1px solid #e5e7eb">
<tr><td style="background:#0b112c;padding:22px 28px;border-bottom:4px solid #d2a74b">
<div style="color:#ffffff;font-size:20px;font-weight:bold">ADIA Training Centre</div>
<div style="color:#d2a74b;font-size:11px;letter-spacing:2px;margin-top:4px">CERTIFICATE</div>
</td></tr>
<tr><td style="padding:26px 28px 8px">
<p style="font-size:15px;margin:0 0 6px">Dear ${esc(first(e.studentName))},</p>
<p style="font-size:15px;line-height:1.55;margin:0 0 18px">${esc(lead(e))}</p>
<p style="font-size:15px;line-height:1.55;margin:0 0 18px">We wish you every success.</p>
</td></tr>
<tr><td style="padding:18px 28px 24px;color:#6b7280;font-size:12px;border-top:1px solid #f1f1f1">Kind regards,<br><strong style="color:#0b112c">ADIA Training Centre</strong>${poweredByHtml()}</td></tr>
</table></td></tr></table></body></html>`;
}
