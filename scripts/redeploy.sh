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
# Stage 8: the data jobs (download/erase/practice requests, and the weekly backup).
# Each new one goes on its own (a new job named in a longer list was once skipped without a message).
npx firebase deploy --project freedom-chms --only functions:onDataRequested
npx firebase deploy --project freedom-chms --only functions:weeklyBackup
# The nightly clean-up now follows the "keep deleted records" setting. It runs in Europe because
# Cloud Scheduler is not offered in Africa, so deploy it by name.
npx firebase deploy --project freedom-chms --only functions:purgeDeletedRecords || echo "(The nightly clean-up was not updated. Tell Claude.)"
# Then the rules, and the app itself.
npx firebase deploy --project freedom-chms --only firestore:rules,firestore:indexes,hosting
# Backups need Firebase Storage. If you have switched it on, lock its rules now. If not, this
# only prints a note; switch Storage on later and run this script again.
npx firebase deploy --project freedom-chms --only storage || echo "(Storage is not switched on yet, so there is no backup place. See README: Backups.)"
echo "Done: https://freedom-chms.web.app"
