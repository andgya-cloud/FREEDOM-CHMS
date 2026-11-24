import { describe, expect, it } from 'vitest';
import { clockOf, durationOf, meetPercent, readMeetList } from './meetList.js';

const S = 20 * 60, E = 21 * 60;

describe('Google Meet attendance lists (2026-11-24)', () => {
  it('reads clock times and durations', () => {
    expect(clockOf('8:04 PM')).toBe(20 * 60 + 4);
    expect(clockOf('20:04:30')).toBeCloseTo(20 * 60 + 4.5);
    expect(clockOf('11/24/2026, 8:04:12 PM')).toBeCloseTo(1204.2);
    expect(clockOf('2026-11-24T17:04:00Z')).toBe(1204);
    expect(clockOf('Tue Nov 24 2026 20:04:00 GMT+0300')).toBe(1204);
    expect(durationOf('54 min')).toBe(54);
    expect(durationOf('1 hr 2 min')).toBe(62);
    expect(durationOf('01:02:30')).toBe(62.5);
    expect(durationOf('1:05')).toBe(65);
    expect(durationOf('54:30')).toBe(54.5);
  });
  it('adds up a person who left and came back, cut to class hours', () => {
    const r = readMeetList([
      ['Meeting', 'Freedom 252'],
      ['Full Name', 'Joined', 'Left'],
      ['Grace Wanjiku', '7:50 PM', '8:30 PM'],
      ['Grace Wanjiku', '8:40 PM', '9:20 PM'],
      ['Peter Gitau', '8:10 PM', ''],
      ['Jay iPhone', '8:45 PM', '8:50 PM'],
    ], S, E);
    expect(r).toEqual([
      { name: 'Grace Wanjiku', minutes: 50, join: 1190, leave: 1280 },
      { name: 'Peter Gitau', minutes: 50, join: 1210, leave: 1260 },
      { name: 'Jay iPhone', minutes: 5, join: 1245, leave: 1250 },
    ]);
    expect(meetPercent(50, S, E)).toBe(83);
  });
  it('reads a list with only time in call', () => {
    expect(readMeetList([['Participant', 'Email', 'Time in call'], ['Ann N', 'a@x.com', '45 min'], ['Ann N', '', '20 min']], S, E))
      .toEqual([{ name: 'Ann N', minutes: 60, join: null, leave: null }]);
  });
  it('reads a list ticked at moments', () => {
    const r = readMeetList([['Name', '8:00 PM', '8:15 PM', '8:30 PM', '8:45 PM', '9:00 PM'], ['Ann N', '✓', '✓', '', '', ''], ['Bob K', 'P', 'P', 'P', 'P', 'P']], S, E);
    expect(r.map((p) => [p.name, p.minutes, p.join, p.leave])).toEqual([['Ann N', 24, 1200, 1215], ['Bob K', 60, 1200, 1260]]);
  });
  it('needs a name column', () => {
    expect(() => readMeetList([['a', 'b']], S, E)).toThrow(/Name/);
  });
});
