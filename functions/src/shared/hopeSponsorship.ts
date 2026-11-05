/**
 * The sponsorship list (Andy, 2026-11-05): the monthly "Child Registration List" from the sponsoring partner (KE-014
 * Freedom Shujaa Hope Center). Each child's partner Child ID, sponsorship status, sponsor and dates are kept on their
 * profile. A row is matched by the HC code in the sheet, the Child ID kept from an earlier list, or by name and birth
 * date (1A). The list is right for birth date, gender, registration date and sponsor (2A, 4A); our names are kept (3A).
 */
import { normalizeCode } from './hope.js';

type Cell = string | number | Date | null | undefined;
const clean = (v: Cell) => (v instanceof Date ? v.toISOString().slice(0, 10) : v == null ? '' : String(v)).replace(/\s+/g, ' ').trim();
const key = (v: Cell) => clean(v).toLowerCase().replace(/[^a-z]/g, '');
const dateOf = (v: Cell): string | null => {
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? null : v.toISOString().slice(0, 10);
  const s = clean(v);
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})/.exec(s);
  return m ? `${m[3]}-${m[2]!.padStart(2, '0')}-${m[1]!.padStart(2, '0')}` : null;
};

/** On the child: what the sponsorship list says. */
export interface ChildSponsorship {
  /** The partner's Child ID, such as C467370; empty for a child not on the list. */
  childId: string;
  status: string;
  sponsorId: string;
  sponsorName: string;
  registeredOn: string | null;
  completesOn: string | null;
  /** The centre's line on the list, such as "KE-014 Freedom Shujaa Hope Center". */
  centre: string;
  /** The day the list was uploaded. */
  updatedOn: string;
  /** The child's name as the list spells it (Andy, 2026-11-05, 3A: our names are kept). */
  listName?: string;
}

/** The status kept on a child who is not on the list (5A). */
export const NOT_ON_LIST = 'Not on KE-014';
export const isSponsored = (s: ChildSponsorship | null | undefined) => !!s && /^sponsored/i.test(s.status);
export const notOnList = (s: ChildSponsorship | null | undefined) => !!s && s.status === NOT_ON_LIST;

export interface SponsorChild { id: string; code: string; sponsorChildId: string; dateOfBirth: string | null; enrolledOn: string | null; sponsorName: string; gender: string; name: string }
export interface SponsorRowPlan {
  line: number;
  childId: string;
  code: string;
  name: string;
  /** How the row was matched: by the HC code, the Child ID kept from before, name and birth date, or picked by hand. */
  how: 'code' | 'id' | 'name' | 'picked';
  sponsorship: ChildSponsorship;
  /** What the list sets on the profile (Andy 2A, 4A: the list is right). */
  fill: { dateOfBirth?: string; enrolledOn?: string; sponsorName?: string; gender?: string };
  /** What changes on a field that already had something: "birth date 2017-03-01 → 2017-03-02". */
  differs: string[];
  /** Sponsorship changes since the last list. */
  changed: boolean;
}
export interface SponsorCandidate { id: string; code: string; name: string; dateOfBirth: string | null }
export interface SponsorUnsure { line: number; partnerId: string; name: string; dateOfBirth: string | null; candidates: SponsorCandidate[] }
export interface SponsorPlan {
  centre: string;
  rows: SponsorRowPlan[];
  /** Rows matched to nobody, even by hand. */
  notFound: { line: number; partnerId: string; name: string }[];
  /** Rows the app is not sure of: pick the child (1A). */
  unsure: SponsorUnsure[];
  notOnList: { id: string; code: string; name: string }[];
}

// ---- Matching by name and birth date (Andy, 2026-11-05, 1A) ----------------------------------------
const words = (n: string) => n.toLowerCase().replace(/[^a-z]+/g, ' ').split(' ').filter((w) => w.length > 1);
function ratio(a: string, b: string): number {
  if (a === b) return 1;
  const m = a.length, n = b.length;
  if (!m || !n) return 0;
  let prev = Array.from({ length: n + 1 }, (_, j) => j);
  for (let i = 1; i <= m; i++) {
    const cur = [i];
    for (let j = 1; j <= n; j++) cur[j] = Math.min(prev[j]! + 1, cur[j - 1]! + 1, prev[j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1));
    prev = cur;
  }
  return 1 - prev[n]! / Math.max(m, n);
}
/** How many of the list's name words match a word of the child's name, in any order (names are often reversed). */
function nameMatches(listName: string, childName: string): number {
  const a = words(listName), b = words(childName);
  return a.filter((w) => b.some((x) => ratio(w, x) >= 0.8)).length;
}
function score(listName: string, dob: string | null, c: SponsorChild): { score: number; names: number; sameBirth: boolean } {
  const names = nameMatches(listName, c.name);
  const sameBirth = !!dob && dob === c.dateOfBirth;
  return { score: names * 2 + (sameBirth ? 3 : 0), names, sameBirth };
}

/**
 * Reads the list. Returns null when the sheet has no "Child ID" column. A row is matched by its HC code, then by
 * the Child ID kept from an earlier list, then by name and birth date; rows it is not sure of are listed to pick
 * by hand (`picks`: Child ID → child id, or '' for "none of these").
 */
export function planSponsorUpdate(rows: readonly (readonly Cell[])[], children: readonly SponsorChild[], today: string,
  existing: Record<string, ChildSponsorship | null | undefined> = {}, picks: Record<string, string> = {}): SponsorPlan | null {
  const at = rows.findIndex((r) => r.some((c) => key(c) === 'childid'));
  if (at < 0) return null;
  const col: Record<string, number> = {};
  rows[at]!.forEach((c, i) => { const k = key(c); if (k && col[k] == null) col[k] = i; });
  const get = (r: readonly Cell[], ...names: string[]) => { for (const n of names) if (col[n] != null) return r[col[n]!]; return undefined; };
  const centreRow = rows.slice(0, at).map((r) => r.map(clean).find((t) => /^KE-\d+/i.test(t))).find(Boolean) ?? '';
  const byCode = new Map(children.map((c) => [c.code, c]));
  const byPartner = new Map(children.filter((c) => c.sponsorChildId).map((c) => [c.sponsorChildId, c]));
  const byId = new Map(children.map((c) => [c.id, c]));
  const used = new Set<string>();
  const out: SponsorPlan = { centre: centreRow, rows: [], notFound: [], unsure: [], notOnList: [] };

  type Row = { line: number; partnerId: string; name: string; dob: string | null; r: readonly Cell[] };
  const list: Row[] = [];
  rows.slice(at + 1).forEach((r, i) => {
    const partnerId = clean(get(r, 'childid')).toUpperCase();
    if (!/^C\d+$/.test(partnerId)) return;
    list.push({ line: at + 2 + i, partnerId, name: clean(get(r, 'childname', 'name')), dob: dateOf(get(r, 'dateofbirth')), r });
  });
  const matched = new Map<string, { child: SponsorChild; how: SponsorRowPlan['how'] }>();
  const take = (row: Row, child: SponsorChild | undefined, how: SponsorRowPlan['how']) => {
    if (!child || used.has(child.id) || matched.has(row.partnerId)) return false;
    used.add(child.id); matched.set(row.partnerId, { child, how }); return true;
  };
  // 1. By the HC code in the sheet, the Child ID kept from before, or a pick by hand.
  for (const row of list) {
    const code = normalizeCode(clean(get(row.r, 'code', 'hccode')));
    if (picks[row.partnerId] !== undefined) { if (picks[row.partnerId]) take(row, byId.get(picks[row.partnerId]!), 'picked'); continue; }
    if (!take(row, code ? byCode.get(code) : undefined, 'code')) take(row, byPartner.get(row.partnerId), 'id');
  }
  // 2. By name and birth date, surest first; a match must stand clear of the next best.
  const left = list.filter((row) => !matched.has(row.partnerId) && picks[row.partnerId] === undefined);
  const tries = left.map((row) => {
    const ranked = children.filter((c) => !used.has(c.id)).map((c) => ({ c, ...score(row.name, row.dob, c) })).sort((a, b) => b.score - a.score);
    return { row, ranked };
  });
  const sure = tries.filter(({ ranked }) => {
    const [a, b] = ranked;
    if (!a) return false;
    const strong = (a.sameBirth && a.names >= 1) || a.names >= 3 || (a.names >= 2 && !a.c.dateOfBirth);
    return strong && (!b || a.score - b.score >= 2);
  }).sort((x, y) => y.ranked[0]!.score - x.ranked[0]!.score);
  for (const { row, ranked } of sure) take(row, ranked[0]!.c, 'name');
  for (const { row } of tries) {
    if (matched.has(row.partnerId)) continue;
    const candidates = children.filter((c) => !used.has(c.id)).map((c) => ({ c, ...score(row.name, row.dob, c) }))
      .filter((x) => x.names >= 1 || x.sameBirth).sort((a, b) => b.score - a.score).slice(0, 4)
      .map(({ c }) => ({ id: c.id, code: c.code, name: c.name, dateOfBirth: c.dateOfBirth }));
    if (candidates.length) out.unsure.push({ line: row.line, partnerId: row.partnerId, name: row.name, dateOfBirth: row.dob, candidates });
    else out.notFound.push({ line: row.line, partnerId: row.partnerId, name: row.name });
  }
  for (const row of list) if (picks[row.partnerId] === '') out.notFound.push({ line: row.line, partnerId: row.partnerId, name: row.name });

  // 3. What each matched row sets on the profile.
  for (const row of list) {
    const m = matched.get(row.partnerId);
    if (!m) continue;
    const { child, how } = m;
    const r = row.r;
    const s: ChildSponsorship = {
      childId: row.partnerId, status: clean(get(r, 'sponsorshipstatus', 'status')).slice(0, 80), sponsorId: clean(get(r, 'sponsorid')).slice(0, 30),
      sponsorName: clean(get(r, 'sponsorname')).slice(0, 120), registeredOn: dateOf(get(r, 'registrationdate')), completesOn: dateOf(get(r, 'progcompletiondate', 'programmecompletiondate')),
      centre: centreRow.slice(0, 120), updatedOn: today, listName: row.name.slice(0, 120),
    };
    const gender = clean(get(r, 'gender'));
    const fill: SponsorRowPlan['fill'] = {};
    const differs: string[] = [];
    if (row.dob && row.dob !== child.dateOfBirth) { fill.dateOfBirth = row.dob; if (child.dateOfBirth) differs.push(`birth date ${child.dateOfBirth} → ${row.dob}`); }
    if (s.registeredOn && s.registeredOn !== child.enrolledOn) { fill.enrolledOn = s.registeredOn; if (child.enrolledOn) differs.push(`registration date ${child.enrolledOn} → ${s.registeredOn}`); }
    if (s.sponsorName && s.sponsorName.toLowerCase() !== child.sponsorName.toLowerCase()) { fill.sponsorName = s.sponsorName; if (child.sponsorName) differs.push(`sponsor "${child.sponsorName}" → "${s.sponsorName}"`); }
    if (/^(male|female)$/i.test(gender)) {
      const g = gender[0]!.toUpperCase() + gender.slice(1).toLowerCase();
      if (g.toLowerCase() !== child.gender.toLowerCase()) { fill.gender = g; if (child.gender) differs.push(`${child.gender} → ${g}`); }
    }
    const before = existing[child.id];
    const changed = !before || before.status !== s.status || before.sponsorId !== s.sponsorId || before.sponsorName !== s.sponsorName || before.completesOn !== s.completesOn || before.childId !== s.childId;
    out.rows.push({ line: row.line, childId: child.id, code: child.code, name: child.name, how, sponsorship: s, fill, differs, changed });
  }
  const waiting = new Set(out.unsure.flatMap((u) => u.candidates.map((c) => c.id)));
  out.notOnList = children.filter((c) => !used.has(c.id) && !waiting.has(c.id)).map((c) => ({ id: c.id, code: c.code, name: c.name }));
  return out;
}

/** What a child not on the list keeps (5A), so the profile and the Show filter say so. */
export function notOnListSponsorship(centre: string, today: string): ChildSponsorship {
  return { childId: '', status: NOT_ON_LIST, sponsorId: '', sponsorName: '', registeredOn: null, completesOn: null, centre: centre.slice(0, 120), updatedOn: today };
}
