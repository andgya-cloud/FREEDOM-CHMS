import { describe, expect, it } from 'vitest';
import { trainingDocs } from './training.js';

const docs = trainingDocs('2026-10-21', (w) => w);

describe('training data', () => {
  it('lives only under the practice organization', () => {
    expect(docs.every((d) => d.path.startsWith('organizations/training/'))).toBe(true);
    expect(docs.every((d) => d.data.orgId === 'training')).toBe(true);
  });
  it('uses made-up people with reserved phone numbers', () => {
    const people = docs.filter((d) => d.path.includes('/people/'));
    expect(people).toHaveLength(12);
    expect(people.every((p) => String(p.data.fullName).endsWith('Sample') && String(p.data.phone).startsWith('+254700000'))).toBe(true);
  });
  it('has four Sunday services on Sundays, and check-ins that point at them', () => {
    const events = docs.filter((d) => d.path.includes('/events/'));
    expect(events).toHaveLength(4);
    expect(events.every((e) => new Date(`${e.data.date}T00:00:00Z`).getUTCDay() === 0)).toBe(true);
    const ids = new Set(events.map((e) => e.path.split('/').pop()));
    expect(docs.filter((d) => d.path.includes('/attendance/')).every((a) => ids.has(String(a.data.eventId)))).toBe(true);
  });
  it('keeps document ids unique', () => expect(new Set(docs.map((d) => d.path)).size).toBe(docs.length));
});
