import { Link } from 'react-router-dom';
import { useAuth } from '../../state/AuthContext';
import type { Organization } from '../../state/OrgContext';
import { TRAINER_ROLE_ID } from '../../../functions/src/shared/permissions';
import { usePettyCashAccess } from '../../state/usePettyCash';
import { usePayrollAccess } from '../../state/usePayroll';
import { useInventoryAccess } from '../../state/useInventory';
import { AdiaWelcome } from '../../components/AdiaWelcome';
import { AdiaIcon, type AdiaIconName } from '../../components/icons';
import { PoweredBy } from '../../components/PoweredBy';

/**
 * Today for ADIA staff who don't read the student records: trainers, lab technicians and signatories (Andy,
 * 2026-11-11: "every one sees the welcome card"). The same welcome card as everyone else, then their own jobs.
 */
export function AdiaStaffToday({ org }: { org: Organization }) {
  const { can, profile } = useAuth();
  const petty = usePettyCashAccess();
  const payroll = usePayrollAccess();
  const inventory = useInventoryAccess();
  const trainer = profile?.roleId === TRAINER_ROLE_ID;
  const register = (trainer && (profile?.registerClasses?.length ?? 0) > 0) || can('attendance.write');
  const jobs: { to: string; icon: AdiaIconName; label: string; sub: string; show: boolean }[] = [
    { to: '/attendance', icon: 'register', label: 'Mark register', sub: 'Who came to class today', show: register },
    { to: '/school/exams', icon: 'exams', label: 'Enter marks', sub: 'CATs, finals and results', show: can('exams.mark') || can('exams.manage') },
    { to: '/tutor-files', icon: 'files', label: 'Tutor Files', sub: 'Schemes, lesson plans and records', show: trainer },
    { to: '/inventory', icon: 'inventory', label: 'Inventory', sub: 'Count your department’s items', show: inventory.counts },
    { to: '/school/petty-cash/new', icon: 'pettyCash', label: 'New requisition', sub: 'Ask for petty cash', show: petty.canRequest },
    { to: '/school/petty-cash', icon: 'pettyCash', label: 'Sign requisitions', sub: 'Approve what is waiting', show: petty.canSign },
    { to: '/school/payroll', icon: 'payroll', label: 'Payroll', sub: 'This month’s pay', show: payroll.any },
  ];
  const mine = jobs.filter((j) => j.show);
  return (
    <div className="page lav-today">
      <AdiaWelcome org={org} summary={mine.length ? 'Welcome! Your work is below. Tap what you came to do.' : 'Welcome! Ask Mr Andrew if you need anything here.'} />
      {mine.length > 0 && (
        <section className="lav-jobs" aria-label="What do you want to do?">
          <h2>What do you want to do?</h2>
          <div className="lav-jobs-grid">
            {mine.map((j, i) => (
              <Link key={j.to} to={j.to} className="card lav-job">
                <span className={`lav-ico i${(i % 4) + 1}`}><AdiaIcon name={j.icon} /></span>
                <b>{j.label}</b>
                <span className="lav-sub">{j.sub}</span>
              </Link>
            ))}
          </div>
        </section>
      )}
      <PoweredBy />
    </div>
  );
}
