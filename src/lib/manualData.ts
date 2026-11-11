// Made by docs/manual/tools/web.cjs from the manual's pages. Do not edit by hand: change the spec files and run it again.
export type ManualPartKey = 'start' | 'church' | 'adia' | 'hope' | 'shared' | 'admin';
export interface ManualTopic { id: string; part: ManualPartKey; title: string; purpose: string; who: string; where: string; before?: string; steps: string[]; see?: string; tip?: string; warn?: string; img?: string; wide?: boolean; path?: string }
export interface ManualRole { roleId: string; role: string; does: string; read: string; menu?: string; jobs: string[]; remember: string[] }

export const MANUAL_VERSION = '1.0, November 2026';
export const MANUAL_PARTS: Record<ManualPartKey, { n: string; title: string; color: string; intro: string }> = {
  "start": {
    "n": "Getting started",
    "title": "Getting started",
    "color": "#1f2a5c",
    "intro": "Signing in, finding your way around the screen, putting the app on your phone and getting help."
  },
  "church": {
    "n": "Part 1",
    "title": "Freedom Church Nairobi",
    "color": "#2f6b47",
    "intro": "People, Sunday services, first-timers and follow-ups, giving and reports."
  },
  "adia": {
    "n": "Part 2",
    "title": "ADIA Training Centre",
    "color": "#1f2a5c",
    "intro": "Students, the register, fees, exams, graduation, payroll, Tutor Files and inventory."
  },
  "hope": {
    "n": "Part 3",
    "title": "Freedom Hope Center",
    "color": "#038241",
    "intro": "Children, Saturday registers and gate sign-in, clubs, parents, sponsors and reports."
  },
  "shared": {
    "n": "Part 4",
    "title": "Shared by all three",
    "color": "#7a5a12",
    "intro": "Petty cash, signing, bank and financial statements, and the AI helps."
  },
  "admin": {
    "n": "Administrator guide",
    "title": "Accounts and settings",
    "color": "#14213d",
    "intro": "For Mr Andrew and Doreen: staff accounts, passwords, reviewers and settings."
  }
};
export const MANUAL_TOPICS: ManualTopic[] = [
 {
  "id": "g-signin",
  "part": "start",
  "title": "Sign in",
  "purpose": "Open Freedom ChMS and sign in with the password Mr Andrew gave you.",
  "who": "Everyone",
  "where": "freedom-chms.web.app on your phone or computer",
  "before": "You need the password from Mr Andrew or Doreen. Never share it with anyone.",
  "steps": [
   "Open your phone or computer browser (Chrome or Safari) and go to **freedom-chms.web.app**.",
   "Type your password in the **Password** box.",
   "Press **Sign in**. The app opens on your **Today** page."
  ],
  "see": "Your own Today page, with a greeting and your name.",
  "tip": "If the app says the password is not known, check that Caps Lock is off. If it still fails, ask Mr Andrew to reset it.",
  "img": "/manual/g-signin.jpg",
  "wide": false
 },
 {
  "id": "g-screen",
  "part": "start",
  "title": "Find your way around",
  "purpose": "Learn the parts of the screen that are the same on every page.",
  "who": "Everyone",
  "where": "Every page",
  "steps": [
   "**The menu.** On a computer it is on the left. On a phone it is the bar at the bottom. Press a word to open that page.",
   "**The organisation name.** It shows which place you are working in: Freedom Church, ADIA or Hope.",
   "**The search box.** Type a name or phone number to find a person quickly.",
   "**All saved.** A green dot means everything you did has reached the server.",
   "**Just ask Andy.** Press it any time to ask how to do something."
  ],
  "see": "The menu only shows the pages your role is allowed to use, so your menu may be shorter than this one.",
  "img": "/manual/g-screen.jpg",
  "wide": false,
  "path": "/"
 },
 {
  "id": "g-install",
  "part": "start",
  "title": "Put the app on your phone",
  "purpose": "Add Freedom ChMS to your home screen so it opens like any other app, even with no internet.",
  "who": "Everyone",
  "where": "More, Settings, This device",
  "steps": [
   "On Freedom Church, press **More**, then **Settings**. On ADIA and Hope, press **Settings**.",
   "Press **This device**.",
   "Under **Install and storage**, press **Install**. On an iPhone, press the Share button in Safari and then **Add to Home Screen**.",
   "Choose **Light**, **Dark** or **Match device** under **Theme** if you want a different look."
  ],
  "see": "A Freedom ChMS icon on your home screen.",
  "tip": "The app works without internet. What you save waits on the phone and is sent when the signal returns. Wait for **All saved** before you close the app.",
  "warn": "On a shared computer, tick **Sign out after 15 minutes without use**.",
  "img": "/manual/g-install.jpg",
  "wide": false,
  "path": "/settings/device"
 },
 {
  "id": "g-switch",
  "part": "start",
  "title": "Move between Church, ADIA and Hope",
  "purpose": "Change which place you are working in, if your account belongs to more than one.",
  "who": "People who work in more than one place",
  "where": "The organisation name at the top of the menu",
  "steps": [
   "Press the organisation name at the top of the menu.",
   "Choose **Freedom Church Nairobi**, **ADIA Training Centre** or **Freedom Hope Center**.",
   "The app changes colour and menu to match the place you chose."
  ],
  "see": "Green for the Church, navy and gold for ADIA, and bright green for Hope.",
  "tip": "You only see the places your account belongs to. Most people see only one, and then there is nothing to choose.",
  "img": "/manual/g-switch.jpg",
  "wide": true,
  "path": "/"
 },
 {
  "id": "g-ask",
  "part": "start",
  "title": "Just ask Andy",
  "purpose": "Get help on any page by asking a question in your own words.",
  "who": "Everyone",
  "where": "The gold **Just ask Andy** button on every page",
  "steps": [
   "Press the gold **Just ask Andy** button.",
   "Type your question, for example \"How do I add a visitor?\"",
   "Read the steps, or press **Take me there** to open the right page."
  ],
  "see": "Short steps for your question. If a page is closed to your role, it says to ask Mr Andrew.",
  "tip": "Just ask Andy knows the whole app, so it is the fastest way to find a page you have not used before.",
  "img": "/manual/g-ask.jpg",
  "wide": false,
  "path": "/"
 },
 {
  "id": "c-today",
  "part": "church",
  "title": "The Today page",
  "purpose": "See what needs you today, how last Sunday went, and whose birthday it is.",
  "who": "Pastor, Admin, Organization head, Staff",
  "where": "Today in the menu",
  "steps": [
   "**Needs you today** lists the jobs waiting for you, such as people to reach.",
   "**Last Sunday** shows the count, first-timers, salvations and giving.",
   "**Celebrations this week** shows birthdays and wedding anniversaries."
  ],
  "see": "If nothing is waiting, Needs you today says \"Nothing needs you right now. Well done!\"",
  "img": "/manual/c-today.jpg",
  "wide": false,
  "path": "/"
 },
 {
  "id": "c-find",
  "part": "church",
  "title": "Find a person",
  "purpose": "Open anyone’s record by name or phone number.",
  "who": "Pastor, Admin, Usher, Organization head, Staff",
  "where": "People in the menu, or the search box at the top",
  "steps": [
   "Press **People** in the menu.",
   "Type part of a name or phone number in the search box, or choose a group in the **Everyone** list.",
   "Press the person’s name to open their page."
  ],
  "see": "Each name has a badge: Visitor, Regular or Member.",
  "tip": "The search box at the top of every page finds people too, so you do not need to open People first.",
  "img": "/manual/c-find.jpg",
  "wide": false,
  "path": "/people"
 },
 {
  "id": "c-visitor",
  "part": "church",
  "title": "Add a visitor (first-timer)",
  "purpose": "Record a person who came for the first time, so the church can welcome them and follow up.",
  "who": "Pastor, Admin, Usher, Organization head, Staff",
  "where": "Today or Service, then Add visitor",
  "before": "Ask the visitor if they are happy to receive WhatsApp messages from the church.",
  "steps": [
   "Press **Add visitor** on Today or on the Service page.",
   "Type the visitor’s **Name** and **Phone**.",
   "Tick **They agreed** only if they said yes to WhatsApp messages.",
   "Press **Save**."
  ],
  "see": "The visitor appears under **First-timers this week** on the Service page, and a follow-up is made for the team.",
  "tip": "Visitors can also fill in their own card on their phone. Press **Show the QR poster** and let them scan it.",
  "img": "/manual/c-visitor.jpg",
  "wide": false,
  "path": "/visitors/new"
 },
 {
  "id": "c-member",
  "part": "church",
  "title": "Add a member or regular",
  "purpose": "Add someone who already attends but is not yet in the app.",
  "who": "Pastor, Admin, Usher, Organization head, Staff",
  "where": "People, then Add person",
  "steps": [
   "Press **People**, then **Add person**.",
   "Type the **Name** and **Phone**.",
   "Choose the **Status**: Visitor, Regular, Member or Inactive.",
   "Press **Save**."
  ],
  "see": "The person’s own page opens.",
  "warn": "Check that the person is not already in the app before you add them. Search for their phone number first.",
  "img": "/manual/c-member.jpg",
  "wide": false,
  "path": "/people/new"
 },
 {
  "id": "c-person",
  "part": "church",
  "title": "A person’s page and changing details",
  "purpose": "See everything about one person and correct their details.",
  "who": "Pastor, Admin, Usher, Organization head, Staff",
  "where": "People, then press a name",
  "steps": [
   "Open the person from **People**.",
   "Press **Call** or **WhatsApp** to contact them straight away.",
   "Press **Edit** to change the name, phone or birthday, then press **Save**.",
   "Scroll down for **Family**, **Attendance**, **Follow-up**, **Journey** and **Giving**."
  ],
  "see": "Attendance shows how many of the last 8 weeks they came.",
  "tip": "Giving and pastoral notes only show to roles that are allowed to see them.",
  "img": "/manual/c-person.jpg",
  "wide": false,
  "path": "/people/church/*"
 },
 {
  "id": "c-family",
  "part": "church",
  "title": "Families",
  "purpose": "Link a husband, wife and children so the family shows together and can be checked in together.",
  "who": "Pastor, Admin, Usher, Organization head, Staff",
  "where": "A person’s page, Family box",
  "steps": [
   "Open one person in the family.",
   "In the **Family** box, press **Add a family member**.",
   "Choose the person and say if they are the spouse or a child, then save."
  ],
  "see": "The family name, for example \"The Kamau family\", and everyone in it.",
  "tip": "Add the wedding date in the Family box, and the anniversary shows on Today each year.",
  "img": "/manual/c-family.jpg",
  "wide": false,
  "path": "/people/church/*"
 },
 {
  "id": "c-status",
  "part": "church",
  "title": "Change someone’s status",
  "purpose": "Move a person from Visitor to Regular, or from Regular to Member.",
  "who": "Mr Andrew and Doreen only",
  "where": "People, the badge next to the name",
  "steps": [
   "Open **People**.",
   "Press the badge next to the person’s name.",
   "Choose the new status. If you made a mistake, press **Undo**."
  ],
  "see": "The new badge. The day they became a Member is kept for the reports.",
  "tip": "To change many people at once, press **Select**, tick the names and press **Change status to…**",
  "img": "/manual/c-status.jpg",
  "wide": false,
  "path": "/people"
 },
 {
  "id": "c-checkin",
  "part": "church",
  "title": "Sunday check-in",
  "purpose": "Record who came to the service by name.",
  "who": "Pastor, Admin, Usher, Organization head, Staff",
  "where": "Service in the menu",
  "steps": [
   "Press **Service** in the menu. Today’s date is already filled in.",
   "Type the service name, for example **Main service**.",
   "Press **Check in by name**, find each person and press their name."
  ],
  "see": "Each name you press is ticked. Press it again to undo.",
  "tip": "For a family, press **Whole family** to check everyone in at once.",
  "img": "/manual/c-checkin.jpg",
  "wide": false,
  "path": "/attendance"
 },
 {
  "id": "c-headcount",
  "part": "church",
  "title": "Enter the Sunday headcount",
  "purpose": "Count everyone in the service, so the weekly report is right.",
  "who": "Pastor, Admin, Usher",
  "where": "Service in the menu",
  "steps": [
   "Open **Service** and type the service name.",
   "Press **+** and **–** under **Adults**, **Teens** and **Children** as you count.",
   "Or, if you only counted everyone together, use **Whole Church**.",
   "Add **First-time visitors** and **Salvations**.",
   "Check the **Total count**. It saves as you go."
  ],
  "see": "Today’s services at the bottom shows the total, first-timers, salvations and giving.",
  "tip": "Press **Send to leaders on WhatsApp** after the service to share the numbers.",
  "img": "/manual/c-headcount.jpg",
  "wide": false,
  "path": "/attendance"
 },
 {
  "id": "c-firsttimers",
  "part": "church",
  "title": "Welcome this week’s first-timers",
  "purpose": "Send each first-timer a warm welcome message the same week.",
  "who": "Pastor, Organization head, people who handle follow-ups",
  "where": "Service, First-timers this week",
  "steps": [
   "Open **Service** and scroll to **First-timers this week**.",
   "Press **Draft welcome messages**. The helper writes one for each person.",
   "Press **Send welcome** on each one. WhatsApp opens. Read it and press send."
  ],
  "see": "Each visitor is marked as welcomed.",
  "tip": "Nothing is sent by itself. You always read the message first.",
  "img": "/manual/c-firsttimers.jpg",
  "wide": false,
  "path": "/attendance"
 },
 {
  "id": "c-reach",
  "part": "church",
  "title": "People to reach today (follow-ups)",
  "purpose": "Call or message the people the church should reach today, such as new visitors or people who missed church.",
  "who": "Pastor, Admin, Organization head, Staff",
  "where": "Today, Needs you today",
  "steps": [
   "On **Today**, press **people to reach today**.",
   "Press a name and choose **WhatsApp** or **Call**.",
   "When you are done, mark it **Done: message sent** or **Done: we spoke**."
  ],
  "see": "The person leaves the list. The number on Today goes down.",
  "img": "/manual/c-reach.jpg",
  "wide": false,
  "path": "/"
 },
 {
  "id": "c-whatsapp",
  "part": "church",
  "title": "Send someone a WhatsApp message",
  "purpose": "Send a ready-written message, such as a thank you or an invitation, to one person.",
  "who": "Pastor, Admin, Usher, Organization head, Staff",
  "where": "A person’s page, WhatsApp",
  "steps": [
   "Open the person’s page and press **WhatsApp**.",
   "Choose the message. Press **Write it for me** if you want the helper to make it warmer.",
   "Press **Open WhatsApp** and send it there."
  ],
  "see": "The message is noted on the person’s page.",
  "warn": "Only message people who agreed to WhatsApp messages. If someone asks to stop, press **They asked us to stop WhatsApp messages** on their page.",
  "img": "/manual/c-whatsapp.jpg",
  "wide": false,
  "path": "/people/church/*"
 },
 {
  "id": "c-celebrate",
  "part": "church",
  "title": "Birthdays and wedding anniversaries",
  "purpose": "Greet members on their birthday and anniversary.",
  "who": "Pastor, Admin, Usher, Organization head, Staff",
  "where": "Today, Celebrations this week",
  "steps": [
   "On **Today**, scroll to **Celebrations this week**.",
   "Press **Send card** to share the birthday card on WhatsApp.",
   "Anniversaries show in the same box, with a greeting button."
  ],
  "see": "The card carries the person’s name. Cards also go by email at 7am to anyone with an email address.",
  "img": "/manual/c-celebrate.jpg",
  "wide": false,
  "path": "/"
 },
 {
  "id": "c-dayGiving",
  "part": "church",
  "title": "Record a day’s giving",
  "purpose": "Enter the total offerings and tithes collected in cash, bank or cheque on one day.",
  "who": "Pastor, Finance",
  "where": "Giving in the menu",
  "steps": [
   "Press **Giving**. Under **Day**, press **Today** or **Last Sunday**.",
   "Choose **How given**: Cash, Bank or Cheque.",
   "Type the **Offerings** and **Tithes** amounts. Use **Another kind of giving** for building fund and others.",
   "Press **Save**."
  ],
  "see": "The month total at the top goes up, and the gifts appear in **Last 30 days**.",
  "tip": "M-Pesa Paybill gifts do not need typing. Upload the Paybill statement instead (next pages).",
  "img": "/manual/c-dayGiving.jpg",
  "wide": false,
  "path": "/giving"
 },
 {
  "id": "c-gift",
  "part": "church",
  "title": "Record one gift and give a receipt",
  "purpose": "Record a gift from a named person and make their receipt.",
  "who": "Pastor, Finance",
  "where": "Giving, then Record one gift instead",
  "steps": [
   "Press **Giving**, then **Record one gift instead (a named giver, with a receipt)**.",
   "Paste an M-Pesa message, or choose **How was it given?** and type the **Amount**.",
   "Choose the **Giving** (Tithes, Offerings…) and the person under **Given by**.",
   "Press **Save and make receipt**."
  ],
  "see": "A receipt with a number such as FCN-2026-000016 that you can share.",
  "img": "/manual/c-gift.jpg",
  "wide": false,
  "path": "/giving/new"
 },
 {
  "id": "c-paybill",
  "part": "church",
  "title": "Upload the M-Pesa Paybill statement",
  "purpose": "Bring in all Paybill 222118 payments at once, without typing them.",
  "who": "Pastor, Finance",
  "where": "Giving, More giving, Import",
  "before": "Download the statement for Paybill 222118 from the M-Pesa portal as Excel (.xlsx) or CSV.",
  "steps": [
   "Open **Giving**, choose **More giving…** and then **Import**.",
   "Press **Choose statement file** and pick the file you downloaded.",
   "Check the list and save. Payments already in the app are skipped."
  ],
  "see": "Payments with a member’s phone number are matched to them. The rest wait in Unassigned.",
  "tip": "You can import the same statement again safely. Nothing is counted twice.",
  "img": "/manual/c-paybill.jpg",
  "wide": false,
  "path": "/giving/import"
 },
 {
  "id": "c-unassigned",
  "part": "church",
  "title": "Payments with no name",
  "purpose": "Decide who sent a payment, or which fund it belongs to, when the app could not tell.",
  "who": "Pastor, Finance",
  "where": "Giving, the box that says a payment needs a person or fund",
  "steps": [
   "On **Giving**, press **payment needs a person or fund**.",
   "Read the phone number and account on the payment. Press **Ask the helper who this is** for a suggestion.",
   "Choose the person under **Who gave it** and the **Fund**.",
   "Press **Confirm**. The receipt is made straight away."
  ],
  "see": "The payment leaves the Unassigned list.",
  "img": "/manual/c-unassigned.jpg",
  "wide": false,
  "path": "/giving/unassigned"
 },
 {
  "id": "c-statements",
  "part": "church",
  "title": "Giving statements and pledges",
  "purpose": "Give members a statement of their giving for the year, and keep track of pledges.",
  "who": "Pastor, Finance",
  "where": "Giving, More giving, Statements or Pledges",
  "steps": [
   "Open **Giving**, choose **More giving…** and then **Statements**.",
   "Choose the dates under **From** and **To**.",
   "Press **Share** next to a name, or **Download all statements** for one PDF.",
   "For pledges, choose **Pledges** under More giving and press **New pledge**."
  ],
  "see": "Each statement lists the person’s gifts and the total.",
  "img": "/manual/c-statements.jpg",
  "wide": false,
  "path": "/giving/statements"
 },
 {
  "id": "c-reports",
  "part": "church",
  "title": "Weekly and monthly reports",
  "purpose": "See how the church is doing: attendance, first-timers, salvations, groups, serving and giving.",
  "who": "Pastor, Admin, Organization head, Staff (giving figures for Pastor and Finance only)",
  "where": "More, then Reports",
  "steps": [
   "Press **More**, then **Reports**.",
   "Choose **Weekly**, **Monthly** or **Giving**.",
   "Read the scorecard. Green arrows are up on last week, red arrows are down.",
   "Press **Print** or **Download CSV** to keep a copy."
  ],
  "see": "A new weekly report is made every Monday morning at 7:00.",
  "tip": "To remake an earlier week, use **Make a report** and choose any day in that week.",
  "img": "/manual/c-reports.jpg",
  "wide": true,
  "path": "/reports"
 },
 {
  "id": "c-classes",
  "part": "church",
  "title": "Classes and programmes (Freedom 252)",
  "purpose": "Keep the register for Growth Track, Freedom 252, Communication Master Class and other classes.",
  "who": "Pastor, Admin, Organization head, Staff",
  "where": "People, then Classes and programmes",
  "steps": [
   "Press **People**, then **Classes and programmes**.",
   "Open the class, for example **Freedom 252**.",
   "Press **Register** and tick who came."
  ],
  "see": "Each member’s Journey shows the classes they finished.",
  "img": "/manual/c-classes.jpg",
  "wide": false,
  "path": "/programs"
 },
 {
  "id": "c-photos",
  "part": "church",
  "title": "Photos and wins",
  "purpose": "Share testimonies, events and good news with photos for the church leaders.",
  "who": "Everyone",
  "where": "More, then Photos and wins",
  "steps": [
   "Press **More**, then **Photos and wins**.",
   "Press **New report**, add a few lines and the photos.",
   "Send it. The leaders can reply to it like a conversation."
  ],
  "see": "Your report in the list, with replies under it.",
  "img": "/manual/c-photos.jpg",
  "wide": false,
  "path": "/updates"
 },
 {
  "id": "c-private",
  "part": "church",
  "title": "Private conversations",
  "purpose": "Write down a worry or concern about a member, kept private.",
  "who": "Pastor, Admin, Organization head, Staff",
  "where": "More, then Private conversations",
  "steps": [
   "Open the member’s page, or press **More**, then **Private conversations**.",
   "Start a conversation and write what happened.",
   "Mark it **Being handled** or **Resolved** as it moves on."
  ],
  "see": "Only Mr Andrew, Doreen and the church leaders can open them.",
  "warn": "Write facts, not gossip. Treat these notes as you would a pastoral file.",
  "img": "/manual/c-private.jpg",
  "wide": false,
  "path": "/conversations"
 },
 {
  "id": "c-notice",
  "part": "church",
  "title": "Write a WhatsApp group notice",
  "purpose": "Turn a few notes into a clear announcement for the church WhatsApp group.",
  "who": "Pastor, Organization head",
  "where": "More, then Write a notice",
  "steps": [
   "Press **More**, then **Write a notice**.",
   "Type a few lines in **Your notes**: what, when and where. Or press **Speak**.",
   "Press **Write it for me**, check the message, then copy it to WhatsApp."
  ],
  "see": "A finished message ready to paste.",
  "img": "/manual/c-notice.jpg",
  "wide": false,
  "path": "/notice"
 },
 {
  "id": "a-today",
  "part": "adia",
  "title": "The ADIA Today page",
  "purpose": "Start every job from one page: the register, exams, students, fees and petty cash.",
  "who": "Everyone at ADIA (each role sees only its own buttons)",
  "where": "Today in the menu",
  "steps": [
   "The welcome card shows the date and how many students are enrolled.",
   "**Needs you** lists anything waiting for you, such as a requisition to sign.",
   "Under **What do you want to do?**, press the big button for your job, for example **Mark register**."
  ],
  "see": "Trainers and lab technicians see a shorter Today page with only their own buttons.",
  "tip": "On a phone the menu is **Today, Register, School, Petty Cash** and **More**. On a computer you also see **Payroll, Exam Records** and **Settings** in the side menu.",
  "img": "/manual/a-today.jpg",
  "wide": false,
  "path": "/"
 },
 {
  "id": "a-register",
  "part": "adia",
  "title": "Mark the class register",
  "purpose": "Record which students came to class today.",
  "who": "Pastor, Principal, Organization head, Staff",
  "where": "Register in the menu (Attendance on a computer)",
  "steps": [
   "Press **Register**. Under **Which day?** press **Today** or **Yesterday**.",
   "Press the department, for example **Food and Beverage Production**.",
   "For each student press **Present**, **Late**, **Absent** or **Excused**.",
   "Press **Mark the other … present** to finish the rest in one tap."
  ],
  "see": "The counts at the top (Present, Late, Absent, Excused, Not marked) change as you go. Each tap saves by itself.",
  "tip": "Write the unit or topic covered in **Notes** so the principal can see what was taught.",
  "img": "/manual/a-register.jpg",
  "wide": false,
  "path": "/attendance/adia/*"
 },
 {
  "id": "a-pastreg",
  "part": "adia",
  "title": "Fill in a register for an earlier day",
  "purpose": "Catch up on registers that were kept on paper or missed.",
  "who": "Pastor, Principal, Organization head, Staff",
  "where": "Register, then Fill in a register",
  "steps": [
   "Press **Register** and scroll to **Past registers and results**. Choose the **Cohort** and press **Fill in a register**.",
   "Choose the **Class** and the **Month**.",
   "Tap a box to tick a student present for that day. Tap again to take it back."
  ],
  "see": "Days with no ticks at all are not counted, so a day the class did not meet does not lower anyone’s attendance.",
  "img": "/manual/a-pastreg.jpg",
  "wide": false,
  "path": "/attendance/past"
 },
 {
  "id": "a-find",
  "part": "adia",
  "title": "Find a student",
  "purpose": "Open a student’s page to see their details, attendance, fees and marks.",
  "who": "Pastor, Principal, Organization head, Staff",
  "where": "School in the menu",
  "steps": [
   "Press **School**. The student list opens.",
   "Use **Status**, **Cohort** and **Department** to narrow the list, or type a name or admission number.",
   "Press the cohort, then the student’s name."
  ],
  "see": "The student’s page, with their admission number, for example ADIA/2026/0002.",
  "tip": "Press a letter (A, B, C…) to jump to names starting with it.",
  "img": "/manual/a-find.jpg",
  "wide": false,
  "path": "/school/students"
 },
 {
  "id": "a-student",
  "part": "adia",
  "title": "A student’s page",
  "purpose": "See and correct everything about one student.",
  "who": "Pastor, Principal, Organization head, Staff (fees for Pastor, Finance and Principal)",
  "where": "School, then press a name",
  "steps": [
   "Press **Edit name and phone** to correct their details.",
   "Change **Status** or **Cohort** with the drop-down lists.",
   "See **Attendance**, **Fees** and marks further down. Press **Print results** for a result slip."
  ],
  "see": "Fees shows what was billed, what was paid and what is owed.",
  "warn": "The identity number is for the Director only. Other staff cannot see it.",
  "img": "/manual/a-student.jpg",
  "wide": false,
  "path": "/school/students/*"
 },
 {
  "id": "a-add",
  "part": "adia",
  "title": "Enrol a student",
  "purpose": "Add one new student to a department and cohort.",
  "who": "Pastor, Principal, Organization head, Staff",
  "where": "School, then Add students",
  "steps": [
   "Press **School**, then **+ Add students**.",
   "Type the **Student’s name** and phone, and choose the **Department**.",
   "Choose the **Status** and the day they **Started**.",
   "Add a **Sponsor or guardian** if there is one, then press **Enrol student**."
  ],
  "see": "The student gets the next admission number by themselves.",
  "img": "/manual/a-add.jpg",
  "wide": false,
  "path": "/school/students/new"
 },
 {
  "id": "a-import",
  "part": "adia",
  "title": "Add many students from Excel",
  "purpose": "Bring in a whole class list at once.",
  "who": "Pastor, Principal, Organization head, Staff",
  "where": "School, Add students, then Import from Excel",
  "before": "Prepare an Excel (.xlsx) or CSV file with one row per student and a row of column titles at the top. Only **Name** is required.",
  "steps": [
   "Press **Download a template** if you want a ready-made sheet.",
   "Press **Choose the file** and pick your class list.",
   "Check the list the app shows. Rows with a problem are marked. Then add the students."
  ],
  "see": "Students already at ADIA are skipped, so the same file can be imported again safely.",
  "img": "/manual/a-import.jpg",
  "wide": false,
  "path": "/school/students/import"
 },
 {
  "id": "a-fees",
  "part": "adia",
  "title": "School fees",
  "purpose": "Bill students, record payments and see who owes.",
  "who": "Pastor, Finance, Principal (balances only)",
  "where": "School, then Fees (the drop-down by the title)",
  "steps": [
   "Open **Fees**. The boxes show **Billed**, **Paid**, **Collected** and **Owed**.",
   "Use **Bill students** to send a term’s bill to a whole cohort.",
   "To record a payment, open the student and press **Record a payment**.",
   "**Arrears** lists everyone who owes. Press **Download** for a list."
  ],
  "see": "The balance changes straight away when a payment is recorded.",
  "img": "/manual/a-fees.jpg",
  "wide": false,
  "path": "/school/fees"
 },
 {
  "id": "a-exams",
  "part": "adia",
  "title": "Enter exam marks",
  "purpose": "Type CAT and final exam marks for your class.",
  "who": "Trainer, Principal, Pastor",
  "where": "Exam Records (on a phone: School, then Exam Records)",
  "steps": [
   "Open **Exam Records**, choose the cohort and open your mark sheet.",
   "Type each student’s mark. Type **ABS** for absent or **EX** for exempt.",
   "Marks save as you leave each box, even without internet.",
   "When a paper is complete, send it. A sent paper is locked."
  ],
  "see": "Totals and grades work themselves out as each CAT comes in.",
  "tip": "Prefer Excel? Press **Download class list (Excel)**, fill in the marks and press **Upload marks**.",
  "warn": "To change a mark after a paper is sent, ask the principal to unlock it.",
  "img": "/manual/a-exams.jpg",
  "wide": false,
  "path": "/school/exams/sheet/*"
 },
 {
  "id": "a-results",
  "part": "adia",
  "title": "Results, remarks and graduation",
  "purpose": "Approve mark sheets, print result slips and issue certificates.",
  "who": "Principal, Pastor",
  "where": "Exam Records, then Results; School, then Graduation",
  "steps": [
   "In **Exam Records**, open a sent sheet, check it and press **Approve**.",
   "Press **Results** to write remarks and print result slips.",
   "At the end of the course open **Graduation**. Upload the graduation list or press **Issue one certificate**."
  ],
  "see": "Each certificate is kept on the student’s page.",
  "img": "/manual/a-results.jpg",
  "wide": false,
  "path": "/school/graduation"
 },
 {
  "id": "a-depts",
  "part": "adia",
  "title": "Departments and cohorts",
  "purpose": "See each department’s cohorts and start a new cohort.",
  "who": "Pastor, Principal",
  "where": "Settings, then Departments",
  "steps": [
   "Each department shows its cohorts, the day each started and how many students it has.",
   "Press **+ New cohort** to start the next cohort.",
   "Press **Edit** to rename a department, or **+ New department** to add one."
  ],
  "see": "New students are placed in a cohort when you enrol them.",
  "img": "/manual/a-depts.jpg",
  "wide": false,
  "path": "/school/courses"
 },
 {
  "id": "a-payroll",
  "part": "adia",
  "title": "Payroll and payslips",
  "purpose": "Work out each month’s pay with tax and deductions, and print payslips.",
  "who": "Pastor, people given payroll access",
  "where": "Payroll in the menu (on a phone: More, then Payroll)",
  "steps": [
   "Check **Staff pay details** first. Add new staff there.",
   "Under **Prepare a pay run**, choose the **Month** and press **Open**.",
   "Check each person’s pay and prepare the pay run.",
   "A second person checks it and approves it. Then print or send the payslips."
  ],
  "see": "Past months stay under **Pay runs**.",
  "warn": "Nobody approves a pay run they prepared themselves.",
  "img": "/manual/a-payroll.jpg",
  "wide": false,
  "path": "/school/payroll"
 },
 {
  "id": "a-tutor",
  "part": "adia",
  "title": "Tutor Files",
  "purpose": "Collect course outlines, lesson plans and reports from the trainers.",
  "who": "Trainer, Principal, Pastor",
  "where": "Tutor Files in the menu",
  "steps": [
   "The principal presses **Ask for a file** and says what is needed and by when.",
   "Trainers open the request and upload the file.",
   "Under **Lesson plans**, a tick means the plan for that week was added."
  ],
  "see": "A red dot means the register was marked but the lesson plan is missing.",
  "img": "/manual/a-tutor.jpg",
  "wide": false,
  "path": "/tutor-files"
 },
 {
  "id": "a-inventory",
  "part": "adia",
  "title": "Count the inventory",
  "purpose": "Count the equipment in each department at the start and end of a cohort.",
  "who": "Lab technician, Trainer, Principal, Pastor",
  "where": "Inventory (on a phone: More, then Inventory)",
  "steps": [
   "Choose the cohort at the top.",
   "The principal sets the **Deadline** and presses **Open for all 4 departments**.",
   "Each department opens its form, counts each item, notes anything broken or missing, and sends it."
  ],
  "see": "Each count starts from the department’s last count, so you only change what moved.",
  "img": "/manual/a-inventory.jpg",
  "wide": false,
  "path": "/inventory"
 },
 {
  "id": "a-settings",
  "part": "adia",
  "title": "School settings",
  "purpose": "Set the grades, pass mark and how much each kind of assessment counts.",
  "who": "Pastor, Principal",
  "where": "Settings, then School settings",
  "steps": [
   "Under **Grading scale**, set the lowest mark for each grade.",
   "Set the **Pass mark (%)** and the weight of continuous assessment, practical and exam.",
   "Press **Save settings**."
  ],
  "warn": "Changing the grading scale changes the grades on every result slip. Ask Mr Andrew first.",
  "img": "/manual/a-settings.jpg",
  "wide": false,
  "path": "/school/settings"
 },
 {
  "id": "a-photos",
  "part": "adia",
  "title": "Photos and wins, and school reports",
  "purpose": "Share good news and incidents with photos, and read the weekly and monthly reports.",
  "who": "Everyone (reports for Pastor and Principal)",
  "where": "Today, then Photos and wins; School, then Reports",
  "steps": [
   "Press **Photos and wins**, then **New report**. Add a few lines and photos, and send it.",
   "The ADIA board can reply. Each report is a conversation.",
   "Open **Reports** for the weekly report, made every Monday morning."
  ],
  "img": "/manual/a-photos.jpg",
  "wide": false,
  "path": "/school/updates"
 },
 {
  "id": "h-today",
  "part": "hope",
  "title": "The Hope Today page",
  "purpose": "See the week at Hope Center and start the Saturday check-in.",
  "who": "Everyone at Hope Center",
  "where": "Today in the menu",
  "steps": [
   "The big green **Check in** button opens the gate sign-in on Saturdays.",
   "The line under it shows how many children and champions are registered.",
   "**Needs you** lists anything waiting for you, such as absent children to follow up."
  ],
  "tip": "On a phone the menu is **Today, Children, Registers, Reports, Petty Cash** and **More**.",
  "img": "/manual/h-today.jpg",
  "wide": false,
  "path": "/"
 },
 {
  "id": "h-find",
  "part": "hope",
  "title": "Find a child",
  "purpose": "Open a child’s page by name, code or parent’s name.",
  "who": "Pastor, Organization head, Staff, Hope helper",
  "where": "Children in the menu, or the search box at the top",
  "steps": [
   "Press **Children**.",
   "Use **Show** and **Sort by** to change the list, or type in the search box at the top.",
   "Press the child’s card to open their page."
  ],
  "see": "Each card shows the child’s code (HC-0001), age, class colour and sponsor.",
  "tip": "The class colours: blue Jasper, green Rubies, orange Sapphire, navy Emerald, black Topaz.",
  "img": "/manual/h-find.jpg",
  "wide": false,
  "path": "/hope/children"
 },
 {
  "id": "h-new",
  "part": "hope",
  "title": "Register a child",
  "purpose": "Add a new child to Freedom Hope Center.",
  "who": "Pastor, Organization head, Staff",
  "where": "Children, then Register a child",
  "before": "The parent or guardian must agree before you take or keep a photo of the child.",
  "steps": [
   "Press **Children**, then **Register a child**.",
   "Type the **Child’s name**, **Gender** and **Date of birth**.",
   "Press **Take** or **Choose** to add a photo, only if the guardian agreed.",
   "Press **Add more details** for school, clubs, sponsor, parent and consent. Then press **Register child**."
  ],
  "see": "The child gets the next code, for example HC-0211, by itself.",
  "img": "/manual/h-new.jpg",
  "wide": false,
  "path": "/hope/children/new"
 },
 {
  "id": "h-child",
  "part": "hope",
  "title": "A child’s page",
  "purpose": "See everything about one child and contact the parent.",
  "who": "Pastor, Organization head, Staff (Care notes for Pastor and Director only)",
  "where": "Children, then press a child",
  "steps": [
   "Press **Call Parent** or **WhatsApp** to reach the parent.",
   "The tabs **About**, **Attendance**, **Fees** and **Care** hold the child’s record.",
   "Press **Edit details** to correct something, or **Sponsor update** to write to the sponsor."
  ],
  "warn": "Care notes are private. Never copy them into WhatsApp or show them to other children or parents.",
  "img": "/manual/h-child.jpg",
  "wide": false,
  "path": "/hope/children/*"
 },
 {
  "id": "h-register",
  "part": "hope",
  "title": "Take the children’s register",
  "purpose": "Mark who came on Saturday.",
  "who": "Pastor, Organization head, Staff, Hope helper",
  "where": "Registers in the menu",
  "steps": [
   "Press **Registers**. Choose the day, or press **Other date**.",
   "Choose **Children**, **Champions** or **Clubs**.",
   "For each child press **Present**, **Late**, **Absent** or **Excused**.",
   "At the end, press **Mark the … not marked as absent**."
  ],
  "see": "**All children** shows how many came, as a number and a percentage.",
  "tip": "Children who are absent two Saturdays in a row show up on Today for a follow-up call.",
  "img": "/manual/h-register.jpg",
  "wide": false,
  "path": "/hope/register"
 },
 {
  "id": "h-gate",
  "part": "hope",
  "title": "Check in at the gate",
  "purpose": "Let children and champions sign themselves in with their card as they arrive.",
  "who": "Hope helper, Staff",
  "where": "Today, Check in",
  "steps": [
   "On **Today**, press **Check in**. The camera opens.",
   "The child holds their card up to the camera. The app ticks them present.",
   "If the card will not scan, type the code (for example HC-0012) and press **Check in**."
  ],
  "see": "The count at the top goes up with each child and champion.",
  "tip": "Press **Leave** to go back to the app when check-in is over.",
  "img": "/manual/h-gate.jpg",
  "wide": false,
  "path": "/hope/gate"
 },
 {
  "id": "h-clubs",
  "part": "hope",
  "title": "Clubs",
  "purpose": "Keep the register and wins for each club.",
  "who": "Pastor, Organization head, Staff, Hope helper",
  "where": "Registers, then Clubs",
  "steps": [
   "The first time, press **Add the clubs** to add the 8 Hope Centre clubs in one tap.",
   "Open a club to mark its register.",
   "Add the club’s wins with a photo so they show in Photos and wins."
  ],
  "img": "/manual/h-clubs.jpg",
  "wide": false,
  "path": "/hope/clubs"
 },
 {
  "id": "h-messages",
  "part": "hope",
  "title": "WhatsApp the parents",
  "purpose": "Send one message, such as a Saturday reminder, to many parents from the Hope phone.",
  "who": "Pastor, Organization head, Staff",
  "where": "More, then WhatsApp parents",
  "before": "Use the Hope Centre phone (0794 645 455), so parents see the Hope number.",
  "steps": [
   "Choose who to **Send to** and the **Message**.",
   "Check the words. **{parent}** and **{child}** become their names.",
   "Press **Send next**. WhatsApp opens ready to send. Send it, then come back for the next one."
  ],
  "see": "The count of messages sent goes up.",
  "img": "/manual/h-messages.jpg",
  "wide": false,
  "path": "/hope/messages"
 },
 {
  "id": "h-sponsors",
  "part": "hope",
  "title": "Sponsors and photos",
  "purpose": "Keep the sponsorship list and children’s photos up to date.",
  "who": "Pastor, Organization head, Staff",
  "where": "Children, More, then Sponsors or Photos",
  "steps": [
   "For sponsors, press **Choose the filled-in file** and upload the monthly Child Registration List (KE-014).",
   "For photos, name each photo with the child’s code (HC-0042.jpg) or full name.",
   "Press **Choose the photos** to upload many at once."
  ],
  "warn": "Only upload photos of children whose guardian agreed to photos.",
  "img": "/manual/h-sponsors.jpg",
  "wide": false,
  "path": "/hope/children/sponsors"
 },
 {
  "id": "h-reports",
  "part": "hope",
  "title": "Hope reports and records",
  "purpose": "See the figures and outcomes, and open attendance, meals and care records.",
  "who": "Pastor, Organization head (Care for Pastor and Director)",
  "where": "Reports in the menu",
  "steps": [
   "Press **Reports**. Open **Attendance and meals**, **Care** or **Photos and wins**.",
   "**Figures** shows children registered, attendance last Saturday, champions and sponsorship.",
   "**How the children are doing** shows the key outcomes."
  ],
  "see": "The month’s report, with numbers only, is made by itself on the 1st. A summary goes to Mr Andrew and Diana every Monday at 7am.",
  "img": "/manual/h-reports.jpg",
  "wide": false,
  "path": "/hope/reports"
 },
 {
  "id": "s-petty",
  "part": "shared",
  "title": "How petty cash works",
  "purpose": "Understand the rules before you ask for, sign or pay petty cash.",
  "who": "Everyone with Petty Cash in their menu",
  "where": "Petty Cash in the menu",
  "steps": [
   "Each place (Church, ADIA and Hope) has its own petty cash. It is paid from the bank.",
   "**Waiting for you** lists requisitions you need to sign.",
   "**Money in the bank** is the last bank statement balance, less what has been approved since.",
   "**My requests** shows each of your requisitions and how many signatures it has."
  ],
  "see": "The tabs are **Overview**, **New requisition**, **Receipts** and **Reports**.",
  "tip": "If the page says no bank statement has been uploaded, requisitions cannot be approved until the latest statement is uploaded in Financial statements.",
  "warn": "Any two signers approve. The person who asked cannot sign their own request, and nobody signs twice. KES 10,000 or more also needs Mr Andrew.",
  "img": "/manual/s-petty.jpg",
  "wide": false,
  "path": "/petty-cash"
 },
 {
  "id": "s-new",
  "part": "shared",
  "title": "Ask for petty cash (new requisition)",
  "purpose": "Request money for something the ministry needs.",
  "who": "Everyone with Petty Cash",
  "where": "Petty Cash, then New requisition",
  "steps": [
   "Press **New requisition**. Choose the **Requester** and the **Category**.",
   "Under **Expense items**, type what it is for, the quantity and unit price. Press **Add another item** for more.",
   "Or say or type what you need and press **Fill the form for me**. Check what it fills in.",
   "Press **Submit requisition**."
  ],
  "see": "The requisition gets a number, for example FCN-00003, and waits for two signatures.",
  "tip": "Press **Copy an old one** to repeat a requisition you made before.",
  "img": "/manual/s-new.jpg",
  "wide": false,
  "path": "/petty-cash/new"
 },
 {
  "id": "s-sign",
  "part": "shared",
  "title": "Approve or sign a requisition",
  "purpose": "Check a request and sign it with your PIN.",
  "who": "Petty cash signatory, Pastor",
  "where": "Petty Cash, Waiting for you",
  "steps": [
   "Open the requisition from **Waiting for you**.",
   "Read the items, the total and who asked.",
   "Press **Approve** and type your signing PIN, or press **Decline** and give a reason.",
   "The person who asked presses **Send Email** or **Send WhatsApp** to ask the signers."
  ],
  "see": "**Authorization** lists who has signed and who still needs to.",
  "img": "/manual/s-sign.jpg",
  "wide": false,
  "path": "/petty-cash/*"
 },
 {
  "id": "s-receipts",
  "part": "shared",
  "title": "Receipts and matching bank payments",
  "purpose": "Keep a receipt for every approved requisition.",
  "who": "Everyone with Petty Cash",
  "where": "Petty Cash, then Receipts",
  "steps": [
   "Open **Receipts** and find the requisition that was paid. Add the receipt photo or file.",
   "For payments with no receipt, upload the bank payments under **Match bank payments**.",
   "Check each match the app suggests. Once confirmed, the bank payment counts as the receipt."
  ],
  "see": "**Receipt needed** shows how many approved requisitions still have no receipt.",
  "img": "/manual/s-receipts.jpg",
  "wide": false,
  "path": "/petty-cash/receipts"
 },
 {
  "id": "s-report",
  "part": "shared",
  "title": "Petty cash monthly report",
  "purpose": "Print or send the month’s petty cash report.",
  "who": "Finance, signatories, Pastor",
  "where": "Petty Cash, then Reports",
  "steps": [
   "Open **Reports** and choose the **Period**.",
   "Choose who it is **Approved by**.",
   "Press **Download PDF** or **Download Excel**."
  ],
  "see": "The report has the opening and closing balance, money in and out, each voucher, and the sign-off lines.",
  "img": "/manual/s-report.jpg",
  "wide": false,
  "path": "/petty-cash/reports"
 },
 {
  "id": "s-pin",
  "part": "shared",
  "title": "Set your signing PIN",
  "purpose": "Make a 4 to 6 digit PIN to sign petty cash quickly.",
  "who": "Signatories, Pastor",
  "where": "Settings, then Signing PIN (on Church, under More)",
  "steps": [
   "Open **Settings** and press **Signing PIN**.",
   "Type your password, then your new PIN twice.",
   "Press **Save PIN**."
  ],
  "warn": "Never tell anyone your PIN. A signature with your PIN is your signature.",
  "img": "/manual/s-pin.jpg",
  "wide": false,
  "path": "/settings/signing-pin"
 },
 {
  "id": "s-finance",
  "part": "shared",
  "title": "Bank and financial statements",
  "purpose": "Upload the bank statement and get the monthly income and expenditure.",
  "who": "Finance, signatories, Pastor",
  "where": "Petty Cash, then Financial statements",
  "steps": [
   "Press **Financial statements**. Choose the **Account**.",
   "Press **Choose the statement** and pick the Family Bank PDF, Excel or CSV.",
   "Check the lines. Ask the helper to sort lines with no category.",
   "Read the income and expenditure, and close the month when it is right."
  ],
  "warn": "A closed month locks its requisitions too. Only the Director can open it again.",
  "img": "/manual/s-finance.jpg",
  "wide": false,
  "path": "/finance"
 },
 {
  "id": "s-ai",
  "part": "shared",
  "title": "The AI helps",
  "purpose": "Let the helper draft messages, notices and reports for you to check.",
  "who": "Leaders",
  "where": "Just ask Andy, then See the things the AI helper can do",
  "steps": [
   "Open **Just ask Andy** and tap the gold link to the AI Helper.",
   "Choose a help, for example **Ask the app** or **Welcome first-timers**.",
   "Read what the helper wrote and change it if needed. Nothing is sent or saved until you tap."
  ],
  "warn": "The helper never approves money, never matches a payment by itself, never judges a child’s safety and never sees private notes. Only first names and numbers are sent to it.",
  "img": "/manual/s-ai.jpg",
  "wide": false,
  "path": "/ai"
 },
 {
  "id": "ad-accounts",
  "part": "admin",
  "title": "Add a staff account",
  "purpose": "Give a new person their own sign-in, with the right role and places.",
  "who": "Mr Andrew and Doreen only",
  "where": "More, Settings, Staff accounts, then Add",
  "before": "Decide the person’s role and which places they work in. Give each person their own account. Never share one account.",
  "steps": [
   "Open **Settings**, press **Staff accounts**, then **Add**.",
   "Type the **Full name** and **Email**.",
   "Choose the **Role**. Each role says what it can and cannot see.",
   "Tick the **Organizations** they work in, and anything under **Also allow**. Then save."
  ],
  "see": "The app makes a password. Give it to the person yourself, in person or by phone, never in a group chat.",
  "warn": "Give the smallest role that lets the person do their job. Pastoral notes and money are closed to most roles on purpose.",
  "img": "/manual/ad-accounts.jpg",
  "wide": false,
  "path": "/settings/users/new"
 },
 {
  "id": "ad-reset",
  "part": "admin",
  "title": "Reset a password or switch an account off",
  "purpose": "Help someone who forgot their password, or close the account of someone who has left.",
  "who": "Mr Andrew and Doreen only",
  "where": "Settings, Staff accounts, then press the name",
  "steps": [
   "Open **Staff accounts** and press the person’s name.",
   "Press the button to reset the password. Give the new password to the person yourself.",
   "To close the account of someone who has left, switch the account off. Their records stay."
  ],
  "tip": "Each person can change their own password in **Settings, This device, My password**.",
  "img": "/manual/ad-reset.jpg",
  "wide": false,
  "path": "/settings/users"
 },
 {
  "id": "ad-reviewers",
  "part": "admin",
  "title": "Reviewers and their reviews",
  "purpose": "Let an outsider look at the app and write suggestions, without changing anything.",
  "who": "Mr Andrew only",
  "where": "Settings, then Reviews",
  "steps": [
   "Add a reviewer as a staff account with the role **Reviewer**, and tick the places they may look at.",
   "Under **Reviewers** you can switch a reviewer off or on.",
   "New reviews show here and on Today. Read each one, press the page name to see it, and press **Answer**."
  ],
  "see": "The reviewer sees your answer in their own review window.",
  "warn": "Reviewers never see pastoral notes, private conversations, staff accounts or the full download, but they do see real names. Choose reviewers you trust.",
  "img": "/manual/ad-reviewers.jpg",
  "wide": false,
  "path": "/reviews"
 },
 {
  "id": "ad-settings",
  "part": "admin",
  "title": "The Settings page",
  "purpose": "Know what each setting does before you change it.",
  "who": "Pastor (some items for Organization heads)",
  "where": "More, then Settings (on ADIA and Hope: Settings)",
  "steps": [
   "**People**: the journey stages and your own extra fields.",
   "**Birthday card**, **WhatsApp** and **Staff accounts**: see the next pages.",
   "**This device**: install, sync, theme, signing PIN and password.",
   "**Advanced**: organisations, clean-up, data download, the audit log and programme reminders. Change these only when you are sure."
  ],
  "tip": "**Sign out** is at the bottom of Settings.",
  "img": "/manual/ad-settings.jpg",
  "wide": false,
  "path": "/settings"
 },
 {
  "id": "ad-templates",
  "part": "admin",
  "title": "Change the words of WhatsApp messages",
  "purpose": "Edit the ready-made messages staff send, such as the first-time visitor welcome.",
  "who": "Pastor",
  "where": "More, Settings, WhatsApp, then Messages",
  "steps": [
   "Open **Settings**, press **WhatsApp**, then **Messages**.",
   "Find the message by its **Name** and change the words in **Message**.",
   "Use merge fields such as **{first_name}** and **{campus}**. The app fills them in for each person. Then save."
  ],
  "see": "Staff can still change a message before they send it.",
  "img": "/manual/ad-templates.jpg",
  "wide": false,
  "path": "/settings/templates"
 },
 {
  "id": "ad-card",
  "part": "admin",
  "title": "The birthday card and the QR poster",
  "purpose": "Change the birthday card picture, and print the poster visitors scan to sign up.",
  "who": "Pastor",
  "where": "Settings, Birthday card; People, Show the QR poster",
  "steps": [
   "In **Birthday card**, press **Upload a new picture**, tap the card to move where the name goes, and choose the **Name colour**.",
   "Press **Email me a test card** to check it.",
   "For the visitor poster, open **Add visitor**, press **Show the QR poster**, then **Print the poster**."
  ],
  "see": "Cards that visitors send appear in People as visitors, with their welcome follow-ups.",
  "img": "/manual/ad-card.jpg",
  "wide": false,
  "path": "/settings/birthday-card"
 }
];
export const MANUAL_ROLES: ManualRole[] = [
 {
  "roleId": "pastor",
  "role": "Pastor",
  "does": "Everything, in every place",
  "read": "All of this manual, and the Administrator guide",
  "menu": "Everything, in every place",
  "jobs": [
   "c-today",
   "c-reports",
   "s-sign",
   "ad-accounts"
  ],
  "remember": [
   "You see every page and every place.",
   "Requisitions of KES 10,000 or more need you.",
   "Only you and Doreen manage accounts and passwords."
  ]
 },
 {
  "roleId": "admin",
  "role": "Admin",
  "does": "People, Sunday services, follow-ups and gifts at the Church",
  "read": "Getting started, Part 1",
  "menu": "Today · People · Service · Giving · More",
  "jobs": [
   "c-visitor",
   "c-checkin",
   "c-headcount",
   "c-reach",
   "c-gift"
  ],
  "remember": [
   "Search before you add someone, to avoid doubles.",
   "Wait for All saved before you close the app."
  ]
 },
 {
  "roleId": "head",
  "role": "Organization head",
  "does": "Leads one place and can add staff accounts there. Does not see money",
  "read": "Getting started, the part for your place",
  "menu": "The menu of your place",
  "jobs": [
   "c-today",
   "c-find",
   "c-reach",
   "c-photos"
  ],
  "remember": [
   "You lead one place and can add its staff accounts.",
   "Money pages are closed to your role."
  ]
 },
 {
  "roleId": "staff",
  "role": "Staff",
  "does": "People, attendance and follow-ups in one place. Does not see money",
  "read": "Getting started, the part for your place",
  "menu": "The menu of your place",
  "jobs": [
   "c-find",
   "c-visitor",
   "c-checkin",
   "c-reach"
  ],
  "remember": [
   "Money pages are closed to your role.",
   "Ask Just ask Andy when you are not sure."
  ]
 },
 {
  "roleId": "usher",
  "role": "Usher",
  "does": "Sunday check-in, headcount and visitors",
  "read": "Getting started; in Part 1: Find a person, Add a visitor, Families, Sunday check-in, Headcount",
  "menu": "People · Service · More",
  "jobs": [
   "c-visitor",
   "c-checkin",
   "c-headcount",
   "c-family"
  ],
  "remember": [
   "Ask each visitor before ticking They agreed for WhatsApp.",
   "Press Whole family to check a family in at once.",
   "Send the numbers to leaders after the service."
  ]
 },
 {
  "roleId": "finance",
  "role": "Finance",
  "does": "Giving, receipts, statements and petty cash",
  "read": "Getting started; in Part 1: the Giving pages and Reports; Part 4: Petty cash",
  "menu": "Giving · Petty Cash · More",
  "jobs": [
   "c-dayGiving",
   "c-gift",
   "c-paybill",
   "c-unassigned",
   "s-report"
  ],
  "remember": [
   "Every gift gets a receipt.",
   "Upload the Paybill statement instead of typing M-Pesa gifts.",
   "Upload the bank statement so requisitions can be approved."
  ]
 },
 {
  "roleId": "signatory",
  "role": "Petty cash signatory",
  "does": "Signs requisitions",
  "read": "Getting started; Part 4: Petty cash",
  "menu": "Petty Cash",
  "jobs": [
   "s-petty",
   "s-sign",
   "s-pin"
  ],
  "remember": [
   "Any two signers approve; nobody signs twice.",
   "Never sign a requisition you asked for.",
   "KES 10,000 or more also needs Mr Andrew."
  ]
 },
 {
  "roleId": "principal",
  "role": "Principal",
  "does": "Students, register, exams and graduation at ADIA",
  "read": "Getting started; Part 2: ADIA",
  "menu": "Today · Register · School · More",
  "jobs": [
   "a-register",
   "a-find",
   "a-add",
   "a-results",
   "a-depts"
  ],
  "remember": [
   "You see each student’s fee balance, not the invoices.",
   "Approve mark sheets before printing result slips."
  ]
 },
 {
  "roleId": "trainer",
  "role": "Trainer",
  "does": "Enters exam marks and uses Tutor Files at ADIA",
  "read": "Getting started; Part 2: Exam marks, Tutor Files",
  "menu": "Today · Exam Records · Tutor Files",
  "jobs": [
   "a-exams",
   "a-tutor"
  ],
  "remember": [
   "Marks save as you leave each box.",
   "Type ABS for absent and EX for exempt.",
   "A sent paper is locked; ask the principal to unlock it."
  ]
 },
 {
  "roleId": "labtech",
  "role": "Lab technician",
  "does": "Counts inventory at ADIA",
  "read": "Getting started; Part 2: Inventory",
  "menu": "Today · Inventory",
  "jobs": [
   "a-inventory"
  ],
  "remember": [
   "Count every item, and note anything broken or missing.",
   "Send the form before the deadline."
  ]
 },
 {
  "roleId": "helper",
  "role": "Hope helper",
  "does": "Takes the children’s register at Hope Center",
  "read": "Getting started; Part 3: the register and gate sign-in",
  "menu": "Today · Registers",
  "jobs": [
   "h-gate",
   "h-register",
   "h-clubs"
  ],
  "remember": [
   "Only photograph children whose guardian agreed.",
   "Tell the Director the same day if you are worried about a child."
  ]
 },
 {
  "roleId": "reviewer",
  "role": "Reviewer",
  "does": "Looks at the app and writes suggestions. Cannot change anything",
  "read": "Getting started (Find your way around, Just ask Andy)",
  "menu": "Every area of the places you were given, to look at only",
  "jobs": [
   "g-screen",
   "g-ask"
  ],
  "remember": [
   "You can look but not change anything.",
   "Write what you notice in My reviews; Mr Andrew answers there.",
   "Keep what you see private."
  ]
 }
];
export const MANUAL_PRIVACY = {
 "intro": "Freedom ChMS holds the names, phone numbers, giving, school records and children’s records of people who trust us. Kenya’s Data Protection Act asks us to keep that information safe and use it only for the reason it was given. These rules apply to everyone with an account.",
 "sections": [
  {
   "h": "Your account",
   "items": [
    "Use only your own account. Never share your password or signing PIN.",
    "Sign out on a shared computer, or tick **Sign out after 15 minutes without use**.",
    "If you think someone knows your password, tell Mr Andrew straight away so he can reset it."
   ]
  },
  {
   "h": "People’s details",
   "items": [
    "Only message people who agreed to WhatsApp messages. If someone asks to stop, record it on their page the same day.",
    "Do not copy lists of names or phone numbers out of the app, or post them in WhatsApp groups.",
    "Do not take screenshots of people’s records to send to others."
   ]
  },
  {
   "h": "Pastoral notes and private conversations",
   "items": [
    "Write facts, kindly, as if the person will read it one day.",
    "Never repeat what you read there to anyone who does not need to know."
   ]
  },
  {
   "h": "Children at Freedom Hope Center",
   "items": [
    "Only take, keep or share a child’s photo if the guardian agreed to photos.",
    "Care notes, welfare and safeguarding records are for the Pastor and the Director only.",
    "If you are worried about a child’s safety, tell the Director or Mr Andrew in person the same day. Do not write the details in WhatsApp."
   ]
  },
  {
   "h": "Money",
   "items": [
    "Every gift gets a receipt. Every requisition is signed by two different people.",
    "Never sign a requisition you asked for, and never sign for someone else."
   ]
  }
 ],
 "warn": "If something goes wrong, such as a phone with the app being lost or a message sent to the wrong person, tell Mr Andrew the same day. Quick action protects the people involved."
};
export const MANUAL_PROBLEMS: [string, string][] = [["**The app says my password is not known.**","Check that Caps Lock is off and try again. If it still fails, ask Mr Andrew or Doreen to reset it. Nobody else can."],["**The badge at the top does not say All saved.**","You are offline or the signal is weak. Keep working: what you save waits on the phone. Wait for All saved before you close the app or log out."],["**I can’t see a page that someone else has.**","Your role decides your pages. If you need the page for your work, ask Mr Andrew for access."],["**A person is in the app twice.**","Do not delete either record. Tell Mr Andrew. The app can join the two so no history is lost."],["**A Paybill payment shows no name.**","Open Payments with no name on the Giving page and choose who gave it."],["**My requisition cannot be approved.**","The latest bank statement must be uploaded in Financial statements first. Tell Finance."],["**I forgot my signing PIN.**","Set a new one in Settings, Signing PIN. You need your password to do it."],["**I marked the register wrong.**","Open the register again and press the right button. You can change it the same day."],["**A mark sheet is locked.**","The paper was already sent. Ask the principal to unlock it."],["**The camera will not open at the Hope gate.**","Allow the camera in the phone’s settings, or type the child’s code (HC-0012) in the box and press Check in."],["**The app looks old after an update.**","Close the app fully and open it again. On a computer, refresh the page."],["**I pressed something by mistake.**","Look for an Undo button. If there is none, tell Mr Andrew. Deleted records wait in the Bin and can be put back."]];
export const MANUAL_WORDS: [string, string][] = [["**Admission number**","The number ADIA gives each student, for example ADIA/2026/0002."],["**All saved**","The green badge at the top. Everything you did has reached the server."],["**Champion**","A young volunteer who helps at Freedom Hope Center on Saturdays."],["**Child code**","The number Hope Center gives each child, for example HC-0042."],["**Cohort**","A group of ADIA students who start together, for example Cohort 4."],["**CAT**","Continuous Assessment Test. ADIA has CAT 1, 2 and 3 before the final exam."],["**Department**","An ADIA course, for example ICT or Dressmaking & Tailoring."],["**First-timer**","A visitor at their first service."],["**Follow-up**","A call or message the church owes someone, shown in People to reach today."],["**Fund**","What a gift is for: Tithes, Offerings, Building and so on."],["**Headcount**","The number of adults, teens and children counted in a service."],["**Journey**","The steps a member takes: Salvation, Baptism, Growth Track, Freedom 252 and more."],["**Merge field**","A word in curly brackets, such as {first_name}, that the app replaces with the person’s details."],["**Organisation**","One of the three places: Freedom Church Nairobi, ADIA Training Centre or Freedom Hope Center."],["**Paybill**","The church M-Pesa Paybill, 222118."],["**Requisition**","A request for petty cash, with its items and total."],["**Role**","The kind of account you have. It decides which pages you see."],["**Signatory**","A person allowed to sign petty cash requisitions."],["**Signing PIN**","Your 4 to 6 digit number for signing requisitions."],["**Status**","Where a person is with the church: Visitor, Regular, Member or Inactive."],["**Unassigned**","A payment the app could not match to a person or fund yet."]];
export const MANUAL_CONTACTS: [string, string][] = [["**How to do something in the app**","Press **Just ask Andy** on any page"],["**Passwords, accounts and access**","Mr Andrew Guya or Doreen Mayaka"],["**Petty cash and giving**","Daniel Ojwang’, Accountant"],["**ADIA students, exams and graduation**","The Principal, Flavier Akinyi"],["**Freedom Hope Center**","Diana Kiunga · Hope Centre phone 0794 645 455"],["**A worry about a child’s safety**","The Director or Mr Andrew, in person, the same day"],["**Something in the app is broken or wrong**","Mr Andrew, with a photo of the screen"]];
export const MANUAL_WELCOME: string[] = ["Dear friend,","Thank you for serving. Every name in Freedom ChMS is a person God loves: a first-timer who needs a warm welcome, a student working towards a better future, a child at Hope Center who needs to be known and cared for. This app helps us see them, remember them and serve them well.","We built Freedom ChMS to be simple. Most jobs take three or four steps, and the app shows you only the pages your work needs. You do not need to be good with computers to use it.","This manual walks you through each job one page at a time, with a picture of the screen. Start with **Getting started**, then turn to **Find your role** to see the pages that are yours.","If you are ever stuck, press **Just ask Andy** in the app, or speak to me.","\"Whatever you do, work at it with all your heart, as working for the Lord.\" Colossians 3:23"];
export const MANUAL_HOW: [string, string][] = [["Title and first line","What the job is and why you do it"],["Who can do it","The roles that can see this page. If yours is not listed, the page is closed to you"],["Where to find it","Which menu and buttons take you there"],["Steps","What to press, in order"],["Picture","The screen, with numbered circles that match the steps"]];
