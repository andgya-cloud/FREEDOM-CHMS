import { describe, expect, it } from 'vitest';
import { allFinished, counterInvite, counterServices, countLines, waPhone } from './counters.js';

describe('phone counters', () => {
  it('offers the usual Sunday service when nothing has started', () => {
    expect(counterServices({ today: '2026-11-29', isSunday: true, started: [], calendar: [], lastSunday: 'Main service 10:00' })).toEqual(['Main service 10:00']);
    expect(counterServices({ today: '2026-11-29', isSunday: true, started: [], calendar: [], lastSunday: null })).toEqual(['Sunday service']);
  });

  it('puts started services first and shows each record once', () => {
    const list = counterServices({
      today: '2026-11-29', isSunday: true, started: ['Main service 10:00'],
      calendar: [{ title: 'Youth service', start: '14:00' }, { title: 'Main service', start: '10:00' }], lastSunday: 'Main service 10:00',
    });
    expect(list).toEqual(['Main service 10:00', 'Youth service 14:00']);
  });

  it('on a weekday shows only calendar services and started ones', () => {
    expect(counterServices({ today: '2026-12-02', isSunday: false, started: [], calendar: [], lastSunday: 'Main service' })).toEqual([]);
    expect(counterServices({ today: '2026-12-24', isSunday: false, started: [], calendar: [{ title: 'Christmas Eve service', start: null }], lastSunday: null }))
      .toEqual(['Christmas Eve service']);
  });

  it('knows when every counter has finished', () => {
    const jobs = [
      { job: 'teens' as const, person: 'Grace', active: true },
      { job: 'children' as const, person: 'Tom', active: true },
      { job: 'adults' as const, person: '', active: true },
      { job: 'salvations' as const, person: 'Ann', active: false },
    ];
    expect(allFinished(jobs, { teens: { person: 'Grace', done: true } })).toBe(false);
    expect(allFinished(jobs, { teens: { person: 'Grace', done: true }, children: { person: 'Tom', done: true } })).toBe(true);
    expect(allFinished([], {})).toBe(false);
  });

  it('writes the email lines and the invite', () => {
    expect(countLines({ teens: 34 }, { teens: { person: 'Grace', done: true } })[1]).toBe('Teens: 34 (Grace)');
    expect(counterInvite('teens', 'Grace Wanjiku', 'https://x/count/a/b', 'Freedom Church')).toContain('Hello Grace, thank you for counting Teens');
    expect(waPhone('0712 345 678')).toBe('254712345678');
    expect(waPhone('+254 712 345 678')).toBe('254712345678');
    expect(waPhone('12')).toBe('');
  });
});
