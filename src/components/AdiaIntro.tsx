import { useEffect, useRef, useState } from 'react';

const KEY = 'adia-intro-pending';

/** Called after a sign-in, so ADIA's crest (or Freedom Church's logo) plays once when the app opens there. */
export function markIntroPending() {
  try { sessionStorage.setItem(KEY, '1'); } catch { /* private mode: no intro */ }
}
function takePending() {
  try { const on = sessionStorage.getItem(KEY) === '1'; sessionStorage.removeItem(KEY); return on; } catch { return false; }
}

/** The places that open with a video, and its file in /public. */
const INTROS: Record<string, { name: string; label: string; tone?: string }> = {
  college: { name: 'adia-intro', label: 'ADIA Training Centre' },
  church_campus: { name: 'church-intro', label: 'Freedom Church', tone: 'adia-intro-church' },
  ministry: { name: 'hope-intro', label: 'Freedom Hope Center', tone: 'adia-intro-hope' },
};

/**
 * ADIA's animated crest, full screen, after a sign-in or a switch to ADIA (Andy, 2026-10-26, 1A-3A):
 * about 6 seconds of the crest forming, then it shrinks to the centre and fades into Today.
 * Freedom Church opens the same way with its own logo video, 8 seconds, silent (Andy, 2026-10-31, 1A-6A), and Hope Centre with its OneChild video, 9 seconds (1A-5A).
 */
export function AdiaIntro({ orgId, orgType }: { orgId?: string; orgType?: string }) {
  const [phase, setPhase] = useState<'off' | 'play' | 'shrink'>('off');
  const prev = useRef<{ id?: string; type?: string }>({});
  const intro = INTROS[orgType ?? ''];
  useEffect(() => {
    if (!orgId) return;
    const before = prev.current;
    prev.current = { id: orgId, type: orgType };
    const pending = takePending();
    const switched = !!before.id && before.id !== orgId && before.type !== orgType;
    const still = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    if (INTROS[orgType ?? ''] && (pending || switched) && !still) setPhase('play');
  }, [orgId, orgType]);
  useEffect(() => {
    if (phase === 'play') { const t = setTimeout(() => setPhase('shrink'), 10000); return () => clearTimeout(t); }
    if (phase === 'shrink') { const t = setTimeout(() => setPhase('off'), 1000); return () => clearTimeout(t); }
  }, [phase]);
  if (phase === 'off' || !intro) return null;
  // H.264 for Safari and most browsers; WebM where H.264 is missing.
  const src = document.createElement('video').canPlayType('video/mp4; codecs="avc1.4D401F"') ? `/${intro.name}.mp4` : `/${intro.name}.webm`;
  const finish = () => setPhase((p) => (p === 'play' ? 'shrink' : p));
  return (
    <div className={`adia-intro${intro.tone ? ` ${intro.tone}` : ''}${phase === 'shrink' ? ' adia-intro-out' : ''}`} role="presentation">
      <video src={src} autoPlay muted playsInline preload="auto" onEnded={finish} onError={finish} aria-label={intro.label} />
      <button type="button" className="adia-intro-skip" onClick={finish}>Skip</button>
    </div>
  );
}
