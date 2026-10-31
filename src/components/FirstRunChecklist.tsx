import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { collection, getCountFromServer } from 'firebase/firestore';
import { db } from '../firebase';
import { useAuth } from '../state/AuthContext';
import { useOrg } from '../state/OrgContext';
import { readPref, writePref } from '../lib/storage';

function isInstalled(): boolean {
  return window.matchMedia('(display-mode: standalone)').matches || (navigator as { standalone?: boolean }).standalone === true;
}

/** Shown to the pastor until the basics are in place. "scene" is the card laid over ADIA's welcome picture. */
export function FirstRunChecklist({ variant }: { variant?: 'scene' } = {}) {
  const { can } = useAuth();
  const { organizations } = useOrg();
  const [staffCount, setStaffCount] = useState<number | null>(null);
  const [hidden, setHidden] = useState(() => readPref('firstRunDone') === 'yes');
  const isPastor = can('users.manage');

  useEffect(() => {
    if (!isPastor || hidden) return;
    getCountFromServer(collection(db, 'users')).then((c) => setStaffCount(c.data().count), () => setStaffCount(null));
  }, [isPastor, hidden]);

  if (!isPastor || hidden) return null;

  const steps = [
    { done: organizations.length > 0, label: 'Add your organizations', to: '/settings/organizations' },
    { done: (staffCount ?? 0) > 1, label: 'Add staff accounts', to: '/settings/users' },
    { done: isInstalled(), label: 'Install the app on this device', to: '/settings/device' },
  ];
  if (steps.every((s) => s.done)) return null;
  const hide = () => { writePref('firstRunDone', 'yes'); setHidden(true); };

  if (variant === 'scene') {
    const done = steps.filter((s) => s.done).length;
    return (
      <>
        <span className="lav-tag"><span className="lav-chk" aria-hidden="true"><Tick /></span>{done} of {steps.length} done</span>
        <section className="lav-steps" aria-labelledby="first-run">
          <div className="lav-steps-row"><b id="first-run">Getting started</b><button type="button" className="lav-hide" onClick={hide}>Hide</button></div>
          <div className="lav-prog"><i style={{ width: `${(done / steps.length) * 100}%` }} /></div>
          <ul>
            {steps.map((s) => (
              <li key={s.label}>
                <span className={`lav-chk${s.done ? '' : ' off'}`} aria-hidden="true">{s.done && <Tick />}</span>
                {s.done ? <span>{s.label}</span> : <Link to={s.to}>{s.label}</Link>}
              </li>
            ))}
          </ul>
        </section>
      </>
    );
  }

  return (
    <section className="card checklist" aria-labelledby="first-run">
      <div className="card-head">
        <h2 id="first-run">Getting started</h2>
        <button type="button" className="btn btn-quiet" onClick={hide}>Hide</button>
      </div>
      <ol>
        {steps.map((s) => (
          <li key={s.label} className={s.done ? 'done' : ''}>
            <span className="tick" aria-hidden="true">{s.done ? '✓' : ''}</span>
            {s.done ? <span>{s.label}</span> : <Link to={s.to}>{s.label}</Link>}
          </li>
        ))}
      </ol>
    </section>
  );
}

function Tick() {
  return <svg viewBox="0 0 24 24" width="11" height="11" fill="none" stroke="#fff" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round"><path d="m5 12 5 5 9-10" /></svg>;
}
