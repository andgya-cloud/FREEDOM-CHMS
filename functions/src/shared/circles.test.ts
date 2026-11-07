import { describe, expect, it } from 'vitest';
import { circleApprover, circleKeeper, circleReader, circleRef, circleRole, circleSender, isKindOf, kindLabel } from './circles';
import { canSeeAllPhotoReports, storyRef } from './hopePhotos';
import { chatRef } from './hopeChats';

const org = 'adia';
const p = (o: Record<string, unknown>) => ({ active: true, orgIds: [org], permissions: [], roleId: 'staff', displayName: 'Someone', ...o }) as never;

describe('conversation circles (Andy, 2026-11-07)', () => {
  it('ADIA readers: Head, Principal, board, Andy and Doreen; a trainer only sends', () => {
    expect(circleReader(p({ roleId: 'head' }), org, 'college')).toBe(true);
    expect(circleReader(p({ roleId: 'principal' }), org, 'college')).toBe(true);
    expect(circleReader(p({ displayName: 'Elizabeth Mutuku' }), org, 'college')).toBe(true);
    expect(circleReader(p({ displayName: 'Ronald Awili' }), org, 'college')).toBe(true);
    const trainer = p({ roleId: 'trainer', permissions: ['exams.mark'] });
    expect(circleReader(trainer, org, 'college')).toBe(false);
    expect(circleSender(trainer, org, 'college')).toBe(true);
    expect(circleReader(p({ displayName: 'Ronald Awili', orgIds: ['other'] }), org, 'college')).toBe(false);
  });
  it('church readers: Andy, Doreen and the leaders; an usher only sends', () => {
    expect(circleReader(p({ displayName: 'Doreen Mayaka' }), org, 'church_campus')).toBe(true);
    expect(circleReader(p({ roleId: 'head' }), org, 'church_campus')).toBe(true);
    const usher = p({ roleId: 'usher', permissions: ['people.read'] });
    expect(circleReader(usher, org, 'church_campus')).toBe(false);
    expect(circleSender(usher, org, 'church_campus')).toBe(true);
    expect(circleReader(p({ displayName: 'Elias Omondi' }), org, 'church_campus')).toBe(false);
  });
  it('the sign-off (10A)', () => {
    expect(circleApprover(p({ roleId: 'principal' }), org, 'director', 'college')).toBe(true);
    expect(circleApprover(p({ roleId: 'head' }), org, 'director', 'college')).toBe(false);
    expect(circleApprover(p({ roleId: 'head' }), org, 'board', 'college')).toBe(true);
    expect(circleApprover(p({ displayName: 'Andrew Guya' }), org, 'director', 'church_campus')).toBe(true);
    expect(circleApprover(p({ displayName: 'Doreen Guya' }), org, 'board', 'church_campus')).toBe(true);
    expect(circleApprover(p({ roleId: 'usher' }), org, 'board', 'church_campus')).toBe(false);
  });
  it('keepers, roles, kinds and numbers', () => {
    expect(circleKeeper(p({ roleId: 'principal' }), org, 'college')).toBe(true);
    expect(circleKeeper(p({ displayName: 'Elias Omondi' }), org, 'college')).toBe(false);
    expect(circleRole(p({ roleId: 'trainer' }), org, 'college')).toBe('Trainer');
    expect(circleRole(p({ roleId: 'head' }), org, 'church_campus')).toBe('Church leader');
    expect(isKindOf('exams', 'college')).toBe(true);
    expect(isKindOf('exams', 'church_campus')).toBe(false);
    expect(kindLabel('win', 'church_campus')).toBe('Testimony');
    expect(circleRef('college', 2026, 3)).toBe('ADIA-2026-003');
    expect(storyRef(2026, 1, 'church_campus')).toBe('FCN-2026-001');
    expect(chatRef(2026, 7, 'college')).toBe('ADIA-C-2026-007');
    expect(chatRef(2026, 7)).toBe('FHC-C-2026-007');
  });
  it('Hope is unchanged', () => {
    expect(canSeeAllPhotoReports(p({ displayName: 'Dorothy Mohat' }), org)).toBe(true);
    expect(canSeeAllPhotoReports(p({ displayName: 'Dorothy Mohat' }), org, 'college')).toBe(false);
  });
});
