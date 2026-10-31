import { useEffect, useState, type ReactNode } from 'react';
import { Navigate, NavLink, useLocation } from 'react-router-dom';
import { OrgSwitcher } from './OrgSwitcher';
import { SyncBadge } from './SyncBadge';
import { PageHelp } from './PageHelp';
import { InstallBanner } from './InstallBanner';
import { AdiaIntro } from './AdiaIntro';
import { usingEmulators } from '../firebase';
import { useOrg } from '../state/OrgContext';
import { useTemplates } from '../state/useFollowUps';
import { LiveClock } from './LiveClock';
import { lookFor } from '../lib/look';
import { QuickSearch } from './QuickSearch';
import { AdiaIcon } from './icons';
import { useAuth } from '../state/AuthContext';
import { PETTY_CASH_ORG_TYPES, pettyCashBase } from '../../functions/src/shared/pettyCash';
import { isDirectorProfile, isInventoryManager, LABTECH_ROLE_ID, SIGNATORY_ROLE_ID, TRAINER_ROLE_ID } from '../../functions/src/shared/permissions';
import { InventoryDueBanner } from '../pages/inventory/InventoryBanner';

/** ADIA's phone dock has eight items, so long names give way to a short one on small screens. */
function TabLabel({ full, short }: { full: string; short: string }) {
  return <><span className="tab-full">{full}</span><span className="tab-short" aria-hidden="true">{short}</span></>;
}

export function AppShell({ children }: { children: ReactNode }) {
  const location = useLocation();
  const { current } = useOrg();
  const { can, profile } = useAuth();
  // The petty cash signatories see Petty Cash and Settings only; trainers see Exam Records and Settings (Andy, 2026-10-25).
  const trainer = profile?.roleId === TRAINER_ROLE_ID;
  // A lab technician only counts their department's inventory (Andy, 2026-10-29).
  const labtech = profile?.roleId === LABTECH_ROLE_ID;
  const full = profile?.roleId !== SIGNATORY_ROLE_ID && !trainer && !labtech;
  const counter = (profile?.inventoryCourseIds?.length ?? 0) > 0;
  const inventoryTab = current?.type === 'college' && (counter || (!!profile && isInventoryManager(profile)));
  // Loaded once at the start, so a WhatsApp message opens with the pastor's words straight away, offline too.
  useTemplates();
  const look = lookFor(current);
  const adia = look === 'glass';
  // The look changes the colours of every page, so it is set on the page root.
  useEffect(() => {
    document.documentElement.dataset.look = look;
    return () => { delete document.documentElement.dataset.look; };
  }, [look]);
  // ADIA phones show 4 menu buttons and a "More" button for the rest (Andy 8A, 2026-10-30).
  const [moreOpen, setMoreOpen] = useState(false);
  useEffect(() => { setMoreOpen(false); }, [location.pathname]);
  // Freedom Church's menu has Giving and Follow-ups too (Andy, 2026-10-31, 5A), so its phones get "More" as well.
  const church = current?.type === 'church_campus';
  const phoneMore = (adia || church) && full;
  // In ADIA the install reminder shows to the Director only (Andy 9A, 2026-10-30).
  const showInstall = !adia || isDirectorProfile(profile);
  const extra = phoneMore ? ' tab-extra' : '';
  // A trainer's only pages are their marks sheets and their own settings.
  // A trainer with register classes also marks those classes' registers (Andy, 2026-10-26).
  const trainerRegister = trainer && (profile?.registerClasses?.length ?? 0) > 0;
  if (trainer && !new RegExp(`^/(school/exams|settings${trainerRegister ? '|attendance' : ''}${counter ? '|inventory' : ''})(/|$)`).test(location.pathname)) return <Navigate to="/school/exams" replace />;
  if (labtech && !/^\/(inventory|settings)(\/|$)/.test(location.pathname)) return <Navigate to="/inventory" replace />;
  const tabs = (
    <nav className={`tabbar${phoneMore ? ' has-more' : ''}${moreOpen ? ' more-open' : ''}`} aria-label="Main">
      {full && (<>
      <NavLink to="/" end className="tab">
        {adia ? <AdiaIcon name="today" /> : <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 11 12 4l9 7v9a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z" /></svg>}
        Today
      </NavLink>
      {current?.type !== 'college' && <NavLink to="/people" className="tab">
        {adia ? <AdiaIcon name="people" /> : <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M16 19a4 4 0 0 0-8 0M12 11a3 3 0 1 0 0-6 3 3 0 0 0 0 6M21 19a3 3 0 0 0-4-2.8M17 11a2.5 2.5 0 1 0 0-5M3 19a3 3 0 0 1 4-2.8M7 11a2.5 2.5 0 1 1 0-5" /></svg>}
        People
      </NavLink>}
      <NavLink to="/attendance" className="tab">
        {adia ? <AdiaIcon name="attendance" /> : <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 12l2 2 4-4M5 4h14a1 1 0 0 1 1 1v15a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1ZM8 2v4M16 2v4" /></svg>}
        {adia ? <TabLabel full="Attendance" short="Register" /> : 'Attendance'}
      </NavLink>
      {church && (can('gifts.write') || can('finance.reports') || can('giving.person.read')) && (
        <NavLink to="/giving" className="tab">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 9h18v4H3zM5 13v8h14v-8M12 9v12M12 9c-1.5-3-6-3.5-6-1s4 1 6 1Zm0 0c1.5-3 6-3.5 6-1s-4 1-6 1Z" /></svg>
          Giving
        </NavLink>
      )}
      </>)}
      {trainerRegister && current?.type === 'college' && (
        <NavLink to="/attendance" className="tab">
          <AdiaIcon name="attendance" />
          <TabLabel full="Attendance" short="Register" />
        </NavLink>
      )}
      {full && (<>
      {current?.type === 'college' ? (
        // "School" opens the school pages; Students, Programmes, Fees and the rest are in its Go to dropdown (Andy, 2026-10-26, 4A and 5A).
        <NavLink to="/school/students" className={() => `tab${/^\/school(\/|$)/.test(location.pathname) && !/^\/school\/(petty-cash|payroll|exams)/.test(location.pathname) ? ' active' : ''}`}>
          {adia ? <AdiaIcon name="programmes" /> : <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M2 9l10-5 10 5-10 5zM6 11.5V16c0 1.5 2.7 3 6 3s6-1.5 6-3v-4.5M22 9v6" /></svg>}
          School
        </NavLink>
      ) : current?.type === 'ministry' ? (
        <NavLink to="/hope" className={({ isActive }) => `tab${isActive && !location.pathname.startsWith('/hope/petty-cash') ? ' active' : ''}`}>
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 21s-7-4.4-9.3-9A5.3 5.3 0 0 1 12 6.6 5.3 5.3 0 0 1 21.3 12C19 16.600 12 21 12 21Z" /></svg>
          Hope
        </NavLink>
      ) : church ? null : (
        <NavLink to="/programs" className={({ isActive }) => `tab${isActive || /^\/(teams|groups)\//.test(location.pathname) ? ' active' : ''}`}>
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 19.5V6a2 2 0 0 1 2-2h12v13H6a2 2 0 0 0-2 2.5Zm0 0A2 2 0 0 0 6 22h12v-5M8 8h6M8 11h4" /></svg>
          Programmes
        </NavLink>
      )}
      </>)}
      {!church && current && (PETTY_CASH_ORG_TYPES as readonly string[]).includes(current.type) && (can('pettycash.request') || can('pettycash.check') || can('pettycash.approve') || can('pettycash.authorize') || can('users.manage')) && (
        <NavLink to={pettyCashBase(current.type)} className="tab">
          {adia ? <AdiaIcon name="pettyCash" /> : <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 7h18v12H3zM3 7l2-3h14l2 3M12 10v6M9.5 11.5c0-.8 1.1-1.5 2.5-1.5s2.5.7 2.5 1.5-1.1 1.2-2.5 1.5-2.5.7-2.5 1.5 1.1 1.5 2.5 1.5 2.5-.7 2.5-1.5" /></svg>}
          Petty Cash
        </NavLink>
      )}
      {phoneMore && (
        <button type="button" className={`tab tab-more${moreOpen ? ' active' : ''}`} aria-expanded={moreOpen} onClick={() => setMoreOpen((o) => !o)}>
          <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="5" cy="12" r="1.8" /><circle cx="12" cy="12" r="1.8" /><circle cx="19" cy="12" r="1.8" /></svg>
          More
        </button>
      )}
      {church && can('followups.manage') && (
        <NavLink to="/follow-ups" className={`tab${extra}`}>
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M21 12a8 8 0 0 1-11.6 7.1L4 20.5l1.4-5A8 8 0 1 1 21 12Z" /></svg>
          Follow-ups
        </NavLink>
      )}
      {church && full && (
        <NavLink to="/programs" className={({ isActive }) => `tab${extra}${isActive || /^\/(teams|groups)\//.test(location.pathname) ? ' active' : ''}`}>
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 19.5V6a2 2 0 0 1 2-2h12v13H6a2 2 0 0 0-2 2.5Zm0 0A2 2 0 0 0 6 22h12v-5M8 8h6M8 11h4" /></svg>
          Programmes
        </NavLink>
      )}
      {church && (can('pettycash.request') || can('pettycash.check') || can('pettycash.approve') || can('pettycash.authorize') || can('users.manage')) && (
        <NavLink to={pettyCashBase('church_campus')} className={`tab${extra}`}>
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 7h18v12H3zM3 7l2-3h14l2 3M12 10v6M9.5 11.5c0-.8 1.1-1.5 2.5-1.5s2.5.7 2.5 1.5-1.1 1.2-2.5 1.5-2.5.7-2.5 1.5 1.1 1.5 2.5 1.5 2.5-.7 2.5-1.5" /></svg>
          Petty Cash
        </NavLink>
      )}
      {full && current?.type === 'college' && (can('payroll.manage') || can('payroll.approve') || can('users.manage')) && (
        <NavLink to="/school/payroll" className={`tab${extra}`}>
          {adia ? <AdiaIcon name="payroll" /> : <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 3h9l4 4v14H6zM15 3v4h4M9 12h7M9 15.5h7M9 8.5h3" /></svg>}
          Payroll
        </NavLink>
      )}
      {(full || trainer) && current?.type === 'college' && (can('exams.mark') || can('exams.manage') || can('users.manage')) && (
        <NavLink to="/school/exams" className={`tab${extra}`}>
          {adia ? <AdiaIcon name="exams" /> : <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 4h14v17H5zM9 4V2.5h6V4M8.5 10l1.5 1.5 3-3M8.5 16l1.5 1.5 3-3M15 10.5h1.5M15 16.5h1.5" /></svg>}
          {adia ? <TabLabel full="Exam Records" short="Exams" /> : 'Exam Records'}
        </NavLink>
      )}
      {inventoryTab && (
        <NavLink to="/inventory" className={`tab${extra}`}>
          {adia ? <AdiaIcon name="inventory" /> : <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 7l9-4 9 4v10l-9 4-9-4zM3 7l9 4 9-4M12 11v10" /></svg>}
          Inventory
        </NavLink>
      )}
      <NavLink to="/settings" className={`tab${extra}`}>
        {adia ? <AdiaIcon name="settings" /> : <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8Zm8.9 5.2-1.9-.4a7 7 0 0 1-.7 1.7l1.1 1.6-1.6 1.6-1.6-1.1a7 7 0 0 1-1.7.7l-.4 1.9h-2.2l-.4-1.9a7 7 0 0 1-1.7-.7l-1.6 1.1-1.6-1.6 1.1-1.6a7 7 0 0 1-.7-1.7l-1.9-.4v-2.2l1.9-.4a7 7 0 0 1 .7-1.7L5.6 6.5l1.6-1.6 1.6 1.1a7 7 0 0 1 1.7-.7l.4-1.9h2.2l.4 1.9a7 7 0 0 1 1.7.7l1.6-1.1 1.6 1.6-1.1 1.6a7 7 0 0 1 .7 1.7l1.9.4z" /></svg>}
        Settings
      </NavLink>
    </nav>
  );
  const notices = (
    <>
      {usingEmulators && <div className="dev-ribbon">Local test server. Nothing here is live data.</div>}
      {current?.training && <div className="dev-ribbon" role="status">Practice mode. Everything here is made up and is never mixed with real records.</div>}
      {showInstall && <InstallBanner />}
      {current?.type === 'college' && (counter || (!!profile && isInventoryManager(profile))) && <InventoryDueBanner />}
    </>
  );
  // ADIA Training Centre, Freedom Church and Freedom Hope Center: the menu down a side panel on wide screens (a bottom dock on phones).
  if (look === 'glass' || look === 'cockpit' || look === 'aurora') {
    return (
      <div className={`shell look-${look} side-look lite-look`}>
        <AdiaIntro orgId={current?.id} orgType={current?.type} />
        <aside className="adia-side">
          <NavLink to="/" className="brand" aria-label="Insight-IQ, Today">
            <img className="brand-logo" src="/logo-mark.png" alt="" width={56} height={56} />
            <span className="brand-name">Insight-IQ{adia && <small className="brand-sub">Freedom ChMS</small>}</span>
          </NavLink>
          <OrgSwitcher />
          {tabs}
          {adia && showInstall && <InstallBanner variant="side" />}
        </aside>
        <div className={`adia-body${/^\/((school|hope)\/)?petty-cash|^\/school\/payroll/.test(location.pathname) ? ' petty-light' : ''}`}>
          <header className="adia-head">
            {can('people.read') && !trainer && <QuickSearch className="adia-search" />}
            {look === 'cockpit' && current && <LiveClock timeZone={current.timeZone} />}
            <PageHelp college={adia} />
            <SyncBadge />
            {look === 'glass' ? <img className="org-mark" src="/org/adia-crest.png" alt="ADIA Training Centre crest" width={96} height={96} />
              : look === 'cockpit' ? <img className="org-mark org-mark-church" src="/org/freedom-church-logo.png" alt="Freedom Church" width={64} height={90} />
              : <img className="org-mark org-mark-hope" src="/org/hope-centre-logo.png" alt="Freedom Hope Center, OneChild" width={73} height={90} />}
          </header>
          {notices}
          <main className="main">{children}</main>
        </div>
      </div>
    );
  }
  return (
    <div className={`shell look-${look}`}>
      <header className="topbar">
        <NavLink to="/" className="brand" aria-label="Insight-IQ, Today">
          <img className="brand-logo" src="/logo-mark.png" alt="" width={30} height={30} />
          <span className="brand-name">Insight-IQ</span>
        </NavLink>
        <OrgSwitcher />
        <SyncBadge />
      </header>
      {notices}
      <main className="main">{children}</main>
      {tabs}
    </div>
  );
}
