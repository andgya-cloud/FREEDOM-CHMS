import { describe, expect, it } from 'vitest';
import { NOT_ON_LIST, notOnList, notOnListSponsorship, planSponsorUpdate } from './hopeSponsorship';

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
    expect(p.rows.map((r) => [r.childId, r.how])).toEqual([['a', 'code'], ['b', 'id']]);
    expect(p.notFound.map((r) => r.partnerId)).toEqual(['C9']);
    expect(p.notOnList.map((r) => r.code)).toEqual(['HC-0003']);
  });
  it('takes the list as right and says what changes (2A, 4A)', () => {
    expect(p.rows[0]!.fill).toEqual({ dateOfBirth: '2018-06-12', enrolledOn: '2023-10-09', sponsorName: 'Josh and Nichele', gender: 'Male' });
    expect(p.rows[0]!.differs).toEqual([]);
    expect(p.rows[0]!.sponsorship).toMatchObject({ childId: 'C1', status: 'Sponsored', sponsorId: '691874', completesOn: '2034-11-30', listName: 'Abdi R. Kibugi' });
    expect(p.rows[1]!.fill).toEqual({ enrolledOn: '2023-10-09', gender: 'Female' });
    expect(p.rows[1]!.differs).toEqual(['registration date 2024-01-01 → 2023-10-09', 'Male → Female']);
  });
  it('needs a Child ID column', () => { expect(planSponsorUpdate([['Name'], ['x']], kids, '2026-11-05')).toBeNull(); });
});

describe('matching without HC codes (1A)', () => {
  const people = [
    { id: 'm', code: 'HC-0010', sponsorChildId: '', dateOfBirth: '2016-02-03', enrolledOn: null, sponsorName: '', gender: '', name: 'Mercy Achieng Otieno' },
    { id: 'j1', code: 'HC-0011', sponsorChildId: '', dateOfBirth: '2015-05-05', enrolledOn: null, sponsorName: '', gender: '', name: 'John Kamau' },
    { id: 'j2', code: 'HC-0012', sponsorChildId: '', dateOfBirth: '2017-07-07', enrolledOn: null, sponsorName: '', gender: '', name: 'John Kamau' },
  ];
  const rows = [...head,
    [null, 'C10', 'Otieno Mercy Akeyo', null, 'Female', new Date('2016-02-03'), null, null, 'Sponsored', '5', 'Ann'],
    [null, 'C11', 'John Kamau', null, 'Male', new Date('2014-01-01'), null, null, 'Sponsored', '6', 'Bob']];
  it('matches a name in any order with the same birth date, and lists a doubtful one to pick', () => {
    const p = planSponsorUpdate(rows, people, '2026-11-05')!;
    expect(p.rows.map((r) => [r.childId, r.how])).toEqual([['m', 'name']]);
    expect(p.unsure.map((u) => [u.partnerId, u.candidates.map((c) => c.id).sort()])).toEqual([['C11', ['j1', 'j2']]]);
    expect(p.notOnList).toEqual([]);
  });
  it('uses a pick, and "none of these" goes to not found', () => {
    const picked = planSponsorUpdate(rows, people, '2026-11-05', {}, { C11: 'j2' })!;
    expect(picked.rows.map((r) => [r.childId, r.how])).toEqual([['m', 'name'], ['j2', 'picked']]);
    expect(picked.notOnList.map((c) => c.id)).toEqual(['j1']);
    const none = planSponsorUpdate(rows, people, '2026-11-05', {}, { C11: '' })!;
    expect(none.notFound.map((r) => r.partnerId)).toEqual(['C11']);
    expect(none.unsure).toEqual([]);
  });
  it('marks children not on the list (5A)', () => {
    const s = notOnListSponsorship('KE-014', '2026-11-05');
    expect(s.status).toBe(NOT_ON_LIST);
    expect(notOnList(s)).toBe(true);
  });
});
