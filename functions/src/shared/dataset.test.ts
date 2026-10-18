import { describe, expect, it } from 'vitest';
import { anonymisedGift, backupsToRemove, ERASED_NAME, ORG_COLLECTIONS, PERSON_COLLECTIONS, retentionDays, toPlain } from './dataset.js';

describe('retention', () => {
  it('defaults to 30 days and stays between 7 and 365', () => {
    expect(retentionDays(undefined)).toBe(30);
    expect(retentionDays('x')).toBe(30);
    expect(retentionDays(1)).toBe(7);
    expect(retentionDays(9999)).toBe(365);
    expect(retentionDays(90.4)).toBe(90);
  });
});

describe('backups kept', () => {
  it('removes only the oldest beyond 12 and ignores other files', () => {
    const names = Array.from({ length: 14 }, (_, i) => `backups/freedom-chms-2026-0${i < 9 ? '1' : '2'}-${String((i % 9) + 10)}.json.gz`);
    const out = backupsToRemove([...names, 'backups/notes.txt']);
    expect(out).toHaveLength(2);
    expect(out).toEqual([...names].sort().slice(0, 2));
  });
  it('removes nothing when there are few', () => expect(backupsToRemove(['backups/freedom-chms-2026-01-04.json.gz'])).toEqual([]));
});

describe('erase', () => {
  it('money records stop naming the person', () => {
    expect(anonymisedGift()).toMatchObject({ personId: null, giverName: ERASED_NAME, phone: null });
  });
  it('person data collections are all backed up too', () => {
    for (const c of PERSON_COLLECTIONS) expect(ORG_COLLECTIONS).toContain(c);
  });
});

describe('toPlain', () => {
  it('turns timestamps into text, also inside maps and lists', () => {
    const ts = { toDate: () => new Date('2026-10-18T00:00:00Z') };
    expect(toPlain({ a: ts, b: [ts], c: 3 })).toEqual({ a: '2026-10-18T00:00:00.000Z', b: ['2026-10-18T00:00:00.000Z'], c: 3 });
  });
});
