// Part 2: ADIA Training Centre.
const role = (name) => (p) => p.getByRole('button', { name }).first();
const text = (t) => (p) => p.getByText(t).first();
const exact = (t) => (p) => p.getByText(t, { exact: true }).first();
const css = (c) => (p) => p.locator(c).first();
const dock = (name) => (p) => p.locator('nav a, nav button').filter({ hasText: name }).last();
const A = { org: 'adia', device: 'm' };
const REG = '/attendance/adia/2026-11-12_food_and_beverage_production';

module.exports = [
  {
    id: 'a-today', part: 'adia', title: 'The ADIA Today page',
    purpose: 'Start every job from one page: the register, exams, students, fees and petty cash.',
    who: 'Everyone at ADIA (each role sees only its own buttons)', where: 'Today in the menu',
    steps: [
      'The welcome card shows the date and how many students are enrolled.',
      '**Needs you** lists anything waiting for you, such as a requisition to sign.',
      'Under **What do you want to do?**, press the big button for your job, for example **Mark register**.',
    ],
    see: 'Trainers and lab technicians see a shorter Today page with only their own buttons.',
    tip: 'On a phone the menu is **Today, Register, School, Petty Cash** and **More**. On a computer you also see **Payroll, Exam Records** and **Settings** in the side menu.',
    shots: [{ ...A, path: '/', tall: 1300, marks: [text('Good morning'), text('Nothing needs you right now'), text('What do you want to do?')] }],
  },
  {
    id: 'a-register', part: 'adia', title: 'Mark the class register',
    purpose: 'Record which students came to class today.',
    who: 'Pastor, Principal, Organization head, Staff', where: 'Register in the menu (Attendance on a computer)',
    steps: [
      'Press **Register**. Under **Which day?** press **Today** or **Yesterday**.',
      'Press the department, for example **Food and Beverage Production**.',
      'For each student press **Present**, **Late**, **Absent** or **Excused**.',
      'Press **Mark the other … present** to finish the rest in one tap.',
    ],
    see: 'The counts at the top (Present, Late, Absent, Excused, Not marked) change as you go. Each tap saves by itself.',
    tip: 'Write the unit or topic covered in **Notes** so the principal can see what was taught.',
    shots: [{ ...A, path: REG, tall: 1250, marks: [null, text('Food and Beverage Production register'), exact('Present'), role(/mark the other/i)] }],
  },
  {
    id: 'a-pastreg', part: 'adia', title: 'Fill in a register for an earlier day',
    purpose: 'Catch up on registers that were kept on paper or missed.',
    who: 'Pastor, Principal, Organization head, Staff', where: 'Register, then Fill in a register',
    steps: [
      'Press **Register** and scroll to **Past registers and results**. Choose the **Cohort** and press **Fill in a register**.',
      'Choose the **Class** and the **Month**.',
      'Tap a box to tick a student present for that day. Tap again to take it back.',
    ],
    see: 'Days with no ticks at all are not counted, so a day the class did not meet does not lower anyone’s attendance.',
    shots: [{ ...A, path: '/attendance/past', marks: [css('main select'), text(/^Class$/), text(/students$/)] }],
  },
  {
    id: 'a-find', part: 'adia', title: 'Find a student',
    purpose: 'Open a student’s page to see their details, attendance, fees and marks.',
    who: 'Pastor, Principal, Organization head, Staff', where: 'School in the menu',
    steps: [
      'Press **School**. The student list opens.',
      'Use **Status**, **Cohort** and **Department** to narrow the list, or type a name or admission number.',
      'Press the cohort, then the student’s name.',
    ],
    see: 'The student’s page, with their admission number, for example ADIA/2026/0002.',
    tip: 'Press a letter (A, B, C…) to jump to names starting with it.',
    shots: [{ ...A, path: '/school/students', marks: [dock('School'), text(/^Status$/), text(/^Cohort 3$/)] }],
  },
  {
    id: 'a-student', part: 'adia', title: 'A student’s page',
    purpose: 'See and correct everything about one student.',
    who: 'Pastor, Principal, Organization head, Staff (fees for Pastor, Finance and Principal)', where: 'School, then press a name',
    steps: [
      'Press **Edit name and phone** to correct their details.',
      'Change **Status** or **Cohort** with the drop-down lists.',
      'See **Attendance**, **Fees** and marks further down. Press **Print results** for a result slip.',
    ],
    see: 'Fees shows what was billed, what was paid and what is owed.',
    warn: 'The identity number is for the Director only. Other staff cannot see it.',
    shots: [{ ...A, path: '/school/students/15O5ZvrSUAtwP4FpP4vz', tall: 1300, marks: [role(/edit name and phone/i), text(/^Status$/), role(/print results/i)] }],
  },
  {
    id: 'a-add', part: 'adia', title: 'Enrol a student',
    purpose: 'Add one new student to a department and cohort.',
    who: 'Pastor, Principal, Organization head, Staff', where: 'School, then Add students',
    steps: [
      'Press **School**, then **+ Add students**.',
      'Type the **Student’s name** and phone, and choose the **Department**.',
      'Choose the **Status** and the day they **Started**.',
      'Add a **Sponsor or guardian** if there is one, then press **Enrol student**.',
    ],
    see: 'The student gets the next admission number by themselves.',
    shots: [{ ...A, path: '/school/students/new', tall: 1350, marks: [null, text(/^Department$/), text(/^Started$/), role(/enrol student/i)] }],
  },
  {
    id: 'a-import', part: 'adia', title: 'Add many students from Excel',
    purpose: 'Bring in a whole class list at once.',
    who: 'Pastor, Principal, Organization head, Staff', where: 'School, Add students, then Import from Excel',
    before: 'Prepare an Excel (.xlsx) or CSV file with one row per student and a row of column titles at the top. Only **Name** is required.',
    steps: [
      'Press **Download a template** if you want a ready-made sheet.',
      'Press **Choose the file** and pick your class list.',
      'Check the list the app shows. Rows with a problem are marked. Then add the students.',
    ],
    see: 'Students already at ADIA are skipped, so the same file can be imported again safely.',
    shots: [{ ...A, path: '/school/students/import', marks: [role(/download a template/i), role(/choose the file/i), null] }],
  },
  {
    id: 'a-fees', part: 'adia', title: 'School fees',
    purpose: 'Bill students, record payments and see who owes.',
    who: 'Pastor, Finance, Principal (balances only)', where: 'School, then Fees (the drop-down by the title)',
    steps: [
      'Open **Fees**. The boxes show **Billed**, **Paid**, **Collected** and **Owed**.',
      'Use **Bill students** to send a term’s bill to a whole cohort.',
      'To record a payment, open the student and press **Record a payment**.',
      '**Arrears** lists everyone who owes. Press **Download** for a list.',
    ],
    see: 'The balance changes straight away when a payment is recorded.',
    shots: [{ ...A, path: '/school/fees', marks: [text(/^Billed$/), null, null, text(/^Arrears$/)] }],
  },
  {
    id: 'a-exams', part: 'adia', title: 'Enter exam marks',
    purpose: 'Type CAT and final exam marks for your class.',
    who: 'Trainer, Principal, Pastor', where: 'Exam Records (on a phone: School, then Exam Records)',
    steps: [
      'Open **Exam Records**, choose the cohort and open your mark sheet.',
      'Type each student’s mark. Type **ABS** for absent or **EX** for exempt.',
      'Marks save as you leave each box, even without internet.',
      'When a paper is complete, send it. A sent paper is locked.',
    ],
    see: 'Totals and grades work themselves out as each CAT comes in.',
    tip: 'Prefer Excel? Press **Download class list (Excel)**, fill in the marks and press **Upload marks**.',
    warn: 'To change a mark after a paper is sent, ask the principal to unlock it.',
    shots: [{ ...A, path: '/school/exams/sheet/sIL46Z1u3eZfbgirByJP', tall: 1300, marks: [null, text(/^Marks$/), null, text(/^Papers$/)] }],
  },
  {
    id: 'a-results', part: 'adia', title: 'Results, remarks and graduation',
    purpose: 'Approve mark sheets, print result slips and issue certificates.',
    who: 'Principal, Pastor', where: 'Exam Records, then Results; School, then Graduation',
    steps: [
      'In **Exam Records**, open a sent sheet, check it and press **Approve**.',
      'Press **Results** to write remarks and print result slips.',
      'At the end of the course open **Graduation**. Upload the graduation list or press **Issue one certificate**.',
    ],
    see: 'Each certificate is kept on the student’s page.',
    shots: [{ ...A, path: '/school/graduation', marks: [null, null, text(/issue one certificate/i)] }],
  },
  {
    id: 'a-depts', part: 'adia', title: 'Departments and cohorts',
    purpose: 'See each department’s cohorts and start a new cohort.',
    who: 'Pastor, Principal', where: 'Settings, then Departments',
    steps: [
      'Each department shows its cohorts, the day each started and how many students it has.',
      'Press **+ New cohort** to start the next cohort.',
      'Press **Edit** to rename a department, or **+ New department** to add one.',
    ],
    see: 'New students are placed in a cohort when you enrol them.',
    shots: [{ ...A, path: '/school/courses', marks: [text('Beauty Therapy & Cosmetology'), role(/new cohort/i), role(/^edit$/i)] }],
  },
  {
    id: 'a-payroll', part: 'adia', title: 'Payroll and payslips',
    purpose: 'Work out each month’s pay with tax and deductions, and print payslips.',
    who: 'Pastor, people given payroll access', where: 'Payroll in the menu (on a phone: More, then Payroll)',
    steps: [
      'Check **Staff pay details** first. Add new staff there.',
      'Under **Prepare a pay run**, choose the **Month** and press **Open**.',
      'Check each person’s pay and prepare the pay run.',
      'A second person checks it and approves it. Then print or send the payslips.',
    ],
    see: 'Past months stay under **Pay runs**.',
    warn: 'Nobody approves a pay run they prepared themselves.',
    shots: [{ ...A, path: '/school/payroll', marks: [text('Staff pay details'), text(/^Month$/), null, null] }],
  },
  {
    id: 'a-tutor', part: 'adia', title: 'Tutor Files',
    purpose: 'Collect course outlines, lesson plans and reports from the trainers.',
    who: 'Trainer, Principal, Pastor', where: 'Tutor Files in the menu',
    steps: [
      'The principal presses **Ask for a file** and says what is needed and by when.',
      'Trainers open the request and upload the file.',
      'Under **Lesson plans**, a tick means the plan for that week was added.',
    ],
    see: 'A red dot means the register was marked but the lesson plan is missing.',
    shots: [{ ...A, path: '/tutor-files', marks: [role(/ask for a file/i), null, exact('Lesson plans')] }],
  },
  {
    id: 'a-inventory', part: 'adia', title: 'Count the inventory',
    purpose: 'Count the equipment in each department at the start and end of a cohort.',
    who: 'Lab technician, Trainer, Principal, Pastor', where: 'Inventory (on a phone: More, then Inventory)',
    steps: [
      'Choose the cohort at the top.',
      'The principal sets the **Deadline** and presses **Open for all 4 departments**.',
      'Each department opens its form, counts each item, notes anything broken or missing, and sends it.',
    ],
    see: 'Each count starts from the department’s last count, so you only change what moved.',
    shots: [{ ...A, path: '/inventory', marks: [css('main select'), role(/open for all/i), null] }],
  },
  {
    id: 'a-settings', part: 'adia', title: 'School settings',
    purpose: 'Set the grades, pass mark and how much each kind of assessment counts.',
    who: 'Pastor, Principal', where: 'Settings, then School settings',
    steps: [
      'Under **Grading scale**, set the lowest mark for each grade.',
      'Set the **Pass mark (%)** and the weight of continuous assessment, practical and exam.',
      'Press **Save settings**.',
    ],
    warn: 'Changing the grading scale changes the grades on every result slip. Ask Mr Andrew first.',
    shots: [{ ...A, path: '/school/settings', tall: 1300, marks: [text('Grading scale'), text(/^Pass mark/), role(/save settings/i)] }],
  },
  {
    id: 'a-photos', part: 'adia', title: 'Photos and wins, and school reports',
    purpose: 'Share good news and incidents with photos, and read the weekly and monthly reports.',
    who: 'Everyone (reports for Pastor and Principal)', where: 'Today, then Photos and wins; School, then Reports',
    steps: [
      'Press **Photos and wins**, then **New report**. Add a few lines and photos, and send it.',
      'The ADIA board can reply. Each report is a conversation.',
      'Open **Reports** for the weekly report, made every Monday morning.',
    ],
    shots: [{ ...A, path: '/school/updates', marks: [null, role(/new report/i), null] }],
  },
];
