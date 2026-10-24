#!/usr/bin/env node
/**
 * Sets a new password on one Insight-IQ account from the Terminal, with no email (Andy, 2026-10-24).
 * For when the pastor is locked out and cannot use Settings > Staff accounts. It uses the Firebase
 * login this computer already has for deploying, and asks for the new password without showing it.
 *
 *   npm run set-password -- --email andgya@gmail.com
 *
 * Local emulator: FIREBASE_AUTH_EMULATOR_HOST=127.0.0.1:9099 npm run set-password -- --project demo-freedom-chms --email ...
 */
import { createRequire } from 'node:module';
import { createInterface } from 'node:readline';
import { parseArgs } from 'node:util';

const require = createRequire(import.meta.url);
const { values } = parseArgs({ options: { project: { type: 'string', default: 'freedom-chms' }, email: { type: 'string' } } });
if (!values.email) {
  console.error('Usage: npm run set-password -- --email <their sign-in email>');
  process.exit(1);
}
const email = values.email.trim().toLowerCase();

// Kept in step with functions/src/shared/password.ts.
function passwordProblems(pw) {
  const out = [];
  if (pw.length < 10) out.push('at least 10 characters');
  if (!/[a-z]/.test(pw)) out.push('a lowercase letter');
  if (!/[A-Z]/.test(pw)) out.push('a capital letter');
  if (!/[0-9]/.test(pw)) out.push('a number');
  const local = email.split('@')[0];
  if (local.length >= 3 && pw.toLowerCase().includes(local)) out.push('not containing your email name');
  return out;
}

// Piped input (tests): one line per question.
let piped;
function nextPipedLine() {
  if (!piped) {
    const rl = createInterface({ input: process.stdin });
    const lines = [];
    const waiting = [];
    rl.on('line', (l) => (waiting.length ? waiting.shift()(l) : lines.push(l)));
    rl.on('close', () => waiting.splice(0).forEach((w) => w('')));
    piped = () => new Promise((resolve) => (lines.length ? resolve(lines.shift()) : waiting.push(resolve)));
  }
  return piped();
}

// Reads a line without echoing it.
function askHidden(question) {
  if (!process.stdin.isTTY) return nextPipedLine();
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

const password = await askHidden(`New password for ${email}: `);
const problems = passwordProblems(password);
if (problems.length) {
  console.error(`The password needs ${problems.join(', ')}. Nothing was changed.`);
  process.exit(1);
}
if ((await askHidden('Type it again: ')) !== password) {
  console.error('The two passwords are not the same. Nothing was changed.');
  process.exit(1);
}

// The Identity Toolkit admin API, signed in with this computer's Firebase login (or the emulator).
const emulator = process.env.FIREBASE_AUTH_EMULATOR_HOST;
let call;
if (emulator) {
  call = async (path, body) => {
    const res = await fetch(`http://${emulator}/identitytoolkit.googleapis.com/v1${path}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer owner' }, body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`${res.status} ${await res.text()}`);
    return res.json();
  };
} else {
  const { requireAuth } = require('firebase-tools/lib/requireAuth');
  const { Client } = require('firebase-tools/lib/apiv2');
  try {
    await requireAuth({ project: values.project });
  } catch {
    console.error('This computer is not signed in to Firebase. Run: npx firebase login   then try again.');
    process.exit(1);
  }
  const client = new Client({ urlPrefix: 'https://identitytoolkit.googleapis.com', apiVersion: 'v1', auth: true });
  call = async (path, body) => (await client.post(path, body)).body;
}

const found = await call(`/projects/${values.project}/accounts:lookup`, { email: [email] });
const user = found?.users?.[0];
if (!user) {
  console.error(`No Insight-IQ account uses ${email}. Nothing was changed.`);
  process.exit(1);
}
await call(`/projects/${values.project}/accounts:update`, { localId: user.localId, password });
console.log(`Done. ${email} can now sign in with the new password.`);
process.exit(0);
