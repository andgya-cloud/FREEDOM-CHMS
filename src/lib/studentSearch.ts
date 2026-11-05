/** Letters and digits only, lower case, so "ADIA/ CTR/2025" and "adia ctr 2025" compare alike. */
const plain = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

/**
 * Whether a student matches what was typed (Andy, 2026-10-29, 3A): every word of it is found in the name, in any
 * order ("mbatha agnes"), or it is part of the admission number ("IT/2025/1/002", "it 2025 1 002" or just "002").
 */
export function matchesStudent(query: string, name: string, admissionNo = ''): boolean {
  const q = plain(query);
  if (!q) return true;
  const n = plain(name);
  if (q.split(' ').every((w) => n.split(' ').some((part) => part.startsWith(w)) || n.includes(w))) return true;
  const adm = plain(admissionNo);
  return !!adm && (adm.includes(q) || adm.replace(/ /g, '').includes(q.replace(/ /g, '')));
}

/** The letter a name is filed under in the A to Z bar. */
export const initialOf = (name: string) => { const c = plain(name).charAt(0).toUpperCase(); return /[A-Z]/.test(c) ? c : '#'; };
