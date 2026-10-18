import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../../state/AuthContext';
import type { Organization } from '../../state/OrgContext';
import { usePeople } from '../../state/PeopleContext';
import { useToast } from '../../state/ToastContext';
import { useFunds, useUnassignedGifts, type Fund, type Gift } from '../../state/useGiving';
import { assignGift } from '../../lib/givingWrites';
import { addPerson } from '../../lib/peopleWrites';
import { friendlyError } from '../../lib/errors';
import { useSavedMessage } from '../../lib/useSavedMessage';
import { OrgGate } from '../../components/OrgGate';
import { PersonPicker } from '../../components/PersonPicker';
import { fundFromReference, formatMoney, matchPayment, titleCaseName } from '../../../functions/src/shared/giving';
import { paymentLabel } from '../../lib/givingPdf';
import { formatDateKey } from '../../../functions/src/shared/datetime';
import { normalizePhone } from '../../../functions/src/shared/phone';

/** Payments that came in without a known person or fund. Staff choose them here; the receipt follows. */
export function UnassignedPage() {
  return <OrgGate title="Unassigned">{(org) => <Unassigned org={org} />}</OrgGate>;
}

function Unassigned({ org }: { org: Organization }) {
  const { gifts, loading } = useUnassignedGifts(org.id);
  const { active: funds } = useFunds(org.id);
  const total = gifts.reduce((s, g) => s + g.amountCents, 0);
  return (
    <div className="page narrow">
      <p><Link to="/giving">← Giving</Link></p>
      <h1>Unassigned</h1>
      <p className="lead">{gifts.length ? `${gifts.length} ${gifts.length === 1 ? 'payment' : 'payments'} · ${formatMoney(total)}` : loading ? 'Loading…' : 'Nothing waiting. Every payment has a person and fund.'}</p>
      {gifts.length > 0 && <p className="muted small">Suggestions come from the phone number and name on the statement. Check each one before confirming; a receipt is made as soon as a payment has a person and fund.</p>}
      {gifts.map((g) => <QueuedPayment key={g.id} org={org} gift={g} funds={funds} />)}
    </div>
  );
}

function QueuedPayment({ org, gift, funds }: { org: Organization; gift: Gift; funds: Fund[] }) {
  const { can } = useAuth();
  const { people, byId } = usePeople();
  const toast = useToast();
  const saved = useSavedMessage();
  const candidates = useMemo(
    () => matchPayment({ phone: gift.phone ?? '', name: gift.giverName }, people.filter((p) => p.orgId === org.id)).slice(0, 3),
    [gift.phone, gift.giverName, people, org.id],
  );
  const [giver, setGiver] = useState<{ id: string | null; name: string }>(() => {
    const p = gift.personId ? byId(gift.personId) : undefined;
    return { id: p?.id ?? null, name: p?.fullName ?? '' };
  });
  const [fundId, setFundId] = useState(gift.fundId ?? fundFromReference(gift.accountRef, funds)?.id ?? '');
  const statementName = titleCaseName(gift.giverName);
  const fullPhone = gift.phone && !gift.phone.includes('*') ? normalizePhone(gift.phone) : null;

  function confirm(person: { id: string | null; name: string }) {
    if (!fundId || !person.name.trim()) return;
    assignGift(org.id, gift, { personId: person.id, giverName: person.name, fundId }, false).catch((err) => toast.show(friendlyError(err)));
    toast.show(saved(`${formatMoney(gift.amountCents)} confirmed for ${person.name}`));
  }

  function addAsNewPerson() {
    try {
      const { ref, synced } = addPerson(org.id, {
        fullName: statementName,
        phone: fullPhone,
        whatsapp: null,
        whatsappConsent: { given: false, date: null, recordedBy: null },
        status: 'regular',
        firstVisitDate: null,
      });
      synced.catch((err) => toast.show(friendlyError(err)));
      setGiver({ id: ref.id, name: statementName });
      if (fundId) confirm({ id: ref.id, name: statementName });
    } catch (err) {
      toast.show(friendlyError(err));
    }
  }

  return (
    <section className="card stack">
      <div className="card-head">
        <strong>{formatMoney(gift.amountCents)}</strong>
        <span className="muted small">{formatDateKey(gift.date)} · {paymentLabel(gift)}</span>
      </div>
      <p className="small">
        From <strong>{statementName || 'unknown'}</strong>{gift.phone ? ` · ${gift.phone}` : ''}
        {gift.accountRef ? <> · account <strong>{gift.accountRef}</strong></> : ' · no account reference'}
      </p>

      {candidates.length > 0 && !giver.id && (
        <div className="stack">
          <span className="small muted">Possible matches</span>
          <div className="chips">
            {candidates.map((c) => {
              const p = byId(c.personId);
              return p ? (
                <button key={c.personId} type="button" className="chip" onClick={() => setGiver({ id: p.id, name: p.fullName })}>
                  {p.fullName} <span className="muted small">· {c.reason}</span>
                </button>
              ) : null;
            })}
          </div>
        </div>
      )}

      <PersonPicker label="Who gave it" value={giver} onChange={setGiver} allowFreeText orgId={org.id} />

      <label className="field">
        <span>Fund</span>
        <select value={fundId} onChange={(e) => setFundId(e.target.value)}>
          <option value="">Choose…</option>
          {funds.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
        </select>
        {!gift.fundId && gift.accountRef && !fundFromReference(gift.accountRef, funds) && <small className="hint">"{gift.accountRef}" does not name a fund. You can add it as an alias in Settings, Funds.</small>}
      </label>

      <div className="dialog-actions">
        {can('people.write') && !giver.id && statementName && (
          <button type="button" className="btn btn-quiet" onClick={addAsNewPerson}>Add {statementName} as a new person</button>
        )}
        <button type="button" className="btn btn-primary" disabled={!fundId || !giver.name.trim()} onClick={() => confirm(giver)}>
          Confirm{giver.id ? '' : giver.name.trim() ? ' (name only)' : ''}
        </button>
      </div>
      <p className="muted small">{gift.importId ? 'Imported' : 'Recorded'} by {gift.receivedByName}.</p>
    </section>
  );
}
