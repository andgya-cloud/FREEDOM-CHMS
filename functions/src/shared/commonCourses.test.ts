import { describe, expect, it } from 'vitest';
import { commonCourseList, commonFinal, matchTutor, planCommonChanges, standardCourse, standardOrder, STANDARD_COMMON_COURSES } from './commonCourses.js';

const people = [{ name: 'Andrew Guya' }, { name: 'Flavier  Akinyi' }, { name: 'Alphonse Odhiambo Nyaoro' }, { name: 'Grace Akinyi' }];

describe('matchTutor', () => {
  it('matches the whole name, ignoring case and spaces', () => {
    expect(matchTutor(['flavier akinyi'], people)?.name).toBe('Flavier  Akinyi');
  });
  it('matches first and last name inside a longer name', () => {
    expect(matchTutor(['Alphonse Nyaoro'], people)?.name).toBe('Alphonse Odhiambo Nyaoro');
  });
  it('finds nobody rather than guess', () => {
    expect(matchTutor(['Akinyi'], people)).toBeUndefined();
    expect(matchTutor(['Mary Wanjiru'], people)).toBeUndefined();
  });
  it('lists the seven courses in Andy\'s order', () => {
    expect(STANDARD_COMMON_COURSES.map((c) => `${c.name}:${c.tutor[0]}`)).toEqual([
      'Leadership:Andrew Guya', 'Business Skills:Flavier Akinyi', 'Life Skills:Flavier Akinyi', 'Communication:Flavier Akinyi',
      'Critical Thinking:Alphonse Nyaoro', 'Basic Mathematics:Alphonse Nyaoro', 'ICT Skills:Alphonse Nyaoro',
    ]);
  });
});

describe('standardCourse', () => {
  it('knows a course by an older name', () => {
    expect(standardCourse(' basic  math ')?.name).toBe('Basic Mathematics');
    expect(standardCourse('ICT')?.name).toBe('ICT Skills');
    expect(standardCourse('Entrepreneurship')).toBeUndefined();
    expect(standardOrder('Leadership')).toBe(0);
    expect(standardOrder('Entrepreneurship')).toBe(7);
  });
});

describe('commonFinal', () => {
  it('averages the two semesters once both are in', () => {
    expect(commonFinal(60, 71)).toBe(65.5);
    expect(commonFinal(60, null)).toBeNull();
  });
});

describe('planCommonChanges', () => {
  const A = { name: 'Leadership', tutorUid: 'andy', tutorName: 'Andrew Guya' };
  const F = { name: 'Communication', tutorUid: 'fl', tutorName: 'Flavier Akinyi' };
  const sheet = (id: string, cohort: string, courseName: string, ownerUid: string, semester: 1 | 2, hasMarks = false) => ({ id, cohort, courseName, ownerUid, semester, hasMarks });
  it('adds a new course to every open cohort, both semesters', () => {
    const ch = planCommonChanges([A], [A, F], {}, ['Cohort 4', 'Cohort 5'], [sheet('a1', 'Cohort 4', 'Leadership', 'andy', 1), sheet('a2', 'Cohort 4', 'Leadership', 'andy', 2)]);
    expect(ch.filter((c) => c.kind === 'add').map((c) => `${c.cohort}:${c.name}`)).toEqual(['Cohort 4:Communication', 'Cohort 4:Communication', 'Cohort 5:Leadership', 'Cohort 5:Leadership', 'Cohort 5:Communication', 'Cohort 5:Communication']);
  });
  it('moves a course to its new tutor and renames it, keeping the sheets', () => {
    const ch = planCommonChanges([F], [{ name: 'Communication Skills', tutorUid: 'al', tutorName: 'Alphonse' }], { 'Communication Skills': 'Communication' }, ['Cohort 4'],
      [sheet('c1', 'Cohort 4', 'Communication', 'fl', 1, true), sheet('c2', 'Cohort 4', 'Communication', 'fl', 2)]);
    expect(ch.map((c) => `${c.kind}:${'sheetId' in c ? c.sheetId : ''}`)).toEqual(['rename:c1', 'move:c1', 'rename:c2', 'move:c2']);
  });
  it('removes a dropped course only where no marks are in', () => {
    const ch = planCommonChanges([A, F], [A], {}, ['Cohort 4'],
      [sheet('a1', 'Cohort 4', 'Leadership', 'andy', 1), sheet('a2', 'Cohort 4', 'Leadership', 'andy', 2), sheet('c1', 'Cohort 4', 'Communication', 'fl', 1, true), sheet('c2', 'Cohort 4', 'Communication', 'fl', 2)]);
    expect(ch).toEqual([{ kind: 'remove', sheetId: 'c2', cohort: 'Cohort 4', name: 'Communication' }]);
  });
  it('starts from the seven courses with their usual tutors until saved', () => {
    const list = commonCourseList(null, [{ uid: 'al', name: 'Alphonse Nyaoro' }]);
    expect(list).toHaveLength(7);
    expect(list.find((c) => c.name === 'ICT Skills')?.tutorUid).toBe('al');
    expect(list[0]!.tutorUid).toBe('');
  });
});
