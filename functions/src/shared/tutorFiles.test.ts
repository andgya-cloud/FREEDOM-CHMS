import { describe, expect, it } from 'vitest';
import { canSend, dueText, fileTypeOf, isForTutor, needsReminder, reopenUntilFor, urgency } from './tutorFiles';

describe('tutor files (Andy, 2026-11-04)', () => {
  it('turns redder over the last five days', () => {
    expect(urgency('2026-11-20', '2026-11-10')).toBe(0);
    expect(urgency('2026-11-20', '2026-11-15')).toBeGreaterThan(0);
    expect(urgency('2026-11-20', '2026-11-19')).toBeGreaterThan(urgency('2026-11-20', '2026-11-16'));
    expect(urgency('2026-11-20', '2026-11-20')).toBe(1);
    expect(urgency('2026-11-20', '2026-11-25')).toBe(1);
  });
  it('locks a sent file until it is sent back or reopened', () => {
    expect(canSend(undefined, '2026-11-10')).toBe(true);
    expect(canSend({ status: 'sent', reopenUntil: null }, '2026-11-10')).toBe(false);
    expect(canSend({ status: 'returned', reopenUntil: null }, '2026-11-10')).toBe(true);
    expect(canSend({ status: 'sent', reopenUntil: '2026-11-11' }, '2026-11-11')).toBe(true);
    expect(canSend({ status: 'sent', reopenUntil: '2026-11-11' }, '2026-11-12')).toBe(false);
    expect(reopenUntilFor('2026-11-10', 1)).toBe('2026-11-10');
    expect(reopenUntilFor('2026-11-10', 3)).toBe('2026-11-12');
  });
  it('reminds for the last five days only', () => {
    expect(needsReminder('2026-11-20', '2026-11-14')).toBe(false);
    expect(needsReminder('2026-11-20', '2026-11-15')).toBe(true);
    expect(needsReminder('2026-11-20', '2026-11-20')).toBe(true);
    expect(needsReminder('2026-11-20', '2026-11-21')).toBe(false);
    expect(dueText('2026-11-20', '2026-11-22')).toBe('2 days late');
  });
  it('knows PDF and Word files and who a request is for', () => {
    expect(fileTypeOf(new TextEncoder().encode('%PDF-1.7'))?.ext).toBe('pdf');
    expect(fileTypeOf(Uint8Array.from([0x50, 0x4b, 3, 4, 0]))?.ext).toBe('docx');
    expect(fileTypeOf(new TextEncoder().encode('hello'))).toBeNull();
    expect(isForTutor({ courseIds: [] }, ['a'])).toBe(true);
    expect(isForTutor({ courseIds: ['b'] }, ['a'])).toBe(false);
  });
});

import { FILE_KINDS, kindLabel } from './tutorFiles';
describe('file types (Andy, 2026-11-04)', () => {
  it('lists them in Andy\'s order and shows a typed Other', () => {
    expect(FILE_KINDS).toEqual(['course', 'lesson', 'report', 'other']);
    expect(kindLabel({ kind: 'lesson' })).toBe('Lesson plan');
    expect(kindLabel({ kind: 'other', otherKind: 'Timetable' })).toBe('Timetable');
    expect(kindLabel({ kind: 'other', otherKind: '' })).toBe('Other');
  });
});
