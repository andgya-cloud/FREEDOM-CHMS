// Part 3: Freedom Hope Center.
const role = (name) => (p) => p.getByRole('button', { name }).first();
const text = (t) => (p) => p.getByText(t).first();
const exact = (t) => (p) => p.getByText(t, { exact: true }).first();
const css = (c) => (p) => p.locator(c).first();
const dock = (name) => (p) => p.locator('nav a, nav button').filter({ hasText: name }).last();
const H = { org: 'hope', device: 'm' };

module.exports = [
  {
    id: 'h-today', part: 'hope', title: 'The Hope Today page',
    purpose: 'See the week at Hope Center and start the Saturday check-in.',
    who: 'Everyone at Hope Center', where: 'Today in the menu',
    steps: [
      'The big green **Check in** button opens the gate sign-in on Saturdays.',
      'The line under it shows how many children and champions are registered.',
      '**Needs you** lists anything waiting for you, such as absent children to follow up.',
    ],
    tip: 'On a phone the menu is **Today, Children, Registers, Reports, Petty Cash** and **More**.',
    shots: [{ ...H, path: '/', tall: 1100, marks: [text(/^Check in$/), text(/children and \d+ champions/), text('Nothing needs you right now')] }],
  },
  {
    id: 'h-find', part: 'hope', title: 'Find a child',
    purpose: 'Open a child’s page by name, code or parent’s name.',
    who: 'Pastor, Organization head, Staff, Hope helper', where: 'Children in the menu, or the search box at the top',
    steps: [
      'Press **Children**.',
      'Use **Show** and **Sort by** to change the list, or type in the search box at the top.',
      'Press the child’s card to open their page.',
    ],
    see: 'Each card shows the child’s code (HC-0001), age, class colour and sponsor.',
    tip: 'The class colours: blue Jasper, green Rubies, orange Sapphire, navy Emerald, black Topaz.',
    shots: [{ ...H, path: '/hope/children', marks: [dock('Children'), text(/^Show$/), text('Amani Otieno')] }],
  },
  {
    id: 'h-new', part: 'hope', title: 'Register a child',
    purpose: 'Add a new child to Freedom Hope Center.',
    who: 'Pastor, Organization head, Staff', where: 'Children, then Register a child',
    before: 'The parent or guardian must agree before you take or keep a photo of the child.',
    steps: [
      'Press **Children**, then **Register a child**.',
      'Type the **Child’s name**, **Gender** and **Date of birth**.',
      'Press **Take** or **Choose** to add a photo, only if the guardian agreed.',
      'Press **Add more details** for school, clubs, sponsor, parent and consent. Then press **Register child**.',
    ],
    see: 'The child gets the next code, for example HC-0211, by itself.',
    shots: [{ ...H, path: '/hope/children/new', tall: 1000, marks: [null, text(/^Gender$/), role(/^.*take$/i), text(/add more details/i)] }],
  },
  {
    id: 'h-child', part: 'hope', title: 'A child’s page',
    purpose: 'See everything about one child and contact the parent.',
    who: 'Pastor, Organization head, Staff (Care notes for Pastor and Director only)', where: 'Children, then press a child',
    steps: [
      'Press **Call Parent** or **WhatsApp** to reach the parent.',
      'The tabs **About**, **Attendance**, **Fees** and **Care** hold the child’s record.',
      'Press **Edit details** to correct something, or **Sponsor update** to write to the sponsor.',
    ],
    warn: 'Care notes are private. Never copy them into WhatsApp or show them to other children or parents.',
    shots: [{ ...H, path: '/hope/children/1NJveyRM4GeYkMtWNhRV', tall: 1300, marks: [text('Call Parent'), exact('About'), role(/edit details/i)] }],
  },
  {
    id: 'h-register', part: 'hope', title: 'Take the children’s register',
    purpose: 'Mark who came on Saturday.',
    who: 'Pastor, Organization head, Staff, Hope helper', where: 'Registers in the menu',
    steps: [
      'Press **Registers**. Choose the day, or press **Other date**.',
      'Choose **Children**, **Champions** or **Clubs**.',
      'For each child press **Present**, **Late**, **Absent** or **Excused**.',
      'At the end, press **Mark the … not marked as absent**.',
    ],
    see: '**All children** shows how many came, as a number and a percentage.',
    tip: 'Children who are absent two Saturdays in a row show up on Today for a follow-up call.',
    shots: [{ ...H, path: '/hope/register', tall: 1500, marks: [text('Other date'), css('main button:text-is("Children")'), css('main button:text-is("Present")'), role(/not marked as absent/i)] }],
  },
  {
    id: 'h-gate', part: 'hope', title: 'Check in at the gate',
    purpose: 'Let children and champions sign themselves in with their card as they arrive.',
    who: 'Hope helper, Staff', where: 'Today, Check in',
    steps: [
      'On **Today**, press **Check in**. The camera opens.',
      'The child holds their card up to the camera. The app ticks them present.',
      'If the card will not scan, type the code (for example HC-0012) and press **Check in**.',
    ],
    see: 'The count at the top goes up with each child and champion.',
    tip: 'Press **Leave** to go back to the app when check-in is over.',
    shots: [{ ...H, path: '/hope/gate', prep: async (p) => { await p.addStyleTag({ content: 'video{opacity:0!important}' }); }, marks: [null, text(/hold your card/i), css('input[placeholder*="code"]')] }],
  },
  {
    id: 'h-clubs', part: 'hope', title: 'Clubs',
    purpose: 'Keep the register and wins for each club.',
    who: 'Pastor, Organization head, Staff, Hope helper', where: 'Registers, then Clubs',
    steps: [
      'The first time, press **Add the clubs** to add the 8 Hope Centre clubs in one tap.',
      'Open a club to mark its register.',
      'Add the club’s wins with a photo so they show in Photos and wins.',
    ],
    shots: [{ ...H, path: '/hope/clubs', marks: [text(/Add (the clubs|a club)/), null, null] }],
  },
  {
    id: 'h-messages', part: 'hope', title: 'WhatsApp the parents',
    purpose: 'Send one message, such as a Saturday reminder, to many parents from the Hope phone.',
    who: 'Pastor, Organization head, Staff', where: 'More, then WhatsApp parents',
    before: 'Use the Hope Centre phone (0794 645 455), so parents see the Hope number.',
    steps: [
      'Choose who to **Send to** and the **Message**.',
      'Check the words. **{parent}** and **{child}** become their names.',
      'Press **Send next**. WhatsApp opens ready to send. Send it, then come back for the next one.',
    ],
    see: 'The count of messages sent goes up.',
    shots: [{ ...H, path: '/hope/messages', tall: 1200, marks: [text(/^Send to$/), text(/^Message$/), role(/send next/i)] }],
  },
  {
    id: 'h-sponsors', part: 'hope', title: 'Sponsors and photos',
    purpose: 'Keep the sponsorship list and children’s photos up to date.',
    who: 'Pastor, Organization head, Staff', where: 'Children, More, then Sponsors or Photos',
    steps: [
      'For sponsors, press **Choose the filled-in file** and upload the monthly Child Registration List (KE-014).',
      'For photos, name each photo with the child’s code (HC-0042.jpg) or full name.',
      'Press **Choose the photos** to upload many at once.',
    ],
    warn: 'Only upload photos of children whose guardian agreed to photos.',
    shots: [{ ...H, path: '/hope/children/sponsors', marks: [role(/choose the filled-in file/i), null, null] }],
  },
  {
    id: 'h-reports', part: 'hope', title: 'Hope reports and records',
    purpose: 'See the figures and outcomes, and open attendance, meals and care records.',
    who: 'Pastor, Organization head (Care for Pastor and Director)', where: 'Reports in the menu',
    steps: [
      'Press **Reports**. Open **Attendance and meals**, **Care** or **Photos and wins**.',
      '**Figures** shows children registered, attendance last Saturday, champions and sponsorship.',
      '**How the children are doing** shows the key outcomes.',
    ],
    see: 'The month’s report, with numbers only, is made by itself on the 1st. A summary goes to Mr Andrew and Diana every Monday at 7am.',
    shots: [{ ...H, path: '/hope/reports', tall: 1300, marks: [text('Attendance and meals'), exact('Figures'), text('How the children are doing')] }],
  },
];
