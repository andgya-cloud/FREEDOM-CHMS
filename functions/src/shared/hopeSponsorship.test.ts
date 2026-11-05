import { describe, expect, it } from 'vitest';
import { planSponsorUpdate } from './hopeSponsorship';

const head = [[null, 'KE-014 Freedom Shujaa Hope Center'], ['Code', 'Child ID', 'Child Name', null, 'Gender', 'Date of Birth', 'Registration Date', 'Prog Completion Date', 'Sponsorship Status', 'Sponsor ID', 'Sponsor Name']];
const kids = [
  { id: 'a', code: 'HC-0001', sponsorChildId: '', dateOfBirth: null, enrolledOn: null, sponsorName: '', gender: '', name: 'Abdi Kibugi' },
  { id: 'b', code: 'HC-0002', sponsorChildId: 'C2', dateOfBirth: '2019-07-26', enrolledOn: '2024-01-01', sponsorName: 'Sadie', gender: 'Male', name: 'Abel Zawadi' },
  { id: 'c', code: 'HC-0003', sponsorChildId: '', dateOfBirth: null, enrolledOn: null, sponsorName: '', gender: '', name: 'Not on list' },
];
describe('planSponsorUpdate', () => {
  const rows = [...head,
    ['HC-0001', 'C1', 'Abdi R. Kibugi', null, 'Male', new Date('2018-06-12'), new Date('2023-10-09T16:23:46Z'), new Date('2034-11-30'), 'Sponsored', '691874', 'Josh and Nichele'],
    [null, 'C2', 'Abel Z. N.', null, 'Female', new Date('2019-07-26'), new Date('2023-10-09'), new Date('2035-11-30'), 'Unsponsored', null, null],
    [null, 'C9', 'Someone else', null, 'Male', null, null, null, 'Sponsored', '1', 'X']];
  const p = planSponsorUpdate(rows, kids, '2026-11-05')!;
  it('reads the centre and matches by code, then by the kept Child ID', () => {
    expect(p.centre).toBe('KE-014 Freedom Shujaa Hope Center');
    expect(p.rows.map((r) => r.childId)).toEqual(['a', 'b']);
    expect(p.notFound.map((r) => r.partnerId)).toEqual(['C9']);
    expect(p.notOnList.map((r) => r.code)).toEqual(['HC-0003']);
  });
  it('fills only empty fields and notes differences', () => {
    expect(p.rows[0]!.fill).toEqual({ dateOfBirth: '2018-06-12', enrolledOn: '2023-10-09', sponsorName: 'Josh and Nichele', gender: 'Male' });
    expect(p.rows[0]!.sponsorship).toMatchObject({ childId: 'C1', status: 'Sponsored', sponsorId: '691874', completesOn: '2034-11-30' });
    expect(p.rows[1]!.fill).toEqual({});
    expect(p.rows[1]!.differs).toEqual(['Male here, Female on the list']);
  });
  it('needs a Child ID column', () => { expect(planSponsorUpdate([['Name'], ['x']], kids, '2026-11-05')).toBeNull(); });
});
