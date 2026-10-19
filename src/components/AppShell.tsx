import { useEffect, type ReactNode } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import { OrgSwitcher } from './OrgSwitcher';
import { SyncBadge } from './SyncBadge';
import { InstallBanner } from './InstallBanner';
import { usingEmulators } from '../firebase';
import { useOrg } from '../state/OrgContext';
import { useTemplates } from '../state/useFollowUps';
import { LiveClock } from './LiveClock';
import { lookFor } from '../lib/look';

export function AppShell({ children }: { children: ReactNode }) {
  const location = useLocation();
  const { current } = useOrg();
  // Loaded once at the start, so a WhatsApp message opens with the pastor's words straight away, offline too.
  useTemplates();
  const look = lookFor(current);
  // The look changes the colours of every page, so it is set on the page root.
  useEffect(() => {
    document.documentElement.dataset.look = look;
    return () => { delete document.documentElement.dataset.look; };
  }, [look]);
  return (
    <div className={`shell look-${look}`}>
      <header className="topbar">
        <NavLink to="/" className="brand" aria-label="Insight-IQ, Today">
          <img className="brand-logo" src="/logo-mark.png" alt="" width={30} height={30} />
          <span className="brand-name">Insight-IQ</span>
        </NavLink>
        <OrgSwitcher />
        {look === 'cockpit' && current && <LiveClock timeZone={current.timeZone} />}
        <SyncBadge />
        {look === 'glass' && <img className="adia-crest" src="/org/adia-crest.png" alt="ADIA Training Centre crest" width={48} height={48} />}
      </header>
      {usingEmulators && <div className="dev-ribbon">Local test server. Nothing here is live data.</div>}
      {current?.training && <div className="dev-ribbon" role="status">Practice mode. Everything here is made up and is never mixed with real records.</div>}
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
        {current?.type === 'college' ? (
          <NavLink to="/school" className="tab">
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M2 9l10-5 10 5-10 5zM6 11.5V16c0 1.5 2.7 3 6 3s6-1.5 6-3v-4.5M22 9v6" /></svg>
            {look === 'glass' ? 'Programmes' : 'School'}
          </NavLink>
        ) : current?.type === 'ministry' ? (
          <NavLink to="/hope" className="tab">
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 21s-7-4.4-9.3-9A5.3 5.3 0 0 1 12 6.6 5.3 5.3 0 0 1 21.3 12C19 16.600 12 21 12 21Z" /></svg>
            Hope
          </NavLink>
        ) : (
          <NavLink to="/programs" className={({ isActive }) => `tab${isActive || /^\/(teams|groups)\//.test(location.pathname) ? ' active' : ''}`}>
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 19.5V6a2 2 0 0 1 2-2h12v13H6a2 2 0 0 0-2 2.5Zm0 0A2 2 0 0 0 6 22h12v-5M8 8h6M8 11h4" /></svg>
            Programmes
          </NavLink>
        )}
        <NavLink to="/settings" className="tab">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8Zm8.9 5.2-1.9-.4a7 7 0 0 1-.7 1.7l1.1 1.6-1.6 1.6-1.6-1.1a7 7 0 0 1-1.7.7l-.4 1.9h-2.2l-.4-1.9a7 7 0 0 1-1.7-.7l-1.6 1.1-1.6-1.6 1.1-1.6a7 7 0 0 1-.7-1.7l-1.9-.4v-2.2l1.9-.4a7 7 0 0 1 .7-1.7L5.6 6.5l1.6-1.6 1.6 1.1a7 7 0 0 1 1.7-.7l.4-1.9h2.2l.4 1.9a7 7 0 0 1 1.7.7l1.6-1.1 1.6 1.6-1.1 1.6a7 7 0 0 1 .7 1.7l1.9.4z" /></svg>
          Settings
        </NavLink>
      </nav>
    </div>
  );
}
