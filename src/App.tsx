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
const GivingDashboardPage = lazy(() => import('./pages/giving/GivingDashboardPage').then((m) => ({ default: m.GivingDashboardPage })));
const StatementsPage = lazy(() => import('./pages/giving/StatementsPage').then((m) => ({ default: m.StatementsPage })));
const FundsPage = lazy(() => import('./pages/settings/FundsPage').then((m) => ({ default: m.FundsPage })));
const WhatsAppSettingsPage = lazy(() => import('./pages/settings/WhatsAppSettingsPage').then((m) => ({ default: m.WhatsAppSettingsPage })));
const TemplatesPage = lazy(() => import('./pages/settings/TemplatesPage').then((m) => ({ default: m.TemplatesPage })));
const FollowUpsPage = lazy(() => import('./pages/followups/FollowUpsPage').then((m) => ({ default: m.FollowUpsPage })));
const RemindersPage = lazy(() => import('./pages/followups/RemindersPage').then((m) => ({ default: m.RemindersPage })));
const ReportsPage = lazy(() => import('./pages/reports/ReportsPage').then((m) => ({ default: m.ReportsPage })));
const DashboardPage = lazy(() => import('./pages/reports/DashboardPage').then((m) => ({ default: m.DashboardPage })));
const ReportPage = lazy(() => import('./pages/reports/ReportPage').then((m) => ({ default: m.ReportPage })));
const DataPage = lazy(() => import('./pages/settings/DataPage').then((m) => ({ default: m.DataPage })));
const HelpPage = lazy(() => import('./pages/HelpPage').then((m) => ({ default: m.HelpPage })));
const ReportSettingsPage = lazy(() => import('./pages/settings/ReportSettingsPage').then((m) => ({ default: m.ReportSettingsPage })));
const SchoolHome = lazy(() => import('./pages/school/SchoolHome').then((m) => ({ default: m.SchoolHome })));
const StudentsPage = lazy(() => import('./pages/school/StudentsPage').then((m) => ({ default: m.StudentsPage })));
const EnrolPage = lazy(() => import('./pages/school/EnrolPage').then((m) => ({ default: m.EnrolPage })));
const StudentPage = lazy(() => import('./pages/school/StudentPage').then((m) => ({ default: m.StudentPage })));
const CoursesPage = lazy(() => import('./pages/school/CoursesPage').then((m) => ({ default: m.CoursesPage })));
const ResultsPage = lazy(() => import('./pages/school/ResultsPage').then((m) => ({ default: m.ResultsPage })));
const FeesPage = lazy(() => import('./pages/school/FeesPage').then((m) => ({ default: m.FeesPage })));
const GraduationPage = lazy(() => import('./pages/school/GraduationPage').then((m) => ({ default: m.GraduationPage })));
const SchoolReportsPage = lazy(() => import('./pages/school/SchoolReportsPage').then((m) => ({ default: m.SchoolReportsPage })));
const PettyCashPage = lazy(() => import('./pages/school/PettyCashPage').then((m) => ({ default: m.PettyCashPage })));
const NewRequisitionPage = lazy(() => import('./pages/school/PettyCashPage').then((m) => ({ default: m.NewRequisitionPage })));
const RequisitionPage = lazy(() => import('./pages/school/PettyCashPage').then((m) => ({ default: m.RequisitionPage })));
const PettyReceiptsPage = lazy(() => import('./pages/school/PettyCashBooks').then((m) => ({ default: m.PettyReceiptsPage })));
const PettyBalanceSheetPage = lazy(() => import('./pages/school/PettyCashBooks').then((m) => ({ default: m.PettyBalanceSheetPage })));
const PettyBudgetPage = lazy(() => import('./pages/school/PettyCashBooks').then((m) => ({ default: m.PettyBudgetPage })));
const PettyBinPage = lazy(() => import('./pages/school/PettyBin').then((m) => ({ default: m.PettyBinPage })));
const PayrollPage = lazy(() => import('./pages/school/PayrollPage').then((m) => ({ default: m.PayrollPage })));
const PayrollStaffPage = lazy(() => import('./pages/school/PayrollPage').then((m) => ({ default: m.PayrollStaffPage })));
const PayrollPersonPage = lazy(() => import('./pages/school/PayrollPage').then((m) => ({ default: m.PayrollPersonPage })));
const StudentImportPage = lazy(() => import('./pages/school/StudentImportPage').then((m) => ({ default: m.StudentImportPage })));
const ExamsPage = lazy(() => import('./pages/school/ExamsPage').then((m) => ({ default: m.ExamsPage })));
const ExamSheetPage = lazy(() => import('./pages/school/ExamsPage').then((m) => ({ default: m.ExamSheetPage })));
const PayrollRunPage = lazy(() => import('./pages/school/PayrollPage').then((m) => ({ default: m.PayrollRunPage })));
const SchoolSettingsPage = lazy(() => import('./pages/school/SchoolSettingsPage').then((m) => ({ default: m.SchoolSettingsPage })));
const HopeHome = lazy(() => import('./pages/hope/HopeHome').then((m) => ({ default: m.HopeHome })));
const ChildrenPage = lazy(() => import('./pages/hope/ChildrenPage').then((m) => ({ default: m.ChildrenPage })));
const RegisterChildPage = lazy(() => import('./pages/hope/RegisterChildPage').then((m) => ({ default: m.RegisterChildPage })));
const ChildPage = lazy(() => import('./pages/hope/ChildPage').then((m) => ({ default: m.ChildPage })));
const HopeReportsPage = lazy(() => import('./pages/hope/HopeReportsPage').then((m) => ({ default: m.HopeReportsPage })));
const HopeExportsPage = lazy(() => import('./pages/hope/HopeExportsPage').then((m) => ({ default: m.HopeExportsPage })));

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
        <Route path="/giving/dashboard" element={<RequirePermission permission="finance.reports"><GivingDashboardPage /></RequirePermission>} />
        <Route path="/giving/statements" element={<RequirePermission permission="giving.person.read"><StatementsPage /></RequirePermission>} />
        <Route path="/giving/:orgId/:giftId" element={<RequirePermission anyOf={['gifts.write', 'giving.person.read']}><GiftPage /></RequirePermission>} />
        <Route path="/follow-ups" element={<RequirePermission permission="followups.manage"><FollowUpsPage /></RequirePermission>} />
        <Route path="/follow-ups/reminders" element={<RequirePermission permission="followups.manage"><RemindersPage /></RequirePermission>} />
        <Route path="/dashboard" element={<RequirePermission permission="people.read"><DashboardPage /></RequirePermission>} />
        <Route path="/reports" element={<RequirePermission permission="people.read"><ReportsPage /></RequirePermission>} />
        <Route path="/reports/:orgId/:reportId" element={<RequirePermission permission="people.read"><ReportPage /></RequirePermission>} />
        <Route path="/visitors/new" element={<RequirePermission permission="people.write"><VisitorFormPage /></RequirePermission>} />
        <Route path="/people" element={<RequirePermission permission="people.read"><PeoplePage /></RequirePermission>} />
        <Route path="/people/new" element={<RequirePermission permission="people.write"><PersonFormPage /></RequirePermission>} />
        <Route path="/people/:orgId/:personId" element={<RequirePermission permission="people.read"><PersonPage /></RequirePermission>} />
        <Route path="/people/:orgId/:personId/edit" element={<RequirePermission permission="people.write"><PersonFormPage /></RequirePermission>} />
        <Route path="/school" element={<RequirePermission permission="people.read"><SchoolHome /></RequirePermission>} />
        <Route path="/school/students" element={<RequirePermission permission="people.read"><StudentsPage /></RequirePermission>} />
        <Route path="/school/students/new" element={<RequirePermission permission="people.write"><EnrolPage /></RequirePermission>} />
        <Route path="/school/students/import" element={<RequirePermission permission="people.write"><StudentImportPage /></RequirePermission>} />
        <Route path="/school/students/:studentId" element={<RequirePermission permission="people.read"><StudentPage /></RequirePermission>} />
        <Route path="/school/courses" element={<RequirePermission permission="people.read"><CoursesPage /></RequirePermission>} />
        <Route path="/school/results" element={<RequirePermission permission="people.read"><ResultsPage /></RequirePermission>} />
        <Route path="/school/fees" element={<RequirePermission anyOf={['gifts.write', 'finance.reports', 'giving.person.read']}><FeesPage /></RequirePermission>} />
        <Route path="/school/graduation" element={<RequirePermission permission="people.read"><GraduationPage /></RequirePermission>} />
        <Route path="/school/reports" element={<RequirePermission anyOf={['finance.reports', 'settings.manage']}><SchoolReportsPage /></RequirePermission>} />
        <Route path="/school/petty-cash" element={<RequirePermission anyOf={['pettycash.request', 'pettycash.check', 'pettycash.approve', 'pettycash.authorize', 'users.manage']}><PettyCashPage /></RequirePermission>} />
        <Route path="/school/petty-cash/new" element={<RequirePermission anyOf={['pettycash.request', 'pettycash.check', 'pettycash.approve', 'pettycash.authorize', 'users.manage']}><NewRequisitionPage /></RequirePermission>} />
        <Route path="/school/petty-cash/receipts" element={<RequirePermission anyOf={['pettycash.request', 'pettycash.check', 'pettycash.approve', 'pettycash.authorize', 'users.manage']}><PettyReceiptsPage /></RequirePermission>} />
        <Route path="/school/petty-cash/balance-sheet" element={<RequirePermission anyOf={['pettycash.request', 'pettycash.check', 'pettycash.approve', 'pettycash.authorize', 'users.manage']}><PettyBalanceSheetPage /></RequirePermission>} />
        <Route path="/school/petty-cash/budget" element={<RequirePermission anyOf={['pettycash.request', 'pettycash.check', 'pettycash.approve', 'pettycash.authorize', 'users.manage']}><PettyBudgetPage /></RequirePermission>} />
        <Route path="/school/petty-cash/bin" element={<RequirePermission anyOf={['pettycash.request', 'pettycash.check', 'pettycash.approve', 'pettycash.authorize', 'users.manage']}><PettyBinPage /></RequirePermission>} />
        <Route path="/school/petty-cash/:reqId" element={<RequirePermission anyOf={['pettycash.request', 'pettycash.check', 'pettycash.approve', 'pettycash.authorize', 'users.manage']}><RequisitionPage /></RequirePermission>} />
        <Route path="/school/exams" element={<RequirePermission anyOf={['exams.mark', 'exams.manage', 'users.manage']}><ExamsPage /></RequirePermission>} />
        <Route path="/school/exams/sheet/:sheetId" element={<RequirePermission anyOf={['exams.mark', 'exams.manage', 'users.manage']}><ExamSheetPage /></RequirePermission>} />
        <Route path="/school/payroll" element={<RequirePermission anyOf={['payroll.manage', 'payroll.approve', 'users.manage']}><PayrollPage /></RequirePermission>} />
        <Route path="/school/payroll/staff" element={<RequirePermission anyOf={['payroll.manage', 'payroll.approve', 'users.manage']}><PayrollStaffPage /></RequirePermission>} />
        <Route path="/school/payroll/staff/:staffId" element={<RequirePermission anyOf={['payroll.manage', 'payroll.approve', 'users.manage']}><PayrollPersonPage /></RequirePermission>} />
        <Route path="/school/payroll/:month" element={<RequirePermission anyOf={['payroll.manage', 'payroll.approve', 'users.manage']}><PayrollRunPage /></RequirePermission>} />
        <Route path="/school/settings" element={<RequirePermission permission="settings.manage"><SchoolSettingsPage /></RequirePermission>} />
        <Route path="/hope" element={<RequirePermission permission="people.read"><HopeHome /></RequirePermission>} />
        <Route path="/hope/children" element={<RequirePermission permission="people.read"><ChildrenPage /></RequirePermission>} />
        <Route path="/hope/children/new" element={<RequirePermission permission="people.write"><RegisterChildPage /></RequirePermission>} />
        <Route path="/hope/children/:childId" element={<RequirePermission permission="people.read"><ChildPage /></RequirePermission>} />
        <Route path="/hope/reports" element={<RequirePermission permission="people.read"><HopeReportsPage /></RequirePermission>} />
        <Route path="/hope/petty-cash" element={<RequirePermission anyOf={['pettycash.request', 'pettycash.check', 'pettycash.approve', 'pettycash.authorize', 'users.manage']}><PettyCashPage /></RequirePermission>} />
        <Route path="/hope/petty-cash/new" element={<RequirePermission anyOf={['pettycash.request', 'pettycash.check', 'pettycash.approve', 'pettycash.authorize', 'users.manage']}><NewRequisitionPage /></RequirePermission>} />
        <Route path="/hope/petty-cash/receipts" element={<RequirePermission anyOf={['pettycash.request', 'pettycash.check', 'pettycash.approve', 'pettycash.authorize', 'users.manage']}><PettyReceiptsPage /></RequirePermission>} />
        <Route path="/hope/petty-cash/balance-sheet" element={<RequirePermission anyOf={['pettycash.request', 'pettycash.check', 'pettycash.approve', 'pettycash.authorize', 'users.manage']}><PettyBalanceSheetPage /></RequirePermission>} />
        <Route path="/hope/petty-cash/budget" element={<RequirePermission anyOf={['pettycash.request', 'pettycash.check', 'pettycash.approve', 'pettycash.authorize', 'users.manage']}><PettyBudgetPage /></RequirePermission>} />
        <Route path="/hope/petty-cash/bin" element={<RequirePermission anyOf={['pettycash.request', 'pettycash.check', 'pettycash.approve', 'pettycash.authorize', 'users.manage']}><PettyBinPage /></RequirePermission>} />
        <Route path="/hope/petty-cash/:reqId" element={<RequirePermission anyOf={['pettycash.request', 'pettycash.check', 'pettycash.approve', 'pettycash.authorize', 'users.manage']}><RequisitionPage /></RequirePermission>} />
        <Route path="/petty-cash" element={<RequirePermission anyOf={['pettycash.request', 'pettycash.check', 'pettycash.approve', 'pettycash.authorize', 'users.manage']}><PettyCashPage /></RequirePermission>} />
        <Route path="/petty-cash/new" element={<RequirePermission anyOf={['pettycash.request', 'pettycash.check', 'pettycash.approve', 'pettycash.authorize', 'users.manage']}><NewRequisitionPage /></RequirePermission>} />
        <Route path="/petty-cash/receipts" element={<RequirePermission anyOf={['pettycash.request', 'pettycash.check', 'pettycash.approve', 'pettycash.authorize', 'users.manage']}><PettyReceiptsPage /></RequirePermission>} />
        <Route path="/petty-cash/balance-sheet" element={<RequirePermission anyOf={['pettycash.request', 'pettycash.check', 'pettycash.approve', 'pettycash.authorize', 'users.manage']}><PettyBalanceSheetPage /></RequirePermission>} />
        <Route path="/petty-cash/budget" element={<RequirePermission anyOf={['pettycash.request', 'pettycash.check', 'pettycash.approve', 'pettycash.authorize', 'users.manage']}><PettyBudgetPage /></RequirePermission>} />
        <Route path="/petty-cash/bin" element={<RequirePermission anyOf={['pettycash.request', 'pettycash.check', 'pettycash.approve', 'pettycash.authorize', 'users.manage']}><PettyBinPage /></RequirePermission>} />
        <Route path="/petty-cash/:reqId" element={<RequirePermission anyOf={['pettycash.request', 'pettycash.check', 'pettycash.approve', 'pettycash.authorize', 'users.manage']}><RequisitionPage /></RequirePermission>} />
        <Route path="/hope/exports" element={<RequirePermission permission="people.read"><HopeExportsPage /></RequirePermission>} />
        <Route path="/settings" element={<SettingsPage />} />
        <Route path="/settings/pipeline" element={<RequirePermission permission="settings.manage"><PipelineSettingsPage /></RequirePermission>} />
        <Route path="/settings/custom-fields" element={<RequirePermission permission="settings.manage"><CustomFieldsPage /></RequirePermission>} />
        <Route path="/settings/funds" element={<RequirePermission permission="settings.manage"><FundsPage /></RequirePermission>} />
        <Route path="/settings/reports" element={<RequirePermission permission="settings.manage"><ReportSettingsPage /></RequirePermission>} />
        <Route path="/settings/whatsapp" element={<RequirePermission permission="settings.manage"><WhatsAppSettingsPage /></RequirePermission>} />
        <Route path="/settings/templates" element={<RequirePermission permission="settings.manage"><TemplatesPage /></RequirePermission>} />
        <Route path="/settings/device" element={<DevicePage />} />
        <Route path="/settings/organizations" element={<RequirePermission permission="settings.manage"><OrganizationsPage /></RequirePermission>} />
        <Route path="/settings/organizations/new" element={<RequirePermission permission="settings.manage"><OrganizationFormPage /></RequirePermission>} />
        <Route path="/settings/organizations/:orgId" element={<RequirePermission permission="settings.manage"><OrganizationFormPage /></RequirePermission>} />
        <Route path="/settings/users" element={<RequirePermission anyOf={['users.manage', 'team.manage']}><UsersPage /></RequirePermission>} />
        <Route path="/settings/users/new" element={<RequirePermission anyOf={['users.manage', 'team.manage']}><UserFormPage /></RequirePermission>} />
        <Route path="/settings/users/:uid" element={<RequirePermission anyOf={['users.manage', 'team.manage']}><UserFormPage /></RequirePermission>} />
        <Route path="/settings/data" element={<RequirePermission permission="data.export"><DataPage /></RequirePermission>} />
        <Route path="/help" element={<HelpPage />} />
        <Route path="/settings/audit" element={<RequirePermission permission="audit.read"><AuditLogPage /></RequirePermission>} />
        <Route path="/sign-in" element={<Navigate to="/" replace />} />
        <Route path="*" element={<NotFoundPage />} />
      </Routes>
      </Suspense>
    </AppShell>
  );
}
