import { describe, expect, it } from 'vitest';
import { noticeHtml, noticeSubject, noticeText, PETTY_WA_TEMPLATES, waParams, type NoticeInput } from './pettyNotices';
import { ADIA_LETTERHEAD } from './pettyVoucher';

const base: NoticeInput = {
  kind: 'ask', lh: ADIA_LETTERHEAD, currency: 'KES', link: 'https://freedom-chms.web.app/school/petty-cash/abc', recipientName: 'Elias Omondi', signers: [],
  r: { number: 'ADIA-00012', requesterName: "Daniel Ojwang'", category: 'Transport', categoryNote: null, totalCents: 450000, items: [{ description: 'Fuel <diesel>' }] },
};

describe('petty cash notices', () => {
  it('asks for approval by any two, with the amount in the subject', () => {
    expect(noticeSubject(base)).toMatch(/^Approval needed: petty cash requisition ADIA-00012 \(KES 4,500/);
    expect(noticeText(base)).toContain('Any 2 stakeholders must approve it');
    expect(noticeText(base)).toContain('Dear Elias,');
    expect(noticeText(base)).toContain('P.O. Box 228770-00100 Nairobi');
  });
  it('escapes what people typed in the HTML email', () => {
    const html = noticeHtml(base);
    expect(html).toContain('Fuel &lt;diesel&gt;');
    expect(html).not.toContain('<diesel>');
    expect(html).toContain('Review and approve');
  });
  it('names the two approvers once approved', () => {
    const n = { ...base, kind: 'approved' as const, signers: ['Elizabeth Mutuku (Administrator)', "Daniel Ojwang' (Accountant)"] };
    expect(noticeSubject(n)).toMatch(/^Approved: /);
    expect(noticeText(n)).toContain("approved by Elizabeth Mutuku (Administrator) and Daniel Ojwang' (Accountant)");
    expect(noticeHtml(n)).toContain('APPROVED');
  });
  it('fills every WhatsApp slot, in order, without new lines', () => {
    for (const t of PETTY_WA_TEMPLATES) {
      const slots = new Set(t.body.match(/\{\{\d+\}\}/g)).size;
      const params = waParams({ ...base, kind: t.kind, signers: ['A', 'B'] });
      expect(params).toHaveLength(slots);
      expect(t.example).toHaveLength(slots);
      expect(params.every((p) => p.length > 0 && !p.includes('\n'))).toBe(true);
    }
    expect(waParams(base)[0]).toBe('Elias');
  });
});
