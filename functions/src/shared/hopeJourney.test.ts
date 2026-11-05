import { describe, expect, it } from 'vitest';
import { childJourney } from './hopeJourney';

const child = { id: 'k1', enrolledOn: '2024-01-06', dateOfBirth: '2019-03-10' } as never;
const day = (date: string, s = 'present') => ({ date, marks: { k1: { s } } }) as never;

describe('childJourney', () => {
  it('lists joined, first day, stone moves and wins in order', () => {
    const steps = childJourney(child, {
      today: '2026-11-05', days: [day('2024-01-13'), day('2024-01-20', 'absent')],
      wins: [{ id: 'w', clubId: 'c', date: '2025-06-01', kind: 'award', title: 'Chess cup', note: '', childIds: ['k1'] }],
      clubName: () => 'Chess',
    });
    expect(steps.map((s) => s.text)).toEqual(['Joined the Hope Centre', 'First day at Hope', 'Moved up to Rubies', 'Chess cup (Chess)']);
  });
  it('adds home visits only when given', () => {
    expect(childJourney(child, { today: '2026-11-05', days: [], wins: [], visits: [{ day: '2025-02-02', kind: 'visit' }, { day: '2025-02-03', kind: 'health' }] })
      .filter((s) => s.private).length).toBe(1);
  });
});
