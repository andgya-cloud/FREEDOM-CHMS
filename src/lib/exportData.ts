import { collection, getDocs, query, where, getDoc, doc, type DocumentData } from 'firebase/firestore';
import { db } from '../firebase';
import { FINANCIAL_PERSON_COLLECTIONS, ORG_COLLECTIONS, PERSON_COLLECTIONS, toPlain } from '../../functions/src/shared/dataset';
import { downloadFile } from './givingPdf';

type Row = { id: string } & Record<string, unknown>;

const rows = (docs: { id: string; data: () => DocumentData }[]): Row[] => docs.map((d) => ({ id: d.id, ...(toPlain(d.data()) as object) }));

/** Reads one organization's collections. A collection this account cannot read is listed, not hidden. */
export async function readOrganization(orgId: string): Promise<{ collections: Record<string, Row[]>; skipped: string[] }> {
  const out: Record<string, Row[]> = {};
  const skipped: string[] = [];
  for (const name of ORG_COLLECTIONS) {
    // Receipt counters are kept by the server only; the weekly backup holds them.
    if (name === 'counters') continue;
    try {
      out[name] = rows((await getDocs(collection(db, 'organizations', orgId, name))).docs);
    } catch {
      skipped.push(name);
    }
  }
  return { collections: out, skipped };
}

/** Everything held about one person in one organization. */
export async function readPerson(orgId: string, personId: string): Promise<Record<string, unknown>> {
  const person = await getDoc(doc(db, 'organizations', orgId, 'people', personId));
  const out: Record<string, unknown> = { person: person.exists() ? { id: person.id, ...(toPlain(person.data()) as object) } : null };
  for (const name of [...PERSON_COLLECTIONS, ...FINANCIAL_PERSON_COLLECTIONS]) {
    try {
      out[name] = rows((await getDocs(query(collection(db, 'organizations', orgId, name), where('personId', '==', personId)))).docs);
    } catch {
      out[name] = 'not available to this account';
    }
  }
  return out;
}

export function downloadJson(name: string, data: unknown) {
  downloadFile(new File([JSON.stringify(data, null, 2)], name, { type: 'application/json' }));
}

export function safeName(text: string): string {
  return text.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'export';
}
