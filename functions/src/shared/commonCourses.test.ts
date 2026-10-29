import { describe, expect, it } from 'vitest';
import { commonFinal, matchTutor, standardCourse, standardOrder, STANDARD_COMMON_COURSES } from './commonCourses.js';

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
