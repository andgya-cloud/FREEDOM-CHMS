import {
  collection,
  doc,
  documentId,
  getDocFromServer,
  getDocsFromServer,
  query,
  serverTimestamp,
  setDoc,
  waitForPendingWrites,
  where,
  writeBatch,
} from 'firebase/firestore';
import { auth, db } from '../firebase';
import { createStamps, softDelete, updateRecord } from './records';
import { trackWrite } from './sync';
import { readPref, writePref } from './storage';
import { STANDARD_FUNDS, type GiftMethod, type UnassignedReason } from '../../functions/src/shared/giving';
import type { Gift } from '../state/useGiving';

/**
 * Writes for giving. A gift is saved on the device straight away and synced
 * when online, like everything else. Money facts (amount, date, method,
 * M-Pesa code) never change after entry: a mistake is voided, with a reason,
 * and entered again. Receipt numbers come from the server once the gift
 * reaches it, so two devices offline can never use the same number.
 */

const ref = (orgId: string, name: string, id: string) => doc(db, 'organizations', orgId, name, id);

function me(): string {
  const u = auth.currentUser;
  if (!u) throw new Error('Please sign in again.');
  return u.uid;
}

// ---- Funds --------------------------------------------------------------------

type Batch = ReturnType<typeof writeBatch>;

export function addStandardFunds(orgId: string, existingIds: readonly string[]) {
  const batch = writeBatch(db);
  for (const f of STANDARD_FUNDS) {
    if (existingIds.includes(f.id)) continue;
    batch.set(ref(orgId, 'funds', f.id), { orgId, name: f.name, aliases: [], active: true, ...createStamps() });
  }
  return trackWrite(batch.commit());
}

/** A new kind of other giving, named as it is first recorded (Andy, 2026-10-31, 2A). Saved with the gift that names it. */
export interface NewFund { id: string; name: string }

function addFundToBatch(batch: Batch, orgId: string, fund: NewFund) {
  batch.set(ref(orgId, 'funds', fund.id), { orgId, name: fund.name, aliases: [], active: true, kind: 'other', ...createStamps() });
}

/** Saves new kinds of other giving before an import uses them. Needs internet, like the import. */
export function addOtherFunds(orgId: string, funds: readonly NewFund[]) {
  if (!funds.length) return Promise.resolve();
  const batch = writeBatch(db);
  funds.forEach((f) => addFundToBatch(batch, orgId, f));
  return trackWrite(batch.commit());
}

export function saveFund(orgId: string, id: string, fund: { name: string; aliases: string[]; active: boolean }, exists: boolean) {
  const data = { name: fund.name.trim(), aliases: fund.aliases.map((a) => a.trim()).filter(Boolean).slice(0, 10), active: fund.active };
  if (exists) return updateRecord(ref(orgId, 'funds', id), data);
  return trackWrite(setDoc(ref(orgId, 'funds', id), { orgId, ...data, ...createStamps() }));
}

// ---- Gifts --------------------------------------------------------------------

export interface GiftInput {
  personId: string | null;
  giverName: string;
  phone: string | null;
  date: string;
  amountCents: number;
  fundId: string | null;
  method: GiftMethod;
  mpesaCode: string | null;
  accountRef: string;
  notes: string;
  importId?: string | null;
}

/** A gift is confirmed when it names a giver and a fund; otherwise it waits in the Unassigned queue. */
export function giftStatusFor(input: Pick<GiftInput, 'personId' | 'giverName' | 'fundId'>, personRequired: boolean): { status: 'confirmed' | 'unassigned'; unassignedReason: UnassignedReason | null } {
  const noPerson = personRequired ? !input.personId : !input.giverName.trim();
  const noFund = !input.fundId;
  if (!noPerson && !noFund) return { status: 'confirmed', unassignedReason: null };
  return { status: 'unassigned', unassignedReason: noPerson && noFund ? 'both' : noPerson ? 'person' : 'fund' };
}

function giftData(orgId: string, input: GiftInput, receivedByName: string, personRequired: boolean) {
  const uid = me();
  const { status, unassignedReason } = giftStatusFor(input, personRequired);
  return {
    orgId,
    personId: input.personId,
    giverName: input.giverName.trim(),
    phone: input.phone,
    date: input.date,
    amountCents: input.amountCents,
    fundId: input.fundId,
    method: input.method,
    mpesaCode: input.method === 'mpesa' ? input.mpesaCode : null,
    accountRef: input.accountRef.trim(),
    status,
    unassignedReason,
    receivedBy: uid,
    receivedByName,
    handledBy: status === 'confirmed' ? uid : null,
    notes: input.notes.trim(),
    importId: input.importId ?? null,
    receiptNumber: null,
    receiptIssuedAt: null,
    voidReason: null,
    voidedAt: null,
    ...createStamps(),
  };
}

function addGiftToBatch(batch: Batch, orgId: string, giftId: string, data: ReturnType<typeof giftData>) {
  batch.set(ref(orgId, 'gifts', giftId), data);
  // The code's entry is saved with the gift; the server refuses a second gift with the same code.
  if (data.mpesaCode) batch.set(ref(orgId, 'mpesaCodes', data.mpesaCode), { orgId, giftId, amountCents: data.amountCents, createdAt: serverTimestamp(), createdBy: data.receivedBy });
}

/**
 * Records one gift (cash, bank, cheque or an M-Pesa payment typed in).
 * Works offline. If the server later refuses it, usually because the same
 * M-Pesa code was recorded on another device, it is kept for review instead
 * of being lost: see `reviewOutbox`.
 */
export function recordGift(orgId: string, input: GiftInput, receivedByName: string, newFund?: NewFund) {
  const giftId = doc(collection(db, 'organizations', orgId, 'gifts')).id;
  const data = giftData(orgId, input, receivedByName, false);
  const batch = writeBatch(db);
  if (newFund) addFundToBatch(batch, orgId, newFund);
  addGiftToBatch(batch, orgId, giftId, data);
  remember({ orgId, giftId, savedAt: new Date().toISOString(), gift: { ...input, status: data.status } });
  const synced = trackWrite(batch.commit());
  synced.then(() => forget(giftId), (err) => { void flagForReview(orgId, giftId, reasonFor(err)); });
  return { id: giftId, status: data.status, synced };
}

/** Gives a queued payment its person and/or fund. With both, it is confirmed and gets its receipt. */
export function assignGift(orgId: string, gift: Gift, changes: { personId: string | null; giverName: string; fundId: string | null }, personRequired: boolean) {
  const { status, unassignedReason } = giftStatusFor(changes, personRequired);
  return updateRecord(ref(orgId, 'gifts', gift.id), {
    personId: changes.personId,
    giverName: changes.giverName.trim() || gift.giverName,
    fundId: changes.fundId,
    status,
    unassignedReason,
    handledBy: status === 'confirmed' ? me() : null,
  });
}

/** Voids a gift. The record and its receipt number are kept, marked void, with the reason. */
export function voidGift(orgId: string, giftId: string, reason: string) {
  return updateRecord(ref(orgId, 'gifts', giftId), { status: 'void', voidReason: reason.trim(), voidedAt: serverTimestamp() });
}

/** Links a gift recorded with a name only to the person's record (the receipt keeps its name). */
export function linkGiftToPerson(orgId: string, giftId: string, personId: string) {
  return updateRecord(ref(orgId, 'gifts', giftId), { personId });
}

export function updateGiftNotes(orgId: string, giftId: string, notes: string) {
  return updateRecord(ref(orgId, 'gifts', giftId), { notes: notes.trim() });
}

// ---- Checking codes against the server ----------------------------------------------

/** Which of these documents already exist on the server. Needs internet. */
async function existing(orgId: string, name: string, ids: readonly string[]): Promise<Map<string, Record<string, unknown>>> {
  const found = new Map<string, Record<string, unknown>>();
  const unique = [...new Set(ids)];
  for (let i = 0; i < unique.length; i += 30) {
    const chunk = unique.slice(i, i + 30);
    const snap = await getDocsFromServer(query(collection(db, 'organizations', orgId, name), where(documentId(), 'in', chunk)));
    snap.docs.forEach((d) => found.set(d.id, d.data()));
  }
  return found;
}

export interface RecordedCode { giftId: string; amountCents: number | null }

/** M-Pesa codes already recorded in this organization, with the gift and amount each belongs to. */
export async function recordedCodes(orgId: string, codes: readonly string[]): Promise<Map<string, RecordedCode>> {
  const found = await existing(orgId, 'mpesaCodes', codes);
  return new Map([...found].map(([code, d]) => [code, { giftId: String(d.giftId), amountCents: typeof d.amountCents === 'number' ? d.amountCents : null }]));
}

/** For typing in one payment: the gift that already has this code, if any (null when offline). */
export async function giftWithCode(orgId: string, code: string): Promise<string | null | undefined> {
  if (!navigator.onLine) return undefined;
  try {
    const snap = await getDocFromServer(ref(orgId, 'mpesaCodes', code));
    return snap.exists() ? String(snap.data().giftId) : null;
  } catch {
    return undefined;
  }
}

// ---- Importing a Paybill statement ----------------------------------------------------

export interface ImportPayment extends GiftInput {
  code: string;
}

export interface ImportTotals {
  fileName: string;
  firstDate: string | null;
  lastDate: string | null;
  statementTotalCents: number;
  paymentCount: number;
  duplicateCount: number;
  duplicateCents: number;
  skippedCount: number;
}

export interface ImportResult {
  importId: string;
  importedCount: number;
  importedCents: number;
  confirmedCount: number;
  unassignedCount: number;
  /** Payments that another device recorded while this import was running. */
  lateDuplicates: string[];
}

/**
 * Saves the new payments of a statement: each as a gift (confirmed or
 * unassigned), its M-Pesa code, and its statement line, plus statement lines
 * for payments that were already recorded, so the month reconciles. Needs
 * internet, because every code is checked with the server first.
 */
export async function importStatement(
  orgId: string,
  payments: readonly ImportPayment[],
  alreadyRecorded: readonly { code: string; date: string; amountCents: number }[],
  totals: ImportTotals,
  receivedByName: string,
): Promise<ImportResult> {
  const uid = me();
  const importId = doc(collection(db, 'organizations', orgId, 'giftImports')).id;
  const knownLines = await existing(orgId, 'statementLines', [...payments.map((p) => p.code), ...alreadyRecorded.map((p) => p.code)]);
  const line = (p: { date: string; amountCents: number }) => ({ orgId, date: p.date, amountCents: p.amountCents, importId, createdAt: serverTimestamp(), createdBy: uid });

  const prepared = payments.map((p) => {
    const giftId = doc(collection(db, 'organizations', orgId, 'gifts')).id;
    return { p, giftId, data: giftData(orgId, { ...p, mpesaCode: p.code, method: 'mpesa', importId }, receivedByName, true) };
  });
  const confirmedCount = prepared.filter((x) => x.data.status === 'confirmed').length;
  const importedCents = prepared.reduce((s, x) => s + x.p.amountCents, 0);

  // The import record first, so every gift can point to it.
  await trackWrite(setDoc(ref(orgId, 'giftImports', importId), {
    orgId,
    ...totals,
    importedCount: prepared.length,
    importedCents,
    unassignedCount: prepared.length - confirmedCount,
    ...createStamps(),
  }));

  const lateDuplicates: string[] = [];
  const commit = async (items: typeof prepared) => {
    const batch = writeBatch(db);
    for (const x of items) {
      addGiftToBatch(batch, orgId, x.giftId, x.data);
      if (!knownLines.has(x.p.code)) batch.set(ref(orgId, 'statementLines', x.p.code), line(x.p));
    }
    await trackWrite(batch.commit());
  };
  // 3 writes per payment, well under the 500-write limit of a batch.
  for (let i = 0; i < prepared.length; i += 150) {
    const chunk = prepared.slice(i, i + 150);
    try {
      await commit(chunk);
    } catch {
      // Someone recorded one of these meanwhile: save the rest one by one.
      for (const x of chunk) {
        try { await commit([x]); } catch { lateDuplicates.push(x.p.code); }
      }
    }
  }

  const missingLines = alreadyRecorded.filter((p) => !knownLines.has(p.code));
  for (let i = 0; i < missingLines.length; i += 400) {
    const batch = writeBatch(db);
    missingLines.slice(i, i + 400).forEach((p) => batch.set(ref(orgId, 'statementLines', p.code), line(p)));
    await trackWrite(batch.commit());
  }

  return {
    importId,
    importedCount: prepared.length - lateDuplicates.length,
    importedCents: prepared.filter((x) => !lateDuplicates.includes(x.p.code)).reduce((s, x) => s + x.p.amountCents, 0),
    confirmedCount: prepared.filter((x) => x.data.status === 'confirmed' && !lateDuplicates.includes(x.p.code)).length,
    unassignedCount: prepared.filter((x) => x.data.status === 'unassigned' && !lateDuplicates.includes(x.p.code)).length,
    lateDuplicates,
  };
}

// ---- Gifts the server refused --------------------------------------------------------
//
// Gifts saved on this device are remembered until the server has them. If
// the server refuses one (another device recorded the same M-Pesa code while
// both were offline, say), it is saved as a review item instead: never
// silently dropped, never overwriting the other record.

interface OutboxEntry {
  orgId: string;
  giftId: string;
  savedAt: string;
  gift: GiftInput & { status: string };
}

const OUTBOX = 'giftOutbox';

function readOutbox(): OutboxEntry[] {
  try {
    return JSON.parse(readPref(OUTBOX) ?? '[]') as OutboxEntry[];
  } catch {
    return [];
  }
}

function remember(entry: OutboxEntry) {
  writePref(OUTBOX, JSON.stringify([...readOutbox().filter((e) => e.giftId !== entry.giftId), entry]));
}

function forget(giftId: string) {
  const rest = readOutbox().filter((e) => e.giftId !== giftId);
  writePref(OUTBOX, rest.length ? JSON.stringify(rest) : null);
}

function reasonFor(err: unknown): string {
  const code = (err as { code?: string })?.code ?? '';
  return code === 'permission-denied'
    ? 'The server refused this gift. Usually the same M-Pesa code was already recorded on another device.'
    : 'The server could not save this gift.';
}

async function flagForReview(orgId: string, giftId: string, reason: string) {
  const entry = readOutbox().find((e) => e.giftId === giftId);
  if (!entry) return;
  const g = entry.gift;
  try {
    await trackWrite(setDoc(ref(orgId, 'giftReviews', giftId), {
      orgId,
      giftId,
      giverName: g.giverName,
      personId: g.personId,
      date: g.date,
      amountCents: g.amountCents,
      fundId: g.fundId,
      method: g.method,
      mpesaCode: g.mpesaCode,
      notes: g.notes,
      savedAt: entry.savedAt,
      reason,
      status: 'open',
      resolvedNote: '',
      ...createStamps(),
    }));
    forget(giftId);
  } catch {
    // Kept on the device; tried again next time the Giving page opens.
  }
}

/**
 * Run when the Giving page opens: once every queued change has reached the
 * server, any remembered gift the server doesn't have was refused, so it
 * becomes a review item.
 */
export async function reviewOutbox(): Promise<void> {
  if (!readOutbox().length || !navigator.onLine) return;
  await waitForPendingWrites(db);
  for (const e of readOutbox()) {
    try {
      const snap = await getDocFromServer(ref(e.orgId, 'gifts', e.giftId));
      if (snap.exists()) forget(e.giftId);
      else await flagForReview(e.orgId, e.giftId, reasonFor({ code: 'permission-denied' }));
    } catch (err) {
      // Staff may only read gifts that exist and are theirs, so a gift that
      // never arrived reads as "permission denied". Anything else: try later.
      if ((err as { code?: string })?.code === 'permission-denied') await flagForReview(e.orgId, e.giftId, reasonFor(err));
    }
  }
}

export function resolveReview(orgId: string, giftId: string, note: string) {
  return updateRecord(ref(orgId, 'giftReviews', giftId), { status: 'resolved', resolvedNote: note.trim() });
}

// ---- Pledges (Andy, 2026-10-31, 8A) ---------------------------------------------

export interface PledgeInput {
  personId: string | null;
  name: string;
  fundId: string;
  amountCents: number;
  startDate: string;
  endDate: string | null;
  notes: string;
}

export function addPledge(orgId: string, input: PledgeInput, newFund?: NewFund) {
  const batch = writeBatch(db);
  if (newFund) addFundToBatch(batch, orgId, newFund);
  const pledgeRef = doc(collection(db, 'organizations', orgId, 'pledges'));
  batch.set(pledgeRef, { orgId, ...input, name: input.name.trim(), notes: input.notes.trim(), ...createStamps() });
  return trackWrite(batch.commit());
}

export function updatePledge(orgId: string, pledgeId: string, changes: Partial<PledgeInput>) {
  return updateRecord(doc(db, 'organizations', orgId, 'pledges', pledgeId), changes);
}

export function removePledge(orgId: string, pledgeId: string) {
  return softDelete(doc(db, 'organizations', orgId, 'pledges', pledgeId));
}
