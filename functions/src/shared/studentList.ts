import type { StatementCell } from './finance.js';
import { normalizePhone } from './phone.js';

/**
 * Reading a list of students from Excel or PDF (Andy, 2026-11-09, 1A-5A). A list has a heading row with a Name
 * column and, if there, Phone, Email, Preferred contact and Message. In a PDF a long name or message can wrap onto
 * the next line; those pieces are joined to the row above.
 */
export interface StudentListRow { name: string; phone: string; email: string; whatsapp: boolean; note: string }
type Col = 'num' | 'name' | 'phone' | 'email' | 'contact' | 'note' | 'other';

const EMAIL = /[^\s@]+@[^\s@]+\.[^\s@]+/;
const headerOf = (text: string): Col | null => {
  const t = text.trim().toLowerCase();
  if (/^(#|no\.?|s\/?no\.?)$/.test(t)) return 'num';
  if (/name/.test(t)) return 'name';
  if (/phone|mobile|tel|number/.test(t)) return 'phone';
  if (/mail/.test(t)) return 'email';
  if (/contact|prefer/.test(t)) return 'contact';
  if (/message|note|comment/.test(t)) return 'note';
  if (/regist|date|time/.test(t)) return 'other';
  return null;
};
const isHeaderRow = (cells: readonly string[]) => cells.some((c) => headerOf(c) === 'name') && cells.filter((c) => headerOf(c)).length >= 2;

const tidyCell = (s: string) => s.replace(/\s+/g, ' ').trim();
export const prefersWhatsApp = (contact: string) => !contact || /whatsapp/i.test(contact) || !/phone call|call|email|sms/i.test(contact);

/** Rows of plain cells (Excel or CSV) into students. */
export function studentsFromTable(table: readonly (readonly string[])[]): StudentListRow[] {
  const headAt = table.findIndex((r) => r.some((c) => headerOf(c) === 'name'));
  if (headAt < 0) throw new Error('The list needs a column called Name.');
  const head = table[headAt]!.map((c) => headerOf(c));
  const at = (c: Col) => head.indexOf(c);
  const n = at('name'), p = at('phone'), e = at('email'), k = at('contact'), m = at('note');
  return table.slice(headAt + 1)
    .filter((r) => !isHeaderRow(r))
    .map((r) => {
      const note = m >= 0 ? tidyCell(r[m] ?? '') : '';
      return {
        name: tidyCell(r[n] ?? ''), phone: p >= 0 ? tidyCell(r[p] ?? '') : '', email: e >= 0 ? tidyCell(r[e] ?? '').toLowerCase() : '',
        whatsapp: prefersWhatsApp(k >= 0 ? r[k] ?? '' : ''), note: note === '-' ? '' : note,
      };
    })
    .filter((r) => r.name);
}

/** PDF rows (cells with where they sit across the page) into students. */
export function studentsFromPdf(rows: readonly (readonly StatementCell[])[]): StudentListRow[] {
  const headRow = rows.find((r) => isHeaderRow(r.map((c) => c.text)));
  if (!headRow) return studentsFromLoosePdf(rows);
  const cols = headRow.map((c) => ({ col: headerOf(c.text) ?? 'other', x: c.x0 })).sort((a, b) => a.x - b.x);
  const colAt = (x: number): Col => {
    let found: Col = cols[0]?.col ?? 'other';
    for (const c of cols) if (x >= c.x - 6) found = c.col;
    return found;
  };
  const out: (StudentListRow & { contact: string })[] = [];
  for (const row of rows) {
    if (!row.length || isHeaderRow(row.map((c) => c.text))) continue;
    const parts: Partial<Record<Col, string>> = {};
    for (const cell of row) {
      // An email or a phone number goes to its own column even if the PDF puts it a little off.
      const col = EMAIL.test(cell.text) ? 'email' : colAt(cell.x0);
      parts[col] = tidyCell(`${parts[col] ?? ''} ${cell.text}`);
    }
    const startsNew = !!parts.num && /^\d+\.?$/.test(parts.num) || !!parts.email || (!!parts.phone && !!normalizePhone(parts.phone.replace(/\s/g, '').slice(0, 15)));
    if (startsNew || !out.length) {
      if (!parts.name) continue;
      out.push({ name: parts.name, phone: parts.phone ?? '', email: (parts.email ?? '').toLowerCase(), whatsapp: true, note: parts.note && parts.note !== '-' ? parts.note : '', contact: parts.contact ?? '' });
    } else {
      // A wrapped line: more of the name, contact or message above.
      const last = out[out.length - 1]!;
      if (parts.name && /^[A-Za-z' .-]+$/.test(parts.name)) last.name = `${last.name} ${parts.name}`;
      if (parts.contact) last.contact = `${last.contact} ${parts.contact}`;
      if (parts.note && last.note) last.note = `${last.note} ${parts.note}`;
    }
  }
  return out.map(({ contact, ...r }) => ({ ...r, note: r.note.replace(/^-\s*/, ''), whatsapp: prefersWhatsApp(contact) }));
}

/** A PDF with no heading row: each line with a phone number or email is a student, the words before it the name. */
function studentsFromLoosePdf(rows: readonly (readonly StatementCell[])[]): StudentListRow[] {
  const out: StudentListRow[] = [];
  for (const row of rows) {
    const line = row.map((c) => c.text).join(' ');
    const email = EMAIL.exec(line)?.[0] ?? '';
    const phone = /(\+?\d[\d ]{8,14}\d)/.exec(line.replace(email, ''))?.[1] ?? '';
    if (!email && !phone) continue;
    const cut = Math.min(...[email, phone].filter(Boolean).map((s) => line.indexOf(s)));
    const name = tidyCell(line.slice(0, cut).replace(/^\s*\d+[.)]?\s+/, ''));
    if (/[a-z]{2}/i.test(name)) out.push({ name, phone, email: email.toLowerCase(), whatsapp: true, note: '' });
  }
  if (!out.length) throw new Error('No students found in this PDF. It needs a Name column, or a phone number or email on each line.');
  return out;
}
