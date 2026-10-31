import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../../state/AuthContext';
import type { Organization } from '../../state/OrgContext';
import { useToast } from '../../state/ToastContext';
import { useFunds, useGiftImports, useOpenReviews, useRecentGifts, useUnassignedGifts, type GiftReview } from '../../state/useGiving';
import { resolveReview, reviewOutbox } from '../../lib/givingWrites';
import { friendlyError } from '../../lib/errors';
import { OrgGate } from '../../components/OrgGate';
import { GiftRow } from '../../components/GiftRow';
import { formatMoney, GIFT_METHOD_LABELS } from '../../../functions/src/shared/giving';
import { formatDateKey, localDateKey, zonedParts } from '../../../functions/src/shared/datetime';

/** The Giving home: record a gift, import the Paybill statement, the Unassigned queue and recent gifts. */
export function GivingPage() {
  return <OrgGate title="Giving">{(org) => <Giving org={org} />}</OrgGate>;
}

const RECENT_DAYS = 30;

function Giving({ org }: { org: Organization }) {
  const { can } = useAuth();
  const canRecord = can('gifts.write');
  const { funds, loading: fundsLoading } = useFunds(org.id);
  const { gifts: queue } = useUnassignedGifts(canRecord ? org.id : '');
  const since = localDateKey(new Date(Date.now() - RECENT_DAYS * 86_400_000), org.timeZone);
  const { gifts, loading } = useRecentGifts(canRecord || can('giving.person.read') ? org.id : '', since);
  const { imports } = useGiftImports(canRecord || can('finance.reports') ? org.id : '');
  const reviews = useOpenReviews(org.id);
  const fundName = (id: string | null) => funds.find((f) => f.id === id)?.name ?? 'No fund';
  const january = zonedParts(new Date(), org.timeZone).month === 1;

  useEffect(() => { void reviewOutbox(); }, []);

  return (
    <div className="page narrow">
      <h1>Giving</h1>

      {canRecord && !fundsLoading && funds.length === 0 && (
        <div className="notice">
          <p>Set up the funds first (Tithes, Offerings and any others) so gifts can be recorded against them.</p>
          {can('settings.manage') ? <Link className="btn btn-primary" to="/settings/funds">Set up funds</Link> : <p className="muted">Ask the pastor to set up the funds.</p>}
        </div>
      )}

      {canRecord && funds.length > 0 && (
        <div className="big-actions">
          <Link to="/giving/new" className="big-action">
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3v18M17 7H9.5a2.5 2.5 0 0 0 0 5h5a2.5 2.5 0 0 1 0 5H6" /></svg>
            <span className="big-action-label">Record Giving</span>
          </Link>
          <Link to="/giving/import" className="big-action">
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3v12m0 0-4-4m4 4 4-4M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2" /></svg>
            <span className="big-action-label">Import M-Pesa statement</span>
          </Link>
        </div>
      )}

      {reviews.length > 0 && <Reviews orgId={org.id} reviews={reviews} fundName={fundName} />}

      <ul className="link-list">
        {canRecord && (
          <li>
            <Link to="/giving/unassigned">
              <span className="link-title">Unassigned{queue.length > 0 && <span className="badge badge-warn">{queue.length}</span>}</span>
              <span className="link-detail">{queue.length ? `${queue.length} ${queue.length === 1 ? 'payment needs' : 'payments need'} a person or fund · ${formatMoney(queue.reduce((s, g) => s + g.amountCents, 0))}` : 'Every payment has a person and fund'}</span>
            </Link>
          </li>
        )}
        {can('finance.reports') && (
          <li>
            <Link to="/giving/dashboard">
              <span className="link-title">Giving dashboard</span>
              <span className="link-detail">Trends, funds, methods and the year against last year</span>
            </Link>
          </li>
        )}
        {can('finance.reports') && (
          <li>
            <Link to="/giving/summary">
              <span className="link-title">Monthly summary</span>
              <span className="link-detail">Fund ledger, and the check against the Paybill statement</span>
            </Link>
          </li>
        )}
        {can('giving.person.read') && (
          <li>
            <Link to="/giving/statements">
              <span className="link-title">Giving statements{january && <span className="badge badge-warn">Year-end</span>}</span>
              <span className="link-detail">{january ? `Statements for ${zonedParts(new Date(), org.timeZone).year - 1} are ready to send` : 'For any member and any dates'}</span>
            </Link>
          </li>
        )}
      </ul>

      <section className="stack">
        <h2>Last {RECENT_DAYS} days</h2>
        {!can('giving.person.read') && <p className="muted small">You see the gifts you recorded. The pastor sees everyone's.</p>}
        {loading && gifts.length === 0 ? <p className="muted">Loading…</p> : gifts.length === 0 ? <p className="muted">No gifts recorded yet.</p> : (
          <ul className="row-list">{gifts.slice(0, 50).map((g) => <GiftRow key={g.id} org={org} gift={g} fundName={fundName(g.fundId)} />)}</ul>
        )}
      </section>

      {imports.length > 0 && (
        <section className="stack">
          <h2>Statements imported</h2>
          <ul className="plain">
            {imports.slice(0, 10).map((i) => (
              <li key={i.id}>
                {i.fileName} <span className="muted small">
                  · {i.firstDate ? `${formatDateKey(i.firstDate)} to ${formatDateKey(i.lastDate)}` : 'no payments'} · {i.importedCount} new, {i.duplicateCount} already recorded · statement total {formatMoney(i.statementTotalCents)}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}
      <p className="muted small">Gifts are saved on this device first, so recording works without internet. Methods: {Object.values(GIFT_METHOD_LABELS).join(', ')}.</p>
    </div>
  );
}

function Reviews({ orgId, reviews, fundName }: { orgId: string; reviews: GiftReview[]; fundName: (id: string | null) => string }) {
  const toast = useToast();
  const [notes, setNotes] = useState<Record<string, string>>({});
  return (
    <section className="notice notice-warn stack">
      <strong>{reviews.length === 1 ? 'A gift needs checking' : `${reviews.length} gifts need checking`}</strong>
      <p className="small">These were saved on a device but the server refused them, so they are not in the totals. Nothing has been overwritten. Check each one against the other record, then mark it checked (or record it again if it was really a separate gift).</p>
      <ul className="plain">
        {reviews.map((r) => (
          <li key={r.id} className="stack">
            <span>
              <strong>{formatMoney(r.amountCents)}</strong> from {r.giverName} on {formatDateKey(r.date)} · {fundName(r.fundId)} · {r.mpesaCode ? `M-Pesa ${r.mpesaCode}` : GIFT_METHOD_LABELS[r.method]}
            </span>
            <span className="muted small">{r.reason}</span>
            <div className="input-with-button">
              <input aria-label="What you found" placeholder="What you found (optional)" value={notes[r.id] ?? ''} onChange={(e) => setNotes({ ...notes, [r.id]: e.target.value })} />
              <button type="button" className="btn" onClick={() => resolveReview(orgId, r.id, notes[r.id] ?? '').catch((err) => toast.show(friendlyError(err)))}>Mark checked</button>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
