import { useAuth } from '../state/AuthContext';
import type { Organization } from '../state/OrgContext';
import { useUnassignedGifts } from '../state/useGiving';
import { useReport } from '../state/useReports';
import { localDateKey } from '../../functions/src/shared/datetime';
import { lastCompletePeriod } from '../../functions/src/shared/metrics';

/**
 * What the helper can do for you today (Andy, 2026-11-11, 3A), shown in "Needs you today" only when there is real
 * work, and only the items your role allows.
 */
export function useAiToday(org: Organization): { to: string; text: string }[] {
  const { can } = useAuth();
  const payer = can('gifts.write');
  const briefing = can('pastoral.read') || can('finance.reports') || can('settings.manage');
  const { gifts } = useUnassignedGifts(payer ? org.id : '');
  const today = localDateKey(new Date(), org.timeZone || 'Africa/Nairobi');
  const week = lastCompletePeriod('weekly', today);
  const { report } = useReport(briefing ? org.id : '', `weekly_${week.from}`);
  const unnamed = payer ? gifts.filter((g) => g.giverName).length : 0;
  const items = [
    unnamed > 0 && { to: '/giving/unassigned', text: `${unnamed} ${unnamed === 1 ? 'payment has' : 'payments have'} no member yet: ask the helper who sent ${unnamed === 1 ? 'it' : 'them'}` },
    briefing && report?.aiSummary && { to: `/reports/${org.id}/weekly_${week.from}`, text: "This week's briefing is ready" },
  ].filter(Boolean) as { to: string; text: string }[];
  return items;
}
