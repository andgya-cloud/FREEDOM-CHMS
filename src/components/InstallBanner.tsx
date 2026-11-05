import { useEffect, useState } from 'react';
import { readPref, writePref } from '../lib/storage';

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

function isStandalone(): boolean {
  return window.matchMedia('(display-mode: standalone)').matches || (navigator as { standalone?: boolean }).standalone === true;
}

function isIos(): boolean {
  return /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
}

/**
 * Asks staff to install the app. On iPhone and iPad this matters: Safari can
 * clear offline data for sites not added to the Home Screen.
 */
export function InstallBanner({ variant }: { variant?: 'side' } = {}) {
  const [deferred, setDeferred] = useState<BeforeInstallPromptEvent | null>(null);
  const [hidden, setHidden] = useState(() => isStandalone() || readPref('installDismissed') === 'yes');

  useEffect(() => {
    const onPrompt = (e: Event) => {
      e.preventDefault();
      setDeferred(e as BeforeInstallPromptEvent);
    };
    window.addEventListener('beforeinstallprompt', onPrompt);
    window.addEventListener('appinstalled', () => setHidden(true));
    return () => window.removeEventListener('beforeinstallprompt', onPrompt);
  }, []);

  if (hidden || (!deferred && !isIos())) return null;

  const dismiss = () => {
    writePref('installDismissed', 'yes');
    setHidden(true);
  };

  // In ADIA's side menu it is a small card at the bottom (Andy's design, 2026-10-26).
  if (variant === 'side') {
    return (
      <div className="side-promo">
        <b>Install Insight-IQ</b>
        <span>{deferred ? 'Work offline on phones, tablets and laptops.' : 'Tap Share, then “Add to Home Screen”, to keep offline work safe.'}</span>
        <span className="side-promo-actions">
          {deferred && <button type="button" onClick={async () => { await deferred.prompt(); await deferred.userChoice; setDeferred(null); }}>Install app</button>}
          <button type="button" onClick={dismiss}>Not now</button>
        </span>
      </div>
    );
  }

  return (
    <div className="install-banner">
      {deferred ? (
        <>
          <span>Install Insight-IQ on this device so it opens without internet.</span>
          <button type="button" className="btn btn-gold" onClick={async () => {
            await deferred.prompt();
            await deferred.userChoice;
            setDeferred(null);
          }}>Install</button>
        </>
      ) : (
        <span>
          <strong>Add to Home Screen:</strong> tap the Share button, then “Add to Home Screen”.
          On iPhone and iPad this keeps your offline work safe.
        </span>
      )}
      <button type="button" className="btn btn-quiet" onClick={dismiss} aria-label="Hide this message">Not now</button>
    </div>
  );
}
