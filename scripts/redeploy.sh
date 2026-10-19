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
# The WhatsApp jobs need three secrets (see docs/stage-11.md). Until they are set, Firebase would stop and ask for
# them on every job, so the job deploys are skipped and only the rules and the app are updated.
SKIP_FUNCS=0
for s in WHATSAPP_TOKEN WHATSAPP_APP_SECRET WHATSAPP_VERIFY_TOKEN; do
  npx firebase functions:secrets:get "$s" --project freedom-chms >/dev/null 2>&1 || SKIP_FUNCS=1
done
[ "$SKIP_FUNCS" = 1 ] && echo "WhatsApp secrets are not set yet, so the background jobs are not redeployed this time. The rules and the app are."
fdeploy() { [ "$SKIP_FUNCS" = 1 ] || npx firebase deploy --project freedom-chms --only "functions:$1"; }
# Stage 8: the data jobs (download/erase/practice requests, and the weekly backup).
# Each new one goes on its own (a new job named in a longer list was once skipped without a message).
fdeploy onDataRequested
fdeploy weeklyBackup
# The nightly clean-up now follows the "keep deleted records" setting. It runs in Europe because
# Cloud Scheduler is not offered in Africa, so deploy it by name.
fdeploy purgeDeletedRecords || echo "(The nightly clean-up was not updated. Tell Claude.)"
# Stage 9: ADIA Training Centre. Each new job goes on its own.
fdeploy onStudentCreated
fdeploy onInvoiceWritten
fdeploy onFeePaymentWritten
fdeploy onCertificateCreated
fdeploy onSchoolReportRequested
fdeploy scheduledSchoolReports || echo "(The scheduled school reports were not deployed. Tell Claude.)"
# Stage 10: Freedom Hope Center. Each new job goes on its own.
fdeploy onChildCreated
fdeploy onAbsenceCheckRequested
fdeploy onHopeReportRequested
fdeploy dailyChildAbsences || echo "(The daily absence check was not deployed. Tell Claude.)"
fdeploy scheduledHopeReports || echo "(The scheduled Hope Center reports were not deployed. Tell Claude.)"
# Staff accounts (organization heads add staff for their own organization). Firebase checks the WhatsApp
# secrets on any function deploy, so these are skipped too until the secrets exist.
fdeploy createUser,functions:updateUser,functions:resetUserPassword,functions:listTeam
# Then the rules, and the app itself.
npx firebase deploy --project freedom-chms --only firestore:rules,firestore:indexes,hosting
# Backups need Firebase Storage. If you have switched it on, lock its rules now. If not, this
# only prints a note; switch Storage on later and run this script again.
npx firebase deploy --project freedom-chms --only storage || echo "(Storage is not switched on yet, so there is no backup place. See README: Backups.)"
echo "Done: https://freedom-chms.web.app"
