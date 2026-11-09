import { describe, expect, it } from 'vitest';
import { studentsFromPdf, studentsFromTable } from './studentList.js';

const cell = (text: string, x0: number) => ({ text, x0, x1: x0 + text.length * 4 });

describe('student lists (2026-11-09)', () => {
  it('reads an Excel table with its own column order', () => {
    const r = studentsFromTable([['Title'], ['Phone', 'Full name', 'Preferred contact'], ['0712 345 678', 'Grace W', 'Phone call'], ['', '', '']]);
    expect(r).toEqual([{ name: 'Grace W', phone: '0712 345 678', email: '', whatsapp: false, note: '' }]);
  });
  it('joins a PDF name that wraps onto the next line', () => {
    const rows = [
      [cell('#', 10), cell('Full name', 30), cell('Email', 150), cell('Phone', 260), cell('Preferred contact', 330)],
      [cell('5', 10), cell('OMWANGE SARAH', 30), cell('s@x.com', 150), cell('0712165843', 260), cell('WhatsApp', 330)],
      [cell('KEMUNTO', 30), cell('10:14', 420)],
      [cell('6', 10), cell('Felix', 30), cell('f@x.com', 150), cell('07333313146', 260), cell('Phone call', 330)],
    ];
    const r = studentsFromPdf(rows);
    expect(r.map((x) => x.name)).toEqual(['OMWANGE SARAH KEMUNTO', 'Felix']);
    expect(r[1]).toMatchObject({ phone: '07333313146', whatsapp: false });
  });
  it('reads a PDF with no headings from phone numbers on each line', () => {
    const r = studentsFromPdf([[cell('1. Peter Gitau 0796 003 404', 10)], [cell('Page 1', 10)]]);
    expect(r).toEqual([{ name: 'Peter Gitau', phone: '0796 003 404', email: '', whatsapp: true, note: '' }]);
  });
});
