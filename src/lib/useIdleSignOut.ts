import { useEffect } from 'react';
import { readPref, writePref } from './storage';

const EVENTS = ['pointerdown', 'keydown', 'scroll', 'touchstart'] as const;
const LAST_ACTIVE = 'lastActive';
const WRITE_EVERY_MS = 5_000;

/** Only devices marked as shared sign out by themselves; a personal phone stays signed in. */
export function isSharedDevice(): boolean {
  return readPref('sharedDevice') === 'true';
}

/** Last tap or key press in any tab of the app on this device. */
function lastActiveAnywhere(): number {
  return Number(readPref(LAST_ACTIVE)) || 0;
}

/**
 * On a shared device, signs out after `minutes` without a tap or key press.
 * Activity is shared between tabs, because signing out in one tab signs out
 * all of them: a forgotten tab must not sign out someone working in another.
 */
export function useIdleSignOut(minutes: number, enabled: boolean, onIdle: () => void) {
  useEffect(() => {
    if (!enabled || minutes <= 0) return;
    let last = Date.now();
    let written = last;
    writePref(LAST_ACTIVE, String(last));
    const touch = () => {
      last = Date.now();
      if (last - written > WRITE_EVERY_MS) {
        written = last;
        writePref(LAST_ACTIVE, String(last));
      }
    };
    EVENTS.forEach((e) => window.addEventListener(e, touch, { passive: true }));
    const timer = window.setInterval(() => {
      if (Date.now() - Math.max(last, lastActiveAnywhere()) > minutes * 60_000) onIdle();
    }, 15_000);
    return () => {
      EVENTS.forEach((e) => window.removeEventListener(e, touch));
      window.clearInterval(timer);
    };
  }, [minutes, enabled, onIdle]);
}
