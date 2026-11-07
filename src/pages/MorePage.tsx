import { Link } from 'react-router-dom';
import { useAuth } from '../state/AuthContext';
import { useOrg } from '../state/OrgContext';
import { FINANCE_ROLE_ID, USHER_ROLE_ID } from '../../functions/src/shared/permissions';
import { pettyCashBase } from '../../functions/src/shared/pettyCash';

/**
 * Freedom Church's "More" (Andy, 2026-11-01, 1A): the places used now and then, so the menu keeps five buttons.
 */
export function MorePage() {
  const { can, profile } = useAuth();
  const { current } = useOrg();
  const petty = (can('pettycash.request') || can('pettycash.check') || can('pettycash.approve') || can('pettycash.authorize') || can('users.manage'))
    && profile?.roleId !== FINANCE_ROLE_ID;
  const items = [
    { show: can('people.read') && profile?.roleId !== USHER_ROLE_ID, to: '/reports', label: 'Reports', detail: 'The scorecard, weekly, monthly and giving reports' },
    { show: current?.type === 'church_campus', to: '/updates', label: 'Photos and wins', detail: 'Testimonies, events, pastoral care and incidents, as conversations' },
    { show: current?.type === 'church_campus', to: '/conversations', label: 'Private conversations', detail: 'Worries about a member, read only by Andy, Doreen and the leaders' },
    { show: petty, to: pettyCashBase(current?.type ?? 'church_campus'), label: 'Petty Cash', detail: 'Requests, signatures, receipts and month-end' },
    { show: true, to: '/settings', label: 'Settings', detail: 'Staff accounts, messages, this device and sign out' },
    { show: true, to: '/help', label: 'Help', detail: 'How to do the everyday jobs' },
  ];
  return (
    <div className="page narrow">
      <h1>More</h1>
      <ul className="link-list">
        {items.filter((i) => i.show).map((i) => (
          <li key={i.to}>
            <Link to={i.to}>
              <span className="link-title">{i.label}</span>
              <span className="link-detail">{i.detail}</span>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
