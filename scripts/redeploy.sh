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
# Only the nightly clean-up job changed on the server side in this update. Naming it
# also avoids the question about the old africa-south1 copy of that job.
npx firebase deploy --project freedom-chms --only firestore:rules,firestore:indexes,hosting,functions:purgeDeletedRecords
echo "Done: https://freedom-chms.web.app"
