import { useState, type ReactNode } from 'react';
import { markTipSeen, tipSeen } from '../lib/aiFeatures';

/** The sparkle that marks the helper's work everywhere (Andy, 2026-11-10, 3A), so it shows without colour too. */
export const AI_MARK = '✦';

/** A box holding words the helper wrote: dark gold bar, light gold tint, a label and the "please check" note. */
export function AiBox({ title, note = 'Written by AI. Please check it.', children }: { title?: string; note?: string; children: ReactNode }) {
  return (
    <div className="ai-box" role="note">
      {title && <span className="ai-label">{AI_MARK} {title}</span>}
      {children}
      <p className="ai-note">{title ? '' : `${AI_MARK} `}{note}</p>
    </div>
  );
}

/** The first time someone meets the helper on a page, a small gold tip points to the ✦ button once (Andy, 5A). */
export function AiTip({ id, children }: { id: string; children: ReactNode }) {
  const [open, setOpen] = useState(() => !tipSeen(id));
  if (!open) return null;
  return (
    <div className="ai-tip no-print" role="status">
      <span><span className="ai-label">{AI_MARK} New:</span> {children}</span>
      <button type="button" className="btn btn-ai btn-small" onClick={() => { markTipSeen(id); setOpen(false); }}>Got it</button>
    </div>
  );
}

/** The small gold sparkle on a menu button that leads to AI help (Andy, 2A). */
export function AiDot() {
  return <span className="ai-dot" aria-label="has AI help" title="Has AI help">{AI_MARK}</span>;
}
