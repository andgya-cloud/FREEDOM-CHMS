# Stage 12: A look of its own for Freedom Church

## What I built

Each organization can now have its own interface. Freedom Church Nairobi (any organization of type Church campus) gets the dark, curved "cockpit" look from your picture. ADIA and the Freedom Hope Center keep the standard look, and so does the combined "All" view.

- **Header**: the app name, the organization picker as a pill, a large clock in the organization's own time zone with the city, and the "All saved" indicator. A thin teal and gold line runs under it.
- **Today**: a big centred greeting, the organization name, the "Where are you working?" pills, the search box, then the Getting started list and scorecard below.
- **Curved dock**: Check in, Add visitor, Record gift, Follow-ups and Nav sit on a curved glass dock at the bottom. Follow-ups shows how many are due. Nav opens Settings, where everything else is listed. Buttons you don't have access to are dimmed. On a phone the dock is a straight row; on a tablet or computer the buttons fan out slightly like your picture.
- **Tabs**: Today, People, Attendance, Programmes and Settings are text labels on a curved base, on every page.
- **Colours**: every page of that organization (People, Attendance, Giving, Follow-ups and the rest) uses the same dark colours with teal highlights.

## Test it (about 5 minutes)

1. Open https://freedom-chms.web.app and refresh. Choose **Freedom Church Nairobi**: dark look, clock, curved dock.
2. Tap **Check in**, **Add visitor**, **Record gift** and **Follow-ups** on the dock. Each opens as before.
3. Open People and Settings: same dark colours, tabs along the bottom.
4. Choose **ADIA Training Centre** and **Freedom Hope Center** at the top: they look as before.
5. Open it on your phone: the dock is a row of five buttons above the tabs.

## What I tested here

Automated: the rule that picks the look and the clock text (3 new tests), all earlier tests still pass (199). In a desktop-size and a phone-size browser on local Firebase: the Freedom Church Today and People pages, and ADIA still standard.

## What I could not do or changed from the picture

- **Temperature** next to the city is not shown. It needs a weather service and would not work offline; I can add one if you want it.
- **Getting started** is a card under the search box rather than a list on the left, so it also reads well on a phone.
- The logo is the app's flame icon, not the "F" in the picture. Send me the logo file if you want it replaced.
- The curve and the glow are drawn with styles, not images, so they stay sharp and load instantly. Fine details (exact angle of the buttons, glow strength) are easy to adjust. Tell me what to change.
- No data, permissions or other screens' layouts changed.

## Adding another look later

The look for each organization is chosen in `src/lib/look.ts` (by organization type today). A new look is a new name there and its styles in `src/styles.css`. If you want ADIA or the Hope Center to have their own, tell me how each should feel.
