/** Strong-password rules, checked in the browser and again by Cloud Functions. */
export const PASSWORD_MIN_LENGTH = 10;

export function passwordProblems(password: string, email = ''): string[] {
  const problems: string[] = [];
  if (password.length < PASSWORD_MIN_LENGTH) problems.push(`Use at least ${PASSWORD_MIN_LENGTH} characters.`);
  if (!/[a-z]/.test(password)) problems.push('Add a lowercase letter.');
  if (!/[A-Z]/.test(password)) problems.push('Add a capital letter.');
  if (!/[0-9]/.test(password)) problems.push('Add a number.');
  const name = email.split('@')[0]?.toLowerCase() ?? '';
  if (name.length >= 3 && password.toLowerCase().includes(name)) {
    problems.push('Do not use your email name in the password.');
  }
  if (/^(.)\1+$/.test(password)) problems.push('Do not repeat one character.');
  return problems;
}
