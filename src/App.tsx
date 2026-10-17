import { useCallback } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import { useAuth } from './state/AuthContext';
import { useAppSettings } from './state/useAppSettings';
import { isSharedDevice, useIdleSignOut } from './lib/useIdleSignOut';
import { AppShell } from './components/AppShell';
import { RequirePermission } from './components/RequirePermission';
import { SignInPage } from './pages/SignInPage';
import { ChangePasswordPage } from './pages/ChangePasswordPage';
import { TodayPage } from './pages/TodayPage';
import { NotFoundPage } from './pages/NotFoundPage';
import { SettingsPage } from './pages/settings/SettingsPage';
import { OrganizationsPage } from './pages/settings/OrganizationsPage';
import { OrganizationFormPage } from './pages/settings/OrganizationFormPage';
import { UsersPage } from './pages/settings/UsersPage';
import { UserFormPage } from './pages/settings/UserFormPage';
import { AuditLogPage } from './pages/settings/AuditLogPage';
import { DevicePage } from './pages/settings/DevicePage';

export function App() {
  const { user, profile, loading, signOut } = useAuth();
  const settings = useAppSettings();
  const onIdle = useCallback(() => { void signOut(); }, [signOut]);
  useIdleSignOut(settings.inactivityMinutes, !!user && isSharedDevice(), onIdle);

  if (loading) {
    return <div className="splash" aria-busy="true"><span className="splash-mark" />Loading…</div>;
  }
  if (!user) return <SignInPage />;
  if (!profile || !profile.active) {
    return (
      <div className="center-card">
        <h1>Account not set up</h1>
        <p>This sign-in has no active staff account. Ask the pastor to add or switch on your account.</p>
        <button type="button" className="btn btn-primary" onClick={() => void signOut()}>Sign out</button>
      </div>
    );
  }
  if (profile.mustChangePassword) return <ChangePasswordPage />;

  return (
    <AppShell>
      <Routes>
        <Route path="/" element={<TodayPage />} />
        <Route path="/settings" element={<SettingsPage />} />
        <Route path="/settings/device" element={<DevicePage />} />
        <Route path="/settings/organizations" element={<RequirePermission permission="settings.manage"><OrganizationsPage /></RequirePermission>} />
        <Route path="/settings/organizations/new" element={<RequirePermission permission="settings.manage"><OrganizationFormPage /></RequirePermission>} />
        <Route path="/settings/organizations/:orgId" element={<RequirePermission permission="settings.manage"><OrganizationFormPage /></RequirePermission>} />
        <Route path="/settings/users" element={<RequirePermission permission="users.manage"><UsersPage /></RequirePermission>} />
        <Route path="/settings/users/new" element={<RequirePermission permission="users.manage"><UserFormPage /></RequirePermission>} />
        <Route path="/settings/users/:uid" element={<RequirePermission permission="users.manage"><UserFormPage /></RequirePermission>} />
        <Route path="/settings/audit" element={<RequirePermission permission="audit.read"><AuditLogPage /></RequirePermission>} />
        <Route path="/sign-in" element={<Navigate to="/" replace />} />
        <Route path="*" element={<NotFoundPage />} />
      </Routes>
    </AppShell>
  );
}
