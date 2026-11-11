import { Suspense, lazy, useCallback } from 'react';
import { InstallPage } from './pages/InstallPage';
import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { useAuth } from './state/AuthContext';
import { useAppSettings } from './state/useAppSettings';
import { isSharedDevice, MONEY_IDLE_MINUTES, useIdleSignOut } from './lib/useIdleSignOut';
import { AppShell } from './components/AppShell';
import { RequireAccountKeeper, RequirePermission } from './components/RequirePermission';
import { SignInPage } from './pages/SignInPage';
import { ChangePasswordPage } from './pages/ChangePasswordPage';
import { TodayPage } from './pages/TodayPage';
import { NotFoundPage } from './pages/NotFoundPage';
const SettingsPage = lazy(() => import('./pages/settings/SettingsPage').then((m) => ({ default: m.SettingsPage })));
const SettingsGroupPage = lazy(() => import('./pages/settings/SettingsPage').then((m) => ({ default: m.SettingsGroupPage })));
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
const AttendancePage = lazy(() => import('./pages/attendance/AttendancePage').then((m) => ({ default: m.AttendancePage })));
const EventPage = lazy(() => import('./pages/attendance/EventPage').then((m) => ({ default: m.EventPage })));
const DoorModePage = lazy(() => import('./pages/attendance/DoorModePage').then((m) => ({ default: m.DoorModePage })));
const ProgramsPage = lazy(() => import('./pages/programs/ProgramsPage').then((m) => ({ default: m.ProgramsPage })));
const ProgramPage = lazy(() => import('./pages/programs/ProgramPage').then((m) => ({ default: m.ProgramPage })));
const ProgramFormPage = lazy(() => import('./pages/programs/ProgramFormPage').then((m) => ({ default: m.ProgramFormPage })));
const TeamPage = lazy(() => import('./pages/programs/TeamPage').then((m) => ({ default: m.TeamPage })));
const GroupPage = lazy(() => import('./pages/programs/GroupPage').then((m) => ({ default: m.GroupPage })));
const ClassQrPage = lazy(() => import('./pages/programs/ClassQrPage').then((m) => ({ default: m.ClassQrPage })));
const RegisterPage = lazy(() => import('./pages/programs/RegisterPage').then((m) => ({ default: m.RegisterPage })));
const ClassCheckInPage = lazy(() => import('./pages/classes/ClassCheckInPage').then((m) => ({ default: m.ClassCheckInPage })));
const ClassProgressPage = lazy(() => import('./pages/classes/ClassProgressPage').then((m) => ({ default: m.ClassProgressPage })));
const GroupFormPage = lazy(() => import('./pages/programs/GroupFormPage').then((m) => ({ default: m.GroupFormPage })));
const WelcomeCardPage = lazy(() => import('./pages/people/WelcomeCardPage').then((m) => ({ default: m.WelcomeCardPage })));
const JoinFamilyPage = lazy(() => import('./pages/people/JoinFamilyPage').then((m) => ({ default: m.JoinFamilyPage })));
const SignupsPage = lazy(() => import('./pages/people/SignupsPage').then((m) => ({ default: m.SignupsPage })));
const JoinPosterPage = lazy(() => import('./pages/people/JoinPosterPage').then((m) => ({ default: m.JoinPosterPage })));
const WelcomePosterPage = lazy(() => import('./pages/people/WelcomePosterPage').then((m) => ({ default: m.WelcomePosterPage })));
const PastRegisterPage = lazy(() => import('./pages/attendance/PastRegisterPage').then((m) => ({ default: m.PastRegisterPage })));
const PastResultsPage = lazy(() => import('./pages/school/PastResultsPage').then((m) => ({ default: m.PastResultsPage })));
const PledgesPage = lazy(() => import('./pages/giving/PledgesPage').then((m) => ({ default: m.PledgesPage })));
const GivingPage = lazy(() => import('./pages/giving/GivingPage').then((m) => ({ default: m.GivingPage })));
const RecordGiftPage = lazy(() => import('./pages/giving/RecordGiftPage').then((m) => ({ default: m.RecordGiftPage })));
const GiftPage = lazy(() => import('./pages/giving/GiftPage').then((m) => ({ default: m.GiftPage })));
const UnassignedPage = lazy(() => import('./pages/giving/UnassignedPage').then((m) => ({ default: m.UnassignedPage })));
const ImportPage = lazy(() => import('./pages/giving/ImportPage').then((m) => ({ default: m.ImportPage })));
const GivingSummaryPage = lazy(() => import('./pages/giving/GivingSummaryPage').then((m) => ({ default: m.GivingSummaryPage })));
const StatementsPage = lazy(() => import('./pages/giving/StatementsPage').then((m) => ({ default: m.StatementsPage })));
const BirthdayCardPage = lazy(() => import('./pages/settings/BirthdayCardPage').then((m) => ({ default: m.BirthdayCardPage })));
const FundsPage = lazy(() => import('./pages/settings/FundsPage').then((m) => ({ default: m.FundsPage })));
const WhatsAppSettingsPage = lazy(() => import('./pages/settings/WhatsAppSettingsPage').then((m) => ({ default: m.WhatsAppSettingsPage })));
const TemplatesPage = lazy(() => import('./pages/settings/TemplatesPage').then((m) => ({ default: m.TemplatesPage })));
const FollowUpsPage = lazy(() => import('./pages/followups/FollowUpsPage').then((m) => ({ default: m.FollowUpsPage })));
const RemindersPage = lazy(() => import('./pages/followups/RemindersPage').then((m) => ({ default: m.RemindersPage })));
const ReportsPage = lazy(() => import('./pages/reports/ReportsPage').then((m) => ({ default: m.ReportsPage })));
const ReportPage = lazy(() => import('./pages/reports/ReportPage').then((m) => ({ default: m.ReportPage })));
const DataPage = lazy(() => import('./pages/settings/DataPage').then((m) => ({ default: m.DataPage })));
const HelpPage = lazy(() => import('./pages/HelpPage').then((m) => ({ default: m.HelpPage })));
const AiHelperPage = lazy(() => import('./pages/AiHelperPage').then((m) => ({ default: m.AiHelperPage })));
const NoticePage = lazy(() => import('./pages/NoticePage').then((m) => ({ default: m.NoticePage })));
const MorePage = lazy(() => import('./pages/MorePage').then((m) => ({ default: m.MorePage })));
const ReportSettingsPage = lazy(() => import('./pages/settings/ReportSettingsPage').then((m) => ({ default: m.ReportSettingsPage })));
const StudentsPage = lazy(() => import('./pages/school/StudentsPage').then((m) => ({ default: m.StudentsPage })));
const EnrolPage = lazy(() => import('./pages/school/EnrolPage').then((m) => ({ default: m.EnrolPage })));
const StudentPage = lazy(() => import('./pages/school/StudentPage').then((m) => ({ default: m.StudentPage })));
const CoursesPage = lazy(() => import('./pages/school/CoursesPage').then((m) => ({ default: m.CoursesPage })));
const FeesPage = lazy(() => import('./pages/school/FeesPage').then((m) => ({ default: m.FeesPage })));
const GraduationPage = lazy(() => import('./pages/school/GraduationPage').then((m) => ({ default: m.GraduationPage })));
const SchoolReportsPage = lazy(() => import('./pages/school/SchoolReportsPage').then((m) => ({ default: m.SchoolReportsPage })));
const PettyCashPage = lazy(() => import('./pages/school/PettyCashPage').then((m) => ({ default: m.PettyCashPage })));
const NewRequisitionPage = lazy(() => import('./pages/school/PettyCashPage').then((m) => ({ default: m.NewRequisitionPage })));
const RequisitionPage = lazy(() => import('./pages/school/PettyCashPage').then((m) => ({ default: m.RequisitionPage })));
const PettyReceiptsPage = lazy(() => import('./pages/school/PettyCashBooks').then((m) => ({ default: m.PettyReceiptsPage })));
const CleanupPage = lazy(() => import('./pages/settings/CleanupPage').then((m) => ({ default: m.CleanupPage })));
const SigningPinPage = lazy(() => import('./pages/settings/SigningPinPage').then((m) => ({ default: m.SigningPinPage })));
const FinancePage = lazy(() => import('./pages/finance/FinancePage'));
const PettyReportsPage = lazy(() => import('./pages/school/PettyCashBooks').then((m) => ({ default: m.PettyReportsPage })));
const PettyMonthEndPage = lazy(() => import('./pages/school/PettyCashBooks').then((m) => ({ default: m.PettyMonthEndPage })));
const PettyBalanceSheetPage = lazy(() => import('./pages/school/PettyCashBooks').then((m) => ({ default: m.PettyBalanceSheetPage })));
const PettyBudgetPage = lazy(() => import('./pages/school/PettyCashBooks').then((m) => ({ default: m.PettyBudgetPage })));
const PettyBinPage = lazy(() => import('./pages/school/PettyBin').then((m) => ({ default: m.PettyBinPage })));
const PayrollPage = lazy(() => import('./pages/school/PayrollPage').then((m) => ({ default: m.PayrollPage })));
const PayrollStaffPage = lazy(() => import('./pages/school/PayrollPage').then((m) => ({ default: m.PayrollStaffPage })));
const PayrollPersonPage = lazy(() => import('./pages/school/PayrollPage').then((m) => ({ default: m.PayrollPersonPage })));
const StudentImportPage = lazy(() => import('./pages/school/StudentImportPage').then((m) => ({ default: m.StudentImportPage })));
const TutorFilesPage = lazy(() => import('./pages/tutorFiles/TutorFilesPage').then((m) => ({ default: m.TutorFilesPage })));
const InventoryPage = lazy(() => import('./pages/inventory/InventoryPage').then((m) => ({ default: m.InventoryPage })));
const InventoryCountPage = lazy(() => import('./pages/inventory/InventoryPage').then((m) => ({ default: m.InventoryCountPage })));
const ExamsPage = lazy(() => import('./pages/school/ExamsPage').then((m) => ({ default: m.ExamsPage })));
const CommonFinalsPage = lazy(() => import('./pages/school/ExamsPage').then((m) => ({ default: m.CommonFinalsPage })));
const ExamSheetPage = lazy(() => import('./pages/school/ExamsPage').then((m) => ({ default: m.ExamSheetPage })));
const PayrollRunPage = lazy(() => import('./pages/school/PayrollPage').then((m) => ({ default: m.PayrollRunPage })));
const SchoolSettingsPage = lazy(() => import('./pages/school/SchoolSettingsPage').then((m) => ({ default: m.SchoolSettingsPage })));
const ChildrenPage = lazy(() => import('./pages/hope/ChildrenPage').then((m) => ({ default: m.ChildrenPage })));
const RegisterChildPage = lazy(() => import('./pages/hope/RegisterChildPage').then((m) => ({ default: m.RegisterChildPage })));
const ChildPage = lazy(() => import('./pages/hope/ChildPage').then((m) => ({ default: m.ChildPage })));
const HopeChatPage = lazy(() => import('./pages/hope/HopeChatsPage').then((m) => ({ default: m.HopeChatPage })));
const HopePastRegisterPage = lazy(() => import('./pages/hope/PastRegisterPage').then((m) => ({ default: m.PastRegisterPage })));
const HopeAttendancePage = lazy(() => import('./pages/hope/HopeAttendancePage').then((m) => ({ default: m.HopeAttendancePage })));
const HopeAttendanceDayPage = lazy(() => import('./pages/hope/HopeAttendancePage').then((m) => ({ default: m.HopeAttendanceDayPage })));
const HopeRecordsPage = lazy(() => import('./pages/hope/HopeRecordsPage').then((m) => ({ default: m.HopeRecordsPage })));
const HopeBinPage = lazy(() => import('./pages/hope/HopeBinPage').then((m) => ({ default: m.HopeBinPage })));
const HopeMorePage = lazy(() => import('./pages/hope/HopeMorePage').then((m) => ({ default: m.HopeMorePage })));
const HopePhotosPage = lazy(() => import('./pages/hope/HopePhotosPage').then((m) => ({ default: m.HopePhotosPage })));
const CirclePhotosPage = lazy(() => import('./pages/hope/HopePhotosPage').then((m) => ({ default: m.CirclePhotosPage })));
const CircleVaultPage = lazy(() => import('./pages/hope/HopeChatsPage').then((m) => ({ default: m.CircleVaultPage })));
const CircleChatPage = lazy(() => import('./pages/hope/HopeChatsPage').then((m) => ({ default: m.CircleChatPage })));
const HopeReportsPage = lazy(() => import('./pages/hope/HopeReportsPage').then((m) => ({ default: m.HopeReportsPage })));
const KidsRegisterPage = lazy(() => import('./pages/hope/KidsRegisterPage').then((m) => ({ default: m.KidsRegisterPage })));
const ClubsPage = lazy(() => import('./pages/hope/ClubsPage').then((m) => ({ default: m.ClubsPage })));
const ClubPage = lazy(() => import('./pages/hope/ClubPage').then((m) => ({ default: m.ClubPage })));
const ChildImportPage = lazy(() => import('./pages/hope/ChildImportPage').then((m) => ({ default: m.ChildImportPage })));
const HopeMessagesPage = lazy(() => import('./pages/hope/HopeMessagesPage').then((m) => ({ default: m.HopeMessagesPage })));
const SponsorListPage = lazy(() => import('./pages/hope/SponsorListPage').then((m) => ({ default: m.SponsorListPage })));
const PhotoUploadPage = lazy(() => import('./pages/hope/PhotoUploadPage').then((m) => ({ default: m.PhotoUploadPage })));
const GatePage = lazy(() => import('./pages/hope/GatePage').then((m) => ({ default: m.GatePage })));
const HopeUploadPage = lazy(() => import('./pages/hope/HopeUploadPage').then((m) => ({ default: m.HopeUploadPage })));

export function App() {
  const { user, profile, loading, signOut } = useAuth();
  const settings = useAppSettings();
  const path = useLocation().pathname;
  // The class check-in and a student's progress page are open to anyone too (Freedom 252, 2026-11-09).
  const welcome = path.startsWith('/welcome/') || path.startsWith('/join/') || path.startsWith('/class/') || path === '/install';
  const onIdle = useCallback(() => { void signOut(); }, [signOut]);
  // Anyone who handles money signs out after 10 idle minutes on any device (Andy, 2026-10-24).
  const handlesMoney = (profile?.permissions ?? []).some((x) => x === 'users.manage' || x.startsWith('pettycash.'));
  const shared = isSharedDevice() && settings.inactivityMinutes > 0;
  const idleMinutes = handlesMoney ? Math.min(MONEY_IDLE_MINUTES, shared ? settings.inactivityMinutes : MONEY_IDLE_MINUTES) : settings.inactivityMinutes;
  useIdleSignOut(idleMinutes, !!user && (shared || handlesMoney), onIdle);

  // The visitor's own card behind the QR poster: open to anyone, no sign-in (Andy, 2026-10-31, 3A).
  if (welcome) {
    return (
      <Suspense fallback={<div className="splash" aria-busy="true"><span className="splash-mark" />Loading…</div>}>
        {/* A church-green background so the white form stands out on a phone (Andy, 2026-11-02). */}
        <div className="public-bg">
          <Routes>
            <Route path="/welcome/:orgId" element={<WelcomeCardPage />} />
            <Route path="/join/:orgId" element={<JoinFamilyPage />} />
            <Route path="/class/:orgId/p/:token" element={<ClassProgressPage />} />
            <Route path="/class/:orgId/:eventId" element={<ClassCheckInPage />} />
            <Route path="/install" element={<InstallPage />} />
          </Routes>
        </div>
      </Suspense>
    );
  }
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
      <Route path="/class-qr/:orgId/:programId" element={<RequirePermission permission="attendance.write"><ClassQrPage /></RequirePermission>} />
      <Route path="*" element={<AppRoutes />} />
    </Routes>
    </Suspense>
  );
}

/** v182 (4A): meals are counted on the day's page. Old links to /hope/meals?d= open that day. */
function MealsMoved() {
  const d = new URLSearchParams(useLocation().search).get('d');
  return <Navigate to={d && /^\d{4}-\d{2}-\d{2}$/.test(d) ? `/hope/attendance/${d}#meals` : '/hope/attendance/today#meals'} replace />;
}

function AppRoutes() {
  return (
    <AppShell>
      <Suspense fallback={<p className="muted" aria-busy="true">Loading…</p>}>
      <Routes>
        <Route path="/" element={<TodayPage />} />
        <Route path="/attendance" element={<AttendancePage />} />
        <Route path="/attendance/past" element={<RequirePermission permission="attendance.write"><PastRegisterPage /></RequirePermission>} />
        <Route path="/tutor-files" element={<TutorFilesPage />} />
        <Route path="/inventory" element={<InventoryPage />} />
        <Route path="/inventory/:countId" element={<InventoryCountPage />} />
        <Route path="/attendance/:orgId/:eventId" element={<EventPage />} />
        <Route path="/programs" element={<RequirePermission permission="people.read"><ProgramsPage /></RequirePermission>} />
        <Route path="/programs/:orgId/new" element={<RequirePermission permission="settings.manage"><ProgramFormPage /></RequirePermission>} />
        <Route path="/programs/:orgId/:programId" element={<RequirePermission permission="people.read"><ProgramPage /></RequirePermission>} />
        <Route path="/programs/:orgId/:programId/register" element={<RequirePermission permission="people.read"><RegisterPage /></RequirePermission>} />
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
        <Route path="/giving/dashboard" element={<Navigate to="/reports?tab=giving" replace />} />
        <Route path="/people/signups" element={<SignupsPage />} />
        <Route path="/people/join-qr" element={<RequirePermission permission="people.write"><JoinPosterPage /></RequirePermission>} />
        <Route path="/visitors/qr" element={<RequirePermission permission="people.write"><WelcomePosterPage /></RequirePermission>} />
        <Route path="/giving/pledges" element={<RequirePermission permission="giving.person.read"><PledgesPage /></RequirePermission>} />
        <Route path="/giving/statements" element={<RequirePermission permission="giving.person.read"><StatementsPage /></RequirePermission>} />
        <Route path="/giving/:orgId/:giftId" element={<RequirePermission anyOf={['gifts.write', 'giving.person.read']}><GiftPage /></RequirePermission>} />
        <Route path="/follow-ups" element={<RequirePermission permission="followups.manage"><FollowUpsPage /></RequirePermission>} />
        <Route path="/follow-ups/reminders" element={<RequirePermission permission="followups.manage"><RemindersPage /></RequirePermission>} />
        <Route path="/dashboard" element={<Navigate to="/reports" replace />} />
        <Route path="/reports" element={<RequirePermission permission="people.read"><ReportsPage /></RequirePermission>} />
        <Route path="/reports/:orgId/:reportId" element={<RequirePermission permission="people.read"><ReportPage /></RequirePermission>} />
        <Route path="/visitors/new" element={<RequirePermission permission="people.write"><PersonFormPage visitor /></RequirePermission>} />
        <Route path="/people" element={<RequirePermission permission="people.read"><PeoplePage /></RequirePermission>} />
        <Route path="/people/new" element={<RequirePermission permission="people.write"><PersonFormPage /></RequirePermission>} />
        <Route path="/people/:orgId/:personId" element={<RequirePermission permission="people.read"><PersonPage /></RequirePermission>} />
        <Route path="/people/:orgId/:personId/edit" element={<RequirePermission permission="people.write"><PersonFormPage /></RequirePermission>} />
        <Route path="/school" element={<Navigate to="/school/students" replace />} />
        <Route path="/school/students" element={<RequirePermission permission="people.read"><StudentsPage /></RequirePermission>} />
        <Route path="/school/students/new" element={<RequirePermission permission="people.write"><EnrolPage /></RequirePermission>} />
        <Route path="/school/students/import" element={<RequirePermission permission="people.write"><StudentImportPage /></RequirePermission>} />
        <Route path="/school/students/:studentId" element={<RequirePermission permission="people.read"><StudentPage /></RequirePermission>} />
        <Route path="/school/courses" element={<RequirePermission permission="people.read"><CoursesPage /></RequirePermission>} />
        {/* The old School Results tab is now part of Exam Records (Andy, 2026-10-24). */}
        <Route path="/school/results" element={<Navigate to="/school/exams?tab=results" replace />} />
        <Route path="/school/fees" element={<RequirePermission anyOf={['gifts.write', 'finance.reports', 'giving.person.read']}><FeesPage /></RequirePermission>} />
        <Route path="/school/graduation" element={<RequirePermission permission="people.read"><GraduationPage /></RequirePermission>} />
        <Route path="/school/reports" element={<RequirePermission anyOf={['finance.reports', 'settings.manage']}><SchoolReportsPage /></RequirePermission>} />
        <Route path="/school/petty-cash" element={<RequirePermission anyOf={['pettycash.request', 'pettycash.check', 'pettycash.approve', 'pettycash.authorize', 'users.manage']}><PettyCashPage /></RequirePermission>} />
        <Route path="/school/petty-cash/new" element={<RequirePermission anyOf={['pettycash.request', 'pettycash.check', 'pettycash.approve', 'pettycash.authorize', 'users.manage']}><NewRequisitionPage /></RequirePermission>} />
        <Route path="/school/petty-cash/receipts" element={<RequirePermission anyOf={['pettycash.request', 'pettycash.check', 'pettycash.approve', 'pettycash.authorize', 'users.manage']}><PettyReceiptsPage /></RequirePermission>} />
        <Route path="/school/petty-cash/month-end" element={<RequirePermission anyOf={['pettycash.request', 'pettycash.check', 'pettycash.approve', 'pettycash.authorize', 'users.manage']}><PettyMonthEndPage /></RequirePermission>} />
        <Route path="/school/petty-cash/reports" element={<RequirePermission anyOf={['pettycash.request', 'pettycash.check', 'pettycash.approve', 'pettycash.authorize', 'users.manage']}><PettyReportsPage /></RequirePermission>} />
        <Route path="/school/petty-cash/balance-sheet" element={<RequirePermission anyOf={['pettycash.request', 'pettycash.check', 'pettycash.approve', 'pettycash.authorize', 'users.manage']}><PettyBalanceSheetPage /></RequirePermission>} />
        <Route path="/school/petty-cash/budget" element={<RequirePermission anyOf={['pettycash.request', 'pettycash.check', 'pettycash.approve', 'pettycash.authorize', 'users.manage']}><PettyBudgetPage /></RequirePermission>} />
        <Route path="/school/petty-cash/bin" element={<RequirePermission anyOf={['pettycash.request', 'pettycash.check', 'pettycash.approve', 'pettycash.authorize', 'users.manage']}><PettyBinPage /></RequirePermission>} />
        <Route path="/school/petty-cash/:reqId" element={<RequirePermission anyOf={['pettycash.request', 'pettycash.check', 'pettycash.approve', 'pettycash.authorize', 'users.manage']}><RequisitionPage /></RequirePermission>} />
        <Route path="/school/exams" element={<RequirePermission anyOf={['exams.mark', 'exams.manage', 'users.manage']}><ExamsPage /></RequirePermission>} />
        <Route path="/school/exams/finals/:one/:two" element={<RequirePermission anyOf={['exams.mark', 'exams.manage', 'users.manage']}><CommonFinalsPage /></RequirePermission>} />
        <Route path="/school/exams/past" element={<RequirePermission anyOf={['exams.manage', 'users.manage']}><PastResultsPage /></RequirePermission>} />
        <Route path="/school/exams/sheet/:sheetId" element={<RequirePermission anyOf={['exams.mark', 'exams.manage', 'users.manage']}><ExamSheetPage /></RequirePermission>} />
        <Route path="/school/payroll" element={<RequirePermission anyOf={['payroll.manage', 'payroll.approve', 'users.manage']}><PayrollPage /></RequirePermission>} />
        <Route path="/school/payroll/staff" element={<RequirePermission anyOf={['payroll.manage', 'payroll.approve', 'users.manage']}><PayrollStaffPage /></RequirePermission>} />
        <Route path="/school/payroll/staff/:staffId" element={<RequirePermission anyOf={['payroll.manage', 'payroll.approve', 'users.manage']}><PayrollPersonPage /></RequirePermission>} />
        <Route path="/school/payroll/:month" element={<RequirePermission anyOf={['payroll.manage', 'payroll.approve', 'users.manage']}><PayrollRunPage /></RequirePermission>} />
        <Route path="/school/settings" element={<RequirePermission permission="settings.manage"><SchoolSettingsPage /></RequirePermission>} />
        <Route path="/hope" element={<Navigate to="/" replace />} />
        <Route path="/hope/children" element={<RequirePermission permission="people.read"><ChildrenPage /></RequirePermission>} />
        <Route path="/hope/children/new" element={<RequirePermission permission="people.write"><RegisterChildPage /></RequirePermission>} />
        <Route path="/hope/children/import" element={<RequirePermission permission="people.write"><ChildImportPage /></RequirePermission>} />
        <Route path="/hope/messages" element={<RequirePermission permission="people.write"><HopeMessagesPage /></RequirePermission>} />
        <Route path="/hope/children/sponsors" element={<RequirePermission permission="people.write"><SponsorListPage /></RequirePermission>} />
        <Route path="/hope/gate" element={<RequirePermission permission="attendance.write"><GatePage /></RequirePermission>} />
        <Route path="/hope/upload" element={<RequirePermission permission="people.write"><HopeUploadPage /></RequirePermission>} />
        <Route path="/hope/children/photos" element={<RequirePermission permission="people.write"><PhotoUploadPage /></RequirePermission>} />
        <Route path="/hope/consent" element={<Navigate to="/hope/children?show=consent" replace />} />
        <Route path="/hope/register/upload" element={<RequirePermission permission="people.write"><HopePastRegisterPage /></RequirePermission>} />
        <Route path="/hope/register" element={<RequirePermission anyOf={['people.read', 'attendance.write']}><KidsRegisterPage /></RequirePermission>} />
        <Route path="/hope/clubs" element={<RequirePermission anyOf={['people.read', 'attendance.write']}><ClubsPage /></RequirePermission>} />
        <Route path="/hope/clubs/:clubId" element={<RequirePermission anyOf={['people.read', 'attendance.write']}><ClubPage /></RequirePermission>} />
        <Route path="/hope/champions" element={<Navigate to="/hope/register?w=champions" replace />} />
        <Route path="/hope/children/:childId" element={<RequirePermission permission="people.read"><ChildPage /></RequirePermission>} />
        {/* Who sees which photo report is checked by the server (Andy, 2026-11-04, 3A): board members without Hope work open it from the email link. */}
        <Route path="/hope/photos" element={<HopePhotosPage />} />
        <Route path="/hope/chats" element={<Navigate to="/hope/records?show=chats" replace />} />
        <Route path="/hope/chats/:id" element={<HopeChatPage />} />
        {/* The same conversations at ADIA and Freedom Church (Andy, 2026-11-07); the server checks who reads what. */}
        <Route path="/school/updates" element={<CirclePhotosPage type="college" />} />
        <Route path="/school/conversations" element={<CircleVaultPage type="college" />} />
        <Route path="/school/conversations/:id" element={<CircleChatPage type="college" />} />
        <Route path="/updates" element={<CirclePhotosPage type="church_campus" />} />
        <Route path="/conversations" element={<CircleVaultPage type="church_campus" />} />
        <Route path="/conversations/:id" element={<CircleChatPage type="church_campus" />} />
        <Route path="/hope/attendance" element={<HopeAttendancePage />} />
        <Route path="/hope/attendance/:date" element={<HopeAttendanceDayPage />} />
        <Route path="/hope/records" element={<HopeRecordsPage />} />
        <Route path="/hope/meals" element={<MealsMoved />} />
        <Route path="/hope/bin" element={<HopeBinPage />} />
        <Route path="/hope/more" element={<HopeMorePage />} />
        <Route path="/hope/reports" element={<RequirePermission permission="people.read"><HopeReportsPage /></RequirePermission>} />
        <Route path="/hope/petty-cash" element={<RequirePermission anyOf={['pettycash.request', 'pettycash.check', 'pettycash.approve', 'pettycash.authorize', 'users.manage']}><PettyCashPage /></RequirePermission>} />
        <Route path="/hope/petty-cash/new" element={<RequirePermission anyOf={['pettycash.request', 'pettycash.check', 'pettycash.approve', 'pettycash.authorize', 'users.manage']}><NewRequisitionPage /></RequirePermission>} />
        <Route path="/hope/petty-cash/receipts" element={<RequirePermission anyOf={['pettycash.request', 'pettycash.check', 'pettycash.approve', 'pettycash.authorize', 'users.manage']}><PettyReceiptsPage /></RequirePermission>} />
        <Route path="/hope/petty-cash/month-end" element={<RequirePermission anyOf={['pettycash.request', 'pettycash.check', 'pettycash.approve', 'pettycash.authorize', 'users.manage']}><PettyMonthEndPage /></RequirePermission>} />
        <Route path="/hope/petty-cash/reports" element={<RequirePermission anyOf={['pettycash.request', 'pettycash.check', 'pettycash.approve', 'pettycash.authorize', 'users.manage']}><PettyReportsPage /></RequirePermission>} />
        <Route path="/hope/petty-cash/balance-sheet" element={<RequirePermission anyOf={['pettycash.request', 'pettycash.check', 'pettycash.approve', 'pettycash.authorize', 'users.manage']}><PettyBalanceSheetPage /></RequirePermission>} />
        <Route path="/hope/petty-cash/budget" element={<RequirePermission anyOf={['pettycash.request', 'pettycash.check', 'pettycash.approve', 'pettycash.authorize', 'users.manage']}><PettyBudgetPage /></RequirePermission>} />
        <Route path="/hope/petty-cash/bin" element={<RequirePermission anyOf={['pettycash.request', 'pettycash.check', 'pettycash.approve', 'pettycash.authorize', 'users.manage']}><PettyBinPage /></RequirePermission>} />
        <Route path="/hope/petty-cash/:reqId" element={<RequirePermission anyOf={['pettycash.request', 'pettycash.check', 'pettycash.approve', 'pettycash.authorize', 'users.manage']}><RequisitionPage /></RequirePermission>} />
        <Route path="/finance" element={<RequirePermission anyOf={['finance.reports', 'pettycash.approve', 'pettycash.check', 'pettycash.authorize', 'users.manage']}><FinancePage /></RequirePermission>} />
        <Route path="/petty-cash" element={<RequirePermission anyOf={['pettycash.request', 'pettycash.check', 'pettycash.approve', 'pettycash.authorize', 'users.manage']}><PettyCashPage /></RequirePermission>} />
        <Route path="/petty-cash/new" element={<RequirePermission anyOf={['pettycash.request', 'pettycash.check', 'pettycash.approve', 'pettycash.authorize', 'users.manage']}><NewRequisitionPage /></RequirePermission>} />
        <Route path="/petty-cash/receipts" element={<RequirePermission anyOf={['pettycash.request', 'pettycash.check', 'pettycash.approve', 'pettycash.authorize', 'users.manage']}><PettyReceiptsPage /></RequirePermission>} />
        <Route path="/petty-cash/month-end" element={<RequirePermission anyOf={['pettycash.request', 'pettycash.check', 'pettycash.approve', 'pettycash.authorize', 'users.manage']}><PettyMonthEndPage /></RequirePermission>} />
        <Route path="/petty-cash/reports" element={<RequirePermission anyOf={['pettycash.request', 'pettycash.check', 'pettycash.approve', 'pettycash.authorize', 'users.manage']}><PettyReportsPage /></RequirePermission>} />
        <Route path="/petty-cash/balance-sheet" element={<RequirePermission anyOf={['pettycash.request', 'pettycash.check', 'pettycash.approve', 'pettycash.authorize', 'users.manage']}><PettyBalanceSheetPage /></RequirePermission>} />
        <Route path="/petty-cash/budget" element={<RequirePermission anyOf={['pettycash.request', 'pettycash.check', 'pettycash.approve', 'pettycash.authorize', 'users.manage']}><PettyBudgetPage /></RequirePermission>} />
        <Route path="/petty-cash/bin" element={<RequirePermission anyOf={['pettycash.request', 'pettycash.check', 'pettycash.approve', 'pettycash.authorize', 'users.manage']}><PettyBinPage /></RequirePermission>} />
        <Route path="/petty-cash/:reqId" element={<RequirePermission anyOf={['pettycash.request', 'pettycash.check', 'pettycash.approve', 'pettycash.authorize', 'users.manage']}><RequisitionPage /></RequirePermission>} />
        <Route path="/hope/exports" element={<Navigate to="/hope/children" replace />} />
        <Route path="/settings" element={<SettingsPage />} />
        <Route path="/settings/my-password" element={<RequireAccountKeeper><ChangePasswordPage voluntary /></RequireAccountKeeper>} />
        <Route path="/settings/signing-pin" element={<RequirePermission anyOf={['pettycash.request', 'pettycash.check', 'pettycash.approve', 'pettycash.authorize', 'users.manage']}><SigningPinPage /></RequirePermission>} />
        <Route path="/settings/pipeline" element={<RequirePermission permission="settings.manage"><PipelineSettingsPage /></RequirePermission>} />
        <Route path="/settings/custom-fields" element={<RequirePermission permission="settings.manage"><CustomFieldsPage /></RequirePermission>} />
        <Route path="/settings/birthday-card" element={<RequirePermission permission="settings.manage"><BirthdayCardPage /></RequirePermission>} />
        <Route path="/settings/funds" element={<RequirePermission permission="settings.manage"><FundsPage /></RequirePermission>} />
        <Route path="/settings/reports" element={<RequirePermission permission="settings.manage"><ReportSettingsPage /></RequirePermission>} />
        <Route path="/settings/whatsapp" element={<RequirePermission permission="settings.manage"><WhatsAppSettingsPage /></RequirePermission>} />
        <Route path="/settings/templates" element={<RequirePermission permission="settings.manage"><TemplatesPage /></RequirePermission>} />
        <Route path="/settings/device" element={<DevicePage />} />
        <Route path="/settings/group/:group" element={<SettingsGroupPage />} />
        <Route path="/settings/organizations" element={<RequirePermission permission="settings.manage"><OrganizationsPage /></RequirePermission>} />
        <Route path="/settings/organizations/new" element={<RequirePermission permission="settings.manage"><OrganizationFormPage /></RequirePermission>} />
        <Route path="/settings/organizations/:orgId" element={<RequirePermission permission="settings.manage"><OrganizationFormPage /></RequirePermission>} />
        <Route path="/settings/cleanup" element={<RequireAccountKeeper><CleanupPage /></RequireAccountKeeper>} />
        <Route path="/settings/users" element={<RequireAccountKeeper><UsersPage /></RequireAccountKeeper>} />
        <Route path="/settings/users/new" element={<RequireAccountKeeper><UserFormPage /></RequireAccountKeeper>} />
        <Route path="/settings/users/:uid" element={<RequireAccountKeeper><UserFormPage /></RequireAccountKeeper>} />
        <Route path="/settings/data" element={<RequirePermission permission="data.export"><DataPage /></RequirePermission>} />
        <Route path="/help" element={<HelpPage />} />
        <Route path="/notice" element={<NoticePage />} />
        <Route path="/ai" element={<AiHelperPage />} />
        <Route path="/more" element={<MorePage />} />
        <Route path="/settings/audit" element={<RequirePermission permission="audit.read"><AuditLogPage /></RequirePermission>} />
        <Route path="/sign-in" element={<Navigate to="/" replace />} />
        <Route path="*" element={<NotFoundPage />} />
      </Routes>
      </Suspense>
    </AppShell>
  );
}
