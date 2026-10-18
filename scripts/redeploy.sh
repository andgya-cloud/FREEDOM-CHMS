#!/bin/bash
# Freedom ChMS: update the live app on the freedom-chms Firebase project. Run on Andy's Mac.
# Needs freedom-chms.tar.gz in Downloads and an earlier run of first-deploy.sh.
set -e
cd ~/Documents/"Claude folder"
[ -f freedom-chms/.env.production.local ] || { echo "Run first-deploy.sh once before this script."; exit 1; }
# Unpack over the existing copy: the settings files and installed packages stay.
tar -xzf ~/Downloads/freedom-chms.tar.gz
cd freedom-chms
echo "Installing (only changes are downloaded)..."
npm install --no-audit --no-fund && npm --prefix functions install --no-audit --no-fund
npm run build
# Stage 5: the server job that numbers receipts and keeps the fund ledger.
# It goes first, on its own (a new job named in a longer list was once
# skipped without a message), so it is ready before the new screens arrive.
npx firebase deploy --project freedom-chms --only functions:onGiftWritten
# Then the rules that protect gifts, and the app itself.
npx firebase deploy --project freedom-chms --only firestore:rules,firestore:indexes,hosting
echo "Done: https://freedom-chms.web.app"
