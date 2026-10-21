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
  'pettycash.request', 'pettycash.check', 'pettycash.approve', 'pettycash.authorize', 'team.manage',
  'users.manage', 'audit.read', 'data.export',
];
const ADMIN = ['people.read', 'people.write', 'attendance.write', 'programs.write', 'gifts.write', 'receipts.issue', 'followups.manage'];
// Kept in step with DEFAULT_ROLES in functions/src/shared/permissions.ts. Neither role sees money.
const TEAM_WORK = ['people.read', 'people.write', 'attendance.write', 'programs.write', 'followups.manage'];
const TEAM_ROLES = [
  ['roles/head', { name: 'Organization head', isOwner: false, system: true, permissions: [...TEAM_WORK, 'team.manage'] }],
  ['roles/staff', { name: 'Staff', isOwner: false, system: true, permissions: TEAM_WORK }],
];

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

// Reads a line without echoing it. Raw mode instead of readline, whose redraws
// include the typed text on newer Node versions.
function askHidden(question) {
  if (!process.stdin.isTTY) {
    return new Promise((resolve) => {
      const rl = createInterface({ input: process.stdin });
      rl.question(question, (answer) => { rl.close(); resolve(answer); });
    });
  }
  return new Promise((resolve) => {
    const stdin = process.stdin;
    let answer = '';
    process.stdout.write(question);
    stdin.setRawMode(true);
    stdin.resume();
    stdin.setEncoding('utf8');
    const onData = (chunk) => {
      for (const ch of chunk) {
        if (ch === '\r' || ch === '\n') {
          stdin.setRawMode(false);
          stdin.pause();
          stdin.off('data', onData);
          process.stdout.write('\n');
          resolve(answer);
          return;
        }
        if (ch === '\u0003') { process.stdout.write('\n'); process.exit(130); }
        if (ch === '\u007f' || ch === '\b') answer = answer.slice(0, -1);
        else answer += ch;
      }
    };
    stdin.on('data', onData);
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

const PIPELINE_SETTINGS = {
  // Kept in step with DEFAULT_PIPELINE in functions/src/shared/people.ts.
  stages: [
    { id: 'visitor', name: 'Visitor', sensitive: false, active: true },
    { id: 'salvation', name: 'Salvation', sensitive: true, active: true },
    { id: 'baptism', name: 'Baptism', sensitive: true, active: true },
    { id: 'growth_track', name: 'Growth Track', sensitive: false, active: true },
    { id: 'dream_team', name: 'Dream Team', sensitive: false, active: true },
    { id: 'freedom_252', name: 'Freedom 252', sensitive: false, active: true },
    { id: 'freedom_groups', name: 'Freedom Groups', sensitive: false, active: true },
    { id: 'communication_master_class', name: 'Communication Master Class', sensitive: false, active: true },
  ],
  sensitiveStageIds: ['salvation', 'baptism'],
};
const CUSTOM_FIELD_SETTINGS = { fields: [] };

const existingOwners = await db.collection('users').where('roleId', '==', 'pastor').limit(1).get();
if (!existingOwners.empty) {
  // Already set up: only add settings that later stages introduced, never overwrite.
  const ownerUid = existingOwners.docs[0].id;
  const stamp = { createdAt: FieldValue.serverTimestamp(), createdBy: ownerUid, updatedAt: FieldValue.serverTimestamp(), updatedBy: ownerUid };
  const added = [];
  for (const [path, data] of [['settings/pipeline', PIPELINE_SETTINGS], ['settings/customFields', CUSTOM_FIELD_SETTINGS], ...TEAM_ROLES]) {
    try {
      await db.doc(path).create({ ...data, ...stamp });
      added.push(path);
    } catch (err) {
      if (err.code !== 6) throw err; // 6 = already exists
    }
  }
  console.log(added.length ? `A pastor account already exists. Added missing settings: ${added.join(', ')}.` : 'A pastor account already exists and settings are up to date. Use the app to add or reset accounts.');
  process.exit(0);
}

const user = await auth.createUser({ email, password, displayName: values.name });
const uid = user.uid;
const stamp = { createdAt: FieldValue.serverTimestamp(), createdBy: uid, updatedAt: FieldValue.serverTimestamp(), updatedBy: uid };

const batch = db.batch();
batch.set(db.doc('roles/pastor'), { name: 'Pastor', isOwner: true, system: true, permissions: PERMISSIONS, ...stamp });
batch.set(db.doc('roles/admin'), { name: 'Admin', isOwner: false, system: true, permissions: ADMIN, ...stamp });
for (const [path, data] of TEAM_ROLES) batch.set(db.doc(path), { ...data, ...stamp });
batch.set(db.doc('settings/app'), {
  inactivityMinutes: 15,
  regularAttender: { minWeeks: 3, ofLastWeeks: 8 },
  timeZone: 'Africa/Nairobi',
  currency: 'KES',
  ...stamp,
});
batch.set(db.doc('settings/pipeline'), { ...PIPELINE_SETTINGS, ...stamp });
batch.set(db.doc('settings/customFields'), { ...CUSTOM_FIELD_SETTINGS, ...stamp });
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
