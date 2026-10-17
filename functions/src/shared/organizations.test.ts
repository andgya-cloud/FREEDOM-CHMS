import { describe, expect, it } from 'vitest';
import { organizationProblems, suggestReceiptPrefix } from './organizations';

describe('organizations', () => {
  it('suggests a receipt prefix from the name', () => {
    expect(suggestReceiptPrefix('Freedom Church Nairobi')).toBe('FCN');
    expect(suggestReceiptPrefix('Freedom Church of Mombasa')).toBe('FCM');
  });

  it('validates a new campus form', () => {
    expect(organizationProblems({ name: 'Freedom Church Mombasa', type: 'church_campus', timeZone: 'Africa/Nairobi', currency: 'KES', receiptPrefix: 'FCM' })).toEqual([]);
    expect(organizationProblems({ name: '', type: 'church_campus', timeZone: 'Africa/Nairobi', currency: 'KES', receiptPrefix: 'fc1' })).toHaveLength(2);
  });
});
