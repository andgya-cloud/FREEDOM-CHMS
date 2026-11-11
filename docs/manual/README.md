# User manual tools

Scripts that build the Freedom ChMS user manual PDF from the emulator build with made-up demo data only.

1. Start the emulators (`auth,firestore,functions,storage`, project `demo-freedom-chms`) and `vite` with `VITE_USE_EMULATORS=true VITE_FIREBASE_PROJECT_ID=demo-freedom-chms`.
2. Bootstrap a pastor (`pastor@example.org`), then `node orgs.mjs`, `node run.cjs seedChurch.js`, `node run.cjs seedAdiaHope.js`.
3. `node capture.cjs ./spec-church.cjs` takes the pictures with numbered circles; `python3 tojpg.py` shrinks them.
4. `node build.cjs` writes the PDF (cover, front pages, contents with page numbers, topic pages, Powered by Insight-IQ footer).
