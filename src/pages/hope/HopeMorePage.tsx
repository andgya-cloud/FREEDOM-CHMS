import { Link } from 'react-router-dom';
import { useAuth } from '../../state/AuthContext';
import { pettyCashBase } from '../../../functions/src/shared/pettyCash';
import { canReadNotes } from '../../../functions/src/shared/hopeRecords';
import { HELPER_ROLE_ID } from '../../../functions/src/shared/permissions';
import { HopeGate } from './common';
import type { Organization } from '../../state/OrgContext';

export function HopeMorePage() {
  return <HopeGate title="More">{(org) => <More org={org} />}</HopeGate>;
}

/** More (Andy, 2026-11-05, v173 9A): the pages used now and then, out of the main menu. */
function More({ org }: { org: Organization }) {
  const { can, profile } = useAuth();
  const helper = profile?.roleId === HELPER_ROLE_ID;
  const petty = !helper && (can('pettycash.request') || can('pettycash.check') || can('pettycash.approve') || can('pettycash.authorize') || can('users.manage'));
  const tiles: [string, string, string, string, boolean][] = [
    [pettyCashBase('ministry'), '💵', 'Petty Cash', 'Ask for cash, sign and close the month', petty],
    ['/hope/meals', '🍽️', 'Meals', 'Breakfast, lunch and fruit served each day', !helper],
    ['/hope/bin', '🗑', 'Bin', 'What was removed, to put back', canReadNotes(profile, org.id)],
    ['/settings', '⚙️', 'Settings', 'Your account, password and the Hope Centre settings', true],
    ['/help', '❓', 'Help', 'How each page works', true],
  ];
  return (
    <div className="page narrow">
      <h1>More</h1>
      <div className="rp-tiles">
        {tiles.filter((t) => t[4]).map(([to, ico, title, sub]) => (
          <Link key={to} to={to} className="card rp-tile"><span className="rp-ico" aria-hidden="true">{ico}</span><b>{title}</b><span className="small muted">{sub}</span></Link>
        ))}
      </div>
    </div>
  );
}
