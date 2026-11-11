// The back of the manual: privacy and care, common problems, word list, contacts, index and quick cards.
const pg = (pages, id) => (pages[id] ? `page ${pages[id]}` : '');

exports.privacy = () => `<section class="page front" id="privacy">
  <div class="crumb" style="color:#5b4b9a">Privacy and care</div>
  <h1>Privacy and care</h1>
  <p>Freedom ChMS holds the names, phone numbers, giving, school records and children’s records of people who trust us. Kenya’s Data Protection Act asks us to keep that information safe and use it only for the reason it was given. These rules apply to everyone with an account.</p>
  <h2>Your account</h2>
  <ul><li>Use only your own account. Never share your password or signing PIN.</li><li>Sign out on a shared computer, or tick <b>Sign out after 15 minutes without use</b>.</li><li>If you think someone knows your password, tell Mr Andrew straight away so he can reset it.</li></ul>
  <h2>People’s details</h2>
  <ul><li>Only message people who agreed to WhatsApp messages. If someone asks to stop, record it on their page the same day.</li><li>Do not copy lists of names or phone numbers out of the app, or post them in WhatsApp groups.</li><li>Do not take screenshots of people’s records to send to others.</li></ul>
  <h2>Pastoral notes and private conversations</h2>
  <ul><li>Write facts, kindly, as if the person will read it one day.</li><li>Never repeat what you read there to anyone who does not need to know.</li></ul>
  <h2>Children at Freedom Hope Center</h2>
  <ul><li>Only take, keep or share a child’s photo if the guardian agreed to photos.</li><li>Care notes, welfare and safeguarding records are for the Pastor and the Director only.</li><li>If you are worried about a child’s safety, tell the Director or Mr Andrew in person the same day. Do not write the details in WhatsApp.</li></ul>
  <h2>Money</h2>
  <ul><li>Every gift gets a receipt. Every requisition is signed by two different people.</li><li>Never sign a requisition you asked for, and never sign for someone else.</li></ul>
  <div class="box warn"><span class="h">Warning</span>If something goes wrong, such as a phone with the app being lost or a message sent to the wrong person, tell Mr Andrew the same day. Quick action protects the people involved.</div>
</section>`;

const PROBLEMS = [
  ['The app says my password is not known.', 'Check that Caps Lock is off and try again. If it still fails, ask Mr Andrew or Doreen to reset it. Nobody else can.'],
  ['The badge at the top does not say All saved.', 'You are offline or the signal is weak. Keep working: what you save waits on the phone. Wait for All saved before you close the app or log out.'],
  ['I can’t see a page that someone else has.', 'Your role decides your pages. If you need the page for your work, ask Mr Andrew for access.'],
  ['A person is in the app twice.', 'Do not delete either record. Tell Mr Andrew. The app can join the two so no history is lost.'],
  ['A Paybill payment shows no name.', 'Open Payments with no name on the Giving page and choose who gave it.'],
  ['My requisition cannot be approved.', 'The latest bank statement must be uploaded in Financial statements first. Tell Finance.'],
  ['I forgot my signing PIN.', 'Set a new one in Settings, Signing PIN. You need your password to do it.'],
  ['I marked the register wrong.', 'Open the register again and press the right button. You can change it the same day.'],
  ['A mark sheet is locked.', 'The paper was already sent. Ask the principal to unlock it.'],
  ['The camera will not open at the Hope gate.', 'Allow the camera in the phone’s settings, or type the child’s code (HC-0012) in the box and press Check in.'],
  ['The app looks old after an update.', 'Close the app fully and open it again. On a computer, refresh the page.'],
  ['I pressed something by mistake.', 'Look for an Undo button. If there is none, tell Mr Andrew. Deleted records wait in the Bin and can be put back.'],
];
exports.problems = () => `<section class="page front" id="problems">
  <div class="crumb" style="color:#c47a12">Help</div><h1>Common problems and fixes</h1>
  <table class="t"><tr><th style="width:62mm">If this happens</th><th>Do this</th></tr>${PROBLEMS.map(([a, b]) => `<tr><td><b>${a}</b></td><td>${b}</td></tr>`).join('')}</table>
  <div class="box tip"><span class="h">Tip</span>Press <b>Just ask Andy</b> and describe the problem in your own words. It knows every page of the app.</div>
</section>`;

const WORDS = [
  ['Admission number', 'The number ADIA gives each student, for example ADIA/2026/0002.'],
  ['All saved', 'The green badge at the top. Everything you did has reached the server.'],
  ['Champion', 'A young volunteer who helps at Freedom Hope Center on Saturdays.'],
  ['Child code', 'The number Hope Center gives each child, for example HC-0042.'],
  ['Cohort', 'A group of ADIA students who start together, for example Cohort 4.'],
  ['CAT', 'Continuous Assessment Test. ADIA has CAT 1, 2 and 3 before the final exam.'],
  ['Department', 'An ADIA course, for example ICT or Dressmaking & Tailoring.'],
  ['First-timer', 'A visitor at their first service.'],
  ['Follow-up', 'A call or message the church owes someone, shown in People to reach today.'],
  ['Fund', 'What a gift is for: Tithes, Offerings, Building and so on.'],
  ['Headcount', 'The number of adults, teens and children counted in a service.'],
  ['Journey', 'The steps a member takes: Salvation, Baptism, Growth Track, Freedom 252 and more.'],
  ['Merge field', 'A word in curly brackets, such as {first_name}, that the app replaces with the person’s details.'],
  ['Organisation', 'One of the three places: Freedom Church Nairobi, ADIA Training Centre or Freedom Hope Center.'],
  ['Paybill', 'The church M-Pesa Paybill, 222118.'],
  ['Requisition', 'A request for petty cash, with its items and total.'],
  ['Role', 'The kind of account you have. It decides which pages you see.'],
  ['Signatory', 'A person allowed to sign petty cash requisitions.'],
  ['Signing PIN', 'Your 4 to 6 digit number for signing requisitions.'],
  ['Status', 'Where a person is with the church: Visitor, Regular, Member or Inactive.'],
  ['Unassigned', 'A payment the app could not match to a person or fund yet.'],
];
exports.words = () => `<section class="page front" id="words">
  <div class="crumb" style="color:#2c568f">Help</div><h1>Word list</h1>
  <table class="t"><tr><th style="width:42mm">Word</th><th>What it means</th></tr>${WORDS.map(([a, b]) => `<tr><td><b>${a}</b></td><td>${b}</td></tr>`).join('')}</table>
</section>`;

exports.contacts = () => `<section class="page front" id="contacts">
  <div class="crumb" style="color:#2f6b47">Help</div><h1>Who to contact</h1>
  <table class="t"><tr><th style="width:62mm">For</th><th>Contact</th></tr>
    <tr><td><b>How to do something in the app</b></td><td>Press <b>Just ask Andy</b> on any page</td></tr>
    <tr><td><b>Passwords, accounts and access</b></td><td>Mr Andrew Guya or Doreen Mayaka</td></tr>
    <tr><td><b>Petty cash and giving</b></td><td>Daniel Ojwang’, Accountant</td></tr>
    <tr><td><b>ADIA students, exams and graduation</b></td><td>The Principal, Flavier Akinyi</td></tr>
    <tr><td><b>Freedom Hope Center</b></td><td>Diana Kiunga · Hope Centre phone 0794 645 455</td></tr>
    <tr><td><b>A worry about a child’s safety</b></td><td>The Director or Mr Andrew, in person, the same day</td></tr>
    <tr><td><b>Something in the app is broken or wrong</b></td><td>Mr Andrew, with a photo of the screen</td></tr>
  </table>
  <h2>The app</h2>
  <p>Open Freedom ChMS at <b>freedom-chms.web.app</b> on any phone or computer.</p>
</section>`;

/** An alphabetical index of topics and the words people use for them. */
exports.index = (topics, pages) => {
  const extra = {
    'c-paybill': ['M-Pesa statement', 'Paybill 222118'], 'c-gift': ['Receipt', 'Tithe'], 'c-reach': ['Follow-ups'], 'c-visitor': ['First-timer', 'Visitor'],
    'c-headcount': ['Attendance (church)'], 'c-checkin': ['Check-in (church)'], 'a-register': ['Attendance (ADIA)'], 'a-exams': ['CAT', 'Marks'], 'a-results': ['Certificates', 'Result slips'],
    'h-register': ['Attendance (Hope)'], 'h-gate': ['Gate', 'Card scan'], 's-new': ['Requisition'], 's-pin': ['PIN'], 's-finance': ['Bank statement', 'Close the month'],
    'g-ask': ['Help'], 'g-install': ['Offline', 'Dark screen', 'Install'], 'g-signin': ['Password'], 'c-family': ['Wedding anniversary'], 'c-celebrate': ['Birthday card'],
  };
  const rows = [];
  for (const t of topics) { rows.push([t.title, t.id]); for (const w of extra[t.id] || []) rows.push([w, t.id]); }
  rows.push(['Privacy', 'privacy'], ['Word list', 'words'], ['Contacts', 'contacts'], ['Problems and fixes', 'problems'], ['Roles', 'roles']);
  rows.sort((a, b) => a[0].replace(/^(The|A|An) /, '').localeCompare(b[0].replace(/^(The|A|An) /, '')));
  const li = rows.filter(([, id]) => pages[id]).map(([w, id]) => `<li><span>${w.replace(/</g, '&lt;')}</span><span class="dots"></span><span>${pages[id]}</span></li>`).join('');
  return `<section class="page front" id="index"><h1>Index</h1><ul class="toc idx" style="columns:2;column-gap:10mm">${li}</ul></section>`;
};

/** One-page quick cards, one per role. */
exports.CARDS = [
  { role: 'Pastor', color: '#14213d', menu: 'Everything, in every place', jobs: ['c-today', 'c-reports', 's-sign', 'ad-accounts'], remember: ['You see every page and every place.', 'Requisitions of KES 10,000 or more need you.', 'Only you and Doreen manage accounts and passwords.'] },
  { role: 'Admin', color: '#2f6b47', menu: 'Today · People · Service · Giving · More', jobs: ['c-visitor', 'c-checkin', 'c-headcount', 'c-reach', 'c-gift'], remember: ['Search before you add someone, to avoid doubles.', 'Wait for All saved before you close the app.'] },
  { role: 'Organization head', color: '#2f6b47', menu: 'The menu of your place', jobs: ['c-today', 'c-find', 'c-reach', 'c-photos'], remember: ['You lead one place and can add its staff accounts.', 'Money pages are closed to your role.'] },
  { role: 'Staff', color: '#2f6b47', menu: 'The menu of your place', jobs: ['c-find', 'c-visitor', 'c-checkin', 'c-reach'], remember: ['Money pages are closed to your role.', 'Ask Just ask Andy when you are not sure.'] },
  { role: 'Usher', color: '#2f6b47', menu: 'People · Service · More', jobs: ['c-visitor', 'c-checkin', 'c-headcount', 'c-family'], remember: ['Ask each visitor before ticking They agreed for WhatsApp.', 'Press Whole family to check a family in at once.', 'Send the numbers to leaders after the service.'] },
  { role: 'Finance', color: '#2f6b47', menu: 'Giving · Petty Cash · More', jobs: ['c-dayGiving', 'c-gift', 'c-paybill', 'c-unassigned', 's-report'], remember: ['Every gift gets a receipt.', 'Upload the Paybill statement instead of typing M-Pesa gifts.', 'Upload the bank statement so requisitions can be approved.'] },
  { role: 'Petty cash signatory', color: '#7a5a12', menu: 'Petty Cash', jobs: ['s-petty', 's-sign', 's-pin'], remember: ['Any two signers approve; nobody signs twice.', 'Never sign a requisition you asked for.', 'KES 10,000 or more also needs Mr Andrew.'] },
  { role: 'Principal', color: '#1f2a5c', menu: 'Today · Register · School · More', jobs: ['a-register', 'a-find', 'a-add', 'a-results', 'a-depts'], remember: ['You see each student’s fee balance, not the invoices.', 'Approve mark sheets before printing result slips.'] },
  { role: 'Trainer', color: '#1f2a5c', menu: 'Today · Exam Records · Tutor Files', jobs: ['a-exams', 'a-tutor'], remember: ['Marks save as you leave each box.', 'Type ABS for absent and EX for exempt.', 'A sent paper is locked; ask the principal to unlock it.'] },
  { role: 'Lab technician', color: '#1f2a5c', menu: 'Today · Inventory', jobs: ['a-inventory'], remember: ['Count every item, and note anything broken or missing.', 'Send the form before the deadline.'] },
  { role: 'Hope helper', color: '#038241', menu: 'Today · Registers', jobs: ['h-gate', 'h-register', 'h-clubs'], remember: ['Only photograph children whose guardian agreed.', 'Tell the Director the same day if you are worried about a child.'] },
  { role: 'Reviewer', color: '#5b4b9a', menu: 'Every area of the places you were given, to look at only', jobs: ['g-screen', 'g-ask'], remember: ['You can look but not change anything.', 'Write what you notice in My reviews; Mr Andrew answers there.', 'Keep what you see private.'] },
];

exports.cards = (topics, pages, LOGO) => {
  const title = Object.fromEntries(topics.map((t) => [t.id, t.title]));
  return exports.CARDS.map((c, i) => `<section class="page card" id="${i === 0 ? 'cards' : 'card-' + i}" style="--c:${c.color}">
    <div class="cardhead"><div class="k">Quick card</div><h1>${c.role}</h1></div>
    <div class="cardbody">
      <h3>Your menu</h3><p>${c.menu}</p>
      <h3>Your main jobs</h3><ol class="steps">${c.jobs.map((j) => `<li><b>${title[j] || j}</b>${pages[j] ? ` <span class="pg">· page ${pages[j]}</span>` : j.startsWith('ad-') ? ' <span class="pg">· Administrator guide</span>' : ''}</li>`).join('')}</ol>
      <h3>Remember</h3><ul>${c.remember.map((r) => `<li>${r}</li>`).join('')}</ul>
      <div class="box tip"><span class="h">Stuck?</span>Press <b>Just ask Andy</b> on any page, or ask Mr Andrew.</div>
    </div></section>`).join('\n');
};
