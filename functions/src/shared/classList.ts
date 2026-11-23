/**
 * Marking a class from a list of names (Andy, 2026-11-23, 5A): a typed or handwritten attendance list is matched
 * to the students already on the register. A name is only matched on its own when two of its words agree with one
 * student and no other student fits as well; one word in common ("Emmy Muthoni" and "Mercy Wanjiru Muthoni") is
 * a guess the leader must check; no word in common is a new student.
 */
export interface ListStudent { id: string; name: string }
export interface ListMatch {
  name: string;
  /** found: matched on its own. check: a guess, the leader picks. new: nobody like them on the register. */
  status: 'found' | 'check' | 'new';
  personId: string | null;
  /** The likeliest students, best first, for the leader to pick from. */
  maybe: string[];
  /** The same name came earlier in the list. */
  repeat: boolean;
}

/** The words of a name, in small letters, without initials ("Elizabeth K." → elizabeth). */
export function nameWords(name: string): string[] {
  return name.toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[^a-z\s'-]/g, ' ')
    .split(/[\s'-]+/).filter((w) => w.length >= 2);
}

function editDistance(a: string, b: string): number {
  const prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let diag = prev[0]!;
    prev[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const up = prev[j]!;
      prev[j] = Math.min(up + 1, prev[j - 1]! + 1, diag + (a[i - 1] === b[j - 1] ? 0 : 1));
      diag = up;
    }
  }
  return prev[b.length]!;
}

/** Two words agree when they are the same, or a long word has one letter more (Sharon, Sharone; Tekla, Teckla). */
const sameWord = (a: string, b: string) => a === b || (Math.min(a.length, b.length) >= 5 && Math.abs(a.length - b.length) === 1 && editDistance(a, b) === 1);

/** How many words of the list name agree with the student's name. */
export function nameScore(listName: string, studentName: string): number {
  const theirs = nameWords(studentName);
  const used = new Set<number>();
  let score = 0;
  for (const w of nameWords(listName)) {
    const i = theirs.findIndex((t, k) => !used.has(k) && sameWord(w, t));
    if (i >= 0) { used.add(i); score++; }
  }
  return score;
}

export function matchList(names: readonly string[], students: readonly ListStudent[]): ListMatch[] {
  const seen = new Map<string, string | null>();
  return names.map((raw) => {
    const name = raw.replace(/\s+/g, ' ').trim();
    const key = nameWords(name).join(' ');
    const scored = students.map((s) => ({ id: s.id, score: nameScore(name, s.name) }))
      .filter((s) => s.score > 0).sort((a, b) => b.score - a.score);
    const top = scored[0]?.score ?? 0;
    const alone = top >= 2 && scored.filter((s) => s.score === top).length === 1;
    const maybe = scored.slice(0, 5).map((s) => s.id);
    const repeat = seen.has(key);
    if (!repeat) seen.set(key, alone ? scored[0]!.id : null);
    if (alone) return { name, status: 'found', personId: scored[0]!.id, maybe, repeat };
    return { name, status: top > 0 ? 'check' : 'new', personId: null, maybe, repeat };
  });
}
