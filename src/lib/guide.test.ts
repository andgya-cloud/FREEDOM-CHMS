import { describe, expect, it } from 'vitest';
import { canOpen, confident, findTopics, GUIDE, isWhereAmI, topicPath, topicSteps, type Access } from './guide';
import { roleRedirect } from './roleAccess';
import { parseGuide, checkGuideLimits, GUIDE_DAILY_PER_USER, GUIDE_MONTHLY_CAP } from '../../functions/src/shared/aiWrite';

const everyone: Access = { can: () => true, keeper: true, roleBlocks: () => false };
const usher: Access = { can: (p) => ['people.read', 'people.write', 'attendance.write'].includes(p), keeper: false, roleBlocks: () => false };
const best = (q: string, k: Parameters<typeof findTopics>[1] = 'church_campus') => findTopics(q, k)[0]?.topic.id;

describe('Just ask Andy guide', () => {
  it('places everyday questions without the AI', () => {
    for (const [q, id, k] of [
      ['How do I add a visitor?', 'visitor', 'church_campus'],
      ['record a tithe', 'giving-record', 'church_campus'],
      ['where do I approve requisitions', 'petty-sign', 'church_campus'],
      ['I want to mark the class register', 'register', 'college'],
      ['enter exam marks', 'exams', 'college'],
      ['register a new child', 'child-new', 'ministry'],
      ['how do I sign out', 'signout', 'ministry'],
      ['payslips', 'payroll', 'college'],
    ] as const) {
      const m = findTopics(q, k);
      expect(m[0]?.topic.id, q).toBe(id);
      expect(confident(m), q).toBe(true);
    }
  });
  it('keeps each organisation to its own pages', () => {
    expect(findTopics('payroll', 'church_campus').some((m) => m.topic.id === 'payroll')).toBe(false);
    expect(best('children register', 'ministry')).toBe('hope-register');
  });
  it('sends vague questions on to the AI', () => {
    expect(confident(findTopics('the thing is not working', 'church_campus'))).toBe(false);
  });
  it('knows "where am I"', () => {
    expect(isWhereAmI('Where am I?')).toBe(true);
    expect(isWhereAmI('add a visitor')).toBe(false);
  });
  it('uses each organisation’s petty cash address', () => {
    const t = GUIDE.find((x) => x.id === 'petty-new')!;
    expect(topicPath(t, 'college')).toBe('/school/petty-cash/new');
    expect(topicPath(t, 'church_campus')).toBe('/petty-cash/new');
    expect(topicSteps(t, 'college').length).toBeGreaterThan(0);
  });
  it('tells a role what it cannot open', () => {
    const giving = GUIDE.find((x) => x.id === 'giving-record')!;
    const staff = GUIDE.find((x) => x.id === 'staff-accounts')!;
    expect(canOpen(giving, 'church_campus', usher)).toBe(false);
    expect(canOpen(GUIDE.find((x) => x.id === 'visitor')!, 'church_campus', usher)).toBe(true);
    expect(canOpen(staff, 'church_campus', usher)).toBe(false);
    expect(canOpen(staff, 'church_campus', everyone)).toBe(true);
  });
  it('follows the menu rules for trainers and helpers', () => {
    expect(roleRedirect({ roleId: 'trainer' }, '/school/students')).toBe('/school/exams');
    expect(roleRedirect({ roleId: 'trainer' }, '/school/exams')).toBeNull();
    expect(roleRedirect({ roleId: 'helper' }, '/hope/children')).toBe('/');
    expect(roleRedirect({ roleId: 'pastor' }, '/giving')).toBeNull();
  });
  it('every topic has a page and steps', () => {
    const ids = new Set<string>();
    for (const t of GUIDE) {
      expect(ids.has(t.id), t.id).toBe(false);
      ids.add(t.id);
      for (const k of t.orgs) expect(topicSteps(t, k).length, t.id).toBeGreaterThan(0);
    }
  });
});

describe('guide answers from the AI', () => {
  it('keeps only a topic we sent', () => {
    expect(parseGuide('{"answer":"Open Giving.","topic":"giving-record"}', ['giving-record'])).toEqual({ answer: 'Open Giving.', topic: 'giving-record' });
    expect(parseGuide('{"answer":"Open it.","topic":"made-up"}', ['giving-record']).topic).toBe('');
    expect(parseGuide('Just open Giving.', []).answer).toBe('Just open Giving.');
  });
  it('has its own limits', () => {
    expect(checkGuideLimits(GUIDE_MONTHLY_CAP, 0).ok).toBe(false);
    expect(checkGuideLimits(0, GUIDE_DAILY_PER_USER).ok).toBe(false);
    expect(checkGuideLimits(10, 3).ok).toBe(true);
  });
});

describe('Reviewer role (Andy, 2026-11-11)', () => {
  it('never carries pastoral notes, accounts, audit or the full download', async () => {
    const { DEFAULT_ROLES, isReviewer } = await import('../../functions/src/shared/permissions');
    const p = DEFAULT_ROLES.reviewer.permissions;
    for (const no of ['pastoral.read', 'users.manage', 'team.manage', 'audit.read', 'data.export']) expect(p).not.toContain(no);
    expect(p).toContain('people.read');
    expect(isReviewer({ roleId: 'reviewer' })).toBe(true);
    expect(isReviewer({ roleId: 'staff' })).toBe(false);
  });
});
