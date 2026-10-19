# Freedom ChMS

People, attendance, giving and follow-up for **Freedom Church Nairobi**, **ADIA Training Centre** and **Freedom Hope Center**, in one installable app that works offline.

Built in stages. This README grows with each stage.

| Stage | What | Status |
|---|---|---|
| 1 | Foundation: sign-in, roles, organization switcher, installable app, offline sync, server access rules, audit log | Approved |
| 2 | People and visitors: quick visitor form, search, profiles, duplicate check, pipeline timeline, pastoral notes | Built, awaiting approval |
| 3 | Services and attendance: headcounts, check-in by name, door tablet mode, ADIA class register, Hope Center sessions and meals | Built, awaiting approval |
| 4 | Programmes and groups: programme engine (Growth Track, Freedom 252, Communication Master Class), cohorts, class topics and mentors, automatic completion, Dream Team, Freedom Groups with missed-meeting flags | Built, awaiting approval |
| 5 | Giving and receipts | Not started |
| 6 | Follow-up and WhatsApp | Not started |
| 7 | Dashboard and automatic reports | Not started |
| 8 | Hardening: backups, exports, training mode, help, two-step sign-in | Not started |
| 9 | ADIA Training Centre module | Not started |
| 10 | Freedom Hope Center module | Built, awaiting approval |

## How it fits together

- **App**: React + TypeScript, built with Vite, installable as a PWA on phones, tablets and laptops.
- **Offline**: Firestore's on-device cache. Every change is saved on the device first and synced when the connection returns. The service worker caches the app itself so it opens with no internet.
- **Server**: Firebase Authentication (email and password), Firestore, Cloud Functions, Hosting.
- **Access control**: `firestore.rules` checks every read and write on the server. A user's role and permissions live on `users/{uid}`, which only Cloud Functions can write.
- **Audit log**: Cloud Functions record every create, edit, delete, restore and sign-in in `auditLog`. Only field names are logged, never values, so sensitive data stays out of the log.
- **Deleting**: nothing is hard-deleted from the app. Deleted records go to a bin for 30 days, then a nightly job removes them.

```
src/                      the web app
functions/src/            Cloud Functions
functions/src/shared/     rules shared by app and server (permissions, dates, passwords)
firestore.rules           server access rules
tests/rules/              access-rule tests (run against the Firestore emulator)
scripts/bootstrap.mjs     one-time setup of roles and the first Pastor account
```

### Roles

Roles are data (`roles/{id}`), so a third role can be added without code.

- **Pastor** (owner): everything, every organization, including user accounts and the audit log.
- **Admin**: people, attendance, programs, gifts, receipts and follow-ups in the organizations the pastor assigns. The pastor can also allow, per admin: pastoral notes and salvation records, per-person giving, financial reports, and settings.

## Run it on your computer

You need Node.js 22 and Java 21 (for the Firebase emulators).

```bash
npm install
npm --prefix functions install
cp .env.example .env.local          # leave VITE_USE_EMULATORS=true
npm --prefix functions run build
npm run emulators                   # terminal 1: local Firebase (auth, database, functions)
npm run dev                         # terminal 2: the app at http://localhost:5173
```

Create the first Pastor account on the emulators (terminal 3):

```bash
FIREBASE_AUTH_EMULATOR_HOST=127.0.0.1:9099 FIRESTORE_EMULATOR_HOST=127.0.0.1:8080 \
  npm run bootstrap -- --project demo-freedom-chms --email you@example.org --name "Your Name"
```

A gold "Local test server" ribbon shows whenever the app is talking to the emulators.

## Tests

```bash
npm test             # permissions, dates, passwords, audit classification
npm run test:rules   # server access rules, against the Firestore emulator
npm run typecheck
```

## Deploy to Firebase

Do these once:

1. Create a Firebase project and upgrade it to the **Blaze** (pay-as-you-go) plan. Scheduled jobs and Cloud Functions need it; at this size the cost should be low, but check current pricing and set a budget alert.
2. **Authentication** → Sign-in method → enable **Email/Password**.
3. **Firestore** → create the database. Choose a location close to Nairobi (the default here is `africa-south1`, Johannesburg). The location cannot be changed later.
4. **Project settings** → Your apps → add a **Web app**. Copy its config values into `.env.local` and set `VITE_USE_EMULATORS=false`.
5. Copy `functions/.env.example` to `functions/.env` and set `FUNCTIONS_REGION` to the same location as Firestore.
6. `npx firebase login`, then `npx firebase use --add` and pick the project.

Then each time you release:

```bash
npm run build
npx firebase deploy
```

Create the first Pastor account on the live project with a service-account key (Project settings → Service accounts → Generate new private key). Keep the key file out of git and delete it afterwards:

```bash
GOOGLE_APPLICATION_CREDENTIALS=./service-account.json \
  npm run bootstrap -- --project <project-id> --email <pastor email> --name "<name>"
```

## Add a campus

Settings → Organizations → **Add**. Fill in the name, type and receipt prefix and save. A type of College gets the School screens. No code change is needed. Only accounts that can see every organization (the pastor) can add one, so nobody creates a campus they can't open.

## Add staff

Settings → Staff accounts → **Add**. Choose the role and organizations, and give the person the temporary password shown. They choose their own password at first sign-in. To reset a password or switch an account off, open the account.

## Taking attendance

Today → **Check in** (or the Attendance tab) and tap the service, class or session. Church services come from the organization's service times, and ADIA and Freedom Hope Center programmes come from its programme list (Settings → Organizations). For the entrance, open the service and tap **Door mode**: the tablet then shows only first names with an initial. Hand it back to staff to leave door mode. Full details are in [docs/stage-3.md](docs/stage-3.md).

## Programmes and groups

The **Programmes** tab (church campuses) has three parts:

- **Discipleship programmes.** The first time, the pastor taps **Add Growth Track, Freedom 252 and Communication Master Class**. Each programme has a list of topics and a rule for finishing (every topic, or at least a set number), both editable under **Edit** with no code. A new programme is just a name and its topics. To run a class, open the programme, choose the cohort (or **Make-up class**), the topic and the mentor, and tap **Start class**; then mark the register. Progress counts every class a person attended in that programme, whatever the cohort. When the rule is met the person is marked completed (or graduated) automatically, and their journey moves on.
- **Dream Team.** Departments with who serves, their role and start date.
- **Freedom Groups.** Leader, meeting day, place and members. Record each week's meeting from the group page. A group with two or more meeting days in a row with nothing recorded is flagged.

Full details are in [docs/stage-4.md](docs/stage-4.md).

## Giving and receipts

Open **Giving** from Today (or **Record gift** for one gift). First, the pastor adds the funds: Settings → Funds → **Add Tithes and Offerings**, then any others, such as Building, with other spellings people type.

- **One gift** (cash, bank, cheque, or an M-Pesa payment from the SMS): amount, date, fund, who gave, and the M-Pesa code for M-Pesa. Save, then **Share receipt** (WhatsApp) or **Print**.
- **The Paybill 222118 statement**: download it from the M-Pesa portal as Excel (.xlsx) or CSV and import it. Payments already in the app (same M-Pesa code) are skipped, the fund comes from the text after # in the account (FCC#Tithes), and the person is suggested from the phone number and name for staff to confirm. The rest go to **Unassigned**. The import ends by checking that the statement total equals what is already in the app plus what was imported.
- **Receipts** are numbered by the server per organization and year, for example FCN-2026-000123, in order, never reused. A gift saved offline shows a provisional number until it syncs. Amounts, dates and codes can't be edited: a mistake is voided with a reason (the record and its number stay, marked void) and entered again.
- **Monthly summary** (finance staff): totals by fund and method, and the check against the statement, listing any payment on one side but not the other.
- **Giving statements** (the pastor): from a person's record for any dates, or for everyone at once from Giving → Giving statements (last year's, in January).
- Per-person giving is visible only to the pastor and staff given "Giving history per person". Other staff see only the gifts they recorded and the Unassigned list.

Full details are in [docs/stage-5.md](docs/stage-5.md).

## Follow-ups and WhatsApp

Open **Follow-ups** from Today. The app adds follow-ups by itself:

- a same-day welcome and a 48-hour check-in for each new visitor;
- a salvation follow-up and a baptism class invitation when a salvation is recorded;
- every morning, a care message for regular attenders who haven't been to a service for 3 weeks.

Staff can add their own from a person's record. Give each one to a staff member. One still open 3 days after it was due is escalated to the pastor.

- **WhatsApp** opens the message filled in from its template, then WhatsApp with it ready to send. Back in the app, mark it done with what happened.
- The pastor edits the seven templates in Settings → WhatsApp messages. Merge fields such as {first_name}, {campus} and {service_time} are filled in for each person.
- WhatsApp only opens for people who agreed to it and haven't asked us to stop. A child's message goes to their parent or guardian.
- Every message sent is logged: template, sender and time. The words are not stored.
- **Programme reminders** (from Follow-ups) and the **WhatsApp thank-you** on a gift use the same templates.
- Salvation and baptism follow-ups are for the pastor and staff with pastoral access only.

Full details are in [docs/stage-6.md](docs/stage-6.md).

## ADIA Training Centre

Pick the ADIA college at the top, then open **School** (it replaces the Programmes tab for a college).

- **Set up** (overview page, pastor): adds the four programmes from the brief (Food and Beverage Production, Dressmaking & Tailoring, ICT, Beauty Therapy & Cosmetology), the grading settings and a *School fees* fund. Levels, units, trainers, timetables and intakes (with places) are entered by the school under **Courses**.
- **Students**: enrol (existing person or new), with programme, intake, level, status and up to four sponsors or guardians. The admission number (for example `ADIA/2026/0042`) is made by the server. ID or passport numbers are pastor-only.
- **Attendance**: Attendance → tap the programme name. The register lists that programme's enrolled students (works offline). Attendance % per student, and an alert list below the threshold (75% until changed in School settings).
- **Results**: add assessments (continuous, practical, exam) per unit, enter marks, grades follow the editable scale. Report card and transcript PDFs on the student page. The exam candidate list is a spreadsheet until the exam body's template is supplied.
- **Fees**: fee structure per programme and intake, bill the intake (safe to repeat), record a payment from the student page (it is a gift in the *School fees* fund with the next ADIA receipt number), arrears list, fee statement PDF, WhatsApp reminder to a sponsor who agreed to WhatsApp (otherwise a Call button).
- **Graduation**: issue a certificate (serial `ADIA-CERT-2026-0007`), certificate register, and follow-ups at 3, 6 and 12 months.
- **Reports** (pastor and finance staff): weekly attendance and alerts report and monthly enrolment, results and fee report, made on schedule (Monday and the 1st, 07:00) and on request, with PDF.

## Freedom Hope Center

Pick the Freedom Hope Center (type Ministry) at the top, then open **Hope**. Protecting children comes before every other feature.

- **Children register**: name, date of birth, gender, guardian or caregiver, school and whether they are in school, joined date, programmes (with a team, instrument or level where it applies), status (active or left). The code (`HC-0042`) is made by the server and never reused. Lists show the code and name. **No photo is stored anywhere.**
- **Consent**: guardian consent and photo consent are each yes, no or not yet, with a date. A child saves without them; they show a "Consent missing" badge and are counted on the home screens.
- **Programmes**: Saturday meals (headcount of new and returning children when names are not taken, or tap names), Football academy (training and match sessions, team or age group), Chess club (level reached), Music academy (instrument or class, progress level). An event name that starts with a programme's name belongs to it ("Football academy match").
- **Check-in**: Attendance or Hope → tap the session, then tap a name, or type or scan the code and press Enter (a keyboard-style barcode scanner works). Works offline.
- **Welfare**: three missed sessions in a row of a programme create a follow-up to the guardian (a daily check at 06:30, and a "Check now" button); WhatsApp always goes to the guardian, never to the child; the follow-up closes itself when the child comes back. Welfare notes, health flags, home circumstances, home visits and referrals are pastor-only. **Raise a safeguarding concern** is on every child page: it can be raised by any staff member, only the pastor can read it afterwards.
- **Privacy**: dashboards and the monthly report are counts only. Admins see names and attendance but not welfare records. An export of child data needs the pastor's approval, can be downloaded once, and is written to the activity log (Hope → Exports).
- **Numbers**: children registered and active (came in the last 8 weeks), weekly attendance per programme, meals served, attendance consistency (3 in 4 sessions), retention at 6 months, programme reach, school enrolment as reported by guardians, guardian contact rate. Reports: a monthly counts-only report for leadership and donors and a weekly attendance and follow-up report for the pastor, with PDF.

Details and the test list are in [docs/stage-10.md](docs/stage-10.md). Donors and sponsors are not built yet.

## Dashboard and reports

Today shows last week's **scorecard**: attendance, first-time visitors, salvations, baptisms, small group and serving rates, giving (for staff with finance reports) and overdue follow-ups. Each number shows how it moved since last week and a year ago, and opens the records behind it.

- A **weekly report** is made every Monday at 07:00 (Nairobi time) for Monday to Sunday, and a **monthly report** on the 1st at 07:00. Both are kept under **Reports**.
- Each report has the scorecard, the three biggest changes in plain words, people needing follow-up, regulars away 4 weeks or more, programme progress, the journey funnel and a 12-week attendance chart. The giving summary is in the pastor's copy only.
- **Make a report** builds one for any past week or month, and **Remake** brings one up to date. Every report downloads as a PDF or as a CSV that opens in Excel.
- Salvation and baptism names are shown only to staff with pastoral access; giving only to staff with finance reports. The server rules enforce this.
- With more than one campus, **Campuses compared** puts their latest weekly reports side by side.
- Settings → Reports sets who counts as a regular attender, who gets reports by email, and an optional monthly giving budget.
- Email uses the Firebase "Trigger Email" extension, which reads the `mail` collection. Until it is installed and email is ticked in Settings → Reports, reports are kept in the app only.

The numbers are worked out in `functions/src/shared/metrics.ts` (tested in `metrics.test.ts`). Full details are in [docs/stage-7.md](docs/stage-7.md).

## Using it offline

- The first sign-in on a device needs internet. After that the app opens and works with no connection.
- The badge at the top shows **All saved**, **Syncing…**, or **Offline, will sync**.
- **iPhone and iPad**: add the app to the Home Screen (Share → Add to Home Screen) and open it online regularly. Safari can clear offline data for sites that are not on the Home Screen.
- Staff accounts, password resets and the audit log need internet.

## Backups, exports and erasing

**Weekly backup.** Every Sunday at 23:00 Nairobi time the `weeklyBackup` function saves every record (people, attendance, giving, notes, follow-ups, settings, staff accounts, the audit log) as one compressed JSON file, `backups/freedom-chms-YYYY-MM-DD.json.gz`, in the project's Firebase Storage bucket. The last 12 are kept. The result shows in **Settings → Data and backups**. The practice organization is left out. Nobody can reach the bucket from the app (`storage.rules` denies everything); only the pastor, through the Firebase console, can download a file.

*One-time setup:* Firebase console → Build → Storage → Get started (choose the same location as the database). Then run `npx firebase deploy --only storage` so `storage.rules` replaces the starting rules. `scripts/redeploy.sh` does this for you and carries on if Storage is not switched on yet.

**To restore:** download the latest file from Storage, unzip it, and ask your developer to load the records back (or the pastor can use Firestore's own backups as well; see below). A restore is never automatic.

**Also switch on Firestore's own daily backups (recommended).** Firebase console → Firestore → Disaster recovery → Backups → schedule a daily backup (7 days) and weekly (14 weeks).

**Download everything.** Settings → Data and backups → Download everything. One JSON file with every organization's records (pastor only; each download is logged in the audit log, and the file is made only after the server has logged it).

**One person's data.** The same page can download everything held about one person, or erase them. Erasing removes their record, attendance, notes, prayer requests, follow-ups, messages, journey, programme, team and group records for good. Gifts and receipts stay in the accounts, but lose the person's name, phone and link. Others' links to them (a child's guardian, who invited whom) are cleared. A backup may still hold them until it ages out after 12 weeks.

**Keeping deleted records.** Deleted records are kept 30 days, then removed every night at 02:30. The pastor can change this between 7 and 365 days on the same page.

**Training (practice) mode.** *Set up practice mode* creates an organization called "Practice Church (training)" with made-up people, four Sunday services and check-ins. *Reset the practice data* wipes it and fills it again. It is skipped by reports, backups, downloads and the combined "All organizations" view, so it never mixes with real records. Give a staff member access to it in Staff accounts to let them practise.

## Help

The built-in **Help** page (Settings → Help) explains the everyday jobs in plain words. Edit the topics in `src/pages/HelpPage.tsx`.

## Two-step sign-in

Not built in yet. Firebase's two-step sign-in needs the project upgraded to Identity Platform (which adds a monthly cost after 50,000 users, none for a church) and an authenticator app or SMS. Ask for it when you want it.

## Before going live

Have a lawyer or data protection officer review the setup, and check whether the church must register with the Office of the Data Protection Commissioner. The data will be stored in the Firestore location chosen above, outside Kenya; that counts as a cross-border transfer under the Data Protection Act 2019.
