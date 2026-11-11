// Part 4: Shared by all three: petty cash, signing PIN, financial statements and the AI helps.
const role = (name) => (p) => p.getByRole('button', { name }).first();
const text = (t) => (p) => p.getByText(t).first();
const exact = (t) => (p) => p.getByText(t, { exact: true }).first();
const css = (c) => (p) => p.locator(c).first();
const dock = (name) => (p) => p.locator('nav a, nav button').filter({ hasText: name }).last();
const C = { org: 'church', device: 'm' };

module.exports = [
  {
    id: 's-petty', part: 'shared', title: 'How petty cash works',
    purpose: 'Understand the rules before you ask for, sign or pay petty cash.',
    who: 'Everyone with Petty Cash in their menu', where: 'Petty Cash in the menu',
    steps: [
      'Each place (Church, ADIA and Hope) has its own petty cash. It is paid from the bank.',
      '**Waiting for you** lists requisitions you need to sign.',
      '**Money in the bank** is the last bank statement balance, less what has been approved since.',
      '**My requests** shows each of your requisitions and how many signatures it has.',
    ],
    see: 'The tabs are **Overview**, **New requisition**, **Receipts** and **Reports**.',
    warn: 'Any two signers approve. The person who asked cannot sign their own request, and nobody signs twice. KES 10,000 or more also needs Mr Andrew.',
    tip: 'If the page says no bank statement has been uploaded, requisitions cannot be approved until the latest statement is uploaded in Financial statements.',
    shots: [{ ...C, path: '/petty-cash', tall: 1000, marks: [null, text('Waiting for you'), text('Money in the bank'), text('My requests')] }],
  },
  {
    id: 's-new', part: 'shared', title: 'Ask for petty cash (new requisition)',
    purpose: 'Request money for something the ministry needs.',
    who: 'Everyone with Petty Cash', where: 'Petty Cash, then New requisition',
    steps: [
      'Press **New requisition**. Choose the **Requester** and the **Category**.',
      'Under **Expense items**, type what it is for, the quantity and unit price. Press **Add another item** for more.',
      'Or say or type what you need and press **Fill the form for me**. Check what it fills in.',
      'Press **Submit requisition**.',
    ],
    see: 'The requisition gets a number, for example FCN-00003, and waits for two signatures.',
    tip: 'Press **Copy an old one** to repeat a requisition you made before.',
    shots: [{ ...C, path: '/petty-cash/new', tall: 1400, marks: [text(/^Category$/), text('Expense items'), role(/fill the form for me/i), role(/submit requisition/i)] }],
  },
  {
    id: 's-sign', part: 'shared', title: 'Approve or sign a requisition',
    purpose: 'Check a request and sign it with your PIN.',
    who: 'Petty cash signatory, Pastor', where: 'Petty Cash, Waiting for you',
    steps: [
      'Open the requisition from **Waiting for you**.',
      'Read the items, the total and who asked.',
      'Press **Approve** and type your signing PIN, or press **Decline** and give a reason.',
      'The person who asked presses **Send Email** or **Send WhatsApp** to ask the signers.',
    ],
    see: '**Authorization** lists who has signed and who still needs to.',
    shots: [{ ...C, path: '/petty-cash/hAveKGf9U86twX2MDoAL', tall: 1300, marks: [null, text('Expense items'), text(/^Authorization$/), role(/send whatsapp/i)] }],
  },
  {
    id: 's-receipts', part: 'shared', title: 'Receipts and matching bank payments',
    purpose: 'Keep a receipt for every approved requisition.',
    who: 'Everyone with Petty Cash', where: 'Petty Cash, then Receipts',
    steps: [
      'Open **Receipts** and find the requisition that was paid. Add the receipt photo or file.',
      'For payments with no receipt, upload the bank payments under **Match bank payments**.',
      'Check each match the app suggests. Once confirmed, the bank payment counts as the receipt.',
    ],
    see: '**Receipt needed** shows how many approved requisitions still have no receipt.',
    shots: [{ ...C, path: '/petty-cash/receipts', tall: 1300, marks: [text(/^Month$/), text(/match bank payment/i), text(/^Receipt needed$/)] }],
  },
  {
    id: 's-report', part: 'shared', title: 'Petty cash monthly report',
    purpose: 'Print or send the month’s petty cash report.',
    who: 'Finance, signatories, Pastor', where: 'Petty Cash, then Reports',
    steps: [
      'Open **Reports** and choose the **Period**.',
      'Choose who it is **Approved by**.',
      'Press **Download PDF** or **Download Excel**.',
    ],
    see: 'The report has the opening and closing balance, money in and out, each voucher, and the sign-off lines.',
    shots: [{ ...C, path: '/petty-cash/reports', tall: 1100, marks: [text(/^Period$/), text(/^Approved by$/), role(/download excel/i)] }],
  },
  {
    id: 's-pin', part: 'shared', title: 'Set your signing PIN',
    purpose: 'Make a 4 to 6 digit PIN to sign petty cash quickly.',
    who: 'Signatories, Pastor', where: 'Settings, then Signing PIN (on Church, under More)',
    steps: [
      'Open **Settings** and press **Signing PIN**.',
      'Type your password, then your new PIN twice.',
      'Press **Save PIN**.',
    ],
    warn: 'Never tell anyone your PIN. A signature with your PIN is your signature.',
    shots: [{ ...C, path: '/settings/signing-pin', marks: [null, text(/Your Insight-IQ password/), role(/save pin/i)] }],
  },
  {
    id: 's-finance', part: 'shared', title: 'Bank and financial statements',
    purpose: 'Upload the bank statement and get the monthly income and expenditure.',
    who: 'Finance, signatories, Pastor', where: 'Petty Cash, then Financial statements',
    steps: [
      'Press **Financial statements**. Choose the **Account**.',
      'Press **Choose the statement** and pick the Family Bank PDF, Excel or CSV.',
      'Check the lines. Ask the helper to sort lines with no category.',
      'Read the income and expenditure, and close the month when it is right.',
    ],
    warn: 'A closed month locks its requisitions too. Only the Director can open it again.',
    shots: [{ ...C, path: '/finance', marks: [null, role(/choose the statement/i), null, null] }],
  },
  {
    id: 's-ai', part: 'shared', title: 'The AI helps',
    purpose: 'Let the helper draft messages, notices and reports for you to check.',
    who: 'Leaders', where: 'Just ask Andy, then See the things the AI helper can do',
    steps: [
      'Open **Just ask Andy** and tap the gold link to the AI Helper.',
      'Choose a help, for example **Ask the app** or **Welcome first-timers**.',
      'Read what the helper wrote and change it if needed. Nothing is sent or saved until you tap.',
    ],
    warn: 'The helper never approves money, never matches a payment by itself, never judges a child’s safety and never sees private notes. Only first names and numbers are sent to it.',
    shots: [{ ...C, path: '/ai', tall: 1200, marks: [null, text('Ask the app'), null] }],
  },
];
