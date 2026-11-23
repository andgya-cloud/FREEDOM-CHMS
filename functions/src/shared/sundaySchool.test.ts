import { describe, expect, it } from 'vitest';
import { classHeadcounts, DEFAULT_SS_CLASSES, ssClassWithLeader, classesTotal, classReportText, cleanClasses, cleanClassReport, ssClassLabel, ssSummaryLines } from './sundaySchool.js';

describe('sunday school', () => {
  it('cleans the class list and keeps ids', () => {
    const list = cleanClasses([{ name: ' Beginners ', ages: '3-5' }, { name: '' }, { id: 'juniors', name: 'Juniors renamed', ages: '6-9' }, { name: 'Beginners' }]);
    expect(list.map((c) => c.id)).toEqual(['beginners', 'juniors', 'beginners-2']);
    expect(ssClassLabel(list[0]!)).toBe('Beginners (3-5)');
    expect(cleanClasses('x')).toEqual([]);
    expect(cleanClasses(DEFAULT_SS_CLASSES)).toEqual(DEFAULT_SS_CLASSES);
    expect(ssClassWithLeader(DEFAULT_SS_CLASSES[0]!)).toBe('3-5 years · Christine');
    expect(ssClassWithLeader(DEFAULT_SS_CLASSES[4]!)).toBe('Teens (13-19) · David');
  });

  it('adds the classes into Children', () => {
    expect(classesTotal({ a: { name: 'A', count: 12, teacher: 'x' }, b: { name: 'B', count: 8, teacher: 'y' } })).toBe(20);
    expect(classesTotal(undefined)).toBe(0);
    expect(classHeadcounts({ 'age-3-5': { name: '3-5 years', count: 10, teacher: 'C' }, teens: { name: 'Teens', count: 25, teacher: 'D' } })).toEqual({ children: 10, teens: 25 });
    expect(classHeadcounts({ a: { name: 'A', count: 4, teacher: 'x' } })).toEqual({ children: 4, teens: null });
  });

  it('writes the class report and the summary', () => {
    const r = cleanClassReport({ present: '14', lesson: 'Noah', win: '', need: 'Crayons' });
    expect(r.present).toBe(14);
    expect(classReportText(r)).toBe('Children present: 14\nLesson: Noah\nNeed: Crayons');
    const lines = ssSummaryLines([{ id: 'a', name: 'Beginners', ages: '3-5', leader: '' }, { id: 'b', name: 'Juniors', ages: '', leader: '' }], { b: { name: 'Juniors', count: 9, teacher: 'T' } },
      [{ classId: 'a', report: r, by: 'Mary' }]);
    expect(lines[0]).toBe('Beginners (3-5): 14 children · Mary');
    expect(lines).toContain('Juniors: 9 children · no class report yet');
    expect(lines.at(-1)).toBe('Total in Sunday school: 23');
  });
});
