#!/bin/bash
# Freedom ChMS: switch on WhatsApp Cloud API sending. Run on Andy's Mac AFTER the Meta steps in docs/stage-11.md.
# It stores the three secrets in Firebase (never in the code or in chat) and deploys the three WhatsApp jobs.
# Run redeploy.sh first so the app and rules are up to date. Safe to run again to change a secret.
set -e
cd ~/Documents/"Claude folder"/freedom-chms
[ -f .env.production.local ] || { echo "Run first-deploy.sh once before this script."; exit 1; }

echo ""
echo "You will be asked for two things from Meta. What you type is hidden. Press Enter to keep a value you set before."
echo ""
read -r -s -p "1. Access token (the permanent token from Meta): " TOKEN; echo ""
read -r -s -p "2. App secret (Meta, App settings, Basic, App secret): " APPSECRET; echo ""
VERIFY="$(openssl rand -hex 16)"
echo "3. Verify token: made up for you. You will paste it into Meta in a moment:"
echo ""
echo "      $VERIFY"
echo ""
read -r -p "Press Enter when you have copied it. " _

set_secret() { # name, value
  [ -n "$2" ] || { echo "(Keeping the saved $1.)"; return; }
  printf '%s' "$2" | npx firebase functions:secrets:set "$1" --project freedom-chms --data-file - --force
}
set_secret WHATSAPP_TOKEN "$TOKEN"
set_secret WHATSAPP_APP_SECRET "$APPSECRET"
set_secret WHATSAPP_VERIFY_TOKEN "$VERIFY"

npm --prefix functions install --no-audit --no-fund
npm --prefix functions run build
# Each new job goes on its own (a new job named in a longer list was once skipped without a message).
npx firebase deploy --project freedom-chms --only functions:onWhatsappOutboxWritten
npx firebase deploy --project freedom-chms --only functions:whatsappWebhook
npx firebase deploy --project freedom-chms --only functions:whatsappQueue || echo "(The hourly queue job was not deployed. Tell Claude.)"
echo ""
echo "Done. In Meta, the webhook is:"
echo "   Callback URL: https://africa-south1-freedom-chms.cloudfunctions.net/whatsappWebhook"
echo "   Verify token: $VERIFY"
echo "Then switch it on in the app: Settings, WhatsApp automation."
