/**
 * Families on Freedom Church's People page (Andy, 2026-11-01, 1A-7A). People in one family share a householdId;
 * each carries a familyRole. A family shows as one card: parents first, then the children oldest to youngest.
 */

export const FAMILY_ROLES = ['parent', 'spouse', 'child'] as const;
export type FamilyRole = (typeof FAMILY_ROLES)[number];
export const FAMILY_ROLE_LABELS: Record<FamilyRole, string> = { parent: 'Parent', spouse: 'Spouse', child: 'Child' };

export interface FamilyMember {
  id: string;
  fullName: string;
  status: string;
  phone?: string | null;
  whatsapp?: string | null;
  gender?: string | null;
  birthday?: string | null;
  birthYear?: number | null;
  householdId?: string | null;
  guardianId?: string | null;
  familyRole?: FamilyRole | null;
}

/** The role shown when none was chosen: a child status or a guardian makes a child, anyone else a parent. */
export function roleOf(p: FamilyMember): FamilyRole {
  if (p.familyRole) return p.familyRole;
  return p.status === 'child' || p.guardianId ? 'child' : 'parent';
}

/** The last word of a name: "Andrew Guya" → "Guya". */
export function surnameOf(fullName: string): string {
  const words = fullName.trim().split(/\s+/);
  return words.length > 1 ? words[words.length - 1]! : '';
}

/** Born first sorts first; anyone with no birth year goes after those with one. */
function ageKey(p: FamilyMember): string {
  return p.birthYear ? `${p.birthYear}-${p.birthday ?? '12-31'}` : `9999-${p.birthday ?? '99-99'}`;
}

/** Parents (and spouses) first, a father before a mother, then the children oldest to youngest (2A). */
export function sortFamily<T extends FamilyMember>(members: readonly T[]): T[] {
  const rank = (p: T) => (roleOf(p) === 'child' ? 2 : 0);
  const gender = (p: T) => ({ male: 0, female: 1 }[(p.gender ?? '').toLowerCase()] ?? 2);
  return [...members].sort((a, b) => rank(a) - rank(b)
    || (rank(a) === 2 ? ageKey(a).localeCompare(ageKey(b)) : gender(a) - gender(b))
    || a.fullName.localeCompare(b.fullName));
}

/** "Guya family", from the first parent's surname, unless the family was given its own name (5A). */
export function familyName(members: readonly FamilyMember[], stored?: string | null): string {
  if (stored?.trim()) return stored.trim();
  const sorted = sortFamily(members);
  const surname = sorted.map((p) => surnameOf(p.fullName)).find(Boolean);
  return surname ? `${surname} family` : 'Family';
}

/** Families of two or more people, by householdId. */
export function familyGroups<T extends FamilyMember>(people: readonly T[]): Map<string, T[]> {
  const byHouse = new Map<string, T[]>();
  for (const p of people) {
    if (!p.householdId) continue;
    const list = byHouse.get(p.householdId) ?? [];
    list.push(p);
    byHouse.set(p.householdId, list);
  }
  for (const [id, list] of byHouse) {
    if (list.length < 2) byHouse.delete(id);
    else byHouse.set(id, sortFamily(list));
  }
  return byHouse;
}

export type PeopleListItem<T> = { kind: 'family'; id: string; members: T[] } | { kind: 'person'; person: T };

/** One list in A to Z order with each family placed where its first parent's name falls (7A). */
export function groupedList<T extends FamilyMember>(people: readonly T[]): PeopleListItem<T>[] {
  const families = familyGroups(people);
  const inFamily = new Set([...families.values()].flat().map((p) => p.id));
  const items: { key: string; item: PeopleListItem<T> }[] = [
    ...[...families].map(([id, members]) => ({ key: members[0]!.fullName, item: { kind: 'family' as const, id, members } })),
    ...people.filter((p) => !inFamily.has(p.id)).map((p) => ({ key: p.fullName, item: { kind: 'person' as const, person: p } })),
  ];
  return items.sort((a, b) => a.key.localeCompare(b.key)).map((x) => x.item);
}

/** The same pair always gives the same key, whichever way round. */
export function pairKey(a: string, b: string): string {
  return a < b ? `${a}__${b}` : `${b}__${a}`;
}

export interface FamilySuggestion<T> {
  key: string;
  /** The person whose family the other joins. */
  anchor: T;
  member: T;
  role: FamilyRole;
  reason: string;
}

const digits = (v?: string | null) => (v ?? '').replace(/\D/g, '');

/**
 * Likely families nobody has linked yet (4A): a child whose parent is set but who is not in the parent's family,
 * and people with the same surname who share a phone or WhatsApp number. Pairs already answered "No" are left out.
 */
export function familySuggestions<T extends FamilyMember>(people: readonly T[], dismissed: ReadonlySet<string>, limit = 20): FamilySuggestion<T>[] {
  const byId = new Map(people.map((p) => [p.id, p]));
  const sameFamily = (a: T, b: T) => !!a.householdId && a.householdId === b.householdId;
  const out: FamilySuggestion<T>[] = [];
  const seen = new Set<string>();
  const add = (anchor: T, member: T, role: FamilyRole, reason: string) => {
    const key = pairKey(anchor.id, member.id);
    if (seen.has(key) || dismissed.has(key) || sameFamily(anchor, member)) return;
    seen.add(key);
    out.push({ key, anchor, member, role, reason });
  };
  for (const child of people) {
    const parent = child.guardianId ? byId.get(child.guardianId) : undefined;
    if (parent) add(parent, child, 'child', `${parent.fullName} is set as ${child.fullName.split(' ')[0]}'s parent or guardian`);
  }
  const byNumber = new Map<string, T[]>();
  for (const p of people) {
    for (const n of new Set([digits(p.phone), digits(p.whatsapp)])) {
      if (n.length < 9) continue;
      const list = byNumber.get(n) ?? [];
      list.push(p);
      byNumber.set(n, list);
    }
  }
  for (const list of byNumber.values()) {
    for (let i = 0; i < list.length; i++) {
      for (let j = i + 1; j < list.length; j++) {
        const [a, b] = sortFamily([list[i]!, list[j]!]);
        const s = surnameOf(a!.fullName).toLowerCase();
        if (s && s === surnameOf(b!.fullName).toLowerCase()) add(a!, b!, roleOf(b!), 'Same surname and phone number');
      }
    }
  }
  return out.slice(0, limit);
}
