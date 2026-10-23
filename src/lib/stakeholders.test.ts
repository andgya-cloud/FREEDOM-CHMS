import { describe, expect, it } from 'vitest';
import { ADIA_STAKEHOLDERS, matchStakeholders, resolveStakeholderEmail } from './stakeholders';

describe('stakeholder emails', () => {
  it('lists everyone when nothing is typed', () => {
    expect(matchStakeholders(ADIA_STAKEHOLDERS, '')).toHaveLength(6);
  });
  it('matches the first letters of a name', () => {
    expect(matchStakeholders(ADIA_STAKEHOLDERS, 'dan').map((p) => p.email)).toEqual(['danalfre9@gmail.com']);
  });
  it('turns a typed full name into the email, whatever the case or apostrophe', () => {
    expect(resolveStakeholderEmail(ADIA_STAKEHOLDERS, "daniel Ojwang'")).toBe('danalfre9@gmail.com');
    expect(resolveStakeholderEmail(ADIA_STAKEHOLDERS, 'daniel  ojwang’')).toBe('danalfre9@gmail.com');
    expect(resolveStakeholderEmail(ADIA_STAKEHOLDERS, 'Ronald')).toBe('ronaldawili@gmail.com');
  });
  it('keeps a typed email and refuses an unclear name', () => {
    expect(resolveStakeholderEmail(ADIA_STAKEHOLDERS, 'Someone@Example.org ')).toBe('someone@example.org');
    expect(resolveStakeholderEmail(ADIA_STAKEHOLDERS, 'el')).toBeUndefined();
  });
});
