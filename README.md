# Freedom ChMS

People, attendance, giving and follow-up for **Freedom Church Nairobi**, **ADIA Training Centre** and **Freedom Hope Center**, in one installable app that works offline.

Built in stages. This README grows with each stage.

| Stage | What | Status |
|---|---|---|
| 1 | Foundation: sign-in, roles, organization switcher, installable app, offline sync, server access rules, audit log | Approved |
| 2 | People and visitors: quick visitor form, search, profiles, duplicate check, pipeline timeline, pastoral notes | Built, awaiting approval |
| 3 | Services and attendance: headcounts, check-in by name, door tablet mode, ADIA class register, Hope Center sessions and meals | Built, awaiting approval |
| 4 | Programs and groups | Not started |
| 5 | Giving and receipts | Not started |
| 6 | Follow-up and WhatsApp | Not started |
| 7 | Dashboard and automatic reports | Not started |
| 8 | Hardening: backups, exports, training mode, help, two-step sign-in | Not started |
| 9 | ADIA Training Centre module | Not started |
| 10 | Freedom Hope Center module | Not started |

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

Settings → Organizations → **Add**. Fill in the name, type and receipt prefix and save. No code change is needed. Only accounts that can see every organization (the pastor) can add one, so nobody creates a campus they can't open.

## Add staff

Settings → Staff accounts → **Add**. Choose the role and organizations, and give the person the temporary password shown. They choose their own password at first sign-in. To reset a password or switch an account off, open the account.

## Taking attendance

Today → **Check in** (or the Attendance tab) and tap the service, class or session. Church services come from the organization's service times, and ADIA and Freedom Hope Center programmes come from its programme list (Settings → Organizations). For the entrance, open the service and tap **Door mode**: the tablet then shows only first names with an initial. Hand it back to staff to leave door mode. Full details are in [docs/stage-3.md](docs/stage-3.md).

## Using it offline

- The first sign-in on a device needs internet. After that the app opens and works with no connection.
- The badge at the top shows **All saved**, **Syncing…**, or **Offline, will sync**.
- **iPhone and iPad**: add the app to the Home Screen (Share → Add to Home Screen) and open it online regularly. Safari can clear offline data for sites that are not on the Home Screen.
- Staff accounts, password resets and the audit log need internet.

## Backups

Automatic weekly export to Google Drive and a "download everything" button arrive in Stage 8. Until then, use Firestore's managed export (`gcloud firestore export`) if you put real data in.

## Before going live

Have a lawyer or data protection officer review the setup, and check whether the church must register with the Office of the Data Protection Commissioner. The data will be stored in the Firestore location chosen above, outside Kenya; that counts as a cross-border transfer under the Data Protection Act 2019.
