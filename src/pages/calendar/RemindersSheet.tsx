import { useEffect, useState } from 'react';
import { httpsCallable } from 'firebase/functions';
import { functions } from '../../firebase';
import { useAuth } from '../../state/AuthContext';
import { useToast } from '../../state/ToastContext';
import type { Organization } from '../../state/OrgContext';
import { useEmailReminders } from '../../state/useCalendar';
import { disablePush, enablePush, pushState, type PushState } from '../../lib/push';
import { setEmailReminders } from '../../lib/calendarWrites';
import { friendlyError } from '../../lib/errors';

const WORDS: Record<PushState, string> = {
  on: 'On. Reminders pop up on this device.',
  off: 'Off on this device.',
  blocked: 'Blocked. This browser was told not to show pop-ups from Insight-IQ. Allow notifications for this site in the browser settings, then come back.',
  unsupported: 'This browser cannot show pop-ups. Use Chrome, Edge or Firefox, or the app on your phone.',
  'iphone-install': 'On iPhone and iPad, first add Insight-IQ to your Home Screen (Share, then Add to Home Screen), open it from there, and turn pop-ups on.',
};

/** Where my reminders reach me (4A): pop-ups on this phone or computer, and email. Each person sets their own. */
export function RemindersSheet({ org, onClose }: { org: Organization | undefined; onClose: () => void }) {
  const { profile } = useAuth();
  const toast = useToast();
  const uid = profile?.uid ?? '';
  const emailOn = useEmailReminders(uid);
  const [state, setState] = useState<PushState | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => { if (uid) void pushState(uid).then(setState); }, [uid]);

  async function turnOn() {
    setBusy(true);
    try {
      const s = await enablePush(uid);
      setState(s);
      if (s === 'on') toast.show('Pop-ups are on for this device.');
    } catch (err) {
      toast.show(`Pop-ups could not be turned on: ${friendlyError(err)}`);
    } finally { setBusy(false); }
  }
  async function turnOff() {
    setBusy(true);
    await disablePush();
    setState('off');
    setBusy(false);
  }
  async function test() {
    if (!org) return;
    setBusy(true);
    try {
      const r = await httpsCallable<{ orgId: string }, { devices: number; emails: number; deviceCount: number; email: string }>(functions, 'calendarTest')({ orgId: org.id });
      const d = r.data;
      const parts = [d.devices > 0 ? `a pop-up to ${d.devices === 1 ? 'this device' : `${d.devices} devices`}` : '', d.emails > 0 ? `an email to ${d.email}` : ''].filter(Boolean);
      toast.show(parts.length ? `Sent ${parts.join(' and ')}.` : 'Nothing could be sent. Turn pop-ups on, or check your email address.');
    } catch (err) {
      toast.show(friendlyError(err));
    } finally { setBusy(false); }
  }

  return (
    <div className="sheet-backdrop" role="presentation" onClick={onClose}>
      <div className="sheet cal-solid" role="dialog" aria-modal="true" aria-labelledby="cal-bell-h" onClick={(x) => x.stopPropagation()}>
        <h2 id="cal-bell-h">🔔 My reminders</h2>
        <section className="stack">
          <h3>Pop-ups on this phone or computer</h3>
          <p className="small">{state ? WORDS[state] : 'Checking…'}</p>
          {state === 'off' && <button type="button" className="btn btn-primary align-start" disabled={busy} onClick={() => void turnOn()}>Turn pop-ups on here</button>}
          {state === 'on' && <button type="button" className="btn btn-quiet align-start" disabled={busy} onClick={() => void turnOff()}>Turn pop-ups off here</button>}
          <p className="small muted">Do this once on each phone and computer you use.</p>
        </section>
        <section className="stack">
          <h3>Email</h3>
          <label className="check">
            <input type="checkbox" checked={emailOn} onChange={(x) => { setEmailReminders(uid, x.target.checked).catch((err) => toast.show(friendlyError(err))); }} />
            Also email my reminders to {profile?.email || 'my email address'}
          </label>
        </section>
        <div className="sheet-actions btn-line">
          <button type="button" className="btn btn-quiet" disabled={busy || !org} onClick={() => void test()}>Send me a test reminder</button>
          <button type="button" className="btn btn-primary" onClick={onClose}>Done</button>
        </div>
      </div>
    </div>
  );
}
