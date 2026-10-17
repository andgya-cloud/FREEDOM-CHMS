import { describe, expect, it } from 'vitest';
import { formatPhone, normalizePhone, phoneDigits } from './phone';

describe('normalizePhone', () => {
  it('recognises the common Kenyan ways of writing a number', () => {
    for (const input of ['0712345678', '0712 345 678', '712345678', '254712345678', '+254 712 345 678', '+254-712-345-678', '00254712345678']) {
      expect(normalizePhone(input)).toBe('+254712345678');
    }
  });
  it('accepts the newer 01xx numbers', () => {
    expect(normalizePhone('0110 123 456')).toBe('+254110123456');
  });
  it('keeps foreign numbers given with +', () => {
    expect(normalizePhone('+44 7700 900123')).toBe('+447700900123');
  });
  it('rejects things that are not phone numbers', () => {
    for (const input of ['', '12345', 'hello', '07123', '+2547123', null, undefined]) {
      expect(normalizePhone(input as string)).toBeNull();
    }
  });
});

describe('formatPhone', () => {
  it('shows Kenyan numbers the local way', () => {
    expect(formatPhone('+254712345678')).toBe('0712 345 678');
    expect(formatPhone('+447700900123')).toBe('+447700900123');
    expect(phoneDigits('+254712345678')).toBe('254712345678');
  });
});
