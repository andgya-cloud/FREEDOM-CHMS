import { describe, expect, it } from 'vitest';
import { eventIdFor, isOtherServiceName, serviceName, splitServiceName } from './attendance';

describe('typed service name and time (Andy, 2026-11-03)', () => {
  it('joins the name and time', () => {
    expect(serviceName(' Main  service ', '10:00')).toBe('Main service 10:00');
    expect(serviceName('Main service', '')).toBe('Main service');
    expect(serviceName('Youth service 16:30', '10:00')).toBe('Youth service 16:30');
    expect(serviceName('', '10:00')).toBe('');
    expect(serviceName('Sunday 10:00 service', '09:30')).toBe('Sunday 10:00 service');
    expect(eventIdFor('2026-11-08', serviceName('Main service', '10:00'))).toBe('2026-11-08_main_service_10_00');
  });
  it('splits it back and spots other services', () => {
    expect(splitServiceName('Main service 9:00')).toEqual({ service: 'Main service', time: '09:00' });
    expect(splitServiceName('Prayer night')).toEqual({ service: 'Prayer night', time: '' });
    expect(isOtherServiceName(['Midweek service'], 'midweek service 18:00')).toBe(true);
    expect(isOtherServiceName(['Midweek service'], 'Main service 10:00')).toBe(false);
  });
});
