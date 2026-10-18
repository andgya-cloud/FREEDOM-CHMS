# Stage 7: Dashboard and automatic reports

## What I built

- **Home scorecard.** Today now shows last week's numbers in eight tiles:
  1. Attendance (the weekly service average)
  2. First-time visitors
  3. Salvations
  4. Baptisms
  5. In a Freedom Group (the share of regular attenders in a group)
  6. Serving (the share of regular attenders on the Dream Team)
  7. Giving (only for staff with finance reports)
  8. Follow-ups overdue

  Each tile says how the number moved since last week and since the same week last year, with a green or red arrow. Tapping a tile opens that part of the report, with the people behind the number. Follow-ups overdue opens the Follow-ups queue.
- **Automatic reports.**
  - A weekly report is made every **Monday at 07:00** Nairobi time, covering Monday to Sunday of the week before.
  - A monthly report is made on the **1st at 07:00**, covering the month before.
  - Every campus gets its own. Each one is kept under **Reports**, which you open from Today ("All reports").
- **What each report holds:**
  - the scorecard against last week (or month) and a year ago;
  - **the three biggest changes** in plain words, for example "First-time visitors are up 200% on last week (3, was 1)";
  - **people needing follow-up**, and regulars away 4 weeks or more;
  - **programme progress** for each programme and class group: enrolled, completed, completion rate and, for Freedom 252, average topics covered;
  - the **journey**: Visitor → Salvation → Baptism → Growth Track → Dream Team or Group, with how many didn't go on at each step;
  - a 12-week attendance line (26 weeks on a monthly report);
  - small groups that missed 2 or more meetings, serving, and staying on the Dream Team after 90 days;
  - first-time visitors, how many came back within 4 weeks, and how many were contacted within 48 hours;
  - **giving**, in the pastor's copy only: total by fund, givers, first-time givers, lapsed givers (nothing in 90 days), average gift, giving per attendee, and against budget if one is entered.
- **Make a report.** Reports → Make a report builds one for any past week or month. **Remake with the latest records** brings an old report up to date, for example after late check-ins are added.
- **PDF and Excel.** Every report downloads as a PDF (on a phone it opens the share sheet, so you can send it on WhatsApp) or as a CSV file, which opens in Excel or Google Sheets.
- **Campuses compared.** Once there is more than one campus, Reports shows their latest weekly reports side by side, with bars for attendance.
- **Settings → Reports:**
  - who counts as a regular attender: 3 of the last 8 weeks unless you change it. The morning care messages use this too;
  - email on or off, and who gets it (the pastor unless you tick others);
  - a monthly giving budget for each campus (optional).

## How the numbers are worked out

These follow section 4 of your plan.

- **Attendance** counts Sunday and other services, not classes or group meetings. A service counts its headcount (adults, teens and children). A service with no headcount counts the people checked in.
- A **regular attender** came to a service in at least 3 of the last 8 weeks.
- **Net growth** is the number of regular attenders at the end of the period minus the number at the start.
- **Came back within 4 weeks** looks at visitors whose first visit was 4 to 8 weeks before the end of the period, so everyone counted has had their full 4 weeks.
- **Contacted within 48 hours** checks whether a visitor's welcome or check-in was marked done, or a message was sent, within 48 hours. Visitors still inside their 48 hours aren't counted yet.
- **Salvation to baptism** is the share of people saved in the last 12 months who have been baptised.
- **Small groups** are measured among regular attenders. Groups that missed 2 or more meetings in a row are listed.
- **Volunteer retention** is the share of people who joined the Dream Team over 90 days ago and served for at least 90 days.
- **Giving** counts confirmed gifts only. A **first-time giver** gave for the first time in the period. A **lapsed giver** gave in the 15 months before but nothing in the last 90 days.
- **Drop-off** lists regular attenders who haven't been to a service for 4 weeks or more (up to 6 months).
- **The three biggest changes** leave out small numbers that swing a lot, for example 1 salvation against 0. They also leave out giving, which stays in the pastor's copy.
- **A year ago** is the same week 52 weeks earlier, so Sundays line up, or the same month last year.

## Who sees what

The server rules enforce this, not only the screens:

- **The report itself** is for staff who can see people: counts, visitors, follow-ups, programmes and groups. It carries only the *number* of salvations and baptisms.
- **Who was saved or baptised**, and salvation and baptism follow-ups: the pastor and staff with pastoral access.
- **Giving**: staff with finance reports (the pastor by default).
- Each emailed copy has only what that person's access allows.
- Reports can't be changed from the app, only made again.

## Email (one setup step, when you're ready)

Reports are already made and kept in the app. To have them **emailed** as a PDF, Firebase needs an email sender. That is the free "Trigger Email from Firestore" extension, connected to an email account such as a Gmail address with an app password. I haven't set this up, because it connects an outside account. When you want it, I'll send click-by-click steps. The password is typed into Firebase itself and never into the app's code. After that, tick **Email each report as a PDF** in Settings → Reports.

A WhatsApp message to the pastor with a link (optional in your plan) needs the WhatsApp Cloud API, like automatic follow-up messages. It is left for that later stage.

## What I tested here

- **Automated tests pass:**
  - 32 new unit tests (118 in all). They check report periods, attendance with and without headcounts, regular attenders, return rate, 48-hour contact, salvation to baptism, programmes per class group, group participation and missed meetings, serving and retention, giving (by fund, first-time, lapsed, per attendee, budget), drop-off, net growth, the funnel, the three biggest changes, when reports are due, CSV safety and the PDF.
  - 8 new server-rule tests (113 in all). They check that names and giving are hidden from staff without access, reports can't be edited, other campuses stay out, only settings managers can have a report emailed, and nobody can read the email queue.
- **On local Firebase, with test data** (12 weeks of services, visitors, salvations, a group, the Dream Team and gifts, at two test campuses):
  1. Today with no reports offered **Make last week's report now**. A few seconds later the eight tiles appeared, for example "Attendance 250, up 2% on last week".
  2. **Made a report by hand** for the week of 12 October. It showed "Attendance 254, up 2% on last week, up 34% on last year", visitors Lucy, Moses and Nancy, the salvation and baptism names, and KES 7,500 in giving (up 67%).
  3. Tapping **First-time visitors** jumped to the visitor list. The PDF and the CSV downloaded and opened.
  4. Added a visitor and tapped **Remake**. The visitor count went from 3 to 4.
  5. Made a report for **September 2026**.
  6. **The schedule:** ran the 07:00 job as if it were Tuesday 20 October, and nothing was made. As Monday 19 October, it made last week's report for both campuses and queued one email each, with the PDF attached. A second run that morning did nothing (so no double emails). As 1 November, it made both October reports.
  7. **Campuses compared** showed Freedom Church Nairobi at 254 and Test Campus Two at 95.
  8. As Faith (admin): she saw seven tiles (no Giving), the salvation count but no names, no giving section, and no "Email it too" option.
