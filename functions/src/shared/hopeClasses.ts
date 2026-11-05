/**
 * Hope Centre classes by age (Andy, 2026-11-05, 5A): Jasper 3-5, Rubies 6-7, Sapphire 8-9, Emerald 10-12,
 * Topaz 13 and over. The child's age today decides it, so a child moves up on their birthday.
 */
import { ageOn } from './hope.js';

export const HOPE_CLASSES = [
  { id: 'jasper', name: 'Jasper', from: 3, to: 5, colour: '#b5452f', light: '#e9876f' },
  { id: 'rubies', name: 'Rubies', from: 6, to: 7, colour: '#c8102e', light: '#f2647a' },
  { id: 'sapphire', name: 'Sapphire', from: 8, to: 9, colour: '#1f4fb5', light: '#6f9cf2' },
  { id: 'emerald', name: 'Emerald', from: 10, to: 12, colour: '#11875d', light: '#5fd3a3' },
  { id: 'topaz', name: 'Topaz', from: 13, to: 99, colour: '#e08a00', light: '#ffd067' },
] as const;
export type HopeClassId = (typeof HOPE_CLASSES)[number]['id'];
export type HopeClass = (typeof HOPE_CLASSES)[number];

export function classForAge(age: number | null): HopeClass | null {
  if (age == null) return null;
  return HOPE_CLASSES.find((c) => age >= c.from && age <= c.to) ?? null;
}

export function classOf(dateOfBirth: string | null | undefined, today: string): HopeClass | null {
  return classForAge(ageOn(dateOfBirth, today));
}

/** "Jasper (3 to 5)". */
export function classLabel(c: HopeClass): string {
  return c.to >= 99 ? `${c.name} (${c.from} and over)` : `${c.name} (${c.from} to ${c.to})`;
}

/** An allergy worth warning about: anything written except "None known" (Andy, 2026-11-05, 4A). */
export const NO_ALLERGIES = 'None known';
export function hasAllergy(allergies: string | null | undefined): boolean {
  const a = (allergies ?? '').trim();
  return !!a && a.toLowerCase() !== NO_ALLERGIES.toLowerCase() && !/^(none|no|nil|n\/a)\.?$/i.test(a);
}
