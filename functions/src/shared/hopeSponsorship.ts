/**
 * The sponsorship list (Andy, 2026-11-05): the monthly "Child Registration List" from the sponsoring partner (KE-014
 * Freedom Shujaa Hope Center). Each child's partner Child ID, sponsorship status, sponsor and dates are kept on their
 * profile. A row is matched to a child by the HC code in the sheet, or by the Child ID kept from an earlier list.
 * Empty profile fields (date of birth, joined on, sponsor, gender) are filled from the list; filled ones are kept.
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
  /** The partner's Child ID, such as C467370. */
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
}

export const isSponsored = (s: ChildSponsorship | null | undefined) => !!s && /^sponsored/i.test(s.status);

export interface SponsorChild { id: string; code: string; sponsorChildId: string; dateOfBirth: string | null; enrolledOn: string | null; sponsorName: string; gender: string; name: string }
export interface SponsorRowPlan {
  line: number;
  childId: string;
  code: string;
  name: string;
  sponsorship: ChildSponsorship;
  /** Empty profile fields the list fills. */
  fill: { dateOfBirth?: string; enrolledOn?: string; sponsorName?: string; gender?: string };
  /** Differences worth a look (kept as they are). */
  differs: string[];
  /** Sponsorship changes since the last list. */
  changed: boolean;
}
export interface SponsorPlan { centre: string; rows: SponsorRowPlan[]; notFound: { line: number; partnerId: string; name: string }[]; notOnList: { id: string; code: string; name: string }[] }

/** Reads the list. Returns null when the sheet has no "Child ID" column. */
export function planSponsorUpdate(rows: readonly (readonly Cell[])[], children: readonly SponsorChild[], today: string, existing: Record<string, ChildSponsorship | null | undefined> = {}): SponsorPlan | null {
  const at = rows.findIndex((r) => r.some((c) => key(c) === 'childid'));
  if (at < 0) return null;
  const col: Record<string, number> = {};
  rows[at]!.forEach((c, i) => { const k = key(c); if (k && col[k] == null) col[k] = i; });
  const get = (r: readonly Cell[], ...names: string[]) => { for (const n of names) if (col[n] != null) return r[col[n]!]; return undefined; };
  const centreRow = rows.slice(0, at).map((r) => r.map(clean).find((t) => /^KE-\d+/i.test(t))).find(Boolean) ?? '';
  const byCode = new Map(children.map((c) => [c.code, c]));
  const byPartner = new Map(children.filter((c) => c.sponsorChildId).map((c) => [c.sponsorChildId, c]));
  const used = new Set<string>();
  const out: SponsorPlan = { centre: centreRow, rows: [], notFound: [], notOnList: [] };
  rows.slice(at + 1).forEach((r, i) => {
    const partnerId = clean(get(r, 'childid')).toUpperCase();
    if (!/^C\d+$/.test(partnerId)) return;
    const line = at + 2 + i;
    const name = clean(get(r, 'childname', 'name'));
    const code = normalizeCode(clean(get(r, 'code', 'hccode')));
    const child = (code && byCode.get(code)) || byPartner.get(partnerId);
    if (!child || used.has(child.id)) { out.notFound.push({ line, partnerId, name }); return; }
    used.add(child.id);
    const s: ChildSponsorship = {
      childId: partnerId, status: clean(get(r, 'sponsorshipstatus', 'status')).slice(0, 80), sponsorId: clean(get(r, 'sponsorid')).slice(0, 30),
      sponsorName: clean(get(r, 'sponsorname')).slice(0, 120), registeredOn: dateOf(get(r, 'registrationdate')), completesOn: dateOf(get(r, 'progcompletiondate', 'programmecompletiondate')),
      centre: centreRow.slice(0, 120), updatedOn: today,
    };
    const dob = dateOf(get(r, 'dateofbirth'));
    const gender = clean(get(r, 'gender'));
    const fill: SponsorRowPlan['fill'] = {};
    const differs: string[] = [];
    if (dob) { if (!child.dateOfBirth) fill.dateOfBirth = dob; else if (child.dateOfBirth !== dob) differs.push(`date of birth ${child.dateOfBirth} here, ${dob} on the list`); }
    if (s.registeredOn && !child.enrolledOn) fill.enrolledOn = s.registeredOn;
    if (s.sponsorName && !child.sponsorName) fill.sponsorName = s.sponsorName;
    else if (s.sponsorName && child.sponsorName && child.sponsorName.toLowerCase() !== s.sponsorName.toLowerCase()) differs.push(`sponsor "${child.sponsorName}" here, "${s.sponsorName}" on the list`);
    if (/^(male|female)$/i.test(gender)) { if (!child.gender) fill.gender = gender[0]!.toUpperCase() + gender.slice(1).toLowerCase(); else if (child.gender.toLowerCase() !== gender.toLowerCase()) differs.push(`${child.gender} here, ${gender} on the list`); }
    const before = existing[child.id];
    const changed = !before || before.status !== s.status || before.sponsorId !== s.sponsorId || before.sponsorName !== s.sponsorName || before.completesOn !== s.completesOn || before.childId !== s.childId;
    out.rows.push({ line, childId: child.id, code: child.code, name: child.name, sponsorship: s, fill, differs, changed });
  });
  out.notOnList = children.filter((c) => !used.has(c.id)).map((c) => ({ id: c.id, code: c.code, name: c.name }));
  return out;
}
