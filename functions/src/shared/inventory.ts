import { cohortKey } from './examCohorts.js';
import { formatDateKey, zonedMidnight } from './datetime.js';

/**
 * ADIA's departmental inventory (Andy, 2026-10-29): each department's lab technician or trainer counts its
 * equipment at the start and at the end of every cohort and sends the count to Admin by a deadline. Five days
 * before it they get a countdown and a daily email; after it the form closes until Admin reopens it, and the
 * printed form says how late it was.
 */

export type InventoryPhase = 'start' | 'end';
export const INVENTORY_PHASES: InventoryPhase[] = ['start', 'end'];
export const PHASE_LABELS: Record<InventoryPhase, string> = { start: 'Start of cohort', end: 'End of cohort' };
export const phaseTitle = (phase: InventoryPhase, cohort: string) => `${phase === 'start' ? 'Start' : 'End'} of ${cohort}`;

export type InventoryCondition = 'good' | 'fair' | 'poor' | 'broken' | 'missing';
export const CONDITIONS: InventoryCondition[] = ['good', 'fair', 'poor', 'broken', 'missing'];
export const CONDITION_LABELS: Record<InventoryCondition, string> = { good: 'Good', fair: 'Fair', poor: 'Poor', broken: 'Broken', missing: 'Missing' };
const CONDITION_RANK: Record<InventoryCondition, number> = { good: 0, fair: 1, poor: 2, broken: 3, missing: 4 };

export const CATEGORIES = ['Equipment', 'Machines', 'Electronics', 'Tools', 'Furniture', 'Utensils', 'Linen and fabric', 'Consumables', 'Books and charts', 'Other'];
export const UNITS = ['pcs', 'sets', 'pairs', 'boxes', 'packets', 'kg', 'litres', 'metres', 'rolls'];

export interface InventoryItem {
  id: string;
  name: string;
  category: string;
  quantity: number;
  unit: string;
  condition: InventoryCondition;
  location: string;
  /** Serial or asset tag number. */
  tag: string;
  remarks: string;
  /** The id of the item's photo (inventoryPhotos), kept from count to count. */
  photo?: string | null;
}

export type InventoryStatus = 'open' | 'submitted' | 'verified';

export interface InventoryReopen { reason: string; byName: string; grantedByName: string; until: string; at: string }

export interface InventoryCount {
  orgId: string;
  cohort: string;
  courseId: string;
  courseName: string;
  phase: InventoryPhase;
  /** The last day, "YYYY-MM-DD"; the form closes at the end of it, Nairobi time. */
  deadline: string;
  status: InventoryStatus;
  items: InventoryItem[];
  preparedByName?: string;
  signedName?: string;
  /** The person asks Admin to reopen the closed form. */
  reopenRequest?: { reason: string; byName: string } | null;
  /** The last day the reopened form stays open, "YYYY-MM-DD". */
  reopenUntil?: string | null;
  reopens?: InventoryReopen[];
  verifiedByName?: string | null;
  verifyNote?: string | null;
  returnNote?: string | null;
  remindedOn?: string | null;
}

export const MAX_ITEMS = 400;

/** One count per department, cohort and phase. */
export const inventoryCountId = (cohort: string, courseId: string, phase: InventoryPhase) => `${cohortKey(cohort)}_${courseId}_${phase}`;

const addDays = (key: string, days: number) => {
  const d = new Date(`${key}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
};
/** Whole days from one "YYYY-MM-DD" to another. */
export const daysBetween = (from: string, to: string) => Math.round((Date.parse(`${to}T12:00:00Z`) - Date.parse(`${from}T12:00:00Z`)) / 86_400_000);

/**
 * The usual deadline when Admin opens a count (Andy, 2026-10-29, 6A and B): two weeks after the cohort starts, and
 * a week before graduation. Admin can change it. Without the dates it is two weeks from today.
 */
export function defaultDeadline(phase: InventoryPhase, today: string, cohortStart?: string | null, graduation?: string | null): string {
  const auto = phase === 'start' ? (cohortStart ? addDays(cohortStart, 14) : null) : (graduation ? addDays(graduation, -7) : null);
  return auto && auto >= today ? auto : addDays(today, 14);
}

/** The moment a "YYYY-MM-DD" day ends in Nairobi. */
export const endOfDay = (key: string) => {
  const [y, m, d] = key.split('-').map(Number);
  return new Date(zonedMidnight(y!, m!, d!).getTime() + 86_400_000 - 1000);
};

/** The form is open until the deadline, or until the day Admin reopened it to (Andy, 2026-10-29, 8A). */
export function canEditCount(c: Pick<InventoryCount, 'status' | 'deadline' | 'reopenUntil'>, today: string): boolean {
  return c.status === 'open' && (today <= c.deadline || (!!c.reopenUntil && today <= c.reopenUntil));
}

/** Days left to the deadline: 0 on the day, negative once it has passed. */
export const daysLeft = (deadline: string, today: string) => daysBetween(today, deadline);

/** Days late, counted from the deadline to the day it was sent (0 when on time). */
export const lateDays = (deadline: string, submittedOn: string) => Math.max(0, daysBetween(deadline, submittedOn));

export function countdownText(deadline: string, today: string): string {
  const n = daysLeft(deadline, today);
  if (n > 1) return `due in ${n} days`;
  if (n === 1) return 'due tomorrow';
  if (n === 0) return 'due today';
  return `closed ${-n === 1 ? 'yesterday' : `${-n} days ago`}`;
}

/** The countdown and daily emails run for the last five days (Andy, 2026-10-29, 7A). */
export const REMINDER_DAYS = 5;
export const needsReminder = (c: Pick<InventoryCount, 'status' | 'deadline' | 'remindedOn'>, today: string) =>
  c.status === 'open' && daysLeft(c.deadline, today) >= 0 && daysLeft(c.deadline, today) <= REMINDER_DAYS && c.remindedOn !== today;

/** What the form says about lateness, printed for Admin (Andy, 2026-10-29). */
export function lateNote(c: Pick<InventoryCount, 'deadline' | 'reopens'>, submittedOn: string | null): string {
  const late = submittedOn ? lateDays(c.deadline, submittedOn) : 0;
  if (!late) return '';
  const parts = [`Submitted late by ${late} ${late === 1 ? 'day' : 'days'} (deadline ${formatDateKey(c.deadline)}).`];
  for (const r of c.reopens ?? []) parts.push(`Reopened by ${r.grantedByName} on ${formatDateKey(r.at)} until ${formatDateKey(r.until)}${r.reason ? `. Reason given: ${r.reason}` : ''}.`);
  return parts.join(' ');
}

const norm = (s: string) => s.trim().replace(/\s+/g, ' ').toLowerCase();
const itemKey = (i: InventoryItem) => (i.tag.trim() ? `tag:${norm(i.tag)}` : `name:${norm(i.name)}`);

export interface InventoryChange { name: string; tag: string; was: string; now: string }
export interface InventoryComparison { missing: InventoryChange[]; worse: InventoryChange[]; fewer: InventoryChange[]; more: InventoryChange[]; added: InventoryChange[] }

/** What changed between the start of a cohort and its end: missing, damaged, fewer or more, and new items. */
export function compareCounts(start: InventoryItem[], end: InventoryItem[]): InventoryComparison {
  const out: InventoryComparison = { missing: [], worse: [], fewer: [], more: [], added: [] };
  const was = new Map(start.map((i) => [itemKey(i), i]));
  const seen = new Set<string>();
  const qty = (i: InventoryItem) => `${i.quantity} ${i.unit}`.trim();
  for (const e of end) {
    const k = itemKey(e);
    const s = was.get(k) ?? (e.tag.trim() ? was.get(`name:${norm(e.name)}`) : undefined);
    if (!s) { out.added.push({ name: e.name, tag: e.tag, was: '', now: qty(e) }); continue; }
    seen.add(itemKey(s));
    const row = { name: e.name, tag: e.tag || s.tag };
    if (e.condition === 'missing' || e.quantity === 0) { out.missing.push({ ...row, was: qty(s), now: e.condition === 'missing' ? 'Missing' : qty(e) }); continue; }
    if (CONDITION_RANK[e.condition] > CONDITION_RANK[s.condition]) out.worse.push({ ...row, was: CONDITION_LABELS[s.condition], now: CONDITION_LABELS[e.condition] });
    if (e.quantity < s.quantity) out.fewer.push({ ...row, was: qty(s), now: qty(e) });
    else if (e.quantity > s.quantity) out.more.push({ ...row, was: qty(s), now: qty(e) });
  }
  for (const s of start) if (!seen.has(itemKey(s)) && s.condition !== 'missing') out.missing.push({ name: s.name, tag: s.tag, was: qty(s), now: 'Not on the list' });
  return out;
}

export const conditionCounts = (items: InventoryItem[]) =>
  Object.fromEntries(CONDITIONS.map((c) => [c, items.filter((i) => i.condition === c).length])) as Record<InventoryCondition, number>;

// ---- Excel and CSV upload ----------------------------------------------------

type Cell = string | number | Date | null | undefined;
const FIELD_WORDS: Record<keyof Omit<InventoryItem, 'id' | 'photo'>, RegExp> = {
  name: /^(description( item)?|item( description| name)?|name|asset|equipment|description of item)$/,
  category: /^(category|type|class)$/,
  quantity: /^(qty|quantity|no\.?|number|count|amount)$/,
  unit: /^(unit|units|uom|unit of measure)$/,
  condition: /^(condition|state|status)( \(good\/fair\/poor\))?$/,
  location: /^(location|room|place|store|lab)$/,
  tag: /^(serial|tag|serial\/tag( no\.?)?|serial( no\.?| number)?|tag( no\.?| number)?|asset (tag|no\.?|number))$/,
  remarks: /^(remarks?|notes?|comments?)$/,
};
export const INVENTORY_TEMPLATE_HEAD = ['Item', 'Category', 'Quantity', 'Unit', 'Condition', 'Location', 'Serial/Tag No.', 'Remarks'];

export function conditionFrom(v: Cell): InventoryCondition {
  const s = String(v ?? '').trim().toLowerCase();
  if (/^(fair|ok|average)/.test(s)) return 'fair';
  if (/^(poor|bad|worn)/.test(s)) return 'poor';
  if (/^(broken|damaged|faulty|not working|spoilt|spoiled)/.test(s)) return 'broken';
  if (/^(missing|lost|stolen)/.test(s)) return 'missing';
  return 'good';
}

/**
 * Items from an uploaded sheet: finds the header row (within the first 15 rows) by its column names, the way
 * the paper form or a typed list names them, and reads each row with an item name.
 */
export function itemsFromSheet(rows: readonly (readonly Cell[])[], newId: () => string): { items: InventoryItem[]; skipped: number } | null {
  for (let r = 0; r < Math.min(rows.length, 15); r++) {
    const cols: Partial<Record<keyof typeof FIELD_WORDS, number>> = {};
    rows[r]!.forEach((cell, i) => {
      const t = String(cell ?? '').trim().toLowerCase().replace(/\s+/g, ' ').replace(/:$/, '');
      for (const [f, re] of Object.entries(FIELD_WORDS) as [keyof typeof FIELD_WORDS, RegExp][]) if (cols[f] == null && re.test(t)) { cols[f] = i; break; }
    });
    if (cols.name == null) continue;
    const items: InventoryItem[] = [];
    let skipped = 0;
    for (const row of rows.slice(r + 1)) {
      const get = (f: keyof typeof FIELD_WORDS) => (cols[f] == null ? '' : String(row[cols[f]!] ?? '').trim());
      const name = get('name').replace(/\s+/g, ' ');
      if (!name) { if (row.some((c) => String(c ?? '').trim())) skipped++; continue; }
      const q = Number(String(cols.quantity == null ? '1' : row[cols.quantity] ?? '').replace(/[^0-9.]/g, ''));
      items.push({
        id: newId(), name: name.slice(0, 120), category: get('category').slice(0, 60), quantity: Number.isFinite(q) && q >= 0 ? Math.round(q * 100) / 100 : 0,
        unit: (get('unit') || 'pcs').slice(0, 20), condition: conditionFrom(get('condition')), location: get('location').slice(0, 80),
        tag: get('tag').slice(0, 60), remarks: get('remarks').slice(0, 300), photo: null,
      });
      if (items.length >= MAX_ITEMS) break;
    }
    return { items, skipped };
  }
  return null;
}

/** A clean copy of last count's items for the next count: same items, nothing carried over in Remarks. */
export const carryForward = (items: InventoryItem[]): InventoryItem[] => items.filter((i) => i.condition !== 'missing').map((i) => ({ ...i, remarks: '' }));

// ---- Reminder email ------------------------------------------------------------

export function reminderSubject(c: Pick<InventoryCount, 'courseName' | 'phase' | 'cohort' | 'deadline'>, today: string) {
  return `Inventory ${countdownText(c.deadline, today)}: ${c.courseName}, ${phaseTitle(c.phase, c.cohort)}`;
}
export function reminderText(c: Pick<InventoryCount, 'courseName' | 'phase' | 'cohort' | 'deadline' | 'items'>, today: string, name: string, link: string) {
  const n = daysLeft(c.deadline, today);
  return [
    `Dear ${name},`,
    '',
    `The ${c.courseName} inventory for the ${phaseTitle(c.phase, c.cohort).toLowerCase()} is ${countdownText(c.deadline, today)} (${formatDateKey(c.deadline)}).`,
    `${c.items.length} ${c.items.length === 1 ? 'item is' : 'items are'} on the form so far.`,
    n === 0
      ? 'Please submit it to Admin today. After today the form closes and needs Admin\'s permission to reopen, and the late submission is printed on the form.'
      : 'Please count, fill it in and submit it to Admin before the deadline. After the deadline the form closes and needs Admin\'s permission to reopen.',
    '',
    `Open it here: ${link}`,
    '',
    'ADIA Training Centre',
  ].join('\n');
}
