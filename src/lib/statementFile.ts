import { parseCsv } from '../../functions/src/shared/giving';

type Cell = string | number | Date | null;

/**
 * Reads a Paybill statement downloaded from the M-Pesa portal: CSV, or an
 * Excel .xlsx file (its first sheet). Old .xls files must be saved as .xlsx
 * or CSV first. Returns the rows as they are; parseStatement does the rest.
 */
export async function readStatementFile(file: File): Promise<Cell[][]> {
  const name = file.name.toLowerCase();
  if (name.endsWith('.xlsx')) {
    const { default: readXlsxFile } = await import('read-excel-file');
    const rows = await readXlsxFile(file);
    return rows.map((r) => r.map((c) => (typeof c === 'boolean' ? String(c) : (c as Cell))));
  }
  if (name.endsWith('.xls')) {
    throw new Error('This is an old Excel file (.xls). Open it in Excel or Google Sheets and save it as .xlsx or CSV, then choose it again.');
  }
  if (name.endsWith('.pdf')) {
    throw new Error('PDF statements cannot be read. On the M-Pesa portal, download the statement as Excel or CSV instead.');
  }
  return parseCsv(await file.text());
}

/** Every worksheet of an Excel file (a class list often has one sheet per programme), or a CSV as one sheet. */
export async function readSpreadsheetSheets(file: File): Promise<{ name: string; rows: Cell[][] }[]> {
  const name = file.name.toLowerCase();
  if (!name.endsWith('.xlsx')) return [{ name: '', rows: await readStatementFile(file) }];
  const { default: readXlsxFile, readSheetNames } = await import('read-excel-file');
  const names = await readSheetNames(file);
  const out: { name: string; rows: Cell[][] }[] = [];
  for (const sheet of names) {
    const rows = await readXlsxFile(file, { sheet });
    out.push({ name: sheet.trim(), rows: rows.map((r) => r.map((c) => (typeof c === 'boolean' ? String(c) : (c as Cell)))) });
  }
  return out;
}
