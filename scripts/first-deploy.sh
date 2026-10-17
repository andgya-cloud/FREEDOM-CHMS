#!/bin/bash
# Freedom ChMS: first deploy to the freedom-chms Firebase project. Run on Andy's Mac.
set -e
mkdir -p ~/Documents/"Claude folder" && cd ~/Documents/"Claude folder"
command -v node >/dev/null || { echo "Node.js is not installed. Install it from https://nodejs.org (LTS), then run this again."; exit 1; }
rm -rf freedom-chms && tar -xzf ~/Downloads/freedom-chms.tar.gz
cd freedom-chms
echo "Installing (this takes a few minutes)..."
npm ci && npm --prefix functions ci
cat > .env.production.local <<'EOF'
VITE_FIREBASE_API_KEY=AIzaSyBvb5Dc-XzhGUYZ5LaH4q_fX9vg50LPqAM
VITE_FIREBASE_AUTH_DOMAIN=freedom-chms.firebaseapp.com
VITE_FIREBASE_PROJECT_ID=freedom-chms
VITE_FIREBASE_STORAGE_BUCKET=freedom-chms.firebasestorage.app
VITE_FIREBASE_MESSAGING_SENDER_ID=230591854213
VITE_FIREBASE_APP_ID=1:230591854213:web:11cf4350647b74f0149bec
VITE_USE_EMULATORS=false
EOF
cp functions/.env.example functions/.env
npx firebase firestore:databases:create "(default)" --location=africa-south1 --project freedom-chms || echo "(database already exists)"
npm run build
npx firebase deploy --project freedom-chms
KEY=$(ls -t ~/Downloads/freedom-chms-*.json 2>/dev/null | head -1)
[ -n "$KEY" ] || { echo "No key file found in Downloads. Generate the private key in the Firebase console, then run this again."; exit 1; }
GOOGLE_APPLICATION_CREDENTIALS="$KEY" npm run bootstrap -- --project freedom-chms --email andgya@gmail.com --name "Andy"
rm "$KEY" && echo "Deleted the key file. All done: https://freedom-chms.web.app"
