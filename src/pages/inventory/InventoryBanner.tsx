import { Link } from 'react-router-dom';
import { useOrg } from '../../state/OrgContext';
import { useInventoryAccess, useInventoryCounts, type InventoryCountRow } from '../../state/useInventory';
import { localDateKey } from '../../../functions/src/shared/datetime';
import { canEditCount, countdownText, daysLeft, lateNote, phaseTitle } from '../../../functions/src/shared/inventory';

export const today = () => localDateKey(new Date());
export const dayOf = (t: { toDate?: () => Date } | null | undefined) => (t?.toDate ? localDateKey(t.toDate()) : null);

/** Where a count stands, in a word or two, with how urgent it is. */
export function countStatus(c: InventoryCountRow, now: string): { text: string; tone: 'ok' | 'due' | 'late' | 'done' | 'ask' } {
  if (c.status === 'verified') return { text: 'Verified', tone: 'done' };
  if (c.status === 'submitted') {
    const late = lateNote(c, dayOf(c.submittedAt)) ? ' late' : '';
    return { text: `Submitted${late}, to verify`, tone: late ? 'late' : 'ok' };
  }
  if (c.reopenRequest) return { text: 'Asks to reopen', tone: 'ask' };
  if (canEditCount(c, now)) {
    const n = daysLeft(c.reopenUntil && now > c.deadline ? c.reopenUntil : c.deadline, now);
    return { text: c.reopenUntil && now > c.deadline ? `Reopened, ${countdownText(c.reopenUntil, now)}` : countdownText(c.deadline, now), tone: n <= 5 ? 'due' : 'ok' };
  }
  return { text: 'Closed, not submitted', tone: 'late' };
}

/** The countdown on every page for the people in charge, and reopen requests for Admin (Andy, 2026-10-29, 7A and 8A). */
export function InventoryDueBanner() {
  const { current } = useOrg();
  const a = useInventoryAccess();
  const orgId = current?.type === 'college' && a.counts ? current.id : '';
  const { counts } = useInventoryCounts(orgId);
  const now = today();
  if (!orgId) return null;
  const mine = counts.filter((c) => a.mine.includes(c.courseId) && c.status === 'open' && !c.reopenRequest
    && (canEditCount(c, now) ? daysLeft(c.reopenUntil && now > c.deadline ? c.reopenUntil : c.deadline, now) <= 5 : true));
  const asks = a.manager ? counts.filter((c) => c.status === 'open' && c.reopenRequest) : [];
  const first = mine[0] ?? asks[0];
  if (!first) return null;
  const late = mine[0] && !canEditCount(mine[0], now);
  return (
    <div className={`inv-banner${late || asks.length ? ' inv-banner-late' : ''}`} role="status">
      {mine[0] ? (
        <span><strong>{mine[0].courseName} inventory</strong> ({phaseTitle(mine[0].phase, mine[0].cohort)}) {late ? 'is closed: the deadline has passed. Ask Admin to reopen it.' : `is ${countdownText(mine[0].reopenUntil && now > mine[0].deadline ? mine[0].reopenUntil : mine[0].deadline, now)}.`}{mine.length > 1 ? ` And ${mine.length - 1} more.` : ''}</span>
      ) : (
        <span><strong>{asks[0]!.reopenRequest!.byName}</strong> asks to reopen the {asks[0]!.courseName} inventory.{asks.length > 1 ? ` And ${asks.length - 1} more.` : ''}</span>
      )}
      <Link className="btn btn-small" to={`/inventory/${first.id}`}>Open</Link>
    </div>
  );
}
