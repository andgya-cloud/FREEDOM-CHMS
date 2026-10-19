# Stage 10: Freedom Hope Center

## What I built

A Hope section for the Freedom Hope Center organization (type Ministry): a children register, the four programmes, attendance, welfare, privacy controls, numbers and reports. It reuses people, attendance, follow-ups and WhatsApp. Petty cash and inventory are not rebuilt.

- **Children register**: name, date of birth, gender, guardian or caregiver (new or existing person), school and whether they are in school, joined date, programmes, status (active or left). Each child gets a code like HC-0042 from the server, never reused. Lists show code and name. No photo field exists anywhere.
- **Consent**: guardian consent and photo consent, each yes, no or not yet, with a date. A child always saves. "Consent missing" shows as a badge on the child, as a filter on the list, and as a count on the Hope home screen and on the pastor's Today screen.
- **Programmes**: Saturday meals (headcount of new and returning, or tap names), Football academy (team or age group; training and match sessions), Chess club (level reached), Music academy (instrument or class, progress level). A session whose name starts with the programme's name belongs to it.
- **Check-in**: tap a name, or type or scan the code (HC-0042, hc 42) and press Enter. Works offline like all attendance. A child not yet in a programme can be added from the register search.
- **Welfare**: three missed sessions in a row of a programme create a follow-up for the guardian (daily at 06:30, or the "Check for absent children now" button). The WhatsApp message goes to the guardian and never to the child. The follow-up closes itself when the child comes back. Meals are drop-in and never chased. Pastor-only on each child: welfare notes, dietary and health flags, home circumstances, home visit log, referrals log.
- **Safeguarding**: "Raise a safeguarding concern" on every child page, for any staff member. It creates a record that only the pastor can read (admins cannot open it afterwards, not even their own). The pastor sees it on the Today screen and the Hope home and closes it with a note.
- **Privacy**: the Hope home, the monthly report and the donor numbers are counts only. Admins see names, codes and attendance but not welfare records. Exporting child data (register or attendance, as a spreadsheet) needs the pastor's approval, can be downloaded once, and the request, approval and download are all in the activity log. Welfare and safeguarding records are never exported.
- **Numbers**: children registered and active (came in the last 8 weeks), average attendance per programme, meals served (per Saturday and total), consistency (share who came to at least 3 in 4 sessions in the last 12 weeks), retention (still active 6 months after joining), programme reach (one, or two or more), school enrolment as the guardian reports it, guardian contact rate (absence follow-ups that reached the guardian).
- **Reports**: a monthly report with counts and trends only (no names, no codes), made on the 1st for leadership and donors; a weekly attendance and follow-up report for the pastor (children by code and name). Both on schedule and on request, with PDF.
- **Erasing a child** (Settings → Data) removes the register entry, welfare notes, visits, referrals and concerns along with the person.

## Who can do what

| | Admin | Pastor |
|---|---|---|
| See the register, codes, attendance, counts, monthly report | yes | yes |
| Register a child, change details and consent, mark attendance | yes | yes |
| Raise a safeguarding concern | yes (cannot read it back) | yes |
| Welfare notes, health flags, home visits, referrals, concerns, weekly report | no | yes |
| Ask for an export | yes (needs approval) | yes (approves itself) |
| Approve exports | no | yes |

## Test it (about 15 minutes)

1. Settings → Organizations → Add → choose **Freedom Hope Center** from the suggestions (type Ministry). Choose it at the top (or from the buttons on Today) and open **Hope**.
2. **Register a child**: a name, date of birth, tick Football academy and Saturday meals, add a guardian with a phone number and tick WhatsApp. Leave consent as "Not on file yet" and save. The code appears within seconds, with the "Consent missing" badge. Today shows the count.
3. Hope → **Saturday meals**. Type 6 new and 24 returning without taking any names. Back on Hope, Meals this month shows 30.
4. Hope → **Football academy training**. Put the phone in flight mode, tap a child's name present, then type their code and press Enter. Switch flight mode off; the marks sync.
5. Use a child who has not been to three football sessions in a row (mark the others present on three earlier days, or wait for the real thing): tap **Check for absent children now**. A follow-up for the guardian appears under Follow-ups. Open it: WhatsApp goes to the guardian.
6. As an Admin account: open a child → **Raise a safeguarding concern** → send. Open the same child again: nothing shows. As the pastor: the Today screen shows the alert; the child page shows the concern; close it with a note.
7. Hope → **Reports** → Month → Make the report: no child is named. Make a Week report as the pastor: the follow-ups are listed by code and name.
8. As an Admin: Hope → Exports → ask for the register. As the pastor, approve. The Admin downloads once; the second download is not offered.

## What I tested here

Automated: Hope calculations (28 tests), 18 permission tests (admins cannot read welfare, home visits, referrals or concerns; an admin can raise a concern but not read it, change it or close it; exports need the pastor; no photo field can be saved; consent can be missing; the weekly report is pastor-only), all earlier tests still pass. In a phone-size browser on local Firebase: the whole path above, including the code arriving from the server, meals in headcount mode, offline check-in by tap and by code, a follow-up for a child absent four times, an Admin raising a concern and not seeing it afterwards, the pastor's alert, and a monthly report with no names.

## What I could not test

The real WhatsApp opening, the 06:30 and 07:15 schedules on the live project (checked after you deploy), scanning with a camera (not built, see below) and a physical barcode scanner (the code box takes typed input the same way).

## Decisions I made (tell me if you want any changed)

- **Codes** are HC-0001 upwards, counted across the organization. The code is shown as "code pending" until the first sync, so a child registered offline has no code for a few seconds after reconnecting.
- **Scanning**: a keyboard-style scanner works (it types the code and presses Enter). Camera and QR scanning and printable cards are not built; ask if you want them.
- **Three missed sessions** means the three latest sessions of that programme that had a register taken, counted from the child's joined date. Excused counts as missed, because the guardian still deserves a call. Sessions nobody marked are ignored.
- **Safeguarding notification** is inside the app (Today and the Hope home). Email or WhatsApp to the pastor needs the email extension and is not on yet.
- **Football training and match** are two session buttons; both belong to Football academy.
- **Donors and sponsors** are skipped for now (optional in the plan).
- **Guardian consent** wording is mine and is a simple yes, no or not yet with a date. Please have the consent form itself reviewed under the Kenya Data Protection Act before going live, along with the ODPC registration question already on the list.

## Still open from earlier stages

Two-step sign-in (needs the Identity Platform upgrade), backups go to Firebase Storage not Google Drive, report emails need the Trigger Email extension, the lawyer or data protection officer review, and the exam-body candidate list template.
