import { useEffect, useState } from 'react';

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

type Device = 'android' | 'iphone' | 'laptop';

function guessDevice(): Device {
  const ua = navigator.userAgent;
  if (/iphone|ipad|ipod/i.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)) return 'iphone';
  if (/android/i.test(ua)) return 'android';
  return 'laptop';
}

const STEPS: Record<Device, { title: string; steps: string[] }> = {
  android: {
    title: 'Android phone or tablet',
    steps: ['Open this link in Chrome.', 'Tap “Install the app” above. If you don’t see it, tap the ⋮ menu at the top right.', 'Tap “Install app” (or “Add to Home screen”), then “Install”.'],
  },
  iphone: {
    title: 'iPhone or iPad',
    steps: ['Open this link in Safari.', 'Tap the Share button (the square with an arrow pointing up).', 'Scroll down and tap “Add to Home Screen”, then “Add”.'],
  },
  laptop: {
    title: 'Laptop or desktop',
    steps: ['Open this link in Chrome or Microsoft Edge.', 'Click “Install the app” above, or the install icon at the right end of the address bar.', 'Click “Install”. Insight-IQ opens in its own window and appears with your other apps.'],
  },
};

/** A link anyone can open to install the app on Android, iPhone or a laptop (Andy, 2026-11-03). */
export function InstallPage() {
  const [deferred, setDeferred] = useState<BeforeInstallPromptEvent | null>(null);
  const [installed, setInstalled] = useState(() => window.matchMedia('(display-mode: standalone)').matches);
  const [device, setDevice] = useState<Device>(guessDevice);

  useEffect(() => {
    const onPrompt = (e: Event) => { e.preventDefault(); setDeferred(e as BeforeInstallPromptEvent); };
    const onInstalled = () => setInstalled(true);
    window.addEventListener('beforeinstallprompt', onPrompt);
    window.addEventListener('appinstalled', onInstalled);
    return () => { window.removeEventListener('beforeinstallprompt', onPrompt); window.removeEventListener('appinstalled', onInstalled); };
  }, []);

  const install = async () => {
    if (!deferred) return;
    await deferred.prompt();
    const { outcome } = await deferred.userChoice;
    setDeferred(null);
    if (outcome === 'accepted') setInstalled(true);
  };

  const shown = STEPS[device];
  return (
    <section className="welcome-card install-card">
      <img src="/logo-mark.png" alt="" width={72} height={72} className="install-logo" onError={(e) => { e.currentTarget.style.display = 'none'; }} />
      <h1>Install Insight-IQ</h1>
      <p>Freedom Church Nairobi, ADIA Training Centre and Freedom Hope Center. It works on phones and laptops, even without internet.</p>
      {installed ? (
        <p><b>Insight-IQ is installed on this device.</b> Open it from your home screen or apps.</p>
      ) : deferred ? (
        <button type="button" className="btn btn-primary install-go" onClick={() => void install()}>Install the app</button>
      ) : null}
      <label className="field"><span>My device</span>
        <select value={device} onChange={(e) => setDevice(e.target.value as Device)}>
          <option value="android">Android phone or tablet</option>
          <option value="iphone">iPhone or iPad</option>
          <option value="laptop">Laptop or desktop</option>
        </select>
      </label>
      <h2>{shown.title}</h2>
      <ol className="install-steps">{shown.steps.map((s) => <li key={s}>{s}</li>)}</ol>
      <p className="muted small">After installing, open Insight-IQ and sign in with the email and password the church office gave you.</p>
      <p><a className="btn" href="/">Open Insight-IQ</a></p>
    </section>
  );
}
