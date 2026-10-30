import { useEffect, useRef } from 'react';

/** Wait between the end of one play and the start of the next: 10 minutes (Andy, 2026-10-30). */
const PAUSE_MS = 10 * 60_000;

/**
 * ADIA's crest video behind Getting started (Andy's animated logo, 2026-10-30): plays once, rests on its last
 * frame for ten minutes, then plays again, for as long as the page is open.
 * Muted, and only the still picture for people who turn motion off.
 */
export function SceneVideo() {
  const ref = useRef<HTMLVideoElement>(null);
  const still = typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  useEffect(() => {
    const video = ref.current;
    if (!video || still) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const again = () => { timer = setTimeout(() => { video.currentTime = 0; void video.play().catch(() => {}); }, PAUSE_MS); };
    video.addEventListener('ended', again);
    void video.play().catch(() => {});
    return () => { video.removeEventListener('ended', again); clearTimeout(timer); };
  }, [still]);
  if (still) return <img className="lav-scene-media" src="/adia-crest-scene.jpg" alt="" />;
  // H.264 for Safari and most browsers; WebM where H.264 is missing.
  const src = document.createElement('video').canPlayType('video/mp4; codecs="avc1.4D401F"') ? '/adia-crest-scene.mp4' : '/adia-crest-scene.webm';
  return <video ref={ref} className="lav-scene-media" src={src} poster="/adia-crest-scene.jpg" muted playsInline preload="auto" aria-hidden="true" />;
}
