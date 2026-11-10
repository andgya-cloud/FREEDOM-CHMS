import type { ReactNode } from 'react';

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
