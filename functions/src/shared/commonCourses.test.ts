import { describe, expect, it } from 'vitest';
import { matchTutor, STANDARD_COMMON_COURSES } from './commonCourses.js';

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
  it('lists five courses with Leadership first', () => {
    expect(STANDARD_COMMON_COURSES.map((c) => c.name)).toEqual(['Leadership', 'Communication', 'Basic Mathematics', 'Business Skills', 'Critical Thinking']);
  });
});
