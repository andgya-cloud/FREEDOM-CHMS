import { describe, expect, it } from 'vitest';
import {
  defaultServices, hostMessage, nextFree, plannedDates, reminderFor, suggestFill, waNumber, type RotaSlot, type ServiceHost,
} from './serviceHosts.js';

const host = (id: string, extra: Partial<ServiceHost> = {}): ServiceHost => ({ id, name: id, phone: '', email: '', personId: null, active: true, away: [], joinedOn: '2026-11-01', ...extra });
const slot = (date: string, hostId: string | null, extra: Partial<RotaSlot> = {}): RotaSlot => ({
  id: `${date}_sun1000`, date, serviceKey: 'sun1000', serviceName: 'Sunday service', time: '10:00', hostId, hostName: hostId ?? '', status: 'set', answer: 'pending', reason: '', answeredOn: null, ...extra,
});
const sundays = { services: defaultServices(['Sunday 10:00']), specials: [] };

describe('service hosts', () => {
  it('reads the service times', () => {
    expect(defaultServices(['Sunday 10:00', 'Wednesday 8:00pm'])).toEqual([
      { key: 'sun1000', name: 'Sunday service', weekday: 0, time: '10:00' },
      { key: 'wed2000', name: 'Wednesday service', weekday: 3, time: '20:00' },
    ]);
    expect(defaultServices([])).toHaveLength(1);
    expect(defaultServices(['Sunday 10:00'], 'prayer')).toEqual([{ key: 'sun0900', name: 'Sunday prayer', weekday: 0, time: '09:00' }]);
  });

  it('lists every Sunday for 13 weeks plus specials', () => {
    const d = plannedDates({ ...sundays, specials: [{ key: 'x1', name: 'Conference night', date: '2026-11-27', time: '18:00' }] }, '2026-11-17');
    expect(d.filter((x) => x.serviceKey === 'sun1000')).toHaveLength(13);
    expect(d[0]!.date).toBe('2026-11-22');
    expect(d.some((x) => x.serviceName === 'Conference night')).toBe(true);
  });

  it('suggests fair turns, nobody twice in a row, skipping away dates', () => {
    const dates = plannedDates(sundays, '2026-11-17', 6);
    const hosts = [host('Ann'), host('Ben', { away: [{ from: '2026-11-22', to: '2026-11-29' }] }), host('Cy')];
    const fill = suggestFill(dates, hosts, []);
    const order = dates.map((d) => fill.get(d.id));
    expect(order.slice(0, 2)).not.toContain('Ben');
    for (let i = 1; i < order.length; i++) expect(order[i]).not.toBe(order[i - 1]);
    const counts = new Map<string, number>();
    order.forEach((h) => counts.set(h!, (counts.get(h!) ?? 0) + 1));
    expect(Math.max(...counts.values()) - Math.min(...counts.values())).toBeLessThanOrEqual(1);
  });

  it('keeps dates that already have a host', () => {
    const dates = plannedDates(sundays, '2026-11-17', 2);
    const fill = suggestFill(dates, [host('Ann'), host('Ben')], [slot('2026-11-22', 'Ann')]);
    expect(fill.has('2026-11-22_sun1000')).toBe(false);
    expect(fill.get('2026-11-29_sun1000')).toBe('Ben');
  });

  it('suggests the next free host after a no', () => {
    const slots = [slot('2026-11-22', 'Ann', { answer: 'no' }), slot('2026-11-29', 'Ben')];
    expect(nextFree('2026-11-22', [host('Ann'), host('Ben'), host('Cy')], slots, ['Ann'])?.id).toBe('Cy');
  });

  it('reminds 7, 3, 2 and 1 days before; asks until yes; stops after no', () => {
    const s = slot('2026-11-29', 'Ann');
    expect(reminderFor(s, '2026-11-22', [])).toEqual({ days: 7, kind: 'ask' });
    expect(reminderFor(s, '2026-11-23', [7])).toBeNull();
    expect(reminderFor({ ...s, answer: 'yes' }, '2026-11-26', [7])).toEqual({ days: 3, kind: 'routine' });
    expect(reminderFor(s, '2026-11-27', [7, 3])).toEqual({ days: 2, kind: 'ask' });
    expect(reminderFor({ ...s, answer: 'no' }, '2026-11-28', [7])).toBeNull();
    // Set late: asked on the first evening.
    expect(reminderFor(s, '2026-11-24', [])).toEqual({ days: 5, kind: 'ask' });
    expect(reminderFor({ ...s, status: 'suggested' }, '2026-11-22', [])).toBeNull();
  });

  it('writes WhatsApp numbers and messages', () => {
    expect(waNumber('0712 345 678')).toBe('254712345678');
    expect(waNumber('+254 712345678')).toBe('254712345678');
    const m = hostMessage({ church: 'Freedom Church', hostName: 'Mary Atieno', serviceName: 'Sunday service', date: '2026-11-29', time: '10:00', days: 7, kind: 'ask', link: 'L', doc: 'attached' });
    expect(m.text).toContain('Hello Mary');
    expect(m.text).toContain('Sun 29 Nov at 10:00 AM');
    expect(m.text).toContain('Service Host');
    const p = hostMessage({ church: 'Freedom Church', hostName: 'Mary', serviceName: 'Sunday prayer', date: '2026-11-29', time: '09:00', days: 3, kind: 'routine', link: 'L', doc: null, team: 'prayer' });
    expect(p.text).toContain('Prayer Leader for the Sunday prayer');
  });
});
