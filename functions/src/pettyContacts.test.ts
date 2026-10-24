import { describe, expect, it } from 'vitest';
import { withContacts } from './pettyContacts';

describe('withContacts', () => {
  it('uses the built-in ADIA emails and adds stakeholders without accounts', () => {
    const out = withContacts('college', [
      { uid: 'u1', name: 'Doreen Mayaka', email: 'old@example.com', phone: '' },
      { uid: 'u2', name: 'Someone Else', email: 'else@example.com', phone: '' },
    ]);
    expect(out.find((p) => p.uid === 'u1')).toMatchObject({ email: 'dorreen.guya@gmail.com', phone: '+254723560852' });
    expect(out.find((p) => p.uid === 'u2')?.email).toBe('else@example.com');
    expect(out.map((p) => p.name)).toContain('Ronald Awili');
    expect(out.filter((p) => p.name === 'Doreen Mayaka')).toHaveLength(1);
    expect(out).toHaveLength(7);
  });
  it('matches names ignoring apostrophes and case', () => {
    const out = withContacts('college', [{ uid: 'd', name: 'daniel ojwang', email: '', phone: '' }]);
    expect(out.find((p) => p.uid === 'd')?.email).toBe('danalfre9@gmail.com');
  });
  it('leaves Hope and the church as they are', () => {
    const people = [{ uid: 'u', name: 'Doreen Mayaka', email: 'x@example.com', phone: '' }];
    expect(withContacts('ministry', people)).toEqual(people);
  });
});
