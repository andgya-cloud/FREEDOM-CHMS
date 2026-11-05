import { useState, type InputHTMLAttributes } from 'react';

/** A password box with an eye button to show or hide what was typed. */
export function PasswordInput({ shown = false, className, ...props }: Omit<InputHTMLAttributes<HTMLInputElement>, 'type'> & { shown?: boolean }) {
  const [show, setShow] = useState(shown);
  return (
    <span className="password-box">
      <input {...props} type={show ? 'text' : 'password'} className={className} spellCheck={false} autoCapitalize="off" />
      <button type="button" className="password-eye" onClick={() => setShow((s) => !s)} aria-label={show ? 'Hide password' : 'Show password'} aria-pressed={show} title={show ? 'Hide password' : 'Show password'}>
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12Z" />
          <circle cx="12" cy="12" r="3" />
          {show && <path d="M3 3l18 18" />}
        </svg>
      </button>
    </span>
  );
}
