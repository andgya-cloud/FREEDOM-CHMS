import { Link } from 'react-router-dom';
import { useAuth } from '../../state/AuthContext';
import { canKeepAccounts } from '../../../functions/src/shared/permissions';
import { HopeGate } from './common';
import { HOPE_PHONE, HOPE_PHONE_E164 } from '../../../functions/src/shared/hopeMessages';
import type { Organization } from '../../state/OrgContext';

export function HopeMorePage() {
  return <HopeGate title="More">{(org) => <More org={org} />}</HopeGate>;
}

/** More (Andy, 2026-11-05, v173 9A): the pages used now and then, out of the main menu. */
function More(_: { org: Organization }) {
  const { can, profile } = useAuth();
  const tiles: [string, string, string, string, boolean][] = [
    ['/hope/messages', '💬', 'WhatsApp parents', 'One message to many parents, from the Hope phone', can('people.write')],
    ['/hope/bin', '🗑', 'Bin', 'What was removed, to put back', canKeepAccounts(profile)],
    ['/manual', '📖', 'User manual', 'How to do each job, step by step, with pictures', true],
    ['/settings', '⚙️', 'Settings', 'Your account, password and the Hope Centre settings', true],
  ];
  return (
    <div className="page narrow">
      <h1>More</h1>
      <section className="card hope-phone">
        <span aria-hidden="true">📱</span>
        <span className="grow"><b>Hope Centre phone</b><span className="small muted">{HOPE_PHONE} · WhatsApp and calls</span></span>
        <a className="btn btn-quiet btn-small" href={`tel:${HOPE_PHONE_E164}`}>📞 Call</a>
        <a className="btn btn-quiet btn-small" href={`https://wa.me/${HOPE_PHONE_E164.slice(1)}`} target="_blank" rel="noopener noreferrer">🟢 WhatsApp</a>
      </section>
      <div className="rp-tiles">
        {tiles.filter((t) => t[4]).map(([to, ico, title, sub]) => (
          <Link key={to} to={to} className="card rp-tile"><span className="rp-ico" aria-hidden="true">{ico}</span><b>{title}</b><span className="small muted">{sub}</span></Link>
        ))}
      </div>
    </div>
  );
}
