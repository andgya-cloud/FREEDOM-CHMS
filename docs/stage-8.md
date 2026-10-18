# Stage 8: Hardening

## What I built

- **Faster on a slow phone.** Each screen now loads only when it is opened, and the big libraries (Firebase, React) are kept apart so a phone keeps them cached when the app is updated. The first load went from one 1.19 MB file to a 77 KB start-up file plus the screens you open. The PDF tools (about 590 KB) load only when someone makes a PDF.
- **Help page.** Settings → Help has plain-language guides for the everyday jobs, with a search box. It shows only what the signed-in person can do.
- **Data and backups** (pastor only), Settings → Data and backups:
  - **Weekly backup**: every Sunday 23:00 the whole database is saved as one file in Firebase Storage; the last 12 are kept. The page shows when the last one ran, or says if it failed.
  - **Download everything**: one file with every organization's records. Logged in the audit log.
  - **One person's data**: download everything held about one person, or erase them. Erasing needs the person's full name typed to confirm, removes their records for good, and keeps gifts and receipts for the accounts without their name or phone.
  - **Keeping deleted records**: 7 to 365 days, 30 until changed.
- **Practice mode.** A separate "Practice Church (training)" with made-up people, services and check-ins. It is never counted in reports, backups, downloads or the combined view, and a banner says "Practice mode" whenever it is open. Reset it any time.
- **Proof an Admin can't reach pastoral information** (below).

## Not built: two-step sign-in

It needs your Firebase project upgraded to "Identity Platform" and an authenticator app on each phone. I left it out rather than half-build it. Say the word when you want it.

## Who can do what

| | Admin | Pastor |
|---|---|---|
| Help page | yes | yes |
| Data and backups, downloads, erase | no | yes (`data.export`) |
| Practice mode | only if given access to the practice organization | yes |

## What I tested here

- **Automated:** unit tests for retention limits, how many backups are kept, erasing's effect on money records, timestamps in the backup file, and the practice data (12 made-up people, four Sundays, check-ins that point at real services). Rules tests for who can make a data request.
- **The Admin test you asked for** (19 tests). An Admin was refused on every route to: pastoral notes, prayer requests, salvation and baptism records, salvation and baptism follow-ups and their messages, the private parts of a report, a person's giving, the audit log, the export tools, and the pastor's access settings. Each was tried as one record, as a list, as a filtered search, across all campuses at once, and as a write, change or delete. The pastor can still reach all of them.
- **On local Firebase:** an Admin's erase request was refused and nothing was erased; the pastor's export was logged; an erase removed the person's record, attendance, notes and prayer requests, left another person's note alone, made the gift anonymous and cleared a child's link to them; practice mode filled 12 people, 4 services and 36 check-ins and reset cleanly twice; resetting inside a real organization was refused; the audit log recorded every export, erase and reset; the weekly backup wrote a file with the real organization and none of the practice data.
- **In the browser (phone size):** Help search; setting up practice mode and seeing the banner; Download everything; one person's download; the Erase button staying off until the name was typed, then erasing; the person count dropping by one.

## What I could not test

The real Firebase Storage bucket (only the local copy), and the Sunday-night schedule itself on the live project. Both are checked after you deploy: see the checklist.
