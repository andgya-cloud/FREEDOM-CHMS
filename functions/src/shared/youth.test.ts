import { describe, expect, it } from 'vitest';
import { youthMeeting, youthReminderText, youthSummaryLines } from './youth.js';
import type { SsDay } from './ssTimetable.js';

const day = (o: Partial<SsDay>): SsDay => ({ date: '2026-12-04', kind: 'special', title: '', noClass: false, theme: '', series: '', note: '', time: '', link: '', lessons: {}, files: [], ...o });

describe('youth', () => {
  it('finds a meeting on a timetable day or a Sunday', () => {
    expect(youthMeeting('2026-12-04', day({ title: 'Youth night' }), false)).toEqual({ date: '2026-12-04', name: 'Youth night' });
    expect(youthMeeting('2026-12-04', null, false)).toBeNull();
    expect(youthMeeting('2026-12-06', null, true)).toEqual({ date: '2026-12-06', name: 'Sunday youth' });
    expect(youthMeeting('2026-12-06', day({ date: '2026-12-06', kind: 'sunday', noClass: true }), true)).toBeNull();
  });
  it('writes the reminder for the group', () => {
    const t = youthReminderText({ day: day({ title: 'Youth night', time: '6 PM', lessons: { youth: { title: 'Purpose', passage: 'Jeremiah 29:11', verse: '', point: '', activity: '', teacher: 'Sheila', link: '' } } }), app: 'https://x', drive: '' });
    expect(t).toContain('Youth meeting Fri 4 Dec, 6 PM');
    expect(t).toContain('Topic: Purpose');
    expect(t).toContain('Leading: Sheila');
    expect(t).not.toContain('Youth folder');
  });
  it('sums the week', () => {
    const lines = youthSummaryLines([{ date: '2026-12-04', name: 'Youth night', count: 30, by: 'Sheila' }, { date: '2026-12-06', name: 'Sunday youth', count: 42, by: 'Sheila' }], [{ day: '2026-12-04', present: 30, lesson: 'Purpose', win: '3 saved', need: '', by: 'Sheila' }], 2);
    expect(lines.at(-1)).toBe('Total at youth meetings: 72');
    expect(lines).toContain('   Win: 3 saved');
    expect(lines).toContain('Wins posted in the youth room: 2');
  });
});
