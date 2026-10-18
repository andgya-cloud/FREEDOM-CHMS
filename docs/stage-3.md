# Stage 3: Services and attendance

## What I built

- **Attendance tab, and Check in on Today.** You can open today's service, class or session with one tap. Church campuses get one button per service time; Sunday 10:00 is the default. ADIA gets one button per programme and Freedom Hope Center one per activity. There's also a box for one-off gatherings such as "Youth night", and you can pick a past date if you're catching up. A list shows the last 8 weeks.
- **Headcount.** Services count adults, teens and children. Saturday meals count new and returning children. Other Hope Center sessions have a single total for days when names aren't taken. You can tap + as people walk in or type the number at the end. It saves by itself.
- **Check in by name.** Type part of a name or phone number and tap **Check in**. If you check someone in twice, they're still counted once. Every check-in has Undo. If nobody matches at a church campus, the same box lets you add the person as a visitor and check them in together. That also creates the visitor's welcome follow-up.
- **Door mode** (the gold button on a service) turns a tablet into a full-screen check-in point at the entrance:
  - People type at least three letters and tap their name.
  - The screen says "Welcome, Grace!" and resets itself for the next person.
  - A "Not you?" link takes back a wrong tap.
  - "First time here?" asks only for a name, a phone number and consent.
  - Because anyone walking past can see the screen, it shows only first names with an initial ("Grace W.") and the last three digits of a phone number.
  - Leaving door mode asks for confirmation.
- **ADIA class register.** Every student is on one screen, with one tap each for Present, Late, Absent or Excused. One button marks everyone not yet marked as present (or absent). A running tally sits at the top. Students are people with the status Student; you can search to add anyone else to a class.
- **Freedom Hope Center** records sessions by name or by headcount, and meals as new and returning.
- **Attendance on each person's record.** Church and Hope Center people show "Came in 3 of the last 8 weeks". ADIA students show "Attended 17 of 20 classes (85%)". Their latest dates are listed and link to each session.
- **Programme lists** are editable in Settings → Organizations for ADIA and Freedom Hope Center. Church services still come from the service times there.
- Everything works with no internet. Check-ins keep the time they really happened, even if they sync later. Deleted services and check-ins go to the bin for 30 days, like everything else.

## What I tested here

- **95 automated tests pass.** That's 43 unit tests (including 9 new ones for attendance counting, the 8-week rule and door privacy) and 48 server-rule tests (12 new). The new rule tests check that:
  - an admin can't record attendance for another organization;
  - a check-in must point at a real service and a real person, on the service's date;
  - counts can't be negative or fractions;
  - nothing can be hard-deleted.
- **Browser run on local Firebase, phone-sized screen, with the internet off:**
  1. I opened Sunday 10:00 service and entered a headcount (68).
  2. I checked in **20 people by name in 23 seconds**, typing at a normal pace.
  3. Searching for someone already in showed "✓ In".
  4. I added a new visitor, Brenda Auma, and checked her in from the same box.
  5. In door mode, two letters showed nobody. Typing "Naom" showed only "Naomi J. …420". Tapping it said "Welcome, Naomi!" and the screen reset on its own.
  6. I took one check-in off and put it back with Undo.
  7. With the internet back on, the server had 1 service with its headcount and 22 check-ins (21 by staff, 1 at the door). Brenda was saved as a visitor with her welcome follow-up.
  8. Grace's record showed "Came in 1 of the last 8 weeks".
  9. ADIA, offline: I marked one student late and one excused, then "Mark the other 2 present". It synced as present, present, late, excused.
  10. Freedom Hope Center: I recorded Saturday meals as 12 new and 88 returning, and it reached the server.
- **One bug found and fixed.** Anything deleted while offline, including an undone check-in and a deleted person from Stage 2, kept showing until the internet came back. It now disappears straight away.

## Your test checklist

1. Today → **Check in** → tap **Sunday 10:00 service**.
2. Turn on airplane mode.
3. Tap + on Adults a few times, and type numbers for Teens and Children.
4. Check in 20 people. Type a few letters of each name and tap **Check in**. (Add them first in People if they aren't there yet.)
5. Type a name that isn't in the system. Add them as a visitor from the same box.
6. Tap **Door mode**, type part of your own name, tap it, and see the welcome screen. Tap **Exit** to leave.
7. Turn airplane mode off. The badge changes to **All saved**, and the Checked in number stays the same.
8. Open one of those people from People. Their record shows **Attendance**.
9. Switch to ADIA Training Centre (add it in Settings first if you haven't). Open **ICT** and mark the register.

## Deploy

On your Mac, run `redeploy.sh` from Downloads (see the thread for the exact steps). It updates the app, the server rules and indexes, and the nightly clean-up job.

## Assumptions I made

- Teens are 13 to 19 and children are under 13. These labels are only hints on the headcount screen.
- The headcount and the names checked in are kept separately. The headcount is the official number for the service; names show who came.
- There is one record per service per day. Two tablets opening "Sunday 10:00 service" on the same day share it, even offline. If both change the headcount while offline, the last one to sync wins.
- Door mode needs three letters before it shows any names, and it never shows full surnames or phone numbers.
- "Came in X of the last 8 weeks" counts Monday-to-Sunday weeks with at least one check-in. It is the basis for "regular attender" (3 of 8) in the Stage 7 dashboard.
- ADIA attendance percentage is classes attended (present or late) out of classes marked for that student. The 75% alert comes with the ADIA module in Stage 9.
- Child codes such as HC-0042, and scanning a code at the door, come with the Freedom Hope Center module in Stage 10.
