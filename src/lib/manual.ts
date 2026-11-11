import { MANUAL_TOPICS, type ManualPartKey, type ManualTopic } from './manualData';

/** The manual part for an organisation's type. */
export function manualPartFor(type: string | undefined): ManualPartKey {
  return type === 'college' ? 'adia' : type === 'ministry' ? 'hope' : 'church';
}

const matches = (pattern: string, path: string) => {
  const a = pattern.split('/');
  const b = path.replace(/\/+$/, '').split('/');
  if (pattern === '/') return path === '/' || path === '';
  return a.length === b.length && a.every((s, i) => s === '*' || s === b[i]);
};

/** The manual page about the page someone is on, for "Just ask Andy". Their own place first. */
export function manualTopicForPath(path: string, orgType: string | undefined, keeper: boolean): ManualTopic | null {
  const here = manualPartFor(orgType);
  const rank: ManualPartKey[] = [here, 'shared', ...(keeper ? (['admin'] as const) : []), 'start'];
  const hits = MANUAL_TOPICS.filter((t) => t.path && rank.includes(t.part) && matches(t.path, path));
  hits.sort((x, y) => rank.indexOf(x.part) - rank.indexOf(y.part));
  return hits[0] ?? null;
}
