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

describe('v197 conversations, the Photos and wins way', () => {
  it('numbers conversations FHC-C-YYYY-NNN', async () => {
    const { chatRef } = await import('./hopeChats.js');
    expect(chatRef(2026, 7)).toBe('FHC-C-2026-007');
  });
  it('calls Closed "Resolved" and adds Sent to the board', async () => {
    const { CHAT_STATUS_LABELS, CHAT_STATUSES, isActiveChat } = await import('./hopeChats.js');
    expect(CHAT_STATUSES).toEqual(['open', 'handling', 'closed', 'sent']);
    expect(CHAT_STATUS_LABELS.closed).toBe('Resolved');
    expect(isActiveChat('handling')).toBe(true);
    expect(isActiveChat('sent')).toBe(false);
  });
  it('lets people edit only their own words, never system lines', async () => {
    const { canEditChatMessage } = await import('./hopeChats.js');
    expect(canEditChatMessage('u1', { byUid: 'u1' })).toBe(true);
    expect(canEditChatMessage('u2', { byUid: 'u1' })).toBe(false);
    expect(canEditChatMessage('u1', { byUid: 'u1', system: true })).toBe(false);
  });
  it('reminds once, a day after it started, when nobody has replied', async () => {
    const { needsReplyReminder } = await import('./hopeChats.js');
    const start = '2026-11-06T08:00:00.000Z';
    const t = Date.parse(start);
    expect(needsReplyReminder({ status: 'open', startedAt: start }, t + 23 * 3_600_000)).toBe(false);
    expect(needsReplyReminder({ status: 'open', startedAt: start }, t + 24 * 3_600_000)).toBe(true);
    expect(needsReplyReminder({ status: 'open', startedAt: start, repliedAt: start }, t + 30 * 3_600_000)).toBe(false);
    expect(needsReplyReminder({ status: 'open', startedAt: start, reminderSentAt: start }, t + 30 * 3_600_000)).toBe(false);
    expect(needsReplyReminder({ status: 'closed', startedAt: start }, t + 30 * 3_600_000)).toBe(false);
    expect(needsReplyReminder({ status: 'open' }, t + 30 * 3_600_000)).toBe(false);
  });
  it('lists edits and files taken out in the record of changes', async () => {
    const { chatChanges } = await import('./hopeChats.js');
    const file = { key: 'k', name: 'photo.jpg', contentType: 'image/jpeg', size: 1, photo: true };
    const out = chatChanges({ removed: [{ messageId: 'm', file, removedByName: 'Andrew Guya', removedAt: '2026-11-06T10:00:00.000Z' }] },
      [{ text: 'b', byUid: 'u', byName: 'Diana Kiunga', byRole: 'Director', at: '2026-11-06T08:00:00.000Z', files: [], editedAt: '2026-11-06T09:00:00.000Z', history: [{ text: 'a', at: '' }] }]);
    expect(out.map((x) => x.text)).toEqual([
      'Diana Kiunga edited a message sent 2026-11-06 08:00 (1 earlier version kept).',
      'Andrew Guya took out the file "photo.jpg".',
    ]);
  });
});
