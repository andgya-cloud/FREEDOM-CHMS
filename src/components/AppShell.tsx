import type { ReactNode } from 'react';
import { NavLink } from 'react-router-dom';
import { OrgSwitcher } from './OrgSwitcher';
import { SyncBadge } from './SyncBadge';
import { InstallBanner } from './InstallBanner';
import { usingEmulators } from '../firebase';

export function AppShell({ children }: { children: ReactNode }) {
  return (
    <div className="shell">
      <header className="topbar">
        <NavLink to="/" className="brand" aria-label="Freedom ChMS, Today">
          <img src="/favicon.svg" alt="" width={28} height={28} />
          <span className="brand-name">Freedom ChMS</span>
        </NavLink>
        <OrgSwitcher />
        <SyncBadge />
      </header>
      {usingEmulators && <div className="dev-ribbon">Local test server. Nothing here is live data.</div>}
      <InstallBanner />
      <main className="main">{children}</main>
      <nav className="tabbar" aria-label="Main">
        <NavLink to="/" end className="tab">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 11 12 4l9 7v9a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z" /></svg>
          Today
        </NavLink>
        <NavLink to="/people" className="tab">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M16 19a4 4 0 0 0-8 0M12 11a3 3 0 1 0 0-6 3 3 0 0 0 0 6M21 19a3 3 0 0 0-4-2.8M17 11a2.5 2.5 0 1 0 0-5M3 19a3 3 0 0 1 4-2.8M7 11a2.5 2.5 0 1 1 0-5" /></svg>
          People
        </NavLink>
        <NavLink to="/attendance" className="tab">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 12l2 2 4-4M5 4h14a1 1 0 0 1 1 1v15a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1ZM8 2v4M16 2v4" /></svg>
          Attendance
        </NavLink>
        <NavLink to="/settings" className="tab">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8Zm8.9 5.2-1.9-.4a7 7 0 0 1-.7 1.7l1.1 1.6-1.6 1.6-1.6-1.1a7 7 0 0 1-1.7.7l-.4 1.9h-2.2l-.4-1.9a7 7 0 0 1-1.7-.7l-1.6 1.1-1.6-1.6 1.1-1.6a7 7 0 0 1-.7-1.7l-1.9-.4v-2.2l1.9-.4a7 7 0 0 1 .7-1.7L5.6 6.5l1.6-1.6 1.6 1.1a7 7 0 0 1 1.7-.7l.4-1.9h2.2l.4 1.9a7 7 0 0 1 1.7.7l1.6-1.1 1.6 1.6-1.1 1.6a7 7 0 0 1 .7 1.7l1.9.4z" /></svg>
          Settings
        </NavLink>
      </nav>
    </div>
  );
}
