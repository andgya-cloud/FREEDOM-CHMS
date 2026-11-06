import { describe, expect, it } from 'vitest';
import { canCloseChat, canRaiseWorry, canUseChats, chatColour, chatRole, chatSignature, isUnread, urgentEmail } from './hopeChats';

const HOPE = 'hope';
const user = (o: Record<string, unknown>) => ({ active: true, orgIds: [HOPE], permissions: [] as string[], ...o });
const director = user({ roleId: 'head', displayName: 'Diana Kiunga', permissions: ['people.read', 'team.manage'] });
const helper = user({ roleId: 'helper', displayName: 'Mary Wanjiku', permissions: ['people.read', 'attendance.write'] });
const andy = { active: true, allOrgs: true, roleId: 'pastor', displayName: 'Andrew Guya', permissions: ['users.manage'] };
const board = user({ roleId: 'signatory', displayName: 'Elias Omondi', permissions: ['pettycash.request'] });

describe('Hope conversations (Andy, 2026-11-04)', () => {
  it('only the Director, the board, Andy and Doreen read and start them; staff raise a worry', () => {
    for (const p of [director, andy, board]) expect(canUseChats(p, HOPE)).toBe(true);
    expect(canUseChats(helper, HOPE)).toBe(false);
    expect(canRaiseWorry(helper, HOPE)).toBe(true);
    expect(canCloseChat(board, HOPE)).toBe(false);
    expect(canCloseChat(director, HOPE)).toBe(true);
  });
  it('signs each message with name, role and time, in that person\'s own colour', () => {
    expect(chatRole(andy, HOPE)).toBe('Pastor');
    expect(chatRole(director, HOPE)).toBe('Director');
    expect(chatRole(board, HOPE)).toBe('Board member');
    expect(chatRole(helper, HOPE)).toBe('Helper');
    expect(chatSignature({ byName: 'Diana Kiunga', byRole: 'Director', at: '2026-11-04T06:15:00Z' })).toBe('Diana Kiunga · Director · 4 Nov 2026, 09:15');
    expect(chatColour('abc')).toEqual(chatColour('abc'));
  });
  it('counts unread until the person opens it after the last message', () => {
    expect(isUnread({ lastAt: '2026-11-04T10:00:00Z', seen: {}, lastByName: 'x' }, 'u')).toBe(true);
    expect(isUnread({ lastAt: '2026-11-04T10:00:00Z', seen: { u: '2026-11-04T10:00:00Z' }, lastByName: 'x' }, 'u')).toBe(false);
  });
  it('the URGENT email names only the first name and code, never what was written', () => {
    const e = urgentEmail({ childName: 'Amani Wanjiru', childCode: 'HC-0012', startedByName: 'Diana Kiunga' }, 'Ronald', 'https://x');
    expect(e.subject).toBe('URGENT: your response is needed about Amani (HC-0012)');
    expect(e.text).not.toContain('Wanjiru');
  });
});
