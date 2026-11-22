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

/** The class names for a list of ids, in the classes' own order: "Topaz", "Jasper and Rubies". */
export function classNamesOf(ids: readonly string[] | null | undefined): string {
  const names = HOPE_CLASSES.filter((c) => (ids ?? []).includes(c.id)).map((c) => c.name);
  return names.length <= 1 ? names.join('') : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
}

/** "Class teacher · Topaz" (Andy, 2026-11-22, 1A: show the class name with the role). */
export function teacherLabel(ids: readonly string[] | null | undefined): string {
  const names = classNamesOf(ids);
  return names ? `Class teacher · ${names}` : 'Class teacher';
}

/**
 * How far each class's register is for a day (Andy, 2026-11-22, 4A): who is in the class that day (by age), how
 * many are marked, and who marked them. Children with no class (no birth date) are left out.
 */
export interface ClassProgress { id: HopeClassId; name: string; total: number; marked: number; by: string[] }
export function classProgress(
  children: readonly { id: string; dateOfBirth?: string | null }[],
  marks: Record<string, { s?: string | null; b?: string | null } | undefined>,
  date: string,
): ClassProgress[] {
  return HOPE_CLASSES.map((c) => {
    const kids = children.filter((k) => classOf(k.dateOfBirth, date)?.id === c.id);
    const done = kids.filter((k) => !!marks[k.id]?.s);
    const by = [...new Set(done.map((k) => marks[k.id]?.b).filter((x): x is string => !!x))];
    return { id: c.id, name: c.name, total: kids.length, marked: done.length, by };
  }).filter((p) => p.total > 0);
}
