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

/** Shown to the pastor until the basics are in place. */
export function FirstRunChecklist() {
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

  return (
    <section className="card checklist" aria-labelledby="first-run">
      <div className="card-head">
        <h2 id="first-run">Getting started</h2>
        <button type="button" className="btn btn-quiet" onClick={() => { writePref('firstRunDone', 'yes'); setHidden(true); }}>Hide</button>
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
