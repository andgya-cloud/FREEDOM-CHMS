import { passwordProblems } from '../../functions/src/shared/password';

export function PasswordChecklist({ password, email }: { password: string; email: string }) {
  if (!password) return <p className="hint">At least 10 characters, with a capital letter, a lowercase letter and a number.</p>;
  const problems = passwordProblems(password, email);
  if (problems.length === 0) return <p className="hint hint-ok">Strong password.</p>;
  return (
    <ul className="hint hint-list">
      {problems.map((p) => <li key={p}>{p}</li>)}
    </ul>
  );
}
