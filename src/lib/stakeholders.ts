/**
 * ADIA's petty cash stakeholders, so the "signs on this device" box can suggest an email as soon as a
 * name is typed (Andy's list, 2026-10-23). Emails only; each person still types their own password.
 */
export const ADIA_STAKEHOLDERS: readonly { name: string; email: string }[] = [
  { name: 'Elizabeth Mutuku', email: 'elizabethkithei@gmail.com' },
  { name: 'Elias Omondi', email: 'omondieliaso@gmail.com' },
  { name: "Daniel Ojwang'", email: 'danalfre9@gmail.com' },
  { name: 'Doreen Mayaka', email: 'dorreen.guya@gmail.com' },
  { name: 'Andrew Guya', email: 'andgya@gmail.com' },
  { name: 'Ronald Awili', email: 'ronaldawili@gmail.com' },
];

/** The stakeholders an organization's signing boxes suggest. */
export function stakeholdersFor(orgType: string | undefined) {
  return orgType === 'college' ? ADIA_STAKEHOLDERS : [];
}

/** Lower case, straight apostrophes and single spaces, so "daniel Ojwang’" matches "Daniel Ojwang'". */
function norm(text: string) {
  return text.normalize('NFKC').toLowerCase().replace(/[\u2018\u2019\u02bc\u0060\u00b4]/g, "'").replace(/\s+/g, ' ').trim();
}

/** Stakeholders whose name or email contains what was typed. An empty box lists everyone. */
export function matchStakeholders(people: readonly { name: string; email: string }[], typed: string) {
  const q = norm(typed);
  if (!q) return [...people];
  return people.filter((p) => norm(p.name).includes(q) || p.email.toLowerCase().includes(q));
}

/**
 * The email to sign with: the typed text if it is an email, otherwise the one stakeholder whose name
 * matches it (stakeholders-remember-v56). Undefined when a name matches nobody or more than one person.
 */
export function resolveStakeholderEmail(people: readonly { name: string; email: string }[], typed: string) {
  const t = typed.trim();
  if (t.includes('@')) return t.toLowerCase();
  const q = norm(t);
  if (!q) return undefined;
  const exact = people.filter((p) => norm(p.name) === q);
  if (exact.length === 1) return exact[0].email;
  const matches = matchStakeholders(people, t);
  return matches.length === 1 ? matches[0].email : undefined;
}
