import { parseStatementRows, pdfItemsToRows, sheetCells, type ParsedStatement, type PdfTextItem, type StatementCell } from '../../functions/src/shared/finance';

/** A PDF statement that is locked: it needs the password the bank sent (often an ID or account number). */
export class StatementPasswordError extends Error {
  constructor(public wrong: boolean) {
    super(wrong ? 'That password did not open the statement. Try again.' : 'This statement is locked with a password. Type the password the bank gave you.');
  }
}

/**
 * Reads a bank or M-Pesa statement on this device (Andy, 2026-11-08): a PDF, an Excel .xlsx or a CSV.
 * Nothing leaves the phone or computer until the lines are saved.
 */
export async function readBankStatement(file: File, password?: string): Promise<ParsedStatement> {
  const name = file.name.toLowerCase();
  if (name.endsWith('.pdf') || file.type === 'application/pdf') return parseStatementRows(await pdfRows(file, password));
  const { readStatementFile } = await import('./statementFile');
  return parseStatementRows(sheetCells(await readStatementFile(file)));
}

/** The text of every page, as rows of cells with where they sit across the page. */
async function pdfRows(file: File, password?: string): Promise<StatementCell[][]> {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const { default: workerUrl } = await import('pdfjs-dist/legacy/build/pdf.worker.min.mjs?url');
  pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;
  let doc;
  try {
    doc = await pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()), password, isEvalSupported: false }).promise;
  } catch (err) {
    if ((err as { name?: string }).name === 'PasswordException') throw new StatementPasswordError(!!password);
    throw new Error('This PDF could not be read. If it is a scanned picture, ask the bank for the statement as a PDF from internet banking, or as Excel.');
  }
  const rows: StatementCell[][] = [];
  for (let n = 1; n <= doc.numPages; n++) {
    const page = await doc.getPage(n);
    const content = await page.getTextContent();
    const items: PdfTextItem[] = [];
    for (const it of content.items as { str?: string; transform?: number[]; width?: number }[]) {
      if (!it.str || !it.transform || !it.str.trim()) continue;
      items.push({ text: it.str, x: it.transform[4]!, y: it.transform[5]!, w: it.width ?? it.str.length * 4 });
    }
    rows.push(...pdfItemsToRows(items));
    page.cleanup();
  }
  await doc.destroy();
  if (!rows.length) throw new Error('This PDF has no text in it (it may be a scanned picture). Ask the bank for the statement from internet banking, or as Excel.');
  return rows;
}
