import { useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../../state/AuthContext';
import { useOrg, type Organization } from '../../state/OrgContext';
import { useToast } from '../../state/ToastContext';
import { useFunds, useGiftsBetween, usePledges, type Pledge } from '../../state/useGiving';
import { addPledge, removePledge, type NewFund } from '../../lib/givingWrites';
import { friendlyError } from '../../lib/errors';
import { PersonPicker } from '../../components/PersonPicker';
import { ConfirmDialog } from '../../components/ConfirmDialog';
import { formatMoney, fundNamed, otherFundIdFor, parseAmount, pledgeGivenCents, tidyFundName } from '../../../functions/src/shared/giving';
import { formatDateKey, localDateKey } from '../../../functions/src/shared/datetime';

const OTHER = '__other';

/**
 * Pledges (Andy, 2026-10-31, 8A): "promised KES 50,000 to the building, given 20,000 so far". Giving is matched
 * by person and fund, so recording gifts as usual moves each pledge along on its own.
 */
export function PledgesPage() {
  const { current } = useOrg();
  const { can } = useAuth();
  if (!current) return <div className="page narrow"><p>Choose an organization at the top.</p></div>;
  if (!can('giving.person.read')) {
    return <div className="page narrow"><p><Link to="/giving">← Giving</Link></p><p>Only the pastor can see pledges.</p></div>;
  }
  return <Pledges org={current} />;
}

function Pledges({ org }: { org: Organization }) {
  const tz = org.timeZone || 'Africa/Nairobi';
  const today = localDateKey(new Date(), tz);
  const { pledges, loading } = usePledges(org.id);
  const { funds } = useFunds(org.id);
  const earliest = pledges.reduce((min, p) => (p.startDate < min ? p.startDate : min), today);
  const { gifts } = useGiftsBetween(org.id, earliest, today, pledges.length > 0);
  const [adding, setAdding] = useState(false);
  const [removing, setRemoving] = useState<Pledge | null>(null);
  const toast = useToast();

  const fundName = (id: string) => funds.find((f) => f.id === id)?.name ?? 'Fund';
  const rows = pledges.map((p) => ({ p, given: pledgeGivenCents(p, gifts) }));
  const promised = rows.reduce((s, r) => s + r.p.amountCents, 0);
  const given = rows.reduce((s, r) => s + Math.min(r.given, r.p.amountCents), 0);
  const money = (c: number) => formatMoney(c, org.currency || 'KES');

  function remove() {
    const p = removing!;
    setRemoving(null);
    removePledge(org.id, p.id).catch((err) => toast.show(friendlyError(err)));
  }

  return (
    <div className="page narrow">
      <p><Link to="/giving">← Giving</Link></p>
      <div className="person-head">
        <h1>Pledges</h1>
        {!adding && <button type="button" className="btn btn-primary" onClick={() => setAdding(true)}>+ New pledge</button>}
      </div>

      {adding && <PledgeForm org={org} today={today} onDone={() => setAdding(false)} />}

      {pledges.length > 0 && (
        <section className="card pledge-total">
          <div className="pledge-line"><b>{money(given)}</b> given of <b>{money(promised)}</b> promised</div>
          <Progress given={given} promised={promised} />
        </section>
      )}

      <section className="card">
        {loading ? <p className="muted">Loading…</p> : rows.length === 0 ? (
          <p className="muted">No pledges yet. When someone promises to give to the building or any other fund, add it here. Their giving to that fund then counts towards it on its own.</p>
        ) : (
          <ul className="row-list pledge-list">
            {rows.map(({ p, given: g }) => {
              const left = Math.max(p.amountCents - g, 0);
              const late = !!p.endDate && p.endDate < today && left > 0;
              return (
                <li key={p.id}>
                  <div className="pledge-row-head">
                    {p.personId ? <Link to={`/people/${org.id}/${p.personId}`}><b>{p.name}</b></Link> : <b>{p.name}</b>}
                    <span className="muted small">{fundName(p.fundId)}{p.endDate ? ` · by ${formatDateKey(p.endDate)}` : ''}</span>
                    {left === 0 ? <span className="badge badge-member">Fulfilled</span> : late && <span className="badge badge-warn">Past the date</span>}
                  </div>
                  <div className="pledge-line">{money(g)} of {money(p.amountCents)}{left > 0 && <span className="muted"> · {money(left)} to go</span>}</div>
                  <Progress given={g} promised={p.amountCents} />
                  {!p.personId && <p className="muted small">Not linked to a person, so giving is not counted automatically.</p>}
                  <button type="button" className="link-button-inline small danger-text" onClick={() => setRemoving(p)}>Remove</button>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <ConfirmDialog
        open={!!removing}
        title="Remove this pledge?"
        body="It moves to the bin. Gifts already recorded are not changed."
        confirmLabel="Remove"
        danger
        onConfirm={remove}
        onCancel={() => setRemoving(null)}
      />
    </div>
  );
}

function Progress({ given, promised }: { given: number; promised: number }) {
  const pct = promised > 0 ? Math.min(100, Math.round((given / promised) * 100)) : 0;
  return (
    <div className="pledge-bar" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct} aria-label={`${pct}% given`}>
      <span style={{ width: `${pct}%` }} />
    </div>
  );
}

function PledgeForm({ org, today, onDone }: { org: Organization; today: string; onDone: () => void }) {
  const { active: funds } = useFunds(org.id);
  const toast = useToast();
  const [who, setWho] = useState<{ id: string | null; name: string }>({ id: null, name: '' });
  const [fundId, setFundId] = useState('');
  const [otherName, setOtherName] = useState('');
  const [amount, setAmount] = useState('');
  const [endDate, setEndDate] = useState('');
  const [notes, setNotes] = useState('');
  const [error, setError] = useState('');

  function submit(e: FormEvent) {
    e.preventDefault();
    const cents = parseAmount(amount);
    if (!who.name.trim()) return setError('Choose who made the pledge.');
    if (!cents) return setError('Enter the amount promised.');
    if (!fundId) return setError('Choose what it is for.');
    let useFundId = fundId;
    let newFund: NewFund | undefined;
    if (fundId === OTHER) {
      const name = tidyFundName(otherName);
      if (name.length < 2 || !/[a-z]/i.test(name)) return setError('Type what it is for in words, for example Building Fund.');
      const known = fundNamed(name, funds);
      if (known) useFundId = known.id;
      else { newFund = { id: otherFundIdFor(name), name }; useFundId = newFund.id; }
    }
    if (endDate && endDate < today) return setError('The "by" date has already passed.');
    addPledge(org.id, { personId: who.id, name: who.name, fundId: useFundId, amountCents: cents, startDate: today, endDate: endDate || null, notes }, newFund)
      .catch((err) => toast.show(friendlyError(err)));
    toast.show('Pledge saved');
    onDone();
  }

  return (
    <form className="card form" onSubmit={submit}>
      <h2>New pledge</h2>
      <PersonPicker label="Who" value={who} onChange={setWho} allowFreeText orgId={org.id} hint="Pick them from People so their giving counts towards it." />
      <label className="field">
        <span>For</span>
        <select value={fundId} onChange={(e) => setFundId(e.target.value)}>
          <option value="">Choose…</option>
          {funds.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
          <option value={OTHER}>Something else…</option>
        </select>
      </label>
      {fundId === OTHER && (
        <label className="field"><span>What it is for</span><input value={otherName} onChange={(e) => setOtherName(e.target.value)} placeholder="For example Building Fund" autoCapitalize="words" /></label>
      )}
      <div className="field-row">
        <label className="field"><span>Amount promised (KES)</span><input inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="50,000" /></label>
        <label className="field"><span>By (optional)</span><input type="date" value={endDate} min={today} onChange={(e) => setEndDate(e.target.value)} /></label>
      </div>
      <label className="field"><span>Notes (optional)</span><input value={notes} maxLength={500} onChange={(e) => setNotes(e.target.value)} /></label>
      {error && <p className="error" role="alert">{error}</p>}
      <div className="dialog-actions">
        <button type="submit" className="btn btn-primary">Save pledge</button>
        <button type="button" className="btn" onClick={onDone}>Cancel</button>
      </div>
    </form>
  );
}
