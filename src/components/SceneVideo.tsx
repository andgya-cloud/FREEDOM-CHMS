import { useEffect, useRef } from 'react';

/** Wait between the end of one play and the start of the next: 10 seconds (Andy, 2026-10-30, after trying 10 minutes). */
const PAUSE_MS = 10_000;

/**
 * The animated logo behind Getting started: ADIA's crest (Andy, 2026-10-30) or Freedom Church's logo (2026-10-31).
 * It plays once, rests on its last frame for ten seconds, then plays again, for as long as the page is open.
 * Muted, and only the still picture for people who turn motion off. `name` is the file name in /public, without its ending.
 */
export function SceneVideo({ name = 'adia-crest-scene' }: { name?: string } = {}) {
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
  if (still) return <img className="lav-scene-media" src={`/${name}.jpg`} alt="" />;
  // H.264 for Safari and most browsers; WebM where H.264 is missing.
  const src = document.createElement('video').canPlayType('video/mp4; codecs="avc1.4D401F"') ? `/${name}.mp4` : `/${name}.webm`;
  return <video ref={ref} className="lav-scene-media" src={src} poster={`/${name}.jpg`} muted playsInline preload="auto" aria-hidden="true" />;
}
