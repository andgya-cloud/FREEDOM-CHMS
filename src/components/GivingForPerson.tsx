import { useState } from 'react';
import type { Organization } from '../state/OrgContext';
import { useToast } from '../state/ToastContext';
import { useFunds, usePersonGifts } from '../state/useGiving';
import { shareOrDownload, statementPdf } from '../lib/givingPdf';
import { friendlyError } from '../lib/errors';
import { GiftRow } from './GiftRow';
import { formatMoney } from '../../functions/src/shared/giving';
import { localDateKey } from '../../functions/src/shared/datetime';

/** On a person's record, for the pastor (or staff allowed): their giving, and a statement for any dates. */
export function GivingForPerson({ org, personId, personName }: { org: Organization; personId: string; personName: string }) {
  const { gifts, loading } = usePersonGifts(org.id, personId);
  const { funds } = useFunds(org.id);
  const toast = useToast();
  const today = localDateKey(new Date(), org.timeZone);
  const [from, setFrom] = useState(`${today.slice(0, 4)}-01-01`);
  const [to, setTo] = useState(today);
  const [busy, setBusy] = useState(false);
  const fundName = (id: string | null) => funds.find((f) => f.id === id)?.name ?? 'No fund';
  const confirmed = gifts.filter((g) => g.status === 'confirmed');
  const thisYear = confirmed.filter((g) => g.date.startsWith(today.slice(0, 4)));
  if (loading && gifts.length === 0) return null;

  async function statement() {
    setBusy(true);
    try {
      const inRange = confirmed.filter((g) => g.date >= from && g.date <= to);
      const file = await statementPdf(org, [{ personName, gifts: inRange }], from, to, fundName, `Giving statement ${personName} ${from} to ${to}.pdf`);
      await shareOrDownload(file, `Your giving statement from ${org.name}`);
    } catch (err) {
      toast.show(friendlyError(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="card">
      <h2>Giving</h2>
      {gifts.length === 0 ? <p className="muted">No gifts recorded.</p> : (
        <>
          <p>{formatMoney(thisYear.reduce((s, g) => s + g.amountCents, 0), org.currency || 'KES')} this year, in {thisYear.length} {thisYear.length === 1 ? 'gift' : 'gifts'}.</p>
          <ul className="row-list">{gifts.slice(0, 5).map((g) => <GiftRow key={g.id} org={org} gift={g} fundName={fundName(g.fundId)} showGiver={false} />)}</ul>
        </>
      )}
      <div className="field-row">
        <label className="field"><span>Statement from</span><input type="date" value={from} onChange={(e) => e.target.value && setFrom(e.target.value)} /></label>
        <label className="field"><span>To</span><input type="date" value={to} min={from} onChange={(e) => e.target.value && setTo(e.target.value)} /></label>
      </div>
      <button type="button" className="btn align-start" disabled={busy} onClick={() => void statement()}>Share giving statement</button>
      <p className="muted small">Only the pastor, and staff the pastor allows, can see this.</p>
    </section>
  );
}
