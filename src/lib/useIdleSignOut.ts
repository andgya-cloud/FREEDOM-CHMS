import { useEffect } from 'react';
import { readPref } from './storage';

const EVENTS = ['pointerdown', 'keydown', 'scroll', 'touchstart'] as const;

export function isSharedDevice(): boolean {
  return readPref('sharedDevice') !== 'false';
}

/** On a shared device, signs out after `minutes` without a tap or key press. */
export function useIdleSignOut(minutes: number, enabled: boolean, onIdle: () => void) {
  useEffect(() => {
    if (!enabled || minutes <= 0) return;
    let last = Date.now();
    const touch = () => { last = Date.now(); };
    EVENTS.forEach((e) => window.addEventListener(e, touch, { passive: true }));
    const timer = window.setInterval(() => {
      if (Date.now() - last > minutes * 60_000) onIdle();
    }, 15_000);
    return () => {
      EVENTS.forEach((e) => window.removeEventListener(e, touch));
      window.clearInterval(timer);
    };
  }, [minutes, enabled, onIdle]);
}
