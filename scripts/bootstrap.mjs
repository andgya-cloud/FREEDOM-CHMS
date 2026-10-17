#!/usr/bin/env node
/**
 * One-time setup: creates the built-in roles, default settings and the first
 * Pastor (owner) account. Run it once per Firebase project.
 *
 * Local emulators:
 *   FIREBASE_AUTH_EMULATOR_HOST=127.0.0.1:9099 FIRESTORE_EMULATOR_HOST=127.0.0.1:8080 \
 *     npm run bootstrap -- --project demo-freedom-chms --email pastor@example.org --name "Andy"
 *
 * Live project (needs a service-account key; never commit it):
 *   GOOGLE_APPLICATION_CREDENTIALS=./service-account.json \
 *     npm run bootstrap -- --project <your-project-id> --email <pastor email> --name "<name>"
 *
 * The password is read from BOOTSTRAP_PASSWORD or typed at the prompt (not echoed).
 */
import { initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import { createInterface } from 'node:readline';
import { parseArgs } from 'node:util';

const { values } = parseArgs({
  options: {
    project: { type: 'string' },
    email: { type: 'string' },
    name: { type: 'string' },
  },
});
if (!values.project || !values.email || !values.name) {
  console.error('Usage: npm run bootstrap -- --project <id> --email <pastor email> --name "<display name>"');
  process.exit(1);
}

// Kept in step with functions/src/shared/permissions.ts and password.ts.
const PERMISSIONS = [
  'people.read', 'people.write', 'attendance.write', 'programs.write', 'gifts.write', 'receipts.issue',
  'followups.manage', 'pastoral.read', 'giving.person.read', 'finance.reports', 'settings.manage',
  'users.manage', 'audit.read', 'data.export',
];
const ADMIN = ['people.read', 'people.write', 'attendance.write', 'programs.write', 'gifts.write', 'receipts.issue', 'followups.manage'];

function passwordProblems(pw, email) {
  const out = [];
  if (pw.length < 10) out.push('at least 10 characters');
  if (!/[a-z]/.test(pw)) out.push('a lowercase letter');
  if (!/[A-Z]/.test(pw)) out.push('a capital letter');
  if (!/[0-9]/.test(pw)) out.push('a number');
  const local = email.split('@')[0].toLowerCase();
  if (local.length >= 3 && pw.toLowerCase().includes(local)) out.push('not containing your email name');
  return out;
}

function askHidden(question) {
  return new Promise((resolve) => {
    const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    rl._writeToOutput = (s) => { if (s.includes(question)) rl.output.write(s); };
    rl.question(question, (answer) => { rl.close(); process.stdout.write('\n'); resolve(answer); });
  });
}

const email = values.email.toLowerCase();
const password = process.env.BOOTSTRAP_PASSWORD ?? (await askHidden('Pastor password: '));
const problems = passwordProblems(password, email);
if (problems.length) {
  console.error(`Password needs ${problems.join(', ')}.`);
  process.exit(1);
}

initializeApp({ projectId: values.project });
const auth = getAuth();
const db = getFirestore();

const existingOwners = await db.collection('users').where('roleId', '==', 'pastor').limit(1).get();
if (!existingOwners.empty) {
  console.error('A pastor account already exists. Use the app to add or reset accounts.');
  process.exit(1);
}

const user = await auth.createUser({ email, password, displayName: values.name });
const uid = user.uid;
const stamp = { createdAt: FieldValue.serverTimestamp(), createdBy: uid, updatedAt: FieldValue.serverTimestamp(), updatedBy: uid };

const batch = db.batch();
batch.set(db.doc('roles/pastor'), { name: 'Pastor', isOwner: true, system: true, permissions: PERMISSIONS, ...stamp });
batch.set(db.doc('roles/admin'), { name: 'Admin', isOwner: false, system: true, permissions: ADMIN, ...stamp });
batch.set(db.doc('settings/app'), {
  inactivityMinutes: 15,
  regularAttender: { minWeeks: 3, ofLastWeeks: 8 },
  timeZone: 'Africa/Nairobi',
  currency: 'KES',
  ...stamp,
});
batch.set(db.doc(`users/${uid}`), {
  email,
  displayName: values.name,
  roleId: 'pastor',
  extraPermissions: [],
  orgIds: [],
  allOrgs: true,
  permissions: PERMISSIONS,
  active: true,
  mustChangePassword: false,
  ...stamp,
});
batch.set(db.collection('auditLog').doc(), {
  actorUid: uid, actorEmail: email, action: 'bootstrap', path: `users/${uid}`, collection: 'users',
  docId: uid, orgId: null, changedFields: [], note: 'Created roles, settings and the first pastor account',
  at: FieldValue.serverTimestamp(),
});
await batch.commit();
console.log(`Done. Sign in as ${email}.`);
process.exit(0);
