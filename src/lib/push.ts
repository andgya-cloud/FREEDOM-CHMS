import { deleteDoc, doc, serverTimestamp, setDoc } from 'firebase/firestore';
import { app, db, usingEmulators } from '../firebase';
import { readPref, writePref } from './storage';

/**
 * Calendar reminders as pop-ups on this phone or computer (Andy, 2026-11-14, 4A). Turning them on asks the browser
 * for permission, registers public/firebase-messaging-sw.js and saves this device's push address in pushTokens, under
 * the person signed in. On iPhone and iPad, pop-ups work only once the app is added to the Home Screen.
 */
const SW_URL = '/firebase-messaging-sw.js';
const SW_SCOPE = '/firebase-cloud-messaging-push-scope';
const PREF = 'pushOn';

export type PushState = 'on' | 'off' | 'blocked' | 'unsupported' | 'iphone-install';

const isIos = () => /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const isStandalone = () => window.matchMedia?.('(display-mode: standalone)').matches || (navigator as { standalone?: boolean }).standalone === true;

export async function pushState(uid: string): Promise<PushState> {
  if (typeof window === 'undefined' || !('serviceWorker' in navigator) || !('Notification' in window) || !('PushManager' in window)) {
    return isIos() && !isStandalone() ? 'iphone-install' : 'unsupported';
  }
  try {
    const { isSupported } = await import('firebase/messaging');
    if (!(await isSupported())) return 'unsupported';
  } catch { return 'unsupported'; }
  if (Notification.permission === 'denied') return 'blocked';
  return Notification.permission === 'granted' && readPref(PREF) === uid ? 'on' : 'off';
}

async function fingerprint(text: string): Promise<string> {
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(bytes)].map((b) => b.toString(16).padStart(2, '0')).join('').slice(0, 40);
}

function deviceName(): string {
  const ua = navigator.userAgent;
  const os = /Android/.test(ua) ? 'Android' : isIos() ? 'iPhone or iPad' : /Mac/.test(ua) ? 'Mac' : /Windows/.test(ua) ? 'Windows' : /Linux/.test(ua) ? 'Linux' : 'Device';
  const browser = /Edg\//.test(ua) ? 'Edge' : /Chrome\//.test(ua) ? 'Chrome' : /Firefox\//.test(ua) ? 'Firefox' : /Safari\//.test(ua) ? 'Safari' : 'browser';
  return `${os} · ${browser}`;
}

async function registration(): Promise<ServiceWorkerRegistration> {
  const reg = await navigator.serviceWorker.register(SW_URL, { scope: SW_SCOPE });
  const sw = reg.installing ?? reg.waiting;
  if (sw && !reg.active) {
    await new Promise<void>((resolve) => {
      sw.addEventListener('statechange', () => { if (sw.state === 'activated') resolve(); });
      setTimeout(resolve, 8000);
    });
  }
  return reg;
}

async function saveToken(uid: string): Promise<void> {
  const { getMessaging, getToken } = await import('firebase/messaging');
  const vapidKey = import.meta.env.VITE_FIREBASE_VAPID_KEY || undefined;
  const token = await getToken(getMessaging(app), { serviceWorkerRegistration: await registration(), vapidKey });
  if (!token) throw new Error('This device did not give a push address.');
  const id = await fingerprint(token);
  await setDoc(doc(db, 'pushTokens', id), { uid, token, device: deviceName(), updatedAt: serverTimestamp() });
  writePref(PREF, uid);
  writePref('pushTokenId', id);
}

/** Asks permission and turns pop-ups on. Returns the new state, or throws with a reason in plain words. */
export async function enablePush(uid: string): Promise<PushState> {
  if (usingEmulators) throw new Error('Pop-ups only work on the live app.');
  const state = await pushState(uid);
  if (state === 'unsupported' || state === 'iphone-install' || state === 'blocked') return state;
  const answer = await Notification.requestPermission();
  if (answer !== 'granted') return answer === 'denied' ? 'blocked' : 'off';
  await saveToken(uid);
  return 'on';
}

export async function disablePush(): Promise<void> {
  const id = readPref('pushTokenId');
  writePref(PREF, null);
  try {
    const { getMessaging, deleteToken } = await import('firebase/messaging');
    await deleteToken(getMessaging(app));
  } catch { /* already gone */ }
  if (id) await deleteDoc(doc(db, 'pushTokens', id)).catch(() => undefined);
}

let refreshed = false;
/** Once per visit, keeps this device's push address fresh (browsers change it now and then). */
export function refreshPush(uid: string | undefined): void {
  if (!uid || refreshed || usingEmulators) return;
  refreshed = true;
  void pushState(uid).then((s) => (s === 'on' ? saveToken(uid) : undefined)).catch(() => undefined);
}
