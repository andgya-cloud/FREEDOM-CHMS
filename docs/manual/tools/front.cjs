// The front pages: document control, welcome, how to use the manual, and Find your role.
exports.tocAfter = 2; // contents comes after document control and the welcome

exports.pages = ({ md, esc, VERSION, DATE, APPV }) => [
  {
    id: 'control', title: 'About this manual', html: `<section class="page front" id="control">
    <h1>About this manual</h1>
    <table class="t"><tr><th style="width:45mm">Item</th><th>Detail</th></tr>
      <tr><td>Title</td><td>Freedom ChMS User Manual</td></tr>
      <tr><td>Version</td><td>${esc(VERSION)}</td></tr>
      <tr><td>Date</td><td>${DATE}</td></tr>
      <tr><td>Matches the app</td><td>${APPV}, at freedom-chms.web.app</td></tr>
      <tr><td>For</td><td>Staff, leaders and volunteers of Freedom Church Nairobi, ADIA Training Centre and Freedom Hope Center</td></tr>
      <tr><td>Owner</td><td>Pastor Andrew Guya, Campus Pastor</td></tr>
      <tr><td>Status</td><td>Draft for review</td></tr>
    </table>
    <h2>Change history</h2>
    <table class="t"><tr><th style="width:25mm">Version</th><th style="width:35mm">Date</th><th>What changed</th></tr>
      <tr><td>1.0</td><td>${DATE}</td><td>First edition.</td></tr>
    </table>
    <h2>About the pictures</h2>
    <p>Every picture in this manual comes from a test copy of the app filled with made up people, phone numbers and amounts. None of them are real members, students, children or gifts.</p>
    <p>The app keeps improving, so a button may look a little different from the picture. If a step no longer matches the app, press <b>Just ask Andy</b> or tell Mr Andrew, and the next edition will be corrected.</p>
    <h2>Keep it private</h2>
    <p>This manual is for people who work with Freedom ChMS. Please do not post it on social media or share it outside the church, ADIA and Hope Center.</p>
    </section>`,
  },
  {
    id: 'welcome', title: 'Welcome', html: `<section class="page front" id="welcome">
    <h1>Welcome</h1>
    <p>Dear friend,</p>
    <p>Thank you for serving. Every name in Freedom ChMS is a person God loves: a first-timer who needs a warm welcome, a student working towards a better future, a child at Hope Center who needs to be known and cared for. This app helps us see them, remember them and serve them well.</p>
    <p>We built Freedom ChMS to be simple. Most jobs take three or four steps, and the app shows you only the pages your work needs. You do not need to be good with computers to use it.</p>
    <p>This manual walks you through each job one page at a time, with a picture of the screen. Start with <b>Getting started</b>, then turn to <b>Find your role</b> to see the pages that are yours.</p>
    <p>If you are ever stuck, press <b>Just ask Andy</b> in the app, or speak to me.</p>
    <p>"Whatever you do, work at it with all your heart, as working for the Lord." Colossians 3:23</p>
    <div class="sig"><div class="name">Andrew Guya</div><div>Pastor Andrew Guya<br>Campus Pastor, Freedom Church Nairobi</div></div>
    </section>`,
  },
  {
    id: 'how', title: 'How to use this manual', toc: true, html: `<section class="page front" id="how">
    <h1>How to use this manual</h1>
    <h2>Find your role first</h2>
    <p>You do not need to read the whole book. Read <b>Getting started</b>, then go to <b>Find your role</b>. It lists the pages for your job.</p>
    <h2>Every task page looks the same</h2>
    <table class="t"><tr><th style="width:45mm">Part of the page</th><th>What it tells you</th></tr>
      <tr><td>Title and first line</td><td>What the job is and why you do it</td></tr>
      <tr><td>Who can do it</td><td>The roles that can see this page. If yours is not listed, the page is closed to you</td></tr>
      <tr><td>Where to find it</td><td>Which menu and buttons take you there</td></tr>
      <tr><td>Steps</td><td>What to press, in order</td></tr>
      <tr><td>Picture</td><td>The screen, with numbered circles that match the steps</td></tr>
    </table>
    <h2>Signs used in this manual</h2>
    <div class="conv">
      <div><b>Bold words</b></div><div>A button, menu or box on the screen. Press or type in it.</div>
      <div><span class="dot">2</span></div><div>A numbered circle. The red circle in the picture matches the step with the same number.</div>
      <div><div class="box before" style="margin:0"><span class="h">Before you begin</span></div></div><div>Something to have ready before you start.</div>
      <div><div class="box see" style="margin:0"><span class="h">What you will see</span></div></div><div>How you know the job worked.</div>
      <div><div class="box tip" style="margin:0"><span class="h">Tip</span></div></div><div>A quicker or better way to do it.</div>
      <div><div class="box warn" style="margin:0"><span class="h">Warning</span></div></div><div>Take care. A mistake here can affect a person, money or private records.</div>
    </div>
    <h2>Phone or computer</h2>
    <p>Freedom ChMS works the same on both. On a computer the menu is on the left. On a phone the menu is the bar at the bottom of the screen. Most pictures show a phone, because that is how most people use the app.</p>
    <h2>The app’s name on screen</h2>
    <p>The sign-in page and the top of the menu show <b>Insight-IQ</b>, the system Freedom ChMS is built on. It is the same app.</p>
    </section>`,
  },
  {
    id: 'roles', title: 'Find your role', toc: true, html: `<section class="page front roles" id="roles">
    <h1>Find your role</h1>
    <p>Your role decides which pages you see. Mr Andrew or Doreen gives each person a role when they make their account. Find your role below, then read the pages listed.</p>
    <table class="t"><tr><th>Role</th><th>What you do</th><th>Read these pages</th></tr>
      <tr><td>Pastor</td><td>Everything, in every place</td><td>All of this manual, and the Administrator guide</td></tr>
      <tr><td>Admin</td><td>People, Sunday services, follow-ups and gifts at the Church</td><td>Getting started, Part 1</td></tr>
      <tr><td>Organization head</td><td>Leads one place and can add staff accounts there. Does not see money</td><td>Getting started, the part for your place</td></tr>
      <tr><td>Staff</td><td>People, attendance and follow-ups in one place. Does not see money</td><td>Getting started, the part for your place</td></tr>
      <tr><td>Usher</td><td>Sunday check-in, headcount and visitors</td><td>Getting started; in Part 1: Find a person, Add a visitor, Families, Sunday check-in, Headcount</td></tr>
      <tr><td>Finance</td><td>Giving, receipts, statements and petty cash</td><td>Getting started; in Part 1: the Giving pages and Reports; Part 4: Petty cash</td></tr>
      <tr><td>Petty cash signatory</td><td>Signs requisitions</td><td>Getting started; Part 4: Petty cash</td></tr>
      <tr><td>Principal</td><td>Students, register, exams and graduation at ADIA</td><td>Getting started; Part 2: ADIA</td></tr>
      <tr><td>Trainer</td><td>Enters exam marks and uses Tutor Files at ADIA</td><td>Getting started; Part 2: Exam marks, Tutor Files</td></tr>
      <tr><td>Lab technician</td><td>Counts inventory at ADIA</td><td>Getting started; Part 2: Inventory</td></tr>
      <tr><td>Hope helper</td><td>Takes the children’s register at Hope Center</td><td>Getting started; Part 3: the register and gate sign-in</td></tr>
      <tr><td>Reviewer</td><td>Looks at the app and writes suggestions. Cannot change anything</td><td>Getting started (Find your way around, Just ask Andy)</td></tr>
    </table>
    <div class="box tip"><span class="h">Tip</span>Each role also has a one-page quick card at the back of the manual. Print it or keep it on your phone.</div>
    </section>`,
  },
];

exports.adminIntro = ({ DATE, APPV }) => `<section class="page front" id="aintro">
  <h1>About this guide</h1>
  <p>This guide is for the people who manage Freedom ChMS for everyone else: Mr Andrew Guya and Doreen Mayaka. It covers staff accounts, passwords, reviewers and the settings that change how the app works for every user.</p>
  <p>It goes with the <b>Freedom ChMS User Manual</b>, which explains the everyday jobs. Version 1.0, ${DATE}, matches the app at ${APPV}.</p>
  <div class="box warn"><span class="h">Warning</span>Keep this guide private. Changes made from these pages affect every user, and some cannot be undone.</div>
  <h2>Golden rules</h2>
  <ul><li>One person, one account. Never share an account or a password.</li><li>Give the smallest role that lets a person do their job.</li><li>Switch off accounts the same day someone leaves.</li><li>Give passwords in person or by phone, never in a group chat.</li></ul>
</section>`;
