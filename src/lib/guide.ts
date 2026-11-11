import type { Permission } from '../../functions/src/shared/permissions';
import { pettyCashBase } from '../../functions/src/shared/pettyCash';
import { helpFor } from './pageHelp';

/**
 * "Just ask Andy" (Andy, 2026-11-11, 1A-8A): the map of the app that the helper answers from. Each topic says where a
 * job is, how to do it in a few steps, and who may open it. Most questions are answered from this list on the phone,
 * at no cost; only a question it cannot place goes to the AI, which reads this same list and nothing else.
 */
export type OrgKind = 'church_campus' | 'college' | 'ministry';
const C: OrgKind[] = ['church_campus'];
const A: OrgKind[] = ['college'];
const H: OrgKind[] = ['ministry'];
const ALL: OrgKind[] = ['church_campus', 'college', 'ministry'];

const PETTY: Permission[] = ['pettycash.request', 'pettycash.check', 'pettycash.approve', 'pettycash.authorize', 'users.manage'];
const SIGNERS: Permission[] = ['pettycash.check', 'pettycash.approve', 'pettycash.authorize', 'users.manage'];

export interface GuideTopic {
  id: string;
  title: string;
  orgs: OrgKind[];
  /** The page "Take me there" opens. `@petty` is the organisation's own petty cash address. */
  path: string;
  /** Any one of these opens it. Left out: everyone. */
  need?: Permission[];
  /** Only Andrew Guya and Doreen (staff accounts and passwords). */
  keeper?: boolean;
  /** Extra words people use for it. */
  words: string;
  /** How to get there from the menu. */
  where: string;
  /** The steps; left out, the page's own "?" help is used. */
  steps?: string[];
}

export const GUIDE: GuideTopic[] = [
  // Everyone
  { id: 'today', title: 'The Today page', orgs: ALL, path: '/', words: 'home start main dashboard front first page beginning', where: 'Press Today in the menu.' },
  { id: 'petty-new', title: 'Ask for petty cash (new requisition)', orgs: ALL, path: '@petty/new', need: PETTY, words: 'petty cash request requisition money buy purchase need voucher spend ask funds', where: 'Petty Cash in the menu, then New requisition.',
    steps: ['Open Petty Cash and press New requisition.', 'Choose the category, write the items with quantity and price. You can also say what you need and press Fill the form for me.', 'Press Submit requisition. Two signers approve it before money is paid.'] },
  { id: 'petty-sign', title: 'Approve or sign a requisition', orgs: ALL, path: '@petty', need: SIGNERS, words: 'approve sign signature authorise authorize waiting pending check reject decline', where: 'Petty Cash in the menu. Requisitions waiting for you are at the top.',
    steps: ['Open Petty Cash. What is waiting for you is at the top.', 'Open the requisition, read it, and press Approve (or Decline with a reason).', 'Type your signing PIN. Two different signers must approve, and nobody approves their own.'] },
  { id: 'petty-receipts', title: 'Add a receipt to a requisition', orgs: ALL, path: '@petty/receipts', need: PETTY, words: 'receipt proof invoice attach upload paid bank payments match', where: 'Petty Cash in the menu, then the Receipts tab.' },
  { id: 'petty-reports', title: 'Petty cash monthly report', orgs: ALL, path: '@petty/reports', need: PETTY, words: 'petty report monthly excel pdf summary spent total', where: 'Petty Cash in the menu, then the Reports tab.' },
  { id: 'petty-status', title: 'See where my requisition is', orgs: ALL, path: '@petty', need: PETTY, words: 'my requisition status where stuck approved paid track progress', where: 'Petty Cash in the menu, Overview tab.',
    steps: ['Open Petty Cash.', 'Find your requisition in the list. Its badge says Waiting, Approved or Paid.', 'Open it to see who has signed and who still needs to.'] },
  { id: 'signing-pin', title: 'Set or change my signing PIN', orgs: ALL, path: '/settings/signing-pin', need: PETTY, words: 'pin signing pin forgot change set code', where: 'Settings, then Signing PIN (on Church, Settings is under More).',
    steps: ['Open Settings and press Signing PIN.', 'Type your new PIN twice.', 'Press Save. Use it each time you sign a requisition.'] },
  { id: 'password', title: 'Change or reset a password', orgs: ALL, path: '/settings/device', words: 'password forgot reset change login sign in locked', where: 'Settings, then This device.',
    steps: ['Only Mr Andrew and Doreen can set or reset a password.', 'If you forgot yours, please ask Mr Andrew to reset it.', 'Then sign in with the new password he gives you.'] },
  { id: 'staff-accounts', title: 'Add a staff account or set access', orgs: ALL, path: '/settings/users', keeper: true, words: 'staff account user add new login access role permission give', where: 'Settings, then Staff accounts.' },
  { id: 'signout', title: 'Sign out', orgs: ALL, path: '/settings', words: 'sign out log out logout leave exit', where: 'Settings (on Church, under More).',
    steps: ['Open Settings. On Freedom Church, press More first.', 'Scroll to the bottom of the page.', 'Press Sign out.'] },
  { id: 'device', title: 'Install the app, offline use and dark screen', orgs: ALL, path: '/settings/device', words: 'install phone home screen offline internet network sync theme dark light update', where: 'Settings, then This device.',
    steps: ['The app works without internet. What you save is sent when the signal returns.', 'To install it, open Settings, then This device, and press Install.', 'The small badge at the top shows changes still waiting to send.'] },
  { id: 'switch-org', title: 'Move between Church, ADIA and Hope', orgs: ALL, path: '/', words: 'switch change organisation organization adia hope church campus other', where: 'The name at the top of the menu.',
    steps: ['Press the organisation name at the top of the side menu.', 'Choose the one you want.', 'You only see the ones your account belongs to.'] },
  { id: 'ai-helper', title: 'All the AI helps', orgs: ALL, path: '/ai', words: 'ai helper artificial intelligence write draft gold sparkle', where: 'Open Just ask Andy and tap the gold AI helper link.' },
  { id: 'ask', title: 'Ask a question about the numbers', orgs: ALL, path: '/ask', need: ['pastoral.read', 'finance.reports', 'settings.manage', 'users.manage'], words: 'how many numbers figures attendance last week total question statistics', where: 'AI Helper, then Ask the app.' },
  { id: 'finance', title: 'Bank statements and financial statements', orgs: ALL, path: '/finance', need: ['finance.reports', 'pettycash.approve', 'pettycash.check', 'pettycash.authorize', 'users.manage'], words: 'bank statement financial statements income expenditure family bank balance sort lines accounts close month', where: 'Petty Cash, then Financial statements.',
    steps: ['Open Financial statements.', 'Upload the bank statement PDF and check the lines. Ask the helper to sort lines with no category.', 'Read the income and expenditure, and close the month when it is right.'] },

  // Freedom Church
  { id: 'people', title: 'Find a person', orgs: C, path: '/people', need: ['people.read'], words: 'find search member person people name phone contact look', where: 'People in the menu, or the search at the top.' },
  { id: 'visitor', title: 'Add a visitor (first-timer)', orgs: C, path: '/visitors/new', need: ['people.write'], words: 'visitor new first time first-timer guest add welcome came', where: 'Today or Service, then Add visitor.' },
  { id: 'person-new', title: 'Add a member', orgs: C, path: '/people/new', need: ['people.write'], words: 'add new member person register join enrol', where: 'People in the menu, then Add person.' },
  { id: 'person-edit', title: 'Change a person’s details', orgs: C, path: '/people', need: ['people.write'], words: 'edit change update correct phone number name details address member', where: 'People, open the person, then Edit.',
    steps: ['Open People and find the person.', 'Open their page and press Edit.', 'Change the details and press Save.'] },
  { id: 'family', title: 'Families', orgs: C, path: '/people', need: ['people.read'], words: 'family household spouse child children parent wedding married anniversary', where: 'People, open a person, then the Family box.',
    steps: ['Open People and open one person in the family.', 'In the Family box, add the spouse or children.', 'The whole family can then be checked in together on Sunday.'] },
  { id: 'status', title: 'Change someone’s status (visitor, member)', orgs: C, path: '/people', keeper: true, words: 'status member visitor regular change badge promote', where: 'People, then the badge next to the name.' },
  { id: 'service', title: 'Sunday check-in and attendance', orgs: C, path: '/attendance', need: ['attendance.write', 'people.read'], words: 'sunday service attendance check in checkin came present door register', where: 'Service in the menu.' },
  { id: 'headcount', title: 'Enter the Sunday headcount', orgs: C, path: '/attendance', need: ['attendance.write'], words: 'headcount count adults teens children whole church salvations first-time numbers', where: 'Service in the menu, then the service.',
    steps: ['Open Service and choose today’s service.', 'Type Adults, Teens, Children (or Whole church), First-time and Salvations.', 'Press Save. The weekly report uses these numbers.'] },
  { id: 'welcome', title: 'Welcome this week’s first-timers', orgs: C, path: '/attendance', need: ['pastoral.read', 'followups.manage', 'settings.manage'], words: 'welcome first-timers visitors message thank whatsapp new people', where: 'Service in the menu, First-timers this week.',
    steps: ['Open Service and scroll to First-timers this week.', 'Press Draft welcome messages.', 'Press Send welcome on each one. WhatsApp opens; read it and send.'] },
  { id: 'reach', title: 'People to reach today (follow-ups)', orgs: C, path: '/', need: ['followups.manage'], words: 'follow up followup reach call message whatsapp today care visit absent missing', where: 'Today, Needs you today, then People to reach.',
    steps: ['On Today, tap People to reach in Needs you today.', 'Press a name and choose WhatsApp or Call.', 'When done, mark it Done: message sent or Done: we spoke.'] },
  { id: 'whatsapp', title: 'Send someone a WhatsApp message', orgs: C, path: '/people', need: ['people.read'], words: 'whatsapp message text send sms write', where: 'People, open the person, then WhatsApp.',
    steps: ['Open the person’s page and press WhatsApp.', 'Choose the message. Press Write it for me to make it warmer.', 'Press Open WhatsApp and send it there.'] },
  { id: 'birthdays', title: 'Birthdays and wedding anniversaries', orgs: C, path: '/', need: ['people.read'], words: 'birthday birthdays anniversary card greeting celebrate', where: 'Today, Celebrations this week.',
    steps: ['On Today, look at Celebrations this week.', 'Press Send card to share the birthday card.', 'Anniversaries show on Today too, with a greeting button.'] },
  { id: 'giving-record', title: 'Record a gift and send a receipt', orgs: C, path: '/giving/new', need: ['gifts.write'], words: 'gift tithe offering record give giving money mpesa cash receipt donation', where: 'Giving in the menu, then Record one gift.' },
  { id: 'giving-import', title: 'Upload the Paybill statement', orgs: C, path: '/giving/import', need: ['gifts.write'], words: 'import upload paybill statement mpesa excel csv 222118', where: 'Giving, then More giving, then Import.' },
  { id: 'unassigned', title: 'Payments with no name', orgs: C, path: '/giving/unassigned', need: ['gifts.write'], words: 'unassigned who sent unknown match payment no name', where: 'Giving, then Unassigned.' },
  { id: 'statements', title: 'Giving statements for members', orgs: C, path: '/giving/statements', need: ['giving.person.read'], words: 'giving statement member tax year annual', where: 'Giving, then More giving, then Statements.' },
  { id: 'pledges', title: 'Pledges', orgs: C, path: '/giving/pledges', need: ['giving.person.read'], words: 'pledge pledges promise building', where: 'Giving, then More giving, then Pledges.' },
  { id: 'reports', title: 'Weekly and monthly reports', orgs: C, path: '/reports', need: ['people.read'], words: 'report reports weekly monthly week month last scorecard pdf briefing growth', where: 'More, then Reports.' },
  { id: 'programmes', title: 'Classes and programmes (Freedom 252)', orgs: C, path: '/programs', need: ['people.read'], words: 'class classes programme program group team course freedom 252 growth track register', where: 'People, then Classes and programmes.',
    steps: ['Open People and press Classes and programmes.', 'Open the class, for example Freedom 252.', 'Press Register to mark who came.'] },
  { id: 'updates', title: 'Photos and wins', orgs: C, path: '/updates', words: 'photo photos wins testimony testimonies event incident good news', where: 'More, then Photos and wins.' },
  { id: 'conversations', title: 'Private conversations', orgs: C, path: '/conversations', words: 'private conversation worry concern confidential pastoral', where: 'More, then Private conversations.' },
  { id: 'notice', title: 'Write a WhatsApp group notice', orgs: C, path: '/notice', need: ['pastoral.read', 'followups.manage', 'settings.manage'], words: 'notice announcement group whatsapp event invite', where: 'More, then Write a notice.' },
  { id: 'templates', title: 'Change the words of WhatsApp messages', orgs: C, path: '/settings/templates', need: ['settings.manage'], words: 'template templates words message welcome text change', where: 'More, Settings, WhatsApp, then Messages.' },
  { id: 'birthday-card', title: 'Change the birthday card', orgs: C, path: '/settings/birthday-card', need: ['settings.manage'], words: 'birthday card picture design', where: 'More, Settings, then Birthday card.' },
  { id: 'join-qr', title: 'QR poster for visitors to sign up', orgs: C, path: '/visitors/qr', need: ['people.write'], words: 'qr code poster sign up signup form scan join', where: 'Service, First-timers, then QR poster.' },
  { id: 'more', title: 'The More page', orgs: C, path: '/more', words: 'more other menu settings', where: 'More in the menu.' },

  // ADIA Training Centre
  { id: 'register', title: 'Mark the class register', orgs: A, path: '/attendance', need: ['attendance.write'], words: 'register attendance class mark present absent late roll call students came', where: 'Attendance in the menu.' },
  { id: 'register-past', title: 'Mark a register for an earlier day', orgs: A, path: '/attendance/past', need: ['attendance.write'], words: 'past register earlier day yesterday last week missed late upload', where: 'Attendance, then Past register.' },
  { id: 'students', title: 'Find a student', orgs: A, path: '/school/students', need: ['people.read'], words: 'student students find search admission number name cohort', where: 'School in the menu.' },
  { id: 'student-new', title: 'Add a student', orgs: A, path: '/school/students/new', need: ['people.write'], words: 'add new student enrol enroll admit register admission', where: 'School, then Add a student.' },
  { id: 'student-import', title: 'Add students from Excel', orgs: A, path: '/school/students/import', need: ['people.write'], words: 'import excel upload many students list', where: 'School, then Add from Excel.' },
  { id: 'fees', title: 'Record school fees', orgs: A, path: '/school/fees', need: ['gifts.write', 'finance.reports', 'giving.person.read'], words: 'fees fee payment balance arrears owe paid school fees mpesa', where: 'School, then Fees.' },
  { id: 'graduation', title: 'Graduation and certificates', orgs: A, path: '/school/graduation', need: ['people.read'], words: 'graduation graduate certificate finish complete', where: 'School, then Graduation.' },
  { id: 'school-reports', title: 'School reports', orgs: A, path: '/school/reports', need: ['finance.reports', 'settings.manage'], words: 'report reports weekly monthly school principal briefing', where: 'School, then Reports.' },
  { id: 'departments', title: 'Departments and cohorts', orgs: A, path: '/school/courses', need: ['people.read'], words: 'department departments cohort cohorts course courses intake class', where: 'School, then Departments.' },
  { id: 'exams', title: 'Enter exam marks', orgs: A, path: '/school/exams', need: ['exams.mark', 'exams.manage', 'users.manage'], words: 'exam exams marks mark sheet cat cats final finals score test', where: 'Exam Records in the menu.' },
  { id: 'results', title: 'Result slips and remarks', orgs: A, path: '/school/exams?tab=results', need: ['exams.manage', 'users.manage'], words: 'result results slip slips transcript remarks print grade', where: 'Exam Records, then Results.' },
  { id: 'payroll', title: 'Payroll and payslips', orgs: A, path: '/school/payroll', need: ['payroll.manage', 'payroll.approve', 'users.manage'], words: 'payroll salary salaries pay payslip payslips wages', where: 'Payroll in the menu.' },
  { id: 'tutor-files', title: 'Tutor Files', orgs: A, path: '/tutor-files', need: ['exams.mark', 'exams.manage', 'users.manage'], words: 'tutor files notes documents upload scheme lesson plan', where: 'Tutor Files in the menu.' },
  { id: 'inventory', title: 'Count the inventory', orgs: A, path: '/inventory', words: 'inventory count items stock equipment tools broken missing', where: 'Inventory in the menu.' },
  { id: 'school-settings', title: 'School settings (grades, pass mark)', orgs: A, path: '/school/settings', need: ['settings.manage'], words: 'grading grade scale pass mark settings attendance alert', where: 'Settings, then School settings.' },
  { id: 'school-updates', title: 'Photos and wins', orgs: A, path: '/school/updates', words: 'photo photos wins good news incident class event', where: 'Today, then Photos and wins.' },

  // Freedom Hope Center
  { id: 'children', title: 'Find a child', orgs: H, path: '/hope/children', need: ['people.read'], words: 'child children kid kids find search code hc', where: 'Children in the menu.' },
  { id: 'child-new', title: 'Register a child', orgs: H, path: '/hope/children/new', need: ['people.write'], words: 'register new child add enrol enroll admit', where: 'Children, then Register a child.' },
  { id: 'hope-register', title: 'Take the children’s register', orgs: H, path: '/hope/register', need: ['people.read', 'attendance.write'], words: 'register attendance tick came present absent check in saturday shujaa champions', where: 'Registers in the menu.' },
  { id: 'clubs', title: 'Clubs', orgs: H, path: '/hope/clubs', need: ['people.read', 'attendance.write'], words: 'club clubs activity group', where: 'Registers, then Clubs.' },
  { id: 'gate', title: 'I’m here (sign in at the gate)', orgs: H, path: '/hope/gate', need: ['attendance.write'], words: 'gate arrive arrived here staff helper sign in clock', where: 'Today, I’m here.' },
  { id: 'hope-messages', title: 'Message guardians', orgs: H, path: '/hope/messages', need: ['people.write'], words: 'message guardian guardians parent parents whatsapp send', where: 'More, then Messages.' },
  { id: 'sponsors', title: 'Sponsors', orgs: H, path: '/hope/children/sponsors', need: ['people.write'], words: 'sponsor sponsors sponsored onechild compassion', where: 'Children, then Sponsors.' },
  { id: 'child-photos', title: 'Children’s photos', orgs: H, path: '/hope/children/photos', need: ['people.write'], words: 'photo photos picture pictures child face upload', where: 'Children, then Photos.' },
  { id: 'hope-records', title: 'Records, meals and conversations', orgs: H, path: '/hope/records', words: 'records meals food conversations chats notes', where: 'Reports, then Records.' },
  { id: 'hope-reports', title: 'Hope reports', orgs: H, path: '/hope/reports', need: ['people.read'], words: 'report reports weekly monthly figures briefing', where: 'Reports in the menu.' },
  { id: 'hope-past', title: 'Upload an old register', orgs: H, path: '/hope/register/upload', need: ['people.write'], words: 'upload old past register excel paper', where: 'Registers, then Upload.' },
  { id: 'hope-more', title: 'The More page', orgs: H, path: '/hope/more', words: 'more other menu settings', where: 'More in the menu.' },
];

export const orgKind = (type: string | undefined): OrgKind => (type === 'college' || type === 'ministry' ? type : 'church_campus');

/** The real address for this organisation. */
export function topicPath(t: GuideTopic, kind: OrgKind): string {
  return t.path.startsWith('@petty') ? pettyCashBase(kind) + t.path.slice('@petty'.length) : t.path;
}

export function topicSteps(t: GuideTopic, kind: OrgKind): string[] {
  return t.steps ?? [...helpFor(topicPath(t, kind).split('?')[0]!, kind === 'college', kind === 'church_campus').steps];
}

export interface Access { can: (p: Permission) => boolean; keeper: boolean; roleBlocks: (path: string) => boolean }

export function canOpen(t: GuideTopic, kind: OrgKind, a: Access): boolean {
  if (t.keeper && !a.keeper) return false;
  if (t.need && !t.need.some((p) => a.can(p))) return false;
  return !a.roleBlocks(topicPath(t, kind).split('?')[0]!);
}

const STOP = new Set('a an the i me my we our you your to of in on at for and or is are was be do does did can could how what where when which who why it this that there here with from page app please want need show tell find get go see'.split(' '));
/** Plain words, lower case, without the endings that change little ("payments" and "payment" match). */
export function words(s: string): string[] {
  return s.toLowerCase().replace(/[’']/g, '').split(/[^a-z0-9]+/).filter((w) => w && !STOP.has(w))
    .map((w) => (w.length > 4 ? w.replace(/(ing|ies|es|s|ed)$/, (m) => (m === 'ies' ? 'y' : '')) : w));
}

export interface Match { topic: GuideTopic; score: number }

/** The topics that best fit the question, best first. Words in the title count twice. */
export function findTopics(question: string, kind: OrgKind): Match[] {
  const asked = [...new Set(words(question))];
  if (!asked.length) return [];
  return GUIDE.filter((t) => t.orgs.includes(kind)).map((topic) => {
    const title = new Set(words(topic.title));
    const extra = new Set(words(topic.words));
    // "How many…?" is a question about the numbers, answered on Ask the app.
    const score = asked.reduce((n, w) => n + (title.has(w) ? 2 : extra.has(w) ? 1 : 0), 0) + (topic.id === 'ask' && /\bhow (many|much)\b/i.test(question) ? 3 : 0);
    return { topic, score };
  }).filter((m) => m.score > 0).sort((a, b) => b.score - a.score);
}

/** "Where am I?" and the like are answered from the page itself. */
export const isWhereAmI = (q: string) => /\b(where am i|what is this|what page|this page|what can i do here|lost|whereabouts)\b/i.test(q);

/** Good enough to answer without the AI: a clear lead, or two words that match. */
export function confident(m: Match[]): boolean {
  if (!m.length) return false;
  const [a, b] = m;
  return a!.score >= 3 || (a!.score >= 2 && (!b || b.score < a!.score));
}

export const NO_ACCESS = (title: string) =>
  `“${title}” is not part of your account, so you can’t open it. If you need it for your work, please ask Mr Andrew and he can give you access.`;
