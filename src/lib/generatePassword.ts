import { passwordProblems } from '../../functions/src/shared/password';

const WORDS = ['Cedar', 'River', 'Light', 'Grace', 'Stone', 'Eagle', 'Hope', 'Mango', 'Lion', 'Bridge', 'Harvest', 'Shield', 'Valley', 'Morning'];

/** A temporary password that is easy to read aloud, e.g. "Cedar-River-4821". */
export function generateTemporaryPassword(email = ''): string {
  const pick = (n: number) => {
    const a = new Uint32Array(1);
    crypto.getRandomValues(a);
    return a[0]! % n;
  };
  for (;;) {
    const pw = `${WORDS[pick(WORDS.length)]}-${WORDS[pick(WORDS.length)]}-${String(1000 + pick(9000))}`;
    if (passwordProblems(pw, email).length === 0) return pw;
  }
}
