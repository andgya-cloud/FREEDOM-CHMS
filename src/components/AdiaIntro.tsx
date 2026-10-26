import { useEffect, useRef, useState } from 'react';

const KEY = 'adia-intro-pending';

/** Called after a sign-in, so ADIA's crest plays once when the app opens on ADIA. */
export function markIntroPending() {
  try { sessionStorage.setItem(KEY, '1'); } catch { /* private mode: no intro */ }
}
function takePending() {
  try { const on = sessionStorage.getItem(KEY) === '1'; sessionStorage.removeItem(KEY); return on; } catch { return false; }
}

/**
 * ADIA's animated crest, full screen, after a sign-in or a switch to ADIA (Andy, 2026-10-26, 1A-3A):
 * about 6 seconds of the crest forming, then it shrinks to the centre and fades into Today.
 */
export function AdiaIntro({ orgId, college }: { orgId?: string; college: boolean }) {
  const [phase, setPhase] = useState<'off' | 'play' | 'shrink'>('off');
  const prev = useRef<{ id?: string; college: boolean }>({ college: false });
  useEffect(() => {
    if (!orgId) return;
    const before = prev.current;
    prev.current = { id: orgId, college };
    const pending = takePending();
    const switched = !!before.id && before.id !== orgId && !before.college;
    const still = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    if (college && (pending || switched) && !still) setPhase('play');
  }, [orgId, college]);
  useEffect(() => {
    if (phase === 'play') { const t = setTimeout(() => setPhase('shrink'), 8000); return () => clearTimeout(t); }
    if (phase === 'shrink') { const t = setTimeout(() => setPhase('off'), 1000); return () => clearTimeout(t); }
  }, [phase]);
  if (phase === 'off') return null;
  // H.264 for Safari and most browsers; WebM where H.264 is missing.
  const src = document.createElement('video').canPlayType('video/mp4; codecs="avc1.4D401F"') ? '/adia-intro.mp4' : '/adia-intro.webm';
  const finish = () => setPhase((p) => (p === 'play' ? 'shrink' : p));
  return (
    <div className={`adia-intro${phase === 'shrink' ? ' adia-intro-out' : ''}`} role="presentation">
      <video src={src} autoPlay muted playsInline preload="auto" onEnded={finish} onError={finish} aria-label="ADIA Training Centre" />
      <button type="button" className="adia-intro-skip" onClick={finish}>Skip</button>
    </div>
  );
}
