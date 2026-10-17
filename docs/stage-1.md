# Stage 1: Foundation

## What I built

- **Sign-in** with email and password. The pastor creates every account and gives a temporary password; staff choose their own at first sign-in. Passwords need 10+ characters with a capital, a lowercase letter and a number.
- **Pastor and Admin roles**, stored as data so a third role can be added later. Admins can't see pastoral notes, per-person giving, financial reports or settings unless the pastor ticks them on for that admin.
- **Organization switcher** at the top. The pastor also gets "All organizations" for the combined view. Adding a campus is a form (Settings → Organizations → Add), with one-tap starters for Freedom Church Nairobi, ADIA Training Centre and Freedom Hope Center.
- **Today** home screen with the four big buttons. Each says which stage brings it (Add visitor in 2, Check in in 3, Record gift in 5, Follow-ups in 6), and a "Getting started" checklist for the pastor.
- **Offline sync**: every change saves on the device first and syncs when the connection returns. A badge shows **All saved**, **Syncing…** or **Offline, will sync**.
- **Installable app** with icons in navy, gold and green, light and dark themes, and an "Add to Home Screen" prompt on iPhone and iPad.
- **Server access rules**: the database checks the role and organization on every request, not just the buttons in the app.
- **Audit log** (Settings → Audit log, pastor only) of every add, change, delete, restore, sign-in and password reset. It records which fields changed, never their values.
- **Bin**: deleting asks first, offers Undo, and keeps the record for 30 days before a nightly job removes it.
- **Shared-device sign-out** after 15 minutes without use (the setting is per device).

## What I tested here

- **43 automated tests pass.** 23 cover permissions, Nairobi dates and Monday-to-Sunday weeks, passwords and audit records. 20 check the server rules: an admin can't open another organization, read the audit log, list accounts, raise their own access or hard-delete anything.
- **Browser run on local Firebase, phone-sized screen:**
  1. The pastor signed in and added Freedom Church Nairobi.
  2. Airplane mode on: the pastor added ADIA. The app showed it with "Offline, will sync" while the server still had only one organization.
  3. Back online: ADIA reached the server and the badge said "All saved".
- **Installed-app run:**
  1. With no internet, I closed and reopened the app. It loaded with its data.
  2. Still offline, I added Freedom Hope Center, then closed and reopened the app again. The unsynced campus was still there.
  3. Back online, it synced.
- **Admin run:**
  1. The pastor created an admin for Freedom Church Nairobi only.
  2. The admin changed the temporary password, then saw only that organization and only "This device" in Settings.
  3. Going around the app straight to the database, the admin was refused the audit log, the account list and ADIA (HTTP 403).

## Your test checklist

You need a Firebase project for this (see "Deploy" below).

1. On your phone, open the app link, sign in as Pastor and tap **Install** (Android) or **Share → Add to Home Screen** (iPhone).
2. Settings → Organizations → Add → tap **Freedom Church Nairobi** → Save.
3. Turn on airplane mode. Open the app from the home screen. It should open and show the badge **Offline**.
4. Add **ADIA Training Centre**. It appears straight away and the badge says **Offline, will sync**.
5. Turn airplane mode off. Within a few seconds the badge says **All saved**. Open the app on a laptop: ADIA is there.
6. Settings → Audit log shows both additions under your email.
7. Settings → Staff accounts → Add a test admin for Freedom Church Nairobi only. Sign in as them on another device: they see only that campus and cannot open the audit log.

## Deploy

The full steps are in the README under "Deploy to Firebase". In short:

1. Create a Firebase project on the Blaze plan.
2. Turn on Email/Password sign-in.
3. Create Firestore in `africa-south1`.
4. Add a web app.
5. Run `npm run build && npx firebase deploy`.
6. Run the bootstrap script once to create your Pastor account.

## Assumptions I made

- Weeks run Monday to Sunday. A regular attender has come to 3 of the last 8 weeks (editable in settings later).
- Receipt prefixes are FCN, ADIA and FHC, with one sequence per organization. They are editable on each organization.
- Data and server functions sit in Google's Johannesburg region (`africa-south1`), the closest to Nairobi. Firebase has no Kenya region, so this is a cross-border transfer under the Data Protection Act; it is flagged in the README for the legal review.
- Two-step verification needs Firebase's Identity Platform upgrade, so it comes in Stage 8 (Hardening). So do backups, exports and training mode.
- There is no "forgot password" email. As the brief says, the pastor resets passwords.
- The first Pastor account is created by a one-time setup script, not a public sign-up page, so nobody else can claim it.
- The four Today buttons are visible now but disabled, each saying which stage brings it, rather than opening empty screens.
