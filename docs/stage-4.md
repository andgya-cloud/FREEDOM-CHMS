# Stage 4: Programmes and groups

## What I built

- **A Programmes tab** for church campuses, with three parts: discipleship programmes, Dream Team and Freedom Groups.
- **One programme engine.** Every programme works the same way. It has a list of topics, cohorts (groups who start together), classes, enrolments and a rule for finishing: either every topic, or at least a set number. Growth Track, Freedom 252 and Communication Master Class are all set up this way, so a new programme needs no code. The pastor can rename topics, add or remove them, change the finishing rule, and choose whether finishing is called "Completed" or "Graduated".
- **The three standard programmes, in one tap.** The pastor taps **Add Growth Track, Freedom 252 and Communication Master Class**.
  - **Growth Track** has the four pillars: Know God, Find Freedom, Discover Purpose and Make a Difference.
  - **Freedom 252** has 24 topics and classes on Tuesday at 20:00. The topics are named "Topic 1" to "Topic 24" until you rename them, because I don't have the real topic names.
  - **Communication Master Class** has no topics yet. You can add them when the curriculum is ready.
- **Taking a class.** Open the programme and choose the date. Pick the cohort, or **Make-up class**. Pick the topic: the app suggests the next one that cohort hasn't had yet. Type or pick the mentor, then tap **Start class**. The register lists everyone enrolled in that cohort, with Present, Late, Absent and Excused. A make-up class lists everyone enrolled in any cohort and marks who still **needs this topic**. Topic and mentor can be changed on the class afterwards.
- **Progress and graduation.**
  - Each student shows "17 of 24 topics" with a progress bar.
  - A class counts if the student was present or late. Any class of the programme counts, whichever cohort or make-up class it was. That is how Freedom 252 students can join at any time and catch up.
  - When the last topic is covered, the student moves to **Graduated** (or **Completed**) by themselves. This shows straight away, even with no internet, and the server records it when the device syncs.
  - Tapping a student shows the topics they have covered, with dates, and the topics they still need. From there staff can also mark someone finished or dropped by hand, change their cohort, or add a note.
- **The journey moves by itself.**
  - Enrolling marks the programme's journey stage **In progress**; finishing marks it **Completed**.
  - Joining a Dream Team department completes the **Dream Team** stage. Joining a Freedom Group completes **Freedom Groups**.
  - A stage someone has completed is never set back.
- **Dream Team.**
  - Departments (for example Ushers) have a leader.
  - Each member has a role, a start date, and is either serving or stopped serving.
  - The department page also shows how many people who joined over 90 days ago are still serving.
- **Freedom Groups.**
  - Each group has a name, leader, meeting day and time, place, start date and members. The leader is added as a member.
  - Tap **Take attendance** on the group page to record that week's meeting. A guest can be added to a meeting.
  - A group is flagged **Missed 2 in a row** (or more) when its meeting day passes two weeks running with no meeting recorded that week. A meeting recorded on another day of the same week still counts.
  - Each member shows how many of the last 8 meetings they came to.
- **On each person's record:** a new **Programmes and groups** section shows their programmes and progress, their Dream Team departments and their group.
- **Everything works offline**, like check-in. Deleted or removed records go to the bin for 30 days.

## What I tested here

- **113 automated tests pass:**
  - 54 unit tests, including 11 new ones. They cover topic counting, graduating on the 24th topic, make-up classes, undoing an automatic graduation, the journey only moving forward, and missed group meetings.
  - 59 server-rule tests, including 11 new ones. They check that:
    - only the pastor (or staff with settings access) can change a programme's topics or finishing rule;
    - enrolments and members must point at real people and real programmes, groups or departments in the same organization;
    - a class must belong to a real programme;
    - a check-in must carry its class's programme;
    - nothing can be hard-deleted.
- **Browser run on local Firebase, on a phone-sized screen:**
  1. I added the three standard programmes in one tap, created the "November 2026" cohort of Freedom 252, and enrolled Grace and Peter. Grace's journey showed Freedom 252 **In progress**.
  2. **With the internet off**, I took 23 weekly classes. The topic was suggested each time, the mentor was filled in, and Grace was marked present at every class. Peter was present at 9 classes and absent at one. Grace showed **23 of 24 topics**.
  3. Still offline, I held a **make-up class** for Topic 24. Grace was listed with "Needs this topic". Once she was marked present, she moved to **Graduated** straight away, dated 17/10/2026.
  4. Back online, the server had all 24 classes and 34 check-ins. It recorded Grace as graduated, with 24 topics, and her journey stage as **Completed**. Peter stayed enrolled with 9 topics.
  5. Dream Team: I added Mary to Ushers as Head usher. Her Dream Team stage became Completed.
  6. Freedom Groups: I started "Kilimani young adults", meeting on Tuesdays since 27/09. It was flagged **Missed 3 in a row**. I recorded the 13/10 meeting with both members present, and the flag cleared. Faith's Freedom Groups stage became Completed.
  7. Grace's record showed "Freedom 252 · Graduated on 17/10/2026 · 24 of 24 topics".
- **Small fixes along the way:**
  - A name list could cover the Start button; it now closes with Escape or a tap elsewhere.
  - At most three messages show at the bottom at once.
  - The five tab labels now fit on a phone.

## Your test checklist (graduate a test student through Freedom 252)

1. Open the **Programmes** tab and tap **Add Growth Track, Freedom 252 and Communication Master Class**.
2. Open **Freedom 252** → **New cohort**. Name it "Test" and pick a start date about 6 months ago.
3. Under Students, enrol a test person.
4. **Optional shortcut:** tap **Edit**, set **Finished when** to **At least 2 topics**, and save. That way you only need two classes. Set it back to **Every topic** afterwards.
5. Under **Take a class**, pick a past Tuesday and tap **Start class**. Mark your test student **Present**, then tap **← Freedom 252**. Do this again with a different date: the next topic is suggested.
6. Turn on airplane mode for one of the classes. The student's count still goes up.
7. When enough topics are covered, the student moves to **Graduated** (tap the Graduated filter). Open the person: **Programmes and groups** says Graduated, and their **Journey** shows Freedom 252 Completed once you're back online.
8. Add a Dream Team department and a Freedom Group, and add someone to each.

## Deploy

Same as Stage 3: download the new **freedom-chms.tar.gz** and **redeploy.sh**, then in Terminal run `bash ~/Downloads/redeploy.sh`. This update adds one server job, `syncProgrammes`, which counts progress and moves journeys along. The script deploys it. If Terminal says your credentials are no longer valid, run `cd ~/Documents/"Claude folder"/freedom-chms && npx firebase login --reauth` first.

## Assumptions I made

- Programmes, Dream Team and Freedom Groups are for church campuses. ADIA programmes and Hope Center activities stay under Attendance until their own modules (Stages 9 and 10).
- Changing a programme's topics or finishing rule needs settings access (the pastor by default). Admins can add cohorts, enrol people, take classes and manage Dream Team and groups.
- A student is "Graduated" when every topic has been covered at least once, across any cohort or make-up class. Staff can override this either way on the student.
- If a check-in is taken back and an automatic graduation no longer holds, the student goes back to enrolled. A graduation set by hand is never undone automatically.
- A person has one enrolment per programme. Re-enrolling after dropping out keeps the topics they already covered.
- "Missed a meeting" means no meeting was recorded in that Monday-to-Sunday week. Today's meeting doesn't count as missed until the day is over. Weeks before the group's start date are ignored.
- Programme classes and group meetings don't count towards "Came in X of the last 8 weeks" on a person's record, which counts services only. They show on the programme and group pages instead.
- Group meetings record who came, not a separate headcount. Guests can be added to a meeting without joining the group.

## Fix after the Stage 4 deploy: signed out straight after signing in

- **Cause:** on a device marked as shared, each open tab of the app timed out on its own. A tab left open and untouched signed out every tab, including the one in use, so signing in again was undone within seconds. The shared-device box was also ticked by default, so every phone and computer counted as shared.
- **Fix:** taps and key presses in any tab now count for all tabs. The shared-device box now starts unticked, so a personal phone stays signed in. Tick it on a church computer or the door tablet. A device that already had it ticked keeps it until you untick it at sign-in or in **Settings → This device**.
