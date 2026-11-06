import { db } from './common.js';
import { classOf } from './shared/hopeClasses.js';
import { localDateKey } from './shared/datetime.js';
import { STORY_CHILDREN_MAX, type StoryChild } from './shared/hopePhotos.js';

/** The children named in a message (2A), checked and kept as they are today: name, HC code and class. */
export async function childrenOf(orgId: string, ids: unknown): Promise<StoryChild[]> {
  const list = [...new Set(Array.isArray(ids) ? ids.filter((x): x is string => typeof x === 'string' && /^[\w-]{1,120}$/.test(x)) : [])].slice(0, STORY_CHILDREN_MAX);
  if (!list.length) return [];
  const today = localDateKey();
  const out: StoryChild[] = [];
  for (const cid of list) {
    const [c, p] = await Promise.all([db.doc(`organizations/${orgId}/children/${cid}`).get(), db.doc(`organizations/${orgId}/people/${cid}`).get()]);
    if (!c.exists || c.data()?.deletedAt) continue;
    const person = p.data() ?? {};
    out.push({ id: cid, name: String(person.fullName ?? 'Child'), code: String(c.data()?.code ?? ''), className: classOf(person.dateOfBirth as string | null, today)?.name ?? '' });
  }
  return out;
}
