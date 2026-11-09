import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../../state/AuthContext';
import type { Organization } from '../../state/OrgContext';
import { useToast } from '../../state/ToastContext';
import { useFunds, useGiftImports, useOpenReviews, useRecentGifts, useUnassignedGifts, type GiftReview } from '../../state/useGiving';
import { addStandardFunds, resolveReview, reviewOutbox } from '../../lib/givingWrites';
import { friendlyError } from '../../lib/errors';
import { OrgGate } from '../../components/OrgGate';
import { GiftRow } from '../../components/GiftRow';
import { DayGiving } from './DayGiving';
import { formatMoney, fundNamed, GIFT_METHOD_LABELS } from '../../../functions/src/shared/giving';
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
  const monthStart = `${localDateKey(new Date(), org.timeZone).slice(0, 7)}-01`;
  const since = [localDateKey(new Date(Date.now() - RECENT_DAYS * 86_400_000), org.timeZone), monthStart].sort()[0]!;
  const { gifts, loading } = useRecentGifts(canRecord || can('giving.person.read') ? org.id : '', since);
  const { imports } = useGiftImports(canRecord || can('finance.reports') ? org.id : '');
  const reviews = useOpenReviews(org.id);
  const fundName = (id: string | null) => funds.find((f) => f.id === id)?.name ?? 'No fund';
  const january = zonedParts(new Date(), org.timeZone).month === 1;
  const navigate = useNavigate();
  const recent = gifts.filter((g) => g.date >= localDateKey(new Date(Date.now() - RECENT_DAYS * 86_400_000), org.timeZone));
  const thisMonth = gifts.filter((g) => g.date >= monthStart && g.status !== 'void');
  const monthCents = thisMonth.reduce((sum, g) => sum + g.amountCents, 0);
  const monthName = new Intl.DateTimeFormat('en-GB', { month: 'long', timeZone: org.timeZone || 'Africa/Nairobi' }).format(new Date());
  // Everything else on Giving is one "More giving" dropdown (Andy, 2026-11-01, 5A).
  const more = [
    { show: canRecord, to: '/giving/import', label: 'Import M-Pesa statement' },
    { show: canRecord, to: '/giving/unassigned', label: `Unassigned payments${queue.length ? ` (${queue.length})` : ''}` },
    { show: can('giving.person.read'), to: '/giving/pledges', label: 'Pledges' },
    { show: can('giving.person.read'), to: '/giving/statements', label: `Giving statements${january ? ' (year-end)' : ''}` },
    { show: can('finance.reports'), to: '/reports?tab=giving', label: 'Giving figures and reports' },
    { show: can('finance.reports'), to: '/giving/summary', label: 'Monthly summary' },
    { show: can('finance.reports'), to: '/finance', label: 'Financial statements from the bank' },
    { show: can('settings.manage'), to: '/settings/funds', label: 'Funds' },
  ].filter((m) => m.show);

  useEffect(() => { void reviewOutbox(); }, []);

  // Freedom Church starts with Tithes and Offerings ready, with no set-up step (Andy, 2026-10-31, 4A).
  const church = org.type === 'church_campus';
  const toast = useToast();
  const started = useRef(false);
  useEffect(() => {
    if (!church || !canRecord || fundsLoading || started.current) return;
    if (fundNamed('Tithes', funds) && fundNamed('Offerings', funds)) return;
    started.current = true;
    addStandardFunds(org.id, funds.map((f) => f.id)).catch((err) => toast.show(friendlyError(err)));
  }, [church, canRecord, fundsLoading, funds, org.id, toast]);

  return (
    <div className="page narrow fin-wide">
      <h1>Giving</h1>

      {canRecord && !church && !fundsLoading && funds.length === 0 && (
        <div className="notice">
          <p>Set up the funds first (Tithes, Offerings and any others) so gifts can be recorded against them.</p>
          {can('settings.manage') ? <Link className="btn btn-primary" to="/settings/funds">Set up funds</Link> : <p className="muted">Ask the pastor to set up the funds.</p>}
        </div>
      )}

      {/* A day's giving on any day, in one go (Andy, 2026-11-09). */}
      {canRecord && church && !fundsLoading && <DayGiving org={org} funds={funds} />}

      {canRecord && (church || funds.length > 0) && (
        <Link to="/giving/new" className={`btn ${church ? '' : 'btn-primary '}btn-block giving-record`}>Record a gift</Link>
      )}

      {(can('giving.person.read') || canRecord) && (
        <section className="card giving-month">
          <span className="muted small">{monthName}{can('giving.person.read') ? '' : ', the gifts you recorded'}</span>
          <b>{formatMoney(monthCents)}</b>
          <span className="muted small">{thisMonth.length} {thisMonth.length === 1 ? 'gift' : 'gifts'}</span>
        </section>
      )}

      {canRecord && queue.length > 0 && (
        <Link to="/giving/unassigned" className="notice notice-warn giving-queue">
          {queue.length} {queue.length === 1 ? 'payment needs' : 'payments need'} a person or fund · {formatMoney(queue.reduce((sum, g) => sum + g.amountCents, 0))}
        </Link>
      )}

      {reviews.length > 0 && <Reviews orgId={org.id} reviews={reviews} fundName={fundName} />}

      {more.length > 0 && (
        <label className="field giving-more">
          <span className="visually-hidden">More giving</span>
          <select className="filter-select" value="" onChange={(e) => { if (e.target.value) navigate(e.target.value); }} aria-label="More giving">
            <option value="">More giving…</option>
            {more.map((m) => <option key={m.to} value={m.to}>{m.label}</option>)}
          </select>
        </label>
      )}

      <section className="stack">
        <h2>Last {RECENT_DAYS} days</h2>
        {!can('giving.person.read') && <p className="muted small">You see the gifts you recorded. The pastor sees everyone's.</p>}
        {loading && recent.length === 0 ? <p className="muted">Loading…</p> : recent.length === 0 ? <p className="muted">No gifts recorded yet.</p> : (
          <ul className="row-list">{recent.slice(0, 50).map((g) => <GiftRow key={g.id} org={org} gift={g} fundName={fundName(g.fundId)} />)}</ul>
        )}
      </section>

      {imports.length > 0 && (
        <details className="card fold">
          <summary>Statements imported</summary>
          <ul className="plain">
            {imports.slice(0, 10).map((i) => (
              <li key={i.id}>
                {i.fileName} <span className="muted small">
                  · {i.firstDate ? `${formatDateKey(i.firstDate)} to ${formatDateKey(i.lastDate)}` : 'no payments'} · {i.importedCount} new, {i.duplicateCount} already recorded · statement total {formatMoney(i.statementTotalCents)}
                </span>
              </li>
            ))}
          </ul>
        </details>
      )}
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
