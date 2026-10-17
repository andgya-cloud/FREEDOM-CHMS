#!/bin/bash
# Freedom ChMS: first deploy to the freedom-chms Firebase project. Run on Andy's Mac.
set -e
cd ~/Documents/"Claude folder"
[ -d freedom-chms ] || git clone https://github.com/andgya-cloud/freedom-chms.git
cd freedom-chms
git fetch origin && git checkout stage-2-people && git pull origin stage-2-people
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
KEY=$(ls -t ~/Downloads/freedom-chms-*.json | head -1)
GOOGLE_APPLICATION_CREDENTIALS="$KEY" npm run bootstrap -- --project freedom-chms --email andgya@gmail.com --name "Andy"
rm "$KEY" && echo "Deleted the key file. All done: https://freedom-chms.web.app"
