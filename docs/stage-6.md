# Stage 6: Follow-ups and WhatsApp

## What I built

- **Follow-ups queue.** Open it from the **Follow-ups** button on Today, which shows how many people are due today (and, for the pastor, how many are escalated). The queue lists each person, why they need contacting, since when, and when it is due. Tabs: **Due now**, **Mine**, **Not assigned**, **With the pastor** and **All open**.
- **Follow-ups the app creates by itself:**
  - A new visitor gets a **same-day welcome** and a **48-hour check-in** (due two days later).
  - Recording someone's **salvation** creates a **salvation follow-up** (due the next day) and a **baptism class invitation** (due a week later). Recording their baptism closes the invitation.
  - Every morning at 06:00 the app looks for **regular attenders absent 3 weeks**: people who came to a service in at least 3 of the 8 weeks before their last visit, and haven't been for 21 days. Each gets a **care message** follow-up, due that day. If they come back before anyone gets to it, it closes itself. People away longer than 8 weeks are left out, so switching this on doesn't flood the queue with old absences. Classes and group meetings don't count here, only services.
  - Staff can add their own follow-up from a person's record ("call about the hospital visit"), with a date and who should do it.
- **Assigning.** Each follow-up has a "who" box. Choose a staff member, or "Not assigned".
- **Escalation.** A follow-up still open 3 days after it was due turns red, says "escalated to the pastor", goes to the top of the queue and shows under **With the pastor**. Today shows the pastor how many are waiting.
- **Tap to send on WhatsApp.**
  - **WhatsApp** on a follow-up opens a screen with the message already filled in from its template: the person's first name, the campus, the service time and your first name.
  - You can change the words there. **Open WhatsApp** opens WhatsApp on the phone with the message ready, and you tap Send.
  - Back in the app, tap **Done: message sent** or **Done: we spoke**.
  - **Done** on its own asks what happened: Reached, Message sent no reply yet, No answer, Wrong number, Asked us to stop, or Other, with an optional note.
  - **Call** rings their number.
- **Seven templates**, editable by the pastor in Settings → **WhatsApp messages**:
  1. First-time visitor welcome
  2. 48-hour check-in
  3. Care message after 3 weeks absent
  4. Salvation follow-up
  5. Baptism class invitation
  6. Programme reminder
  7. Giving receipt

  The merge fields are listed on that page: {first_name}, {campus}, {service_time}, {staff_name}, {child_name}, {programme}, {class_time}, {receipt_number}, {amount}, {fund} and {date}. A misspelt field, such as {frist_name}, is flagged before saving. **Back to the original words** undoes your changes to a template.
- **Programme reminders.** Follow-ups → **Programme reminders**. Pick a programme (Growth Track, Freedom 252 and so on) to see everyone taking it now, each with a WhatsApp button for the reminder: "a reminder that Freedom 252 meets Tuesdays at 8pm". The time comes from the class group's schedule, or else the programme's.
- **Giving receipt message.** On a gift linked to a person there is now a **WhatsApp thank-you** button. It sends the amount, fund, date and receipt number. **Share receipt** still sends the PDF.
- **On a person's record**, the Follow-up section shows:
  - their open follow-ups, with the same buttons as the queue;
  - **Message on WhatsApp**, to send any template;
  - **Add a follow-up**;
  - a **History** of messages sent (which template, who sent it, when) and of follow-ups done.

## The rules you asked for

- **Consent.** WhatsApp only opens for people recorded as agreeing to WhatsApp messages. For anyone else the app says why and offers **Call** instead.
- **Stop requests.** Marking a follow-up done with **Asked us to stop** records it on their record (with the date). The app won't open WhatsApp for them again. The existing "Asked us to stop" button on a person's record does the same.
- **Children.** A child is never messaged directly. The message goes to their parent or guardian, whose agreement is checked. The screen says so, and {child_name} is filled in.
- **Every message is logged.** The log records who it was about, who it went to, the template, who sent it and when. The words themselves are not stored. The log can't be changed or deleted from the app.
- **Pastoral privacy.** Salvation and baptism follow-ups, and messages sent with those templates, are seen only by the pastor and staff with "Pastoral notes and salvation records", the same as the salvation and baptism stages. The server rules enforce this, not only the screens.

## What I tested here

- **Automated tests pass:**
  - 12 new unit tests (86 in all): due dates in Nairobi time, escalation after 3 days, who counts as a regular attender absent 3 weeks, filling in templates, spotting misspelt fields, building the WhatsApp link, and who a message may go to (consent, stop requests, children through their guardian).
  - 18 new server-rule tests (105 in all). They check that:
    - salvation follow-ups and messages are hidden from staff without pastoral access;
    - marking done needs an outcome and records who and when;
    - a follow-up can only be assigned to an active staff member;
    - the reason, person and template can't be changed;
    - staff can add their own follow-ups but not the automatic kinds;
    - the message log can't be edited or deleted and must say who sent it;
    - other campuses stay out.
- **Browser run on local Firebase, on a phone-sized screen.** As the pastor (Andy), with an admin (Faith Njeri):
  1. Added visitor Grace Muthoni with WhatsApp agreement. Today showed "3 due today". The queue showed Grace's welcome (due today), Peter's care message ("Last at church 20/09/2026"), and Mary's 4-day-overdue follow-up in red, "escalated to the pastor", also under **With the pastor**.
  2. Gave Grace's welcome to Faith. Tapped WhatsApp. The message read "Hi Grace, thank you for worshipping with us at Freedom Church Nairobi today! … Andy, Freedom Church Nairobi". **Open WhatsApp** opened wa.me/254799123456 with that text. **Done: message sent** took it off the list.
  3. Grace's record listed the message in History ("First-time visitor welcome, Andy, 20:44") and her 48-hour check-in, due in 2 days.
  4. Recorded Grace's salvation. A salvation follow-up and a baptism class invitation appeared on her record. Recording her baptism (written straight to the test database) closed the invitation as "Baptised".
  5. Baraka, a child: **Message on WhatsApp** went to Mary Atieno, his guardian, and said we never message a child directly.
  6. Changed the welcome template. A typo, {frist_name}, was flagged. Saved "Karibu {first_name}! …".
  7. Programme reminder to Jane: "Hi Jane, a reminder that Freedom 252 meets Tuesdays at 8pm. See you there! Andy, Freedom Church Nairobi".
  8. Recorded KES 2,000 from Jane, receipt FCN-2026-000001. The **WhatsApp thank-you** read "… We received KES 2,000 for Tithes on 18/10/2026. Receipt number FCN-2026-000001."
  9. Signed in as Faith. She saw Peter's care message, Mary's follow-up and Grace's 48-hour check-in. She did **not** see the salvation or baptism follow-ups.
  10. **With the internet off**, Faith marked Peter's care message done with "Asked us to stop". Back online it synced: Peter's record says "Asked us to stop on 18/10/2026", and WhatsApp now says he asked us to stop.
  11. Faith added visitor Samuel Kiptoo. His welcome used the edited template: "Karibu Samuel! We loved having you at Freedom Church Nairobi today. See you Sunday 10:00. Faith". She marked it **Done: we spoke**.
  12. The message log held all four messages with template, sender and time. Running the morning job again after a test check-in showed Jane back at church closed her open care message as "Came back to church".

## Notes

- Stage 2 of WhatsApp (sending automatically through the WhatsApp Cloud API, without tapping Send) is for later, as in your plan. It needs a Meta business account and approved templates.
- WhatsApp can't attach a PDF through a link. **WhatsApp thank-you** sends the text; **Share receipt** sends the PDF.
- The service time in messages is the first service time in Settings → Organizations (for example "Sunday 10:00").
- The morning job runs from Europe, like the nightly clean-up, because Google's scheduler isn't offered in the South Africa region. It still works in Nairobi time.
