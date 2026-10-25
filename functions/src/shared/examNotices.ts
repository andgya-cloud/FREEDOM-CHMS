/**
 * The messages a trainer sends the principal from a marks sheet (Andy, 2026-10-25): "CAT 1 is sent"
 * and "please unlock CAT 1 so I can change it". Sent by hand with Send Email (from ADIA's Gmail) or
 * Send WhatsApp (from the trainer's own WhatsApp); nothing goes out on its own.
 */
import { poweredByHtml } from './poweredBy.js';
import { EXAM_COMPONENT_LABELS, type ExamComponent } from './exams.js';

export type ExamNoticeKind = 'sent' | 'change';
export interface ExamNotice {
  kind: ExamNoticeKind;
  component: ExamComponent;
  courseName: string;
  cohort: string;
  teacherName: string;
  reason?: string;
  link: string;
  recipientName?: string;
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const first = (name?: string) => (name ?? '').trim().split(/\s+/)[0] || 'Principal';
const paper = (n: ExamNotice) => (n.component === 'final' ? 'Final exam' : EXAM_COMPONENT_LABELS[n.component]);

export function examNoticeSubject(n: ExamNotice): string {
  return n.kind === 'sent'
    ? `${paper(n)} marks sent: ${n.courseName}, ${n.cohort}`
    : `Please unlock ${paper(n)}: ${n.courseName}, ${n.cohort}`;
}

function lead(n: ExamNotice): string {
  return n.kind === 'sent'
    ? `${n.teacherName} has sent the ${paper(n)} marks for ${n.courseName} (${n.cohort}). They are now locked; only you can unlock them.${n.component === 'final' ? ' The course is waiting for your approval.' : ''}`
    : `${n.teacherName} asks you to unlock the ${paper(n)} marks for ${n.courseName} (${n.cohort}) to change them. Reason: ${n.reason || 'not given'}.`;
}

/** The WhatsApp text, and the plain-text email. */
export function examNoticeText(n: ExamNotice): string {
  return `Hello ${first(n.recipientName)}, ${lead(n)}\n\nOpen it in Insight-IQ: ${n.link}`;
}

export function examNoticeHtml(n: ExamNotice): string {
  const badge = n.kind === 'sent' ? ['MARKS SENT', '#16a34a'] : ['UNLOCK REQUESTED', '#d97706'];
  return `<!doctype html><html><body style="margin:0;padding:0;background:#f3f4f6;font-family:Arial,Helvetica,sans-serif;color:#1f2937">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f3f4f6;padding:24px 12px"><tr><td align="center">
<table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background:#ffffff;border-radius:12px;overflow:hidden;border:1px solid #e5e7eb">
<tr><td style="background:#0b112c;padding:22px 28px;border-bottom:4px solid #d2a74b">
<div style="color:#ffffff;font-size:20px;font-weight:bold">ADIA Training Centre</div>
<div style="color:#d2a74b;font-size:11px;letter-spacing:2px;margin-top:4px">EXAM RECORDS</div>
</td></tr>
<tr><td style="padding:26px 28px 8px">
<span style="display:inline-block;padding:4px 10px;border-radius:999px;background:${badge[1]};color:#ffffff;font-size:11px;font-weight:bold;letter-spacing:1px">${badge[0]}</span>
<p style="font-size:15px;margin:18px 0 6px">Dear ${esc(first(n.recipientName))},</p>
<p style="font-size:15px;line-height:1.55;margin:0 0 18px">${esc(lead(n))}</p>
<p style="margin:24px 0 8px"><a href="${esc(n.link)}" style="display:inline-block;background:#0b112c;color:#ffffff;text-decoration:none;padding:12px 22px;border-radius:8px;font-weight:bold">Open the marks sheet</a></p>
</td></tr>
<tr><td style="padding:18px 28px 24px;color:#6b7280;font-size:12px;border-top:1px solid #f1f1f1">Kind regards,<br><strong style="color:#0b112c">ADIA Training Centre · Exam Records</strong><br>This message was sent from Insight-IQ.${poweredByHtml()}</td></tr>
</table></td></tr></table></body></html>`;
}
