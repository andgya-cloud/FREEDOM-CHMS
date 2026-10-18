import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../state/AuthContext';
import type { Permission } from '../../functions/src/shared/permissions';

interface Topic { id: string; title: string; permission?: Permission; body: string[]; link?: { to: string; label: string } }

const TOPICS: Topic[] = [
  {
    id: 'visitor', title: 'Welcome a new visitor',
    body: ['On Today, tap Add a visitor. Enter their name and phone number, and tick the box only if they agreed to get WhatsApp messages.',
      'Saving creates their welcome follow-up for you. If you are offline, it saves on this phone and sends when the signal returns.'],
    link: { to: '/visitors/new', label: 'Add a visitor' },
  },
  {
    id: 'attendance', title: 'Take attendance on Sunday',
    permission: 'attendance.write',
    body: ['Open Attendance and start today\'s service. Search a name and tap to check them in, or use Door mode on a tablet at the entrance.',
      'Before you leave, fill in the headcount (adults, teens, children). The weekly report uses it.'],
    link: { to: '/attendance', label: 'Open Attendance' },
  },
  {
    id: 'followups', title: 'Do today\'s follow-ups',
    permission: 'followups.manage',
    body: ['Follow-ups lists who needs a call or message today. Tap one, then WhatsApp opens with the words already written. Press send in WhatsApp, then mark it done.',
      'If someone asks you to stop messaging them, tap Stop messages on their page. They will not be messaged again.'],
    link: { to: '/follow-ups', label: 'Open Follow-ups' },
  },
  {
    id: 'giving', title: 'Record a gift and send a receipt',
    permission: 'gifts.write',
    body: ['Giving → Record a gift. Choose the person, the fund and how they gave. For M-Pesa, enter the code from the message. A code can only be recorded once.',
      'Tap the gift to make the receipt. On a phone, it opens the share sheet so you can send it on WhatsApp.',
      'Gifts from the Paybill statement: Giving → Import, then match anything left under Unassigned.'],
    link: { to: '/giving', label: 'Open Giving' },
  },
  {
    id: 'reports', title: 'Read the weekly report',
    permission: 'people.read',
    body: ['Every Monday at 7 am a report is made for the week before. Today shows the eight numbers, and Reports keeps the full report as PDF or Excel.',
      'Tap any number to see the people behind it.'],
    link: { to: '/reports', label: 'Open Reports' },
  },
  {
    id: 'offline', title: 'Working with no internet',
    body: ['The app opens and works offline. Anything you save is kept on this phone and sent when you are back online. The small badge at the top shows how many changes are waiting.',
      'Install the app from your browser menu (Add to Home Screen) so it opens like any other app.'],
    link: { to: '/settings/device', label: 'This device' },
  },
  {
    id: 'private', title: 'Who can see what',
    body: ['Pastoral notes, prayer requests, who was saved or baptised, and each person\'s giving are visible only to the pastor and to staff the pastor has given that access. Admins cannot open them, even by typing the address.',
      'Everything anyone creates, changes, deletes or exports is written to the audit log.'],
  },
  {
    id: 'shared', title: 'Using a shared phone or computer',
    body: ['Tick "This is a shared device" at sign-in. The app then signs you out by itself after a few minutes of no use.',
      'Always sign out when you finish: Settings → Sign out.'],
  },
  {
    id: 'undelete', title: 'I deleted something by mistake',
    body: ['Tap Undo on the message that appears at the bottom right after you delete. If it has gone, tell the pastor straight away: deleted records are kept for a while (30 days unless changed) before they are removed for good.'],
  },
  {
    id: 'backup', title: 'Backups and downloading your data',
    permission: 'data.export',
    body: ['A full backup is saved every Sunday at 11 pm and the last 12 are kept. Data and backups also lets you download everything, or one person\'s data, or erase a person who asks. Each one is logged.'],
    link: { to: '/settings/data', label: 'Data and backups' },
  },
  {
    id: 'practice', title: 'Learning with practice data',
    permission: 'data.export',
    body: ['Practice mode is a separate Practice Church with made-up people. Use it to train new staff. It never mixes with real records or reports.'],
    link: { to: '/settings/data', label: 'Set up practice mode' },
  },
  {
    id: 'password', title: 'Forgot my password',
    body: ['On the sign-in page, ask the pastor to reset it. They will give you a temporary password, and the app asks you to choose your own the first time you sign in.'],
  },
];

/** A plain-words guide for the everyday jobs. Topics follow what the signed-in person can do. */
export function HelpPage() {
  const { can } = useAuth();
  const [q, setQ] = useState('');
  const shown = useMemo(() => {
    const text = q.trim().toLowerCase();
    return TOPICS.filter((t) => !t.permission || can(t.permission))
      .filter((t) => !text || `${t.title} ${t.body.join(' ')}`.toLowerCase().includes(text));
  }, [q, can]);

  return (
    <div className="page narrow">
      <div className="page-head"><h1>Help</h1></div>
      <label className="field"><span>Search the help</span><input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="For example: receipt, offline, visitor" /></label>
      {shown.length === 0 ? <div className="card"><p>Nothing matches. Ask the pastor, or try another word.</p></div> : (
        <div className="stack">
          {shown.map((t) => (
            <details key={t.id} className="card help-topic">
              <summary><strong>{t.title}</strong></summary>
              {t.body.map((p) => <p key={p}>{p}</p>)}
              {t.link && <p><Link to={t.link.to} className="btn btn-quiet">{t.link.label}</Link></p>}
            </details>
          ))}
        </div>
      )}
    </div>
  );
}
