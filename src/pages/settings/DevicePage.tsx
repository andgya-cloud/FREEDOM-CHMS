import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useSyncState } from '../../lib/sync';
import { isSharedDevice } from '../../lib/useIdleSignOut';
import { writePref } from '../../lib/storage';
import { getTheme, setTheme, type ThemeChoice } from '../../lib/theme';
import { useAppSettings } from '../../state/useAppSettings';
import { formatDateTime } from '../../../functions/src/shared/datetime';

export function DevicePage() {
  const { online, pending, lastSyncedAt } = useSyncState();
  const settings = useAppSettings();
  const [shared, setShared] = useState(isSharedDevice);
  const [theme, setThemeState] = useState<ThemeChoice>(getTheme);
  const [persisted, setPersisted] = useState<boolean | null>(null);

  useEffect(() => {
    navigator.storage?.persisted?.().then(setPersisted, () => setPersisted(null));
  }, []);

  const installed = window.matchMedia('(display-mode: standalone)').matches || (navigator as { standalone?: boolean }).standalone === true;

  return (
    <div className="page narrow">
      <p><Link to="/settings">← Settings</Link></p>
      <h1>This device</h1>

      <section className="card">
        <h2>Sync</h2>
        <p>{online ? 'Online.' : 'Offline. Your work is saved on this device and will sync when the connection returns.'}</p>
        <p>{pending > 0 ? 'Some changes are still waiting to sync.' : 'Everything on this device has synced.'}</p>
        {lastSyncedAt && <p className="muted small">Last synced {formatDateTime(lastSyncedAt)}</p>}
      </section>

      <section className="card">
        <h2>Install and storage</h2>
        <p>{installed ? 'The app is installed on this device.' : 'Not installed yet. Use your browser’s Install or Add to Home Screen option.'}</p>
        <p>
          {persisted === true && 'Offline data is protected on this device.'}
          {persisted === false && 'The browser may clear offline data if the device runs low on space. Install the app and sync often.'}
          {persisted === null && 'This browser does not say whether offline data is protected. On iPhone and iPad, add the app to the Home Screen.'}
        </p>
        {persisted === false && navigator.storage?.persist && (
          <button type="button" className="btn" onClick={() => navigator.storage.persist().then(setPersisted)}>Protect offline data</button>
        )}
      </section>

      <section className="card">
        <h2>Shared device</h2>
        <label className="check">
          <input type="checkbox" checked={shared} onChange={(e) => { setShared(e.target.checked); writePref('sharedDevice', e.target.checked ? 'true' : 'false'); }} />
          <span>Sign out after {settings.inactivityMinutes} minutes without use</span>
        </label>
      </section>

      <section className="card">
        <h2>Theme</h2>
        <div className="segmented" role="group" aria-label="Theme">
          {(['system', 'light', 'dark'] as const).map((t) => (
            <button key={t} type="button" className={theme === t ? 'on' : ''} onClick={() => { setTheme(t); setThemeState(t); }}>
              {t === 'system' ? 'Match device' : t === 'light' ? 'Light' : 'Dark'}
            </button>
          ))}
        </div>
      </section>
    </div>
  );
}
