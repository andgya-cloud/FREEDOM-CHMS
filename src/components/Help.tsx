import { useId, useState, type ReactNode } from 'react';

/** A small "?" that opens a short explanation, so pages keep one line of text (Andy, 2026-11-04, 7A). */
export function Help({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const id = useId();
  return (
    <span className="help-tip">
      <button type="button" className="help-q" aria-expanded={open} aria-controls={id} aria-label="More about this" onClick={() => setOpen(!open)}>?</button>
      {open && <span id={id} className="help-text" role="note">{children}</span>}
    </span>
  );
}
