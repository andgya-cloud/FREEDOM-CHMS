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

/** Stakeholders whose name or email contains what was typed (any word of the name may start it). */
export function matchStakeholders(people: readonly { name: string; email: string }[], typed: string) {
  const q = typed.trim().toLowerCase().replace(/[’']/g, "'");
  if (!q) return [];
  return people.filter((p) => p.name.toLowerCase().includes(q) || p.email.toLowerCase().includes(q));
}
