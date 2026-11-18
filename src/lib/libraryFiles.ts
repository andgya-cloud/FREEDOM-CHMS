import writeXlsxFile from 'write-excel-file';
import { crestImage } from './payrollPdf';
import { newPdf } from './givingPdf';
import { readSpreadsheetSheets } from './statementFile';
import { stampPoweredBy, POWERED_BY } from '../../functions/src/shared/poweredBy';
import {
  BOOK_TEMPLATE_HEAD, BORROWER_LABELS, STATUS_LABELS, booksFromRows, monthName, prettyDay,
  type ImportedBook, type LibraryBook, type LibraryReport,
} from '../../functions/src/shared/library';

const XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const NAVY: [number, number, number] = [11, 17, 44];
const GOLD: [number, number, number] = [210, 167, 75];
const INK: [number, number, number] = [31, 41, 55];
const GREY: [number, number, number] = [107, 114, 128];
const RED: [number, number, number] = [176, 32, 32];

/**
 * Reads a list of books from an Excel sheet, a CSV or a PDF (Andy, 2026-11-18: "upload pdf or excel list of
 * books"). Everything is read on the device; nothing is saved until the librarian presses Add.
 */
export async function readBookList(file: File, categories: readonly string[], fallback: string) {
  const name = file.name.toLowerCase();
  let rows: unknown[][];
  if (name.endsWith('.pdf') || file.type === 'application/pdf') {
    const { pdfTextRows } = await import('./bankStatementFile');
    rows = await pdfTextRows(file);
  } else {
    rows = (await readSpreadsheetSheets(file)).flatMap((s) => s.rows);
  }
  const found = booksFromRows(rows, categories, fallback);
  if (!found) throw new Error('No books were found in this file. Use the Excel template, or a list with a Title column.');
  return found;
}

type Cell = { value: string | number | null; type?: StringConstructor | NumberConstructor; fontWeight?: 'bold' } | null;
const t = (value: string | null | undefined): Cell => ({ value: value ?? '', type: String });
const n = (value: number | null | undefined): Cell => (value == null ? null : { value, type: Number });
const b = (value: string): Cell => ({ value, fontWeight: 'bold' });

async function workbook(sheets: Cell[][][], names: string[], widths: number[][], fileName: string): Promise<File> {
  const blob = await writeXlsxFile(sheets as never, { sheets: names, columns: widths.map((ws) => ws.map((width) => ({ width }))) } as never) as unknown as Blob;
  return new File([blob], fileName, { type: XLSX });
}

/** The Excel template (4A): one row per title, with how many copies, and the categories on a second sheet. */
export function bookTemplate(categories: readonly string[]): Promise<File> {
  const head = BOOK_TEMPLATE_HEAD.map(b);
  const examples: Cell[][] = [
    [t('Spiritual Leadership'), t('J. Oswald Sanders'), t('Leadership & Ministry'), n(2), t(''), t('A1'), n(1200)],
    [t('Professional Cookery'), t('Ceserani & Kinton'), t('Food Production & Hospitality'), n(1), t(''), t('C3'), n(3500)],
  ];
  return workbook([[head, ...examples], [[b('Categories')], ...categories.map((c) => [t(c)])]], ['Books', 'Categories'],
    [[40, 28, 30, 9, 16, 10, 12], [34]], 'ADIA-library-books-template.xlsx');
}

/** Every copy, for keeping or checking in Excel. */
export function bookListWorkbook(books: readonly LibraryBook[]): Promise<File> {
  const rows: Cell[][] = [['No.', 'Title', 'Author', 'Category', 'Status', 'Who has it', 'Due', 'ISBN', 'Shelf', 'Price (KES)', 'Times borrowed'].map(b),
    ...books.map((x) => [t(x.no), t(x.title), t(x.author), t(x.category), t(STATUS_LABELS[x.status]), t(x.loan?.whoName), t(x.loan ? prettyDay(x.loan.dueOn) : ''),
      t(x.isbn), t(x.shelf), n(x.price), n(x.timesOut)])];
  return workbook([[...rows, [], [t(POWERED_BY)]]], ['Books'], [[11, 40, 26, 28, 13, 26, 13, 16, 9, 11, 9]], 'ADIA-library-books.xlsx');
}

/** The monthly report as Excel (10A). */
export function reportWorkbook(r: LibraryReport): Promise<File> {
  const title: Cell[] = [b(`ADIA Training Centre · Library report · ${monthName(r.month)}`)];
  const foot: Cell[] = [t(POWERED_BY)];
  const summary: Cell[][] = [title, [],
    [b('Books (copies)'), n(r.books)], [b('Different titles'), n(r.titles)], [b('On the shelf'), n(r.onShelf)], [b('Out on loan'), n(r.out)],
    [b('Overdue'), n(r.overdue.length)], [b('Lost or damaged'), n(r.lost.length)], [],
    [b(`Lent in ${monthName(r.month)}`), n(r.lentThisMonth)], [b('Returned'), n(r.returnedThisMonth)], [b('Different borrowers'), n(r.borrowersThisMonth)],
    ...(['student', 'staff', 'church'] as const).map((k) => [t(`  ${BORROWER_LABELS[k]}s`), n(r.byKind[k])]), [], foot];
  const cats: Cell[][] = [title, [], ['Category', 'Copies', 'Out on loan'].map(b), ...r.byCategory.map((c) => [t(c.category), n(c.copies), n(c.out)]), [], foot];
  const most: Cell[][] = [title, [], ['Book', 'Times borrowed'].map(b), ...r.mostBorrowed.map((m) => [t(m.title), n(m.times)]), [], foot];
  const late: Cell[][] = [title, [], ['No.', 'Book', 'Borrower', 'Who', 'Due', 'Days late'].map(b),
    ...r.overdue.map((o) => [t(o.no), t(o.title), t(o.whoName), t(BORROWER_LABELS[o.kind]), t(prettyDay(o.dueOn)), n(o.days)]), [], foot];
  const lost: Cell[][] = [title, [], ['No.', 'Book', 'Lost or damaged', 'Note', 'Replacement (KES)'].map(b),
    ...r.lost.map((l) => [t(l.no), t(l.title), t(STATUS_LABELS[l.status]), t(l.note), n(l.price)]), [], foot];
  return workbook([summary, cats, most, late, lost], ['Summary', 'By category', 'Most borrowed', 'Overdue', 'Lost or damaged'],
    [[34, 12], [32, 10, 12], [44, 14], [11, 40, 26, 15, 13, 10], [11, 40, 16, 40, 16]], `ADIA-library-report-${r.month}.xlsx`);
}

/** The monthly report on the ADIA letterhead (10A), with "Powered by Insight-IQ" at the foot of each page. */
export async function reportPdf(r: LibraryReport, preparedBy: string): Promise<File> {
  const pdf = await newPdf('a4');
  const w = pdf.internal.pageSize.getWidth();
  const h = pdf.internal.pageSize.getHeight();
  const img = await crestImage();
  const head = () => {
    pdf.setFillColor(...NAVY);
    pdf.rect(0, 0, w, 34, 'F');
    pdf.setFillColor(...GOLD);
    pdf.rect(0, 34, w, 1.8, 'F');
    pdf.setFillColor(255, 255, 255);
    pdf.setDrawColor(...GOLD);
    pdf.setLineWidth(0.9);
    pdf.circle(26, 17, 11.5, 'FD');
    if (img) pdf.addImage(img, 'PNG', 18.5, 9.5, 15, 15);
    pdf.setTextColor(255, 255, 255);
    pdf.setFont('helvetica', 'bold');
    pdf.setFontSize(17);
    pdf.text('ADIA Training Centre', 44, 15);
    pdf.setTextColor(...GOLD);
    pdf.setFontSize(9);
    pdf.setCharSpace(1.6);
    pdf.text(`LIBRARY REPORT · ${monthName(r.month).toUpperCase()}`, 44, 22.5);
    pdf.setCharSpace(0);
    return 46;
  };
  let y = head();
  const ensure = (need: number) => { if (y + need > h - 18) { pdf.addPage(); y = head(); } };
  const heading = (s: string) => { ensure(14); pdf.setFont('helvetica', 'bold'); pdf.setFontSize(11); pdf.setTextColor(...NAVY); pdf.text(s, 14, y); y += 6; };
  const line = (cells: string[], xs: number[], bold = false, colour: [number, number, number] = INK) => {
    ensure(6);
    pdf.setFont('helvetica', bold ? 'bold' : 'normal');
    pdf.setFontSize(8.5);
    pdf.setTextColor(...colour);
    cells.forEach((c, i) => pdf.text(pdf.splitTextToSize(c, (xs[i + 1] ?? w - 14) - xs[i]! - 2)[0] as string ?? '', xs[i]!, y));
    pdf.setDrawColor(229, 231, 235);
    pdf.setLineWidth(0.2);
    pdf.line(14, y + 1.8, w - 14, y + 1.8);
    y += 5.6;
  };

  // The figures at a glance.
  const tiles: [string, number][] = [['Books', r.books], ['On the shelf', r.onShelf], ['Out on loan', r.out], ['Overdue', r.overdue.length], ['Lost or damaged', r.lost.length]];
  const tw = (w - 28 - 4 * 3) / 5;
  tiles.forEach(([label, v], i) => {
    const x = 14 + i * (tw + 3);
    pdf.setFillColor(246, 236, 212);
    pdf.rect(x, y - 5, tw, 17, 'F');
    pdf.setFont('helvetica', 'bold');
    pdf.setFontSize(16);
    pdf.setTextColor(...(label === 'Overdue' && v ? RED : NAVY));
    pdf.text(String(v), x + 3, y + 3.5);
    pdf.setFontSize(6.8);
    pdf.setTextColor(138, 109, 44);
    pdf.text(label.toUpperCase(), x + 3, y + 9);
  });
  y += 20;
  pdf.setFont('helvetica', 'normal');
  pdf.setFontSize(9);
  pdf.setTextColor(...INK);
  pdf.text(`In ${monthName(r.month)}: ${r.lentThisMonth} ${r.lentThisMonth === 1 ? 'book' : 'books'} lent to ${r.borrowersThisMonth} ${r.borrowersThisMonth === 1 ? 'person' : 'people'} (students ${r.byKind.student}, staff ${r.byKind.staff}, church members ${r.byKind.church}), ${r.returnedThisMonth} returned. ${r.titles} different titles.`, 14, y, { maxWidth: w - 28 });
  y += 10;

  heading('Books per category');
  const cx = [14, 120, 150];
  line(['Category', 'Copies', 'Out on loan'], cx, true, NAVY);
  for (const c of r.byCategory) line([c.category, String(c.copies), String(c.out)], cx);
  y += 4;
  if (r.mostBorrowed.length) {
    heading(`Most borrowed in ${monthName(r.month)}`);
    for (const m of r.mostBorrowed) line([m.title, `${m.times}×`], [14, 150]);
    y += 4;
  }
  heading(`Overdue (${r.overdue.length})`);
  const ox = [14, 34, 100, 150, 178];
  if (r.overdue.length) {
    line(['No.', 'Book', 'Borrower', 'Due', 'Late'], ox, true, NAVY);
    for (const o of r.overdue) line([o.no, o.title, `${o.whoName} (${BORROWER_LABELS[o.kind]})`, prettyDay(o.dueOn), `${o.days} d`], ox, false, RED);
  } else line(['No book is late.'], [14]);
  y += 4;
  heading(`Lost or damaged (${r.lost.length})`);
  const lx = [14, 34, 100, 125, 175];
  if (r.lost.length) {
    line(['No.', 'Book', 'Status', 'Note', 'KES'], lx, true, NAVY);
    for (const l of r.lost) line([l.no, l.title, STATUS_LABELS[l.status], l.note, l.price != null ? l.price.toLocaleString('en-KE') : '–'], lx);
  } else line(['None.'], [14]);

  // Signatures.
  ensure(30);
  y = Math.max(y + 14, h - 40);
  pdf.setDrawColor(...GREY);
  pdf.setLineWidth(0.3);
  pdf.line(14, y, 84, y);
  pdf.line(w - 84, y, w - 14, y);
  pdf.setFont('helvetica', 'bold');
  pdf.setFontSize(9);
  pdf.setTextColor(...NAVY);
  pdf.text(preparedBy || ' ', 14, y - 2);
  pdf.setFont('helvetica', 'normal');
  pdf.setFontSize(8);
  pdf.setTextColor(...GREY);
  pdf.text('Prepared by (Librarian) · signature and date', 14, y + 4.5);
  pdf.text('Checked by (Principal) · signature and date', w - 84, y + 4.5);
  pdf.setFillColor(...GOLD);
  pdf.rect(0, h - 4, w, 4, 'F');
  stampPoweredBy(pdf);
  return new File([pdf.output('blob')], `ADIA-library-report-${r.month}.pdf`, { type: 'application/pdf' });
}

/**
 * A sheet of QR stickers to print and stick inside each cover (3A): 3 across and 8 down on A4, each with the
 * book's number, a short title and "ADIA Library". The QR code holds the number only.
 */
export async function stickersPdf(books: readonly Pick<LibraryBook, 'no' | 'title'>[]): Promise<File> {
  const { default: QRCode } = await import('qrcode');
  const pdf = await newPdf('a4');
  const w = pdf.internal.pageSize.getWidth();
  const cols = 3, rows = 8, mx = 8, my = 12;
  const cw = (w - mx * 2) / cols, ch = 34;
  for (let i = 0; i < books.length; i++) {
    const k = i % (cols * rows);
    if (i && k === 0) pdf.addPage();
    const x = mx + (k % cols) * cw, y = my + Math.floor(k / cols) * ch;
    const bk = books[i]!;
    pdf.setDrawColor(200, 200, 200);
    pdf.setLineWidth(0.2);
    pdf.setLineDashPattern([1, 1], 0);
    pdf.rect(x + 1, y + 1, cw - 2, ch - 2);
    pdf.setLineDashPattern([], 0);
    const qr = await QRCode.toDataURL(bk.no, { margin: 0, width: 240, errorCorrectionLevel: 'M' });
    pdf.addImage(qr, 'PNG', x + 4, y + 4, 26, 26);
    pdf.setFont('helvetica', 'bold');
    pdf.setFontSize(13);
    pdf.setTextColor(...NAVY);
    pdf.text(bk.no, x + 33, y + 11);
    pdf.setFont('helvetica', 'normal');
    pdf.setFontSize(7.5);
    pdf.setTextColor(...INK);
    pdf.text((pdf.splitTextToSize(bk.title, cw - 37) as string[]).slice(0, 2), x + 33, y + 16.5);
    pdf.setFont('helvetica', 'bold');
    pdf.setFontSize(6.5);
    pdf.setTextColor(138, 109, 44);
    pdf.text('ADIA LIBRARY', x + 33, y + 28);
  }
  stampPoweredBy(pdf);
  const first = books[0]?.no ?? 'LIB', last = books[books.length - 1]?.no ?? '';
  return new File([pdf.output('blob')], `ADIA-library-stickers-${first}${last && last !== first ? `-to-${last}` : ''}.pdf`, { type: 'application/pdf' });
}

export type { ImportedBook };
