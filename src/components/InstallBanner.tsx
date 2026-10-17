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
export function InstallBanner() {
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

  return (
    <div className="install-banner">
      {deferred ? (
        <>
          <span>Install Freedom ChMS on this device so it opens without internet.</span>
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
