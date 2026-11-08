import { useState, type ChangeEvent } from 'react';
import { useToast } from '../../state/ToastContext';
import { friendlyError } from '../../lib/errors';
import { importPastPetty } from '../../lib/pettyPin';
import { pettyCashCategoriesFor } from '../../../functions/src/shared/pettyCash';
import { dayOf, PAST_MONEY_SHEET, PAST_SHEET, readPastSheets, type PastUpload } from '../../../functions/src/shared/pettyPast';
import { PettySignBox } from './PettySignBox';
import { money } from './common';
import type { Organization } from '../../state/OrgContext';

type Row = (string | number | null)[];
/** Excel cells as plain values: dates become YYYY-MM-DD, so the server reads them the same way. */
const plainRows = (rows: unknown[][]): Row[] => rows.map((r) => r.map((c) => (c instanceof Date ? dayOf(c) : typeof c === 'number' || typeof c === 'string' ? c : c == null ? null : String(c))));

/**
 * Add past months (Andy, 2026-11-08): upload the past petty cash sheet. Requisitions come in approved and
 * marked "Past record"; money in comes in as top-ups; app requisitions move up after the past numbers.
 */
export function PastUploadCard({ org, prefix }: { org: Organization; prefix: string }) {
  const toast = useToast();
  const [file, setFile] = useState<{ name: string; upload: Row[]; money: Row[]; read: PastUpload } | null>(null);
  const [busy, setBusy] = useState(false);
  async function choose(e: ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    e.target.value = '';
    if (!f) return;
    setBusy(true);
    try {
      const { readSpreadsheetSheets } = await import('../../lib/statementFile');
      const sheets = await readSpreadsheetSheets(f);
      const find = (want: string) => sheets.find((x) => x.name.toLowerCase() === want.toLowerCase());
      const up = find(PAST_SHEET);
      if (!up) { toast.show(`The file needs a sheet called "${PAST_SHEET}".`); return; }
      const upload = plainRows(up.rows);
      const moneyRows = plainRows(find(PAST_MONEY_SHEET)?.rows ?? []);
      setFile({ name: f.name, upload, money: moneyRows, read: readPastSheets(upload, moneyRows, pettyCashCategoriesFor(org.type), prefix) });
    } catch (err) {
      toast.show(friendlyError(err));
    } finally {
      setBusy(false);
    }
  }
  const r = file?.read;
  const spent = r ? r.requisitions.reduce((n, q) => n + q.items.reduce((m, i) => m + i.amountCents, 0), 0) : 0;
  const moneyIn = r ? r.moneyIn.reduce((n, m) => n + m.amountCents, 0) : 0;
  const dates = r ? [...r.requisitions.map((q) => q.date), ...r.moneyIn.map((m) => m.date)].sort() : [];
  return (
    <section className="card stack no-print">
      <h2>Add past months</h2>
      <p className="small muted">Upload the past petty cash sheet (Excel, with an "{PAST_SHEET}" sheet and a "{PAST_MONEY_SHEET}" sheet). Each requisition comes in already approved and marked "Past record". Requisitions made in the app move up after the past numbers. Uploading the same sheet again adds nothing twice.</p>
      <label className="btn align-start">
        {busy ? 'Reading…' : file ? 'Choose another file' : 'Choose the Excel file'}
        <input type="file" accept=".xlsx" hidden onChange={(e) => void choose(e)} disabled={busy} />
      </label>
      {r && (
        <>
          <ul className="plain small">
            <li><strong>{file!.name}</strong>{dates.length ? `, ${dates[0]} to ${dates[dates.length - 1]}` : ''}</li>
            <li>{r.requisitions.length} requisition{r.requisitions.length === 1 ? '' : 's'} ({r.requisitions[0]?.number ?? ''}{r.requisitions.length > 1 ? ` to ${r.requisitions[r.requisitions.length - 1]!.number}` : ''}), {money(org, spent)} paid out</li>
            <li>{r.moneyIn.length} money-in record{r.moneyIn.length === 1 ? '' : 's'}, {money(org, moneyIn)} in{moneyIn !== spent ? ` (${money(org, Math.abs(moneyIn - spent))} ${moneyIn > spent ? 'more in than out' : 'more out than in'})` : ', so the past months balance'}</li>
          </ul>
          {r.problems.length > 0 ? (
            <div className="petty-warn small"><strong>Fix these in the sheet, then choose it again:</strong>
              <ul>{r.problems.slice(0, 12).map((p) => <li key={p}>{p}</li>)}{r.problems.length > 12 && <li>…and {r.problems.length - 12} more</li>}</ul>
            </div>
          ) : (
            <PettySignBox label="Andrew Guya, Doreen Mayaka or Elias Omondi: choose your name and type your PIN." orgId={org.id} topUpOnly directorMode exclude={[]} confirmLabel="✓ Add past months"
              sign={async (uid, pin) => {
                const s = await importPastPetty(org.id, file!.upload, file!.money, uid, pin);
                setFile(null);
                return `Added ${s.added} past requisition${s.added === 1 ? '' : 's'} (${money(org, s.spentCents)}) and ${s.moneyAdded} money-in record${s.moneyAdded === 1 ? '' : 's'} (${money(org, s.moneyInCents)}).`
                  + (s.skipped ? ` ${s.skipped} were already in.` : '') + (s.shift ? ` Requisitions made in the app moved up; the first is now ${s.firstAppNumber}.` : '');
              }} />
          )}
        </>
      )}
    </section>
  );
}
