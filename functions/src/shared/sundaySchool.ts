/**
 * Freedom Church Sunday school (Andy, 2026-11-23, 1A-9A). Dorothy Mohart (the leader), Andy and Doreen type the
 * classes and their ages (2A). Each teacher has one class (9A) and counts it on their phone on the day; the classes
 * add up into the service's Children (1A). After the service each teacher sends a short class report (8A).
 */
/** A class, its ages and its class leader (Andy, 2026-11-23). */
export interface SsClass { id: string; name: string; ages: string; leader: string }
export const SS_MAX_CLASSES = 20;
/** Dorothy's place in the class dropdown: the head of Sunday school sees every class (Andy, 2026-11-23). */
export const SS_HEAD_CLASS = 'all';
export const SS_HEAD_LABEL = 'Head of Sunday school';

/** Freedom Church's classes and leaders as Andy gave them (2026-11-23); used until Dorothy changes the list. */
export const DEFAULT_SS_CLASSES: SsClass[] = [
  { id: 'age-3-5', name: '3-5 years', ages: '3-5', leader: 'Christine' },
  { id: 'age-6-8', name: '6-8 years', ages: '6-8', leader: 'Justina' },
  { id: 'age-9-10', name: '9-10 years', ages: '9-10', leader: 'Regina' },
  { id: 'age-11-12', name: '11-12 years', ages: '11-12', leader: 'Lucy' },
  { id: 'teens', name: 'Teens', ages: '13-19', leader: 'David' },
];

/** The Teens class counts into the service's Teens; every other class into Children. */
export const isTeensClass = (c: Pick<SsClass, 'id' | 'name'>) => c.id === 'teens' || /\bteen/i.test(c.name);

const slug = (t: string) => t.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 30) || 'class';
const clean = (v: unknown, max: number) => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim().slice(0, max) : '');

/** The class list as typed: names kept, empty rows dropped, each with a lasting id (a renamed class keeps its id). */
export function cleanClasses(input: unknown): SsClass[] {
  const rows = Array.isArray(input) ? input.slice(0, SS_MAX_CLASSES) : [];
  const out: SsClass[] = [];
  const ids = new Set<string>();
  for (const r of rows) {
    const o = (r ?? {}) as Record<string, unknown>;
    const name = clean(o.name, 40);
    if (!name) continue;
    let id = typeof o.id === 'string' && /^[a-z0-9-]{1,40}$/.test(o.id) ? o.id : slug(name);
    for (let i = 2; ids.has(id); i++) id = `${slug(name)}-${i}`;
    ids.add(id);
    out.push({ id, name, ages: clean(o.ages, 30), leader: clean(o.leader, 60) });
  }
  return out;
}

/** "Juniors (6-9)". */
export const ssClassLabel = (c: Pick<SsClass, 'name' | 'ages'>) => (c.ages && !c.name.includes(c.ages) ? `${c.name} (${c.ages})` : c.name);
/** "3-5 years · Christine". */
export const ssClassWithLeader = (c: Pick<SsClass, 'name' | 'ages' | 'leader'>) => `${ssClassLabel(c)}${c.leader ? ` · ${c.leader}` : ''}`;

export type ClassCounts = Record<string, { name: string; count: number; teacher: string }>;
/** Children = every class added up (1A). */
export const classesTotal = (classes: ClassCounts | undefined) => Object.values(classes ?? {}).reduce((s, c) => s + (Number(c.count) || 0), 0);
/** What the classes put into the service: Children from the children's classes, Teens from the Teens class. */
export function classHeadcounts(classes: ClassCounts | undefined): { children: number; teens: number | null } {
  let children = 0; let teens: number | null = null;
  for (const [id, c] of Object.entries(classes ?? {})) {
    if (isTeensClass({ id, name: c.name })) teens = (teens ?? 0) + (Number(c.count) || 0);
    else children += Number(c.count) || 0;
  }
  return { children, teens };
}

/** The class report form (8A). */
export interface ClassReport { present: number; lesson: string; win: string; need: string }
export function cleanClassReport(v: unknown): ClassReport {
  const o = (v ?? {}) as Record<string, unknown>;
  const n = Math.floor(Number(o.present));
  return { present: Number.isFinite(n) && n > 0 ? Math.min(n, 2000) : 0, lesson: clean(o.lesson, 300), win: clean(o.win, 600), need: clean(o.need, 600) };
}
export function classReportText(r: ClassReport): string {
  return [`Children present: ${r.present}`, r.lesson && `Lesson: ${r.lesson}`, r.win && `Win: ${r.win}`, r.need && `Need: ${r.need}`].filter(Boolean).join('\n');
}

/** The leader's Sunday summary (8A): one line per class, with the classes that have not reported. */
export function ssSummaryLines(classes: SsClass[], counts: ClassCounts, reports: { classId: string; report: ClassReport; by: string }[]): string[] {
  const lines: string[] = [];
  for (const c of classes) {
    const r = reports.find((x) => x.classId === c.id);
    const n = r?.report.present || counts[c.id]?.count || 0;
    lines.push(`${ssClassLabel(c)}: ${n} children${r ? ` · ${r.by}` : ' · no class report yet'}`);
    if (r?.report.lesson) lines.push(`   Lesson: ${r.report.lesson}`);
    if (r?.report.win) lines.push(`   Win: ${r.report.win}`);
    if (r?.report.need) lines.push(`   Need: ${r.report.need}`);
  }
  lines.push(`Total in Sunday school: ${classes.reduce((s, c) => s + (reports.find((x) => x.classId === c.id)?.report.present || counts[c.id]?.count || 0), 0)}`);
  return lines;
}
