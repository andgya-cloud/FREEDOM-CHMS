// The Administrator guide: accounts, passwords, reviewers and settings. For Mr Andrew and Doreen.
const role = (name) => (p) => p.getByRole('button', { name }).first();
const text = (t) => (p) => p.getByText(t).first();
const exact = (t) => (p) => p.getByText(t, { exact: true }).first();
const css = (c) => (p) => p.locator(c).first();
const C = { org: 'church', device: 'm' };

module.exports = [
  {
    id: 'ad-accounts', part: 'admin', title: 'Add a staff account',
    purpose: 'Give a new person their own sign-in, with the right role and places.',
    who: 'Mr Andrew and Doreen only', where: 'More, Settings, Staff accounts, then Add',
    before: 'Decide the person’s role and which places they work in. Give each person their own account. Never share one account.',
    steps: [
      'Open **Settings**, press **Staff accounts**, then **Add**.',
      'Type the **Full name** and **Email**.',
      'Choose the **Role**. Each role says what it can and cannot see.',
      'Tick the **Organizations** they work in, and anything under **Also allow**. Then save.',
    ],
    see: 'The app makes a password. Give it to the person yourself, in person or by phone, never in a group chat.',
    warn: 'Give the smallest role that lets the person do their job. Pastoral notes and money are closed to most roles on purpose.',
    shots: [{ ...C, path: '/settings/users/new', tall: 1500, marks: [null, text(/^Full name$/), exact('Role'), text(/^Organizations$/)] }],
  },
  {
    id: 'ad-reset', part: 'admin', title: 'Reset a password or switch an account off',
    purpose: 'Help someone who forgot their password, or close the account of someone who has left.',
    who: 'Mr Andrew and Doreen only', where: 'Settings, Staff accounts, then press the name',
    steps: [
      'Open **Staff accounts** and press the person’s name.',
      'Press the button to reset the password. Give the new password to the person yourself.',
      'To close the account of someone who has left, switch the account off. Their records stay.',
    ],
    tip: 'Each person can change their own password in **Settings, This device, My password**.',
    shots: [{ ...C, path: '/settings/users', marks: [text('Andrew Guya'), null, null] }],
  },
  {
    id: 'ad-reviewers', part: 'admin', title: 'Reviewers and their reviews',
    purpose: 'Let an outsider look at the app and write suggestions, without changing anything.',
    who: 'Mr Andrew only', where: 'Settings, then Reviews',
    steps: [
      'Add a reviewer as a staff account with the role **Reviewer**, and tick the places they may look at.',
      'Under **Reviewers** you can switch a reviewer off or on.',
      'New reviews show here and on Today. Read each one, press the page name to see it, and press **Answer**.',
    ],
    see: 'The reviewer sees your answer in their own review window.',
    warn: 'Reviewers never see pastoral notes, private conversations, staff accounts or the full download, but they do see real names. Choose reviewers you trust.',
    shots: [{ ...C, path: '/reviews', marks: [null, text(/Reviewers \(/), css('main select')] }],
  },
  {
    id: 'ad-settings', part: 'admin', title: 'The Settings page',
    purpose: 'Know what each setting does before you change it.',
    who: 'Pastor (some items for Organization heads)', where: 'More, then Settings (on ADIA and Hope: Settings)',
    steps: [
      '**People**: the journey stages and your own extra fields.',
      '**Birthday card**, **WhatsApp** and **Staff accounts**: see the next pages.',
      '**This device**: install, sync, theme, signing PIN and password.',
      '**Advanced**: organisations, clean-up, data download, the audit log and programme reminders. Change these only when you are sure.',
    ],
    tip: '**Sign out** is at the bottom of Settings.',
    shots: [{ ...C, path: '/settings', tall: 1100, marks: [(p) => p.locator('main').getByText('People', { exact: true }), text(/^Birthday card$/), text(/^This device$/), text(/^Advanced$/)] }],
  },
  {
    id: 'ad-templates', part: 'admin', title: 'Change the words of WhatsApp messages',
    purpose: 'Edit the ready-made messages staff send, such as the first-time visitor welcome.',
    who: 'Pastor', where: 'More, Settings, WhatsApp, then Messages',
    steps: [
      'Open **Settings**, press **WhatsApp**, then **Messages**.',
      'Find the message by its **Name** and change the words in **Message**.',
      'Use merge fields such as **{first_name}** and **{campus}**. The app fills them in for each person. Then save.',
    ],
    see: 'Staff can still change a message before they send it.',
    shots: [{ ...C, path: '/settings/templates', tall: 1300, marks: [null, text('First-time visitor welcome'), text(/^Merge fields$/)] }],
  },
  {
    id: 'ad-card', part: 'admin', title: 'The birthday card and the QR poster',
    purpose: 'Change the birthday card picture, and print the poster visitors scan to sign up.',
    who: 'Pastor', where: 'Settings, Birthday card; People, Show the QR poster',
    steps: [
      'In **Birthday card**, press **Upload a new picture**, tap the card to move where the name goes, and choose the **Name colour**.',
      'Press **Email me a test card** to check it.',
      'For the visitor poster, open **Add visitor**, press **Show the QR poster**, then **Print the poster**.',
    ],
    see: 'Cards that visitors send appear in People as visitors, with their welcome follow-ups.',
    shots: [{ ...C, path: '/settings/birthday-card', tall: 1450, marks: [role(/upload a new picture/i), role(/email me a test card/i), null] }],
  },
];
