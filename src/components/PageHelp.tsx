import { useEffect, useRef, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { helpFor } from '../lib/pageHelp';

/** The "?" at the top of every ADIA, Freedom Church and Hope page: three simple steps for the page you are on (Andy 6A). */
export function PageHelp({ college = true }: { college?: boolean }) {
  const { pathname } = useLocation();
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const help = helpFor(pathname, college);

  useEffect(() => { setOpen(false); }, [pathname]);
  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => { if (box.current && !box.current.contains(e.target as Node)) setOpen(false); };
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', away);
    document.addEventListener('keydown', esc);
    return () => { document.removeEventListener('mousedown', away); document.removeEventListener('keydown', esc); };
  }, [open]);

  return (
    <div className="page-help no-print" ref={box}>
      <button type="button" className="page-help-btn" aria-expanded={open} aria-label="Help for this page" onClick={() => setOpen((o) => !o)}>?</button>
      {open && (
        <div className="page-help-box" role="dialog" aria-label={`How to use ${help.title}`}>
          <strong>{help.title}: how to use it</strong>
          <ol>{help.steps.map((s) => <li key={s}>{s}</li>)}</ol>
          <button type="button" className="btn btn-quiet" onClick={() => setOpen(false)}>Close</button>
        </div>
      )}
    </div>
  );
}
