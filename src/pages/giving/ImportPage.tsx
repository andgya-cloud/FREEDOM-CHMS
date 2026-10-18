import { useMemo, useState, type ChangeEvent } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../../state/AuthContext';
import type { Organization } from '../../state/OrgContext';
import { usePeople, type Person } from '../../state/PeopleContext';
import { useFunds, type Fund } from '../../state/useGiving';
import { useSyncState } from '../../lib/sync';
import { importStatement, recordedCodes, type ImportResult, type RecordedCode } from '../../lib/givingWrites';
import { readStatementFile } from '../../lib/statementFile';
import { friendlyError } from '../../lib/errors';
import { OrgGate } from '../../components/OrgGate';
import {
  formatMoney,
  fundFromReference,
  matchPayment,
  PAYBILL_NUMBER,
  parseStatement,
  suggestedMatch,
  titleCaseName,
  type MatchCandidate,
  type ParsedStatement,
  type StatementPayment,
} from '../../../functions/src/shared/giving';
import { formatDateKey } from '../../../functions/src/shared/datetime';

/**
 * Imports the Paybill statement from the M-Pesa portal. Payments already in
 * the app (same M-Pesa code) are skipped; the rest are matched to a fund
 * (from FCC#Fund) and suggested to a person for staff to confirm. Anything
 * not confirmed goes to the Unassigned queue. The totals are checked against
 * the statement before and after.
 */
export function ImportPage() {
  return <OrgGate title="Import M-Pesa statement">{(org) => <Import org={org} />}</OrgGate>;
}

interface Row {
  payment: StatementPayment;
  candidates: MatchCandidate[];
  personId: string | null;
  fundId: string;
}

interface Review {
  fileName: string;
  statement: ParsedStatement;
  recorded: Map<string, RecordedCode>;
  rows: Row[];
}

function Import({ org }: { org: Organization }) {
  const { profile } = useAuth();
  const { online } = useSyncState();
  const { people, byId } = usePeople();
  const { active: funds } = useFunds(org.id);
  const [review, setReview] = useState<Review | null>(null);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState('');

  async function choose(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setError('');
    setResult(null);
    setReview(null);
    setBusy('Reading the statement…');
    try {
      const statement = parseStatement(await readStatementFile(file));
      if (!statement.payments.length) {
        setError(statement.skipped[0]?.reason ?? 'No completed payments were found in this file.');
        return;
      }
      setBusy('Checking which payments are already recorded…');
      const recorded = await recordedCodes(org.id, statement.payments.map((p) => p.code));
      const orgPeople = people.filter((p) => p.orgId === org.id);
      const rows = statement.payments.filter((p) => !recorded.has(p.code)).map((payment) => ({
        payment,
        candidates: matchPayment(payment, orgPeople).slice(0, 3),
        personId: null,
        fundId: fundFromReference(payment.accountRef, funds)?.id ?? '',
      }));
      setReview({ fileName: file.name, statement, recorded, rows });
    } catch (err) {
      setError(friendlyError(err));
    } finally {
      setBusy('');
    }
  }

  if (!online && !review) {
    return (
      <div className="page narrow">
        <p><Link to="/giving">← Giving</Link></p>
        <h1>Import M-Pesa statement</h1>
        <div className="notice">Importing checks every M-Pesa code with the server so nothing is counted twice, so it needs internet. Gifts can still be recorded one at a time offline.</div>
      </div>
    );
  }

  return (
    <div className="page narrow">
      <p><Link to="/giving">← Giving</Link></p>
      <h1>Import M-Pesa statement</h1>

      {!review && !result && (
        <section className="card stack">
          <p>On the M-Pesa portal, download the statement for Paybill {PAYBILL_NUMBER} as Excel (.xlsx) or CSV, then choose it here.</p>
          <label className="btn btn-primary align-start">
            Choose statement file
            <input type="file" accept=".csv,.xlsx,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" className="visually-hidden" onChange={(e) => void choose(e)} />
          </label>
          <p className="hint">Payments already in the app are skipped, so the same statement can be imported again safely.</p>
        </section>
      )}

      {busy && <p className="muted" aria-live="polite">{busy}</p>}
      {error && <p className="error" role="alert">{error}</p>}

      {review && !result && (
        <ReviewStep
          org={org}
          review={review}
          funds={funds}
          byId={byId}
          onChange={(rows) => setReview({ ...review, rows })}
          onCancel={() => setReview(null)}
          onImport={async () => {
            setBusy('Saving the payments…');
            setError('');
            try {
              const { statement, recorded, rows, fileName } = review;
              const already = statement.payments.filter((p) => recorded.has(p.code));
              const res = await importStatement(org.id, rows.map((r) => {
                const person = r.personId ? byId(r.personId) : undefined;
                return {
                  code: r.payment.code,
                  personId: person?.id ?? null,
                  giverName: person?.fullName ?? titleCaseName(r.payment.name),
                  phone: r.payment.phone || null,
                  date: r.payment.date,
                  amountCents: r.payment.amountCents,
                  fundId: r.fundId || null,
                  method: 'mpesa',
                  mpesaCode: r.payment.code,
                  accountRef: r.payment.accountRef,
                  notes: '',
                };
              }), already.map((p) => ({ code: p.code, date: p.date, amountCents: p.amountCents })), {
                fileName,
                firstDate: statement.firstDate,
                lastDate: statement.lastDate,
                statementTotalCents: statement.totalCents,
                paymentCount: statement.payments.length,
                duplicateCount: already.length,
                duplicateCents: already.reduce((s, p) => s + p.amountCents, 0),
                skippedCount: statement.skipped.length,
              }, profile?.displayName ?? '');
              setResult(res);
            } catch (err) {
              setError(friendlyError(err));
            } finally {
              setBusy('');
            }
          }}
          busy={!!busy}
        />
      )}

      {review && result && <Done org={org} review={review} result={result} onAnother={() => { setReview(null); setResult(null); }} />}
    </div>
  );
}

function Totals({ review }: { review: Review }) {
  const { statement, recorded, rows } = review;
  const already = statement.payments.filter((p) => recorded.has(p.code));
  const alreadyCents = already.reduce((s, p) => s + p.amountCents, 0);
  const newCents = rows.reduce((s, r) => s + r.payment.amountCents, 0);
  const mismatched = already.filter((p) => {
    const r = recorded.get(p.code);
    return r?.amountCents != null && r.amountCents !== p.amountCents;
  });
  return (
    <section className="card">
      <dl className="details">
        <div><dt>Statement</dt><dd><strong>{formatMoney(statement.totalCents)}</strong> · {statement.payments.length} completed {statement.payments.length === 1 ? 'payment' : 'payments'}{statement.firstDate && `, ${formatDateKey(statement.firstDate)} to ${formatDateKey(statement.lastDate)}`}</dd></div>
        <div><dt>Already in the app</dt><dd>{formatMoney(alreadyCents)} · {already.length} {already.length === 1 ? 'payment' : 'payments'}</dd></div>
        <div><dt>New</dt><dd>{formatMoney(newCents)} · {rows.length} {rows.length === 1 ? 'payment' : 'payments'}</dd></div>
      </dl>
      {mismatched.length > 0 && (
        <div className="notice notice-warn">
          <strong>{mismatched.length === 1 ? 'One payment was' : `${mismatched.length} payments were`} recorded with a different amount from the statement:</strong>
          <ul className="plain">
            {mismatched.map((p) => (
              <li key={p.code}>{p.code}: statement {formatMoney(p.amountCents)}, app {formatMoney(recorded.get(p.code)!.amountCents!)}. Void it and enter it again with the statement amount.</li>
            ))}
          </ul>
        </div>
      )}
      {statement.skipped.length > 0 && (
        <details>
          <summary className="small">{statement.skipped.length} {statement.skipped.length === 1 ? 'line was' : 'lines were'} left out</summary>
          <ul className="plain small">{statement.skipped.map((s) => <li key={s.line}>Line {s.line}: {s.reason}</li>)}</ul>
        </details>
      )}
    </section>
  );
}

function ReviewStep({ org, review, funds, byId, onChange, onCancel, onImport, busy }: {
  org: Organization;
  review: Review;
  funds: Fund[];
  byId: (id: string) => Person | undefined;
  onChange: (rows: Row[]) => void;
  onCancel: () => void;
  onImport: () => Promise<void>;
  busy: boolean;
}) {
  const { rows } = review;
  const suggestions = rows.filter((r) => !r.personId && suggestedMatch(r.candidates)).length;
  const ready = rows.filter((r) => r.personId && r.fundId).length;
  const set = (i: number, changes: Partial<Row>) => onChange(rows.map((r, j) => (j === i ? { ...r, ...changes } : r)));
  const fundsNamed = useMemo(() => new Set(rows.filter((r) => r.fundId).map((r) => r.fundId)), [rows]);

  return (
    <>
      <Totals review={review} />
      {rows.length === 0 ? (
        <div className="card stack">
          <p>Every payment in this statement is already in the app. Nothing new to import.</p>
          <button type="button" className="btn align-start" disabled={busy} onClick={() => void onImport()}>Save the statement totals for the monthly check</button>
        </div>
      ) : (
        <>
          <section className="stack">
            <div className="page-head">
              <h2>New payments</h2>
              {suggestions > 0 && (
                <button type="button" className="btn btn-quiet" onClick={() => onChange(rows.map((r) => (r.personId ? r : { ...r, personId: suggestedMatch(r.candidates)?.personId ?? null })))}>
                  Accept {suggestions} suggested {suggestions === 1 ? 'match' : 'matches'}
                </button>
              )}
            </div>
            <p className="muted small">
              Pick who gave each payment from the suggestions, and check the fund. Payments without a person or fund go to the Unassigned list, where they can be finished later.
              {fundsNamed.size === 0 && ' No account references named a fund.'}
            </p>
            <ul className="row-list">
              {rows.map((r, i) => {
                const best = suggestedMatch(r.candidates);
                return (
                  <li key={r.payment.code} className="card stack">
                    <div className="card-head">
                      <strong>{formatMoney(r.payment.amountCents)}</strong>
                      <span className="muted small">{formatDateKey(r.payment.date)} {r.payment.time} · {r.payment.code}</span>
                    </div>
                    <span className="small">{titleCaseName(r.payment.name) || 'No name'}{r.payment.phone ? ` · ${r.payment.phone}` : ''} · {r.payment.accountRef || 'no account reference'}</span>
                    <div className="field-row">
                      <label className="field">
                        <span>Person</span>
                        <select value={r.personId ?? ''} onChange={(e) => set(i, { personId: e.target.value || null })}>
                          <option value="">Unassigned</option>
                          {r.candidates.map((c) => {
                            const p = byId(c.personId);
                            return p ? <option key={c.personId} value={c.personId}>{p.fullName} ({c.reason.toLowerCase()}){best?.personId === c.personId ? ', suggested' : ''}</option> : null;
                          })}
                        </select>
                      </label>
                      <label className="field">
                        <span>Fund</span>
                        <select value={r.fundId} onChange={(e) => set(i, { fundId: e.target.value })}>
                          <option value="">Unassigned</option>
                          {funds.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
                        </select>
                      </label>
                    </div>
                  </li>
                );
              })}
            </ul>
          </section>
          <div className="card stack">
            <p><strong>{ready}</strong> will be confirmed with a receipt; <strong>{rows.length - ready}</strong> will go to Unassigned.</p>
            <div className="dialog-actions">
              <button type="button" className="btn btn-quiet" disabled={busy} onClick={onCancel}>Cancel</button>
              <button type="button" className="btn btn-primary" disabled={busy} onClick={() => void onImport()}>Import {rows.length} {rows.length === 1 ? 'payment' : 'payments'}</button>
            </div>
          </div>
        </>
      )}
      <p className="muted small">Importing into {org.name}.</p>
    </>
  );
}

function Done({ org, review, result, onAnother }: { org: Organization; review: Review; result: ImportResult; onAnother: () => void }) {
  const { statement, recorded } = review;
  const alreadyCents = statement.payments.filter((p) => recorded.has(p.code)).reduce((s, p) => s + p.amountCents, 0);
  const lateCents = statement.payments.filter((p) => result.lateDuplicates.includes(p.code)).reduce((s, p) => s + p.amountCents, 0);
  const accounted = alreadyCents + result.importedCents + lateCents;
  const matches = accounted === statement.totalCents;
  return (
    <section className="card stack">
      <h2>Import finished</h2>
      <div className={matches ? 'notice' : 'notice notice-warn'} role="status">
        {matches ? (
          <><strong>Totals match.</strong> Statement {formatMoney(statement.totalCents)} = already in the app {formatMoney(alreadyCents)} + imported now {formatMoney(result.importedCents)}{lateCents ? ` + recorded on another device meanwhile ${formatMoney(lateCents)}` : ''}.</>
        ) : (
          <><strong>Totals differ by {formatMoney(statement.totalCents - accounted)}.</strong> Statement {formatMoney(statement.totalCents)}, accounted for {formatMoney(accounted)}. Check the monthly summary.</>
        )}
      </div>
      <dl className="details">
        <div><dt>Imported</dt><dd>{result.importedCount} payments, {formatMoney(result.importedCents)}</dd></div>
        <div><dt>Confirmed with receipts</dt><dd>{result.confirmedCount}</dd></div>
        <div><dt>Sent to Unassigned</dt><dd>{result.unassignedCount ? <Link to="/giving/unassigned">{result.unassignedCount}</Link> : 0}</dd></div>
        <div><dt>Already recorded, skipped</dt><dd>{statement.payments.length - review.rows.length}</dd></div>
        {result.lateDuplicates.length > 0 && <div><dt>Recorded elsewhere meanwhile</dt><dd>{result.lateDuplicates.join(', ')}</dd></div>}
      </dl>
      <p className="muted small">Receipt numbers are given by the server in a moment. {org.name}'s monthly summary now includes these payments.</p>
      <div className="dialog-actions">
        <button type="button" className="btn btn-quiet" onClick={onAnother}>Import another statement</button>
        <Link className="btn btn-primary" to="/giving">Done</Link>
      </div>
    </section>
  );
}
