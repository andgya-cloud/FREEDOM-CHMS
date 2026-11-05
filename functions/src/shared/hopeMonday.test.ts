import { describe, expect, it } from 'vitest';
import { mondaySummary } from './hopeMonday';

const kid = (id: string) => ({ id, status: 'active', enrolledOn: '2026-01-01', guardianConsent: { given: true }, photoConsent: { given: true }, sponsorName: 'S' }) as never;
const sat = (date: string, s: string) => ({ date, marks: { a: { s }, b: { s: 'present' } } }) as never;

describe('mondaySummary', () => {
  it('shows attendance, meals and the children to call by first name', () => {
    const r = mondaySummary({
      today: '2026-11-09', children: [kid('a'), kid('b')], firstName: (id) => (id === 'a' ? 'Amani' : 'Baraka'),
      days: [sat('2026-10-17', 'absent'), sat('2026-10-24', 'absent'), sat('2026-10-31', 'absent'), sat('2026-11-07', 'absent')],
      meals: [{ date: '2026-11-07', breakfast: 40, lunch: 42, fruit: 30 }], champions: [], championDays: [], extras: [], approvedPay: [],
      openChats: 2, urgentChildIds: new Set(),
    });
    const text = r.lines.join('\n');
    expect(text).toContain('Children: 1 came (50%)');
    expect(text).toContain('40 breakfasts, 42 lunches, 30 fruit');
    expect(text).toContain('To call (missed the last 3 Saturdays): Amani.');
    expect(text).toContain('Open care conversations: 2.');
    expect(text).not.toContain('PAY');
    expect(r.subject).toContain('1 need us');
  });
});
