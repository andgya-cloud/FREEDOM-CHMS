import { crestImage } from './payrollPdf';
import { newPdf } from './givingPdf';
import { stampPoweredBy } from '../../functions/src/shared/poweredBy';
import { CONDITIONS, CONDITION_LABELS, conditionCounts, phaseTitle, type InventoryComparison, type InventoryCount } from '../../functions/src/shared/inventory';
import { formatDateKey } from '../../functions/src/shared/datetime';

const NAVY: [number, number, number] = [11, 17, 44];
const GOLD: [number, number, number] = [210, 167, 75];
const GOLD_SOFT: [number, number, number] = [246, 236, 212];
const INK: [number, number, number] = [31, 41, 55];
const GREY: [number, number, number] = [107, 114, 128];
const RED: [number, number, number] = [176, 32, 32];

/**
 * A department's inventory register on the ADIA letterhead (Andy, 2026-10-29, 9A): the items, a summary by
 * condition, how late it came in and who reopened it, what changed since the start of the cohort, and the
 * two signatures. Built on the device, so it works offline.
 */
export async function inventoryPdf(opts: {
  count: InventoryCount; submittedOn: string | null; verifiedOn: string | null; late: string; changes: InventoryComparison | null;
}): Promise<File> {
  const { count: c, changes } = opts;
  const pdf = await newPdf('a4');
  const w = pdf.internal.pageSize.getWidth();
  const h = pdf.internal.pageSize.getHeight();
  const img = await crestImage();
  const cols = [
    { t: 'No', w: 7 }, { t: 'Item', w: 40 }, { t: 'Category', w: 22 }, { t: 'Qty', w: 10 }, { t: 'Unit', w: 11 },
    { t: 'Condition', w: 16 }, { t: 'Location', w: 22 }, { t: 'Serial/Tag No.', w: 22 }, { t: 'Remarks', w: 32 },
  ];
  const xs = cols.reduce<number[]>((a, _col, i) => [...a, i === 0 ? 14 : a[i - 1]! + cols[i - 1]!.w], []);
  const status = c.status === 'verified' ? 'Verified' : c.status === 'submitted' ? 'Submitted' : 'Not submitted';

  const tableHead = (y: number) => {
    pdf.setFillColor(...NAVY);
    pdf.rect(14, y - 4.5, w - 28, 7, 'F');
    pdf.setFont('helvetica', 'bold');
    pdf.setFontSize(7.5);
    pdf.setTextColor(255, 255, 255);
    cols.forEach((col, i) => pdf.text(col.t, xs[i]! + 1, y));
    return y + 6.5;
  };
  const head = () => {
    pdf.setFillColor(...NAVY);
    pdf.rect(0, 0, w, 36, 'F');
    pdf.setFillColor(...GOLD);
    pdf.rect(0, 36, w, 1.8, 'F');
    pdf.setFillColor(255, 255, 255);
    pdf.setDrawColor(...GOLD);
    pdf.setLineWidth(0.9);
    pdf.circle(26, 18, 12, 'FD');
    if (img) pdf.addImage(img, 'PNG', 18, 10, 16, 16);
    pdf.setTextColor(255, 255, 255);
    pdf.setFont('helvetica', 'bold');
    pdf.setFontSize(17);
    pdf.text('ADIA Training Centre', 44, 16);
    pdf.setTextColor(...GOLD);
    pdf.setFontSize(9);
    pdf.setCharSpace(1.6);
    pdf.text('INVENTORY REGISTER', 44, 23);
    pdf.setCharSpace(0);
    pdf.setTextColor(220, 224, 235);
    pdf.setFont('helvetica', 'normal');
    pdf.text('P.O. Box 22870-00100 Nairobi · info@adiaempowerment.org', 44, 29.5);
    let y = 46;
    pdf.setFillColor(...GOLD_SOFT);
    pdf.rect(14, y - 5, w - 28, 22, 'F');
    pdf.setFillColor(...GOLD);
    pdf.rect(14, y - 5, 1.2, 22, 'F');
    const who: [string, string][] = [
      ['DEPARTMENT', c.courseName], ['INVENTORY PERIOD', phaseTitle(c.phase, c.cohort)], ['DEADLINE', formatDateKey(c.deadline)],
      ['PREPARED BY', c.signedName || c.preparedByName || '–'], ['SUBMITTED', formatDateKey(opts.submittedOn) || '–'], ['STATUS', status],
    ];
    const cw = (w - 34) / 3;
    who.forEach(([k, v], i) => {
      const x = 18 + (i % 3) * cw;
      const yy = y + Math.floor(i / 3) * 10;
      pdf.setFont('helvetica', 'bold');
      pdf.setFontSize(6.5);
      pdf.setTextColor(138, 109, 44);
      pdf.text(k, x, yy);
      pdf.setFontSize(9.5);
      pdf.setTextColor(...NAVY);
      pdf.text(pdf.splitTextToSize(v, cw - 3)[0] as string, x, yy + 4.2);
    });
    return y + 22;
  };

  let y = head();
  // Late submission: printed for Admin (Andy, 2026-10-29).
  if (opts.late) {
    const lines = pdf.splitTextToSize(opts.late, w - 36) as string[];
    pdf.setFillColor(253, 236, 236);
    pdf.setDrawColor(...RED);
    pdf.setLineWidth(0.4);
    pdf.rect(14, y - 4, w - 28, 6 + lines.length * 4, 'FD');
    pdf.setFont('helvetica', 'bold');
    pdf.setFontSize(8.5);
    pdf.setTextColor(...RED);
    pdf.text('LATE SUBMISSION', 18, y + 0.5);
    pdf.setFont('helvetica', 'normal');
    pdf.text(lines, 18, y + 4.6);
    y += 8 + lines.length * 4;
  }
  y = tableHead(y + 2);
  c.items.forEach((it, n) => {
    const cells = [String(n + 1), it.name, it.category, String(it.quantity), it.unit, CONDITION_LABELS[it.condition], it.location, it.tag, it.remarks];
    const wrapped = cells.map((v, i) => pdf.splitTextToSize(v || (i >= 6 ? '' : '–'), cols[i]!.w - 2) as string[]);
    const lines = Math.min(4, Math.max(...wrapped.map((x) => x.length)));
    const rh = 2.5 + lines * 3.4;
    if (y + rh > h - 20) { pdf.addPage(); y = tableHead(head()); }
    pdf.setFont('helvetica', 'normal');
    pdf.setFontSize(7.5);
    wrapped.forEach((x, i) => {
      const bad = i === 5 && (it.condition === 'broken' || it.condition === 'missing');
      pdf.setTextColor(...(bad ? RED : INK));
      pdf.text(x.slice(0, 4), xs[i]! + 1, y);
    });
    pdf.setDrawColor(229, 231, 235);
    pdf.setLineWidth(0.2);
    pdf.line(14, y + rh - 3.6, w - 14, y + rh - 3.6);
    y += rh;
  });
  if (!c.items.length) {
    pdf.setFont('helvetica', 'italic');
    pdf.setFontSize(8.5);
    pdf.setTextColor(...GREY);
    pdf.text('No items listed.', 16, y);
    y += 6;
  }

  const ensure = (need: number) => { if (y + need > h - 40) { pdf.addPage(); y = head(); } };
  ensure(14);
  const sum = conditionCounts(c.items);
  pdf.setFont('helvetica', 'bold');
  pdf.setFontSize(8.5);
  pdf.setTextColor(...NAVY);
  pdf.text(`${c.items.length} ${c.items.length === 1 ? 'item' : 'items'} · ${CONDITIONS.filter((k) => sum[k]).map((k) => `${CONDITION_LABELS[k]} ${sum[k]}`).join(' · ') || 'none'}`, 14, y + 3);
  y += 9;

  // What changed since the start of the cohort, on the end-of-cohort form.
  if (changes) {
    const groups: [string, { name: string; tag: string; was: string; now: string }[]][] = [
      ['Missing', changes.missing], ['Condition got worse', changes.worse], ['Fewer than at the start', changes.fewer], ['More than at the start', changes.more], ['New items', changes.added],
    ];
    ensure(12);
    pdf.setFont('helvetica', 'bold');
    pdf.setFontSize(10);
    pdf.setTextColor(...NAVY);
    pdf.text(`Changes since the start of ${c.cohort}`, 14, y + 2);
    y += 7;
    const any = groups.some(([, list]) => list.length);
    if (!any) {
      pdf.setFont('helvetica', 'normal');
      pdf.setFontSize(8.5);
      pdf.setTextColor(...GREY);
      pdf.text('Nothing changed: every item from the start of the cohort is here in the same condition.', 14, y + 1);
      y += 7;
    }
    for (const [label, list] of groups) {
      if (!list.length) continue;
      ensure(10);
      pdf.setFont('helvetica', 'bold');
      pdf.setFontSize(8.5);
      pdf.setTextColor(...(label === 'Missing' || label === 'Condition got worse' ? RED : NAVY));
      pdf.text(`${label} (${list.length})`, 14, y + 1);
      y += 5;
      pdf.setFont('helvetica', 'normal');
      pdf.setFontSize(8);
      pdf.setTextColor(...INK);
      for (const ch of list) {
        ensure(5);
        const tag = ch.tag ? ` [${ch.tag}]` : '';
        pdf.text(pdf.splitTextToSize(`• ${ch.name}${tag}${ch.was ? `: ${ch.was}, now ${ch.now}` : `: ${ch.now}`}`, w - 32)[0] as string, 17, y + 1);
        y += 4.5;
      }
      y += 2;
    }
  }
  if (c.verifyNote) {
    ensure(10);
    pdf.setFont('helvetica', 'normal');
    pdf.setFontSize(8.5);
    pdf.setTextColor(...INK);
    pdf.text(pdf.splitTextToSize(`Admin's note: ${c.verifyNote}`, w - 28) as string[], 14, y + 2);
  }

  // Signatures on the last page.
  const sy = h - 30;
  pdf.setDrawColor(...GREY);
  pdf.setLineWidth(0.3);
  pdf.line(14, sy, 84, sy);
  pdf.line(w - 84, sy, w - 14, sy);
  pdf.setFont('helvetica', 'bold');
  pdf.setFontSize(9);
  pdf.setTextColor(...NAVY);
  pdf.text(c.signedName || ' ', 14, sy - 2);
  if (opts.submittedOn) pdf.text(formatDateKey(opts.submittedOn), 66, sy - 2);
  pdf.text(c.verifiedByName || ' ', w - 84, sy - 2);
  if (opts.verifiedOn) pdf.text(formatDateKey(opts.verifiedOn), w - 32, sy - 2);
  pdf.setFont('helvetica', 'normal');
  pdf.setFontSize(8);
  pdf.setTextColor(...GREY);
  pdf.text('Prepared by · signature and date', 14, sy + 4.5);
  pdf.text('Received and verified by (Admin) · signature and date', w - 84, sy + 4.5);
  pdf.setFillColor(...GOLD);
  pdf.rect(0, h - 4, w, 4, 'F');
  stampPoweredBy(pdf);
  const safe = `${c.courseName}-${phaseTitle(c.phase, c.cohort)}`.replace(/[^A-Za-z0-9]+/g, '-').replace(/^-|-$/g, '');
  return new File([pdf.output('blob')], `Inventory-${safe}.pdf`, { type: 'application/pdf' });
}
