/**
 * The "?" on every ADIA page (Andy 6A, 2026-10-30): three simple steps for the page you are on.
 * The first pattern that matches the address wins, so the more exact addresses come first.
 */
export interface PageHelp { title: string; steps: [string, string, string] }

const PETTY = '^/(school/|hope/)?petty-cash';

const HELP: [RegExp, PageHelp][] = [
  [/^\/$/, { title: 'Today', steps: [
    'Press the big button for the job you want to do.',
    'Do the job on the page that opens, then press Save.',
    'Press Today in the menu to come back here. Press See figures to see how the school is doing.',
  ] }],
  [/^\/attendance\/[^/]+\/[^/]+/, { title: 'Class register', steps: [
    'Tick each student who is in class.',
    'Leave a student unticked if they are absent.',
    'Press Save. You can come back and change it the same day.',
  ] }],
  [/^\/attendance/, { title: 'Attendance', steps: [
    'Choose your class from the list.',
    'Press Mark register for today’s class.',
    'Tick who is present and press Save.',
  ] }],
  [/^\/school\/students\/new/, { title: 'Add a student', steps: [
    'Type the student’s full name and phone number.',
    'Choose the department and the cohort.',
    'Press Save. The student now appears in the student list.',
  ] }],
  [/^\/school\/students\/import/, { title: 'Add students from Excel', steps: [
    'Choose the Excel file with the students’ names.',
    'Check the list the app shows you. Rows with a problem are marked.',
    'Press Add students to save them all at once.',
  ] }],
  [/^\/school\/students\/[^/]+/, { title: 'A student', steps: [
    'Read the student’s details, attendance, fees and marks here.',
    'Press Edit name and phone to correct their details.',
    'Press Print results for their results on paper or as a PDF.',
  ] }],
  [/^\/school\/students/, { title: 'Students', steps: [
    'Type a name or admission number in the search box to find a student.',
    'Use the Status, Cohort and Department lists to narrow the list.',
    'Press a student’s name to open their page.',
  ] }],
  [/^\/school\/fees/, { title: 'Fees', steps: [
    'Find the student in the list.',
    'Record the payment with its amount and M-Pesa code.',
    'The balance each student owes updates straight away.',
  ] }],
  [/^\/school\/graduation/, { title: 'Graduation', steps: [
    'Choose the cohort that is graduating.',
    'Check the marks and the points for each student.',
    'Press Issue certificate for each student who has finished.',
  ] }],
  [/^\/school\/reports/, { title: 'Reports', steps: [
    'Choose the report and the dates you need.',
    'Press the button to make the report.',
    'Open it to read, print or send it.',
  ] }],
  [/^\/school\/courses|^\/programs/, { title: 'Departments', steps: [
    'Press a department to see its cohorts.',
    'Press Add cohort to start a new cohort.',
    'Students are placed in a cohort when you add them.',
  ] }],
  [/^\/school\/exams\/sheet\//, { title: 'Mark sheet', steps: [
    'Type each student’s marks in the boxes.',
    'Press Save often. Your marks are kept as a draft.',
    'When all marks are in, press Send to the principal.',
  ] }],
  [/^\/school\/exams/, { title: 'Exam Records', steps: [
    'Choose your class from the list.',
    'Open the mark sheet and type the marks.',
    'Send the sheet to the principal when it is complete.',
  ] }],
  [/^\/school\/payroll\/staff\/[^/]+/, { title: 'A staff member', steps: [
    'Check the staff member’s pay details.',
    'Press Edit to change them.',
    'Press Save.',
  ] }],
  [/^\/school\/payroll\/staff/, { title: 'Payroll staff', steps: [
    'Press a name to see or change their pay.',
    'Press Add staff member for someone new.',
    'Changes count from the next payroll month.',
  ] }],
  [/^\/school\/payroll\/[^/]+/, { title: 'Payroll month', steps: [
    'Check each person’s pay for the month.',
    'Press Prepare pay run.',
    'Another person checks it and presses Approve pay run. Then print the payslips.',
  ] }],
  [/^\/school\/payroll/, { title: 'Payroll', steps: [
    'Choose the month you want to pay.',
    'Press Open to see that month’s pay.',
    'Prepare the pay run. Another person approves it.',
  ] }],
  [/^\/school\/settings/, { title: 'School settings', steps: [
    'Change only what you need.',
    'Press Save at the bottom of each box.',
    'Ask the Director if you are not sure.',
  ] }],
  [/^\/inventory\/[^/]+/, { title: 'Inventory form', steps: [
    'Count each item and type the number.',
    'Write a note for anything missing or broken.',
    'Press Save, then send the form when you are done.',
  ] }],
  [/^\/inventory/, { title: 'Inventory', steps: [
    'Press the form for your class.',
    'Count the items and type the numbers.',
    'Send the form before the deadline shown.',
  ] }],
  [new RegExp(`${PETTY}/new`), { title: 'New requisition', steps: [
    'Choose the category and write what the money is for.',
    'Type each item with its quantity and price.',
    'Press Submit requisition. Two signers must approve it before money is paid.',
  ] }],
  [new RegExp(`${PETTY}/receipts`), { title: 'Receipts', steps: [
    'Find the requisition that was paid.',
    'Press Add receipt and take a photo or choose the file.',
    'The receipt is saved with that requisition.',
  ] }],
  [new RegExp(`${PETTY}/month-end`), { title: 'Month end', steps: [
    'Check the month’s totals.',
    'Two signers close the month with their PIN.',
    'Only the Director can open a closed month again.',
  ] }],
  [new RegExp(`${PETTY}/(reports|balance-sheet)`), { title: 'Petty cash reports', steps: [
    'Choose the month.',
    'Read the totals on the page.',
    'Press Download or Print to keep a copy.',
  ] }],
  [new RegExp(`${PETTY}/budget`), { title: 'Budget', steps: [
    'Type the amount for each category.',
    'Press Save.',
    'You will see a warning when a category goes over.',
  ] }],
  [new RegExp(`${PETTY}/bin`), { title: 'Petty cash Bin', steps: [
    'Removed entries wait here.',
    'Signers agree to delete or put back an entry.',
    'Nobody signs twice for the same entry.',
  ] }],
  [new RegExp(`${PETTY}/[^/]+`), { title: 'Requisition', steps: [
    'Read what is asked for and the amount.',
    'If you are a signer, press Sign this request, choose your name and type your PIN.',
    'Use Send Email or Send WhatsApp to tell the next signer.',
  ] }],
  [new RegExp(PETTY), { title: 'Petty cash', steps: [
    'Look at Waiting for you first and sign what is there.',
    'Press New requisition to ask for money.',
    'Press Top up when the cash runs low.',
  ] }],
  [/^\/people\/[^/]+\/[^/]+\/edit/, { title: 'Edit details', steps: [
    'Correct the name or phone number.',
    'Leave the other boxes as they are.',
    'Press Save.',
  ] }],
  [/^\/settings\/cleanup/, { title: 'Clean-up', steps: [
    'Choose the type of entry, or press Find test data.',
    'Tick the entries you want to remove and press Remove.',
    'Changed your mind? Open the Recycle Bin and press Put back.',
  ] }],
  [/^\/settings\/signing-pin/, { title: 'Signing PIN', steps: [
    'Type a PIN only you know.',
    'Type it again to be sure.',
    'Press Save. Never tell anyone your PIN.',
  ] }],
  [/^\/settings\/my-password/, { title: 'My password', steps: [
    'Type your old password.',
    'Type your new password twice.',
    'Press Save. Never tell anyone your password.',
  ] }],
  [/^\/settings\/users/, { title: 'Users', steps: [
    'Press a name to change what that person can do.',
    'Press Add for someone new.',
    'Each person sets their own password.',
  ] }],
  [/^\/settings/, { title: 'Settings', steps: [
    'Press the item you want to change.',
    'Make the change and press Save.',
    'Press Settings in the menu to come back here.',
  ] }],
];

const FALLBACK: PageHelp = { title: 'This page', steps: [
  'Read the page from the top.',
  'Fill in what is asked and press Save.',
  'Press Today in the menu to go back to the start.',
] };

export function helpFor(path: string): PageHelp {
  return HELP.find(([re]) => re.test(path))?.[1] ?? FALLBACK;
}
