import { Suspense, lazy, useCallback } from 'react';
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
const SettingsPage = lazy(() => import('./pages/settings/SettingsPage').then((m) => ({ default: m.SettingsPage })));
const OrganizationsPage = lazy(() => import('./pages/settings/OrganizationsPage').then((m) => ({ default: m.OrganizationsPage })));
const OrganizationFormPage = lazy(() => import('./pages/settings/OrganizationFormPage').then((m) => ({ default: m.OrganizationFormPage })));
const UsersPage = lazy(() => import('./pages/settings/UsersPage').then((m) => ({ default: m.UsersPage })));
const UserFormPage = lazy(() => import('./pages/settings/UserFormPage').then((m) => ({ default: m.UserFormPage })));
const AuditLogPage = lazy(() => import('./pages/settings/AuditLogPage').then((m) => ({ default: m.AuditLogPage })));
const DevicePage = lazy(() => import('./pages/settings/DevicePage').then((m) => ({ default: m.DevicePage })));
const PipelineSettingsPage = lazy(() => import('./pages/settings/PipelineSettingsPage').then((m) => ({ default: m.PipelineSettingsPage })));
const CustomFieldsPage = lazy(() => import('./pages/settings/CustomFieldsPage').then((m) => ({ default: m.CustomFieldsPage })));
const PeoplePage = lazy(() => import('./pages/people/PeoplePage').then((m) => ({ default: m.PeoplePage })));
const PersonPage = lazy(() => import('./pages/people/PersonPage').then((m) => ({ default: m.PersonPage })));
const PersonFormPage = lazy(() => import('./pages/people/PersonFormPage').then((m) => ({ default: m.PersonFormPage })));
const VisitorFormPage = lazy(() => import('./pages/people/VisitorFormPage').then((m) => ({ default: m.VisitorFormPage })));
const AttendancePage = lazy(() => import('./pages/attendance/AttendancePage').then((m) => ({ default: m.AttendancePage })));
const EventPage = lazy(() => import('./pages/attendance/EventPage').then((m) => ({ default: m.EventPage })));
const DoorModePage = lazy(() => import('./pages/attendance/DoorModePage').then((m) => ({ default: m.DoorModePage })));
const ProgramsPage = lazy(() => import('./pages/programs/ProgramsPage').then((m) => ({ default: m.ProgramsPage })));
const ProgramPage = lazy(() => import('./pages/programs/ProgramPage').then((m) => ({ default: m.ProgramPage })));
const ProgramFormPage = lazy(() => import('./pages/programs/ProgramFormPage').then((m) => ({ default: m.ProgramFormPage })));
const TeamPage = lazy(() => import('./pages/programs/TeamPage').then((m) => ({ default: m.TeamPage })));
const GroupPage = lazy(() => import('./pages/programs/GroupPage').then((m) => ({ default: m.GroupPage })));
const GroupFormPage = lazy(() => import('./pages/programs/GroupFormPage').then((m) => ({ default: m.GroupFormPage })));
const GivingPage = lazy(() => import('./pages/giving/GivingPage').then((m) => ({ default: m.GivingPage })));
const RecordGiftPage = lazy(() => import('./pages/giving/RecordGiftPage').then((m) => ({ default: m.RecordGiftPage })));
const GiftPage = lazy(() => import('./pages/giving/GiftPage').then((m) => ({ default: m.GiftPage })));
const UnassignedPage = lazy(() => import('./pages/giving/UnassignedPage').then((m) => ({ default: m.UnassignedPage })));
const ImportPage = lazy(() => import('./pages/giving/ImportPage').then((m) => ({ default: m.ImportPage })));
const GivingSummaryPage = lazy(() => import('./pages/giving/GivingSummaryPage').then((m) => ({ default: m.GivingSummaryPage })));
const StatementsPage = lazy(() => import('./pages/giving/StatementsPage').then((m) => ({ default: m.StatementsPage })));
const FundsPage = lazy(() => import('./pages/settings/FundsPage').then((m) => ({ default: m.FundsPage })));
const TemplatesPage = lazy(() => import('./pages/settings/TemplatesPage').then((m) => ({ default: m.TemplatesPage })));
const FollowUpsPage = lazy(() => import('./pages/followups/FollowUpsPage').then((m) => ({ default: m.FollowUpsPage })));
const RemindersPage = lazy(() => import('./pages/followups/RemindersPage').then((m) => ({ default: m.RemindersPage })));
const ReportsPage = lazy(() => import('./pages/reports/ReportsPage').then((m) => ({ default: m.ReportsPage })));
const ReportPage = lazy(() => import('./pages/reports/ReportPage').then((m) => ({ default: m.ReportPage })));
const ReportSettingsPage = lazy(() => import('./pages/settings/ReportSettingsPage').then((m) => ({ default: m.ReportSettingsPage })));

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
    <Suspense fallback={<div className="splash" aria-busy="true"><span className="splash-mark" />Loading…</div>}>
    <Routes>
      {/* The door tablet fills the screen, without the menus. */}
      <Route path="/door/:orgId/:eventId" element={<RequirePermission permission="attendance.write"><DoorModePage /></RequirePermission>} />
      <Route path="*" element={<AppRoutes />} />
    </Routes>
    </Suspense>
  );
}

function AppRoutes() {
  return (
    <AppShell>
      <Suspense fallback={<p className="muted" aria-busy="true">Loading…</p>}>
      <Routes>
        <Route path="/" element={<TodayPage />} />
        <Route path="/attendance" element={<AttendancePage />} />
        <Route path="/attendance/:orgId/:eventId" element={<EventPage />} />
        <Route path="/programs" element={<RequirePermission permission="people.read"><ProgramsPage /></RequirePermission>} />
        <Route path="/programs/:orgId/new" element={<RequirePermission permission="settings.manage"><ProgramFormPage /></RequirePermission>} />
        <Route path="/programs/:orgId/:programId" element={<RequirePermission permission="people.read"><ProgramPage /></RequirePermission>} />
        <Route path="/programs/:orgId/:programId/edit" element={<RequirePermission permission="settings.manage"><ProgramFormPage /></RequirePermission>} />
        <Route path="/teams/:orgId/:teamId" element={<RequirePermission permission="people.read"><TeamPage /></RequirePermission>} />
        <Route path="/groups/:orgId/new" element={<RequirePermission permission="programs.write"><GroupFormPage /></RequirePermission>} />
        <Route path="/groups/:orgId/:groupId" element={<RequirePermission permission="people.read"><GroupPage /></RequirePermission>} />
        <Route path="/groups/:orgId/:groupId/edit" element={<RequirePermission permission="programs.write"><GroupFormPage /></RequirePermission>} />
        <Route path="/giving" element={<RequirePermission anyOf={['gifts.write', 'finance.reports', 'giving.person.read']}><GivingPage /></RequirePermission>} />
        <Route path="/giving/new" element={<RequirePermission permission="gifts.write"><RecordGiftPage /></RequirePermission>} />
        <Route path="/giving/unassigned" element={<RequirePermission permission="gifts.write"><UnassignedPage /></RequirePermission>} />
        <Route path="/giving/import" element={<RequirePermission permission="gifts.write"><ImportPage /></RequirePermission>} />
        <Route path="/giving/summary" element={<RequirePermission permission="finance.reports"><GivingSummaryPage /></RequirePermission>} />
        <Route path="/giving/statements" element={<RequirePermission permission="giving.person.read"><StatementsPage /></RequirePermission>} />
        <Route path="/giving/:orgId/:giftId" element={<RequirePermission anyOf={['gifts.write', 'giving.person.read']}><GiftPage /></RequirePermission>} />
        <Route path="/follow-ups" element={<RequirePermission permission="followups.manage"><FollowUpsPage /></RequirePermission>} />
        <Route path="/follow-ups/reminders" element={<RequirePermission permission="followups.manage"><RemindersPage /></RequirePermission>} />
        <Route path="/reports" element={<RequirePermission permission="people.read"><ReportsPage /></RequirePermission>} />
        <Route path="/reports/:orgId/:reportId" element={<RequirePermission permission="people.read"><ReportPage /></RequirePermission>} />
        <Route path="/visitors/new" element={<RequirePermission permission="people.write"><VisitorFormPage /></RequirePermission>} />
        <Route path="/people" element={<RequirePermission permission="people.read"><PeoplePage /></RequirePermission>} />
        <Route path="/people/new" element={<RequirePermission permission="people.write"><PersonFormPage /></RequirePermission>} />
        <Route path="/people/:orgId/:personId" element={<RequirePermission permission="people.read"><PersonPage /></RequirePermission>} />
        <Route path="/people/:orgId/:personId/edit" element={<RequirePermission permission="people.write"><PersonFormPage /></RequirePermission>} />
        <Route path="/settings" element={<SettingsPage />} />
        <Route path="/settings/pipeline" element={<RequirePermission permission="settings.manage"><PipelineSettingsPage /></RequirePermission>} />
        <Route path="/settings/custom-fields" element={<RequirePermission permission="settings.manage"><CustomFieldsPage /></RequirePermission>} />
        <Route path="/settings/funds" element={<RequirePermission permission="settings.manage"><FundsPage /></RequirePermission>} />
        <Route path="/settings/reports" element={<RequirePermission permission="settings.manage"><ReportSettingsPage /></RequirePermission>} />
        <Route path="/settings/templates" element={<RequirePermission permission="settings.manage"><TemplatesPage /></RequirePermission>} />
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
      </Suspense>
    </AppShell>
  );
}
