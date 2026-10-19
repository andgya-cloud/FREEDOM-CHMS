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

## Update: full curved "cockpit" on wide screens

On screens 900 pixels wide or more, the Freedom Church Today screen now matches the design page (freedom-cockpit.html): the cyan and gold curved bowl along the bottom, five tilted glass tiles (Check in, Add visitor, Record gift, Follow-ups, Nav) that follow the curve, and the page names (Today, People, Attendance, Programmes, Settings) as labels on the curve. The curve and tiles are drawn in percentages of the screen width, so they keep their shape at any size. On phones the earlier compact dock stays. Other organizations keep the standard look.

## Update: glass look for ADIA Training Centre
ADIA (organization type College) now has its own "glass" look: a frosted panel over a blurred room, thick teal glass tiles (Check in, Add student, Record fees, Follow-ups) and a floating dock of round buttons. Church keeps the cockpit and Hope the standard look. Set in `src/lib/look.ts`; styles at the end of `src/styles.css`. A fixed-stage design page is in the deploy folder (`adia-glass.html`).

## Update: aurora look for Freedom Hope Center
Hope (type Ministry) has the "aurora" look: floating, slightly tilted glass cards over a dark green background, in shades of green with gold outlines on the buttons. Tiles: Check in, Register child, Record gift, Follow-ups. Tilt is switched off on phones.

## Insight-IQ logo

The compass logo Andy sent replaces the old icon everywhere: the top bar on all three organizations, the sign-in page (with "The People Compass" under the name), the browser tab and the installed app icon. The name is now written "Insight-IQ". Icons are made from the upload by cropping the compass onto white (public/logo-mark.png, favicon.png, apple-touch-icon.png, pwa-*.png).

## Organization logos

Each organization shows its own logo next to the Insight-IQ one: ADIA in the top bar on the right (glass look only), Freedom Church above the Insight-IQ heading on Today (cockpit look), and Freedom Hope Center inside the Insight-IQ card on Today (aurora look). Files: public/org/*.png, cut from the images Andy sent.
