import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import type { Organization } from '../../state/OrgContext';
import { usePeople } from '../../state/PeopleContext';
import { useToast } from '../../state/ToastContext';
import { useFunds, useGiftsBetween, type Gift } from '../../state/useGiving';
import { downloadFile, shareOrDownload, statementPdf } from '../../lib/givingPdf';
import { friendlyError } from '../../lib/errors';
import { OrgGate } from '../../components/OrgGate';
import { formatMoney } from '../../../functions/src/shared/giving';
import { zonedParts } from '../../../functions/src/shared/datetime';

/**
 * Giving statements for every member who gave in a period: the whole of
 * last year in January (for the annual statements), otherwise this year so
 * far, or any dates.
 */
export function StatementsPage() {
  return <OrgGate title="Giving statements">{(org) => <Statements org={org} />}</OrgGate>;
}

function defaultPeriod(timeZone: string): [string, string] {
  const now = zonedParts(new Date(), timeZone);
  const pad = (n: number) => String(n).padStart(2, '0');
  if (now.month === 1) return [`${now.year - 1}-01-01`, `${now.year - 1}-12-31`];
  return [`${now.year}-01-01`, `${now.year}-${pad(now.month)}-${pad(now.day)}`];
}

function Statements({ org }: { org: Organization }) {
  const [[from, to], setPeriod] = useState(() => defaultPeriod(org.timeZone));
  const { gifts, loading } = useGiftsBetween(org.id, from, to);
  const { funds } = useFunds(org.id);
  const { byId } = usePeople();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const fundName = (id: string | null) => funds.find((f) => f.id === id)?.name ?? 'No fund';

  const givers = useMemo(() => {
    const by = new Map<string, Gift[]>();
    for (const g of gifts) {
      if (g.status !== 'confirmed' || !g.personId) continue;
      by.set(g.personId, [...(by.get(g.personId) ?? []), g]);
    }
    return [...by].map(([personId, list]) => ({
      personId,
      name: byId(personId)?.fullName ?? list[0]!.giverName,
      gifts: list,
      cents: list.reduce((s, g) => s + g.amountCents, 0),
    })).sort((a, b) => a.name.localeCompare(b.name));
  }, [gifts, byId]);
  const nameOnly = gifts.filter((g) => g.status === 'confirmed' && !g.personId);
  const label = from.endsWith('-01-01') && to.endsWith('-12-31') && from.slice(0, 4) === to.slice(0, 4) ? from.slice(0, 4) : `${from}_to_${to}`;

  async function one(giver: (typeof givers)[number]) {
    setBusy(true);
    try {
      const file = await statementPdf(org, [{ personName: giver.name, gifts: giver.gifts }], from, to, fundName, `Giving statement ${giver.name} ${label}.pdf`);
      await shareOrDownload(file, `Your giving statement from ${org.name}`);
    } catch (err) {
      toast.show(friendlyError(err));
    } finally {
      setBusy(false);
    }
  }

  async function all() {
    setBusy(true);
    try {
      downloadFile(await statementPdf(org, givers.map((g) => ({ personName: g.name, gifts: g.gifts })), from, to, fundName, `Giving statements ${org.receiptPrefix} ${label}.pdf`));
    } catch (err) {
      toast.show(friendlyError(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="page narrow">
      <p><Link to="/giving">← Giving</Link></p>
      <h1>Giving statements</h1>
      <div className="field-row">
        <label className="field"><span>From</span><input type="date" value={from} onChange={(e) => e.target.value && setPeriod([e.target.value, to])} /></label>
        <label className="field"><span>To</span><input type="date" value={to} min={from} onChange={(e) => e.target.value && setPeriod([from, e.target.value])} /></label>
      </div>

      {loading ? <p className="muted">Loading…</p> : givers.length === 0 ? <p className="muted">Nobody linked to a person record gave in this period.</p> : (
        <>
          <div className="card stack">
            <p><strong>{givers.length}</strong> {givers.length === 1 ? 'person' : 'people'} gave {formatMoney(givers.reduce((s, g) => s + g.cents, 0))} in this period.</p>
            <button type="button" className="btn btn-primary align-start" disabled={busy} onClick={() => void all()}>Download all statements (one PDF, a page each)</button>
          </div>
          <ul className="row-list">
            {givers.map((g) => (
              <li key={g.personId} className="row">
                <Link to={`/people/${org.id}/${g.personId}`} className="row-main">
                  <span className="row-title">{g.name}</span>
                  <span className="row-detail">{g.gifts.length} {g.gifts.length === 1 ? 'gift' : 'gifts'} · {formatMoney(g.cents)}</span>
                </Link>
                <button type="button" className="btn btn-quiet" disabled={busy} onClick={() => void one(g)}>Share</button>
              </li>
            ))}
          </ul>
        </>
      )}
      {nameOnly.length > 0 && <p className="muted small">{nameOnly.length} {nameOnly.length === 1 ? 'gift' : 'gifts'} ({formatMoney(nameOnly.reduce((s, g) => s + g.amountCents, 0))}) were recorded with a name only, so they have no statement. Open a gift and link it to the person's record to include it.</p>}
    </div>
  );
}
