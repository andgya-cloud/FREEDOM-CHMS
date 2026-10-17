# Stage 2: People and visitors

## What I built

- **Quick visitor form** (Today → Add visitor). Only name and phone are needed. Phones like `0722 111 222` or `+254 722 111 222` are stored the same way. A WhatsApp switch and a consent tick box sit under the phone; everything else (how they heard, who invited them, service, visit date, prayer need) is under "More details". After saving, "Add another visitor" clears the form for the next person at the welcome desk.
- **Duplicate check by phone.** As soon as a typed number matches someone, the form shows who it is with a link to their record. You can still save. The server also marks both records "Possible duplicate"; the pastor or admin can clear that with "Not a duplicate".
- **People list** (People tab) with search by name or any part of a phone number, and filters by status (visitor, regular, member, and so on). Search also sits on the Today screen.
- **Person profile**: phone links, WhatsApp consent with a "They asked us to stop WhatsApp messages" button, family, follow-ups, the journey timeline, and delete with Undo.
- **Full person form** for every field: date of birth, gender, address, household (link family members), guardian for children, and custom fields.
- **Pipeline timeline** for church campuses: Visitor, Salvation, Baptism, Growth Track, Dream Team, Freedom 252, Freedom Groups, Communication Master Class. Tap a stage to mark it in progress or completed with a date. Salvation also records who prayed with them and who will follow up.
- **Private pastoral information.** Salvation, Baptism, pastoral notes and prayer needs are visible only to the Pastor (or an admin you give "pastoral" access). Admins can add a prayer need but can't read them back.
- **Welcome follow-up**: when a visitor is added, the server creates a "Welcome message after first visit" follow-up due today. Stage 6 turns these into a WhatsApp queue.
- **Settings → Pipeline stages** to rename, reorder or add stages (Salvation and Baptism always stay private), and **Settings → Custom fields** for extra questions on the person form.
- **Service times** on each organization (Freedom Church Nairobi starts with Sunday 10:00), used by the visitor form.

## What I tested here

- **70 automated tests pass.** 34 unit tests (phone numbers, names, search, duplicate matching, dates, permissions) and 36 server-rule tests. The new rule tests check that an admin can't read Salvation or Baptism, pastoral notes or prayer requests, can't edit stamps to pretend someone else made a change, and can't see another organization's people.
- **Browser run on local Firebase, phone-sized screen:**
  1. Adding visitor John Kamau, typing at a normal pace, took **2.3 seconds** from tapping Add visitor to "John Kamau added".
  2. His profile showed the Visitor stage completed and the server's welcome follow-up.
  3. The pastor recorded Salvation, a pastoral note and a prayer need.
  4. Typing his number again in another format showed "This number is already in the system". Saving anyway made the server mark it "Possible duplicate".
  5. Searching "0722" and "kam" found both records.
  6. In airplane mode, Mary Achieng was added and found in search with "Offline, will sync". Back online, she reached the server with her follow-up.
  7. An admin opened John's profile and saw no Salvation, Baptism, pastoral notes or prayer needs. Going straight to the database, they were refused all three (HTTP 403).
- One bug found and fixed: right after opening the app, the visitor form could say "Choose the organization" because campuses were still loading.

## Your test checklist

1. Today → **Add visitor**. Type a name and phone, tick consent, Save. Time it: it should be well under 30 seconds.
2. Tap **Add another visitor** and enter the same phone number in a different format (for example +254…). The yellow "already in the system" box appears before you save.
3. Open the first visitor. You should see the welcome follow-up and the timeline with Visitor completed.
4. Tap **Salvation**, fill in who prayed with them, Save. Add a pastoral note.
5. Sign in as your test admin. Open the same person: Salvation, Baptism and pastoral notes are not shown.
6. Airplane mode on: add a visitor. Search finds them. Airplane mode off: the badge returns to **All saved**.
7. People tab: search by part of a phone number, then filter by Visitor.

## Deploy

Same as Stage 1: `npm run build && npx firebase deploy`. This deploys the new rules, indexes and the `onPersonWritten` server function. If you already ran the bootstrap script, run it again once; it only adds the new pipeline and custom-field settings and leaves everything else as it is.

## Assumptions I made

- Phone numbers default to Kenya (+254). Foreign numbers work when typed with their + code.
- A visitor's welcome follow-up is due by the end of the day they were added (23:59 Nairobi time).
- Salvation and Baptism are always private and can't be made public in settings.
- The combined "All organizations" view asks which organization a new person belongs to.
