# User manual tools

Scripts that build the Freedom ChMS user manual PDF from the emulator build with made-up demo data only.

1. Start the emulators (`auth,firestore,functions,storage`, project `demo-freedom-chms`) and `vite` with `VITE_USE_EMULATORS=true VITE_FIREBASE_PROJECT_ID=demo-freedom-chms`.
2. Bootstrap a pastor (`pastor@example.org`), then `node orgs.mjs`, `node run.cjs seedChurch.js`, `node run.cjs seedAdiaHope.js`.
3. `node capture.cjs ./spec-church.cjs` takes the pictures with numbered circles; `python3 tojpg.py` shrinks them.
4. `node build.cjs` writes the PDF (cover, front pages, contents with page numbers, topic pages, Powered by Insight-IQ footer).

## November 2026 update (version 1.1)

Part 1 pages added in `spec-church-new.cjs` (each says which page it follows or replaces). Extra demo data, run in order after `seedChurch.js`:
`seedHosts.js` (Service hosts and prayer leaders), `seedF252.js`, `seedReg.js`, `seedMeet.js` (Freedom 252 register; these hold the demo ids of one run, so update them), `seedCount.js`, `seedCount2.js` (a service today, phone counters, Sunday school class counts), `seedTeacher.js` (a Sunday school teacher and the youth leader). The Meet and class-list files the pictures upload are in `tools/files`.
Pages not photographed again keep their picture from `public/manual`, in both the PDF and the app.
