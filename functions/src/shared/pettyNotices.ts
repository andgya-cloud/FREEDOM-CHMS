import { formatMoney } from './giving.js';
import { BIN_SIGNATURES_NEEDED, categoryLabel, REQUEST_SIGNATURES_NEEDED, type PettyCashCategory } from './pettyCash.js';
import type { Letterhead } from './pettyVoucher.js';
import { POWERED_BY, poweredByHtml } from './poweredBy.js';

const hex = (c: [number, number, number]) => `#${c.map((v) => v.toString(16).padStart(2, '0')).join('')}`;

/*
 * The petty cash notices (Andy, 2026-10-23): "please approve" when a request is submitted, a reminder
 * after 24 hours, and "approved" with the signed voucher. Sent by email and WhatsApp to the stakeholders.
 * Pure text, shared with the tests; the sending lives in the Cloud Functions.
 */
export type PettyNoticeKind = 'ask' | 'reminder' | 'approved';
export const REMIND_AFTER_HOURS = 24;

export interface NoticeRequest {
  number: string; requesterName: string; category: PettyCashCategory; categoryNote?: string | null; totalCents: number;
  items: { description: string }[];
}

export interface NoticeInput {
  kind: PettyNoticeKind; lh: Letterhead; currency: string; r: NoticeRequest; link: string; recipientName: string;
  /** Who signed so far (for a reminder) or who approved (for "approved"), as "Name (Title)". */
  signers: string[];
}

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
const firstName = (name: string) => name.trim().split(/\s+/)[0] || name;

export function noticeSubject(n: NoticeInput): string {
  const amount = formatMoney(n.r.totalCents, n.currency);
  if (n.kind === 'approved') return `Approved: petty cash requisition ${n.r.number} (${amount})`;
  if (n.kind === 'reminder') return `Reminder: requisition ${n.r.number} (${amount}) is waiting for approval`;
  return `Approval needed: petty cash requisition ${n.r.number} (${amount})`;
}

function lead(n: NoticeInput): string {
  const who = n.r.requesterName;
  if (n.kind === 'approved') {
    return `Petty cash requisition ${n.r.number}, raised by ${who}, has been approved by ${n.signers.join(' and ')}. The signed payment voucher is attached.`;
  }
  if (n.kind === 'reminder') {
    const so = n.signers.length ? ` So far it has been signed by ${n.signers.join(' and ')}.` : '';
    return `Petty cash requisition ${n.r.number}, raised by ${who}, has been waiting for approval for more than ${REMIND_AFTER_HOURS} hours.${so} Any ${REQUEST_SIGNATURES_NEEDED} stakeholders must approve it.`;
  }
  return `${who} has submitted petty cash requisition ${n.r.number} for approval. Any ${REQUEST_SIGNATURES_NEEDED} stakeholders must approve it. The requester cannot approve their own request.`;
}

/** The plain-text email, for mail apps that do not show HTML. */
export function noticeText(n: NoticeInput): string {
  const amount = formatMoney(n.r.totalCents, n.currency);
  return [
    `Dear ${firstName(n.recipientName)},`, '', lead(n), '',
    `Requisition: ${n.r.number}`, `Requested by: ${n.r.requesterName}`, `Category: ${categoryLabel(n.r)}`, `Amount: ${amount}`,
    `Items: ${n.r.items.map((i) => i.description).join('; ')}`, '',
    n.kind === 'approved' ? `View it in Insight-IQ: ${n.link}` : `Review and approve in Insight-IQ: ${n.link}`, '',
    'Kind regards,', `${n.lh.name} · Petty Cash`, ...n.lh.lines, '', POWERED_BY,
  ].join('\n');
}

/** The HTML email: navy and gold, with the requisition's details and one clear button. */
export function noticeHtml(n: NoticeInput): string {
  const amount = formatMoney(n.r.totalCents, n.currency);
  const rows: [string, string][] = [
    ['Requisition', n.r.number], ['Requested by', n.r.requesterName], ['Category', categoryLabel(n.r)], ['Amount', amount],
    ['Items', n.r.items.map((i) => i.description).join('; ')],
  ];
  if (n.kind === 'approved') rows.push(['Approved by', n.signers.join('<br>')]);
  const badge = n.kind === 'approved' ? ['APPROVED', '#16a34a'] : n.kind === 'reminder' ? ['REMINDER', '#d97706'] : ['APPROVAL NEEDED', '#b08934'];
  const button = n.kind === 'approved' ? 'View in Insight-IQ' : 'Review and approve';
  const band = hex(n.lh.band);
  const accent = hex(n.lh.accent);
  return `<!doctype html><html><body style="margin:0;padding:0;background:#f3f4f6;font-family:Arial,Helvetica,sans-serif;color:#1f2937">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f3f4f6;padding:24px 12px"><tr><td align="center">
<table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background:#ffffff;border-radius:12px;overflow:hidden;border:1px solid #e5e7eb">
<tr><td style="background:${band};padding:22px 28px;border-bottom:4px solid ${accent}">
<div style="color:#ffffff;font-size:20px;font-weight:bold">${esc(n.lh.name)}</div>
<div style="color:${accent};font-size:11px;letter-spacing:2px;margin-top:4px">PETTY CASH</div>
${n.lh.lines.map((l) => `<div style="color:#cbd5e1;font-size:12px;margin-top:2px">${esc(l)}</div>`).join('')}
</td></tr>
<tr><td style="padding:26px 28px 8px">
<span style="display:inline-block;padding:4px 10px;border-radius:999px;background:${badge[1]};color:#ffffff;font-size:11px;font-weight:bold;letter-spacing:1px">${badge[0]}</span>
<p style="font-size:15px;margin:18px 0 6px">Dear ${esc(firstName(n.recipientName))},</p>
<p style="font-size:15px;line-height:1.55;margin:0 0 18px">${esc(lead(n))}</p>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;font-size:14px">
${rows.map(([k, v], i) => `<tr style="background:${i % 2 ? '#ffffff' : '#faf6ec'}"><td style="padding:9px 12px;color:#6b7280;width:140px;vertical-align:top">${esc(k)}</td><td style="padding:9px 12px;font-weight:bold">${k === 'Approved by' ? v.split('<br>').map(esc).join('<br>') : esc(v)}</td></tr>`).join('\n')}
</table>
<p style="margin:24px 0 8px"><a href="${esc(n.link)}" style="display:inline-block;background:${band};color:#ffffff;text-decoration:none;padding:12px 22px;border-radius:8px;font-weight:bold">${button}</a></p>
<p style="font-size:12px;color:#6b7280;margin:8px 0 0">${n.kind === 'approved' ? 'Each signature on the voucher was made from the signer’s own account or personal PIN.' : `Sign from your own Insight-IQ account, or with your name and PIN on the device where the request is open. Deleting a request needs any ${BIN_SIGNATURES_NEEDED} stakeholders too.`}</p>
</td></tr>
<tr><td style="padding:18px 28px 24px;color:#6b7280;font-size:12px;border-top:1px solid #f1f1f1">Kind regards,<br><strong style="color:${band}">${esc(n.lh.name)} · Petty Cash</strong><br>This message was sent from Insight-IQ.${poweredByHtml()}</td></tr>
</table></td></tr></table></body></html>`;
}

/**
 * The WhatsApp messages, as Meta must approve them (Utility). Names and wording to paste into WhatsApp
 * Manager; {{n}} slots are filled in order. The approved one carries the voucher PDF as its document header.
 */
export interface PettyWaTemplate { kind: PettyNoticeKind; metaName: string; header: 'DOCUMENT' | null; body: string; example: string[] }
export const PETTY_WA_TEMPLATES: PettyWaTemplate[] = [
  {
    kind: 'ask', metaName: 'petty_cash_approval_request', header: null,
    body: 'Dear {{1}}, {{2}} has submitted petty cash requisition {{3}} for {{4}} ({{5}}) at {{6}}. Any two stakeholders must approve it. Please review it here: {{7}}',
    example: ['Elias', 'Daniel Ojwang', 'ADIA-00012', 'KES 4,500', 'Transport', 'ADIA Training Centre', 'https://freedom-chms.web.app/school/petty-cash/abc'],
  },
  {
    kind: 'reminder', metaName: 'petty_cash_approval_reminder', header: null,
    body: 'Dear {{1}}, a reminder that petty cash requisition {{2}} for {{3}} at {{4}} is still waiting for approval. Please review it here: {{5}}',
    example: ['Elias', 'ADIA-00012', 'KES 4,500', 'ADIA Training Centre', 'https://freedom-chms.web.app/school/petty-cash/abc'],
  },
  {
    kind: 'approved', metaName: 'petty_cash_approved', header: 'DOCUMENT',
    body: 'Dear {{1}}, petty cash requisition {{2}} for {{3}} at {{4}} has been approved by {{5}}. The signed payment voucher is attached.',
    example: ['Elias', 'ADIA-00012', 'KES 4,500', 'ADIA Training Centre', 'Elizabeth Mutuku and Daniel Ojwang'],
  },
];

/** The values for a WhatsApp notice's {{n}} slots, in order. WhatsApp refuses new lines and long runs of spaces in them. */
export function waParams(n: NoticeInput): string[] {
  const clean = (s: string) => s.replace(/[\n\t]+/g, ' ').replace(/ {4,}/g, ' ').trim().slice(0, 200);
  const amount = formatMoney(n.r.totalCents, n.currency);
  const first = firstName(n.recipientName);
  const out = n.kind === 'ask'
    ? [first, n.r.requesterName, n.r.number, amount, categoryLabel(n.r), n.lh.name, n.link]
    : n.kind === 'reminder'
      ? [first, n.r.number, amount, n.lh.name, n.link]
      : [first, n.r.number, amount, n.lh.name, n.signers.join(' and ')];
  return out.map(clean);
}
