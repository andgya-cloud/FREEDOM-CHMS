import { attendanceIdFor, eventIdFor } from './attendance.js';
import { TRAINING_ORG_ID } from './organizations.js';

/**
 * Practice data for Training mode. Every name and number is made up: phone numbers use the
 * reserved +254 700 000 xxx range and nothing here is ever copied from a real record.
 */
const FIRST = ['Amani', 'Baraka', 'Chebet', 'Dalila', 'Eshe', 'Faraja', 'Gathoni', 'Halima', 'Imani', 'Jabari', 'Kamau', 'Lulu'];
const LAST = 'Sample';

export interface TrainingDoc { path: string; data: Record<string, unknown> }

export const TRAINING_ORG = {
  name: 'Practice Church (training)', type: 'church_campus', parentId: null, timeZone: 'Africa/Nairobi', currency: 'KES',
  receiptPrefix: 'PRC', serviceTimes: ['Sunday 10:00'], activities: [], active: true, training: true,
};

function sundays(today: string, count: number): string[] {
  const d = new Date(`${today}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - d.getUTCDay());
  const out: string[] = [];
  for (let i = 0; i < count; i++) {
    out.push(d.toISOString().slice(0, 10));
    d.setUTCDate(d.getUTCDate() - 7);
  }
  return out.reverse();
}

/** The people, services and check-ins a new trainee practises on. */
export function trainingDocs(today: string, stamp: (when: string) => unknown): TrainingDoc[] {
  const base = `organizations/${TRAINING_ORG_ID}`;
  const docs: TrainingDoc[] = [];
  const stamps = { deletedAt: null, deletedBy: null, createdBy: 'system', updatedBy: 'system' };
  const people = FIRST.map((first, i) => ({
    id: `sample${String(i + 1).padStart(2, '0')}`,
    first,
    phone: `+254700000${String(100 + i)}`,
    status: i < 3 ? 'visitor' : i < 8 ? 'regular' : 'member',
  }));
  for (const p of people) {
    docs.push({
      path: `${base}/people/${p.id}`,
      data: {
        orgId: TRAINING_ORG_ID, fullName: `${p.first} ${LAST}`, firstName: p.first, phone: p.phone, whatsapp: p.phone,
        whatsappConsent: { given: true, date: today, recordedBy: 'system', stoppedAt: null },
        email: null, status: p.status, firstVisitDate: p.status === 'visitor' ? today : null, gender: null,
        ...stamps, createdAt: stamp(today), updatedAt: stamp(today),
      },
    });
  }
  for (const date of sundays(today, 4)) {
    const name = 'Sunday Service';
    const eventId = eventIdFor(date, name);
    docs.push({
      path: `${base}/events/${eventId}`,
      data: { orgId: TRAINING_ORG_ID, date, type: 'service', name, activity: null, headcounts: { adults: 8, teens: 2, children: 3 }, notes: '', ...stamps, createdAt: stamp(date), updatedAt: stamp(date) },
    });
    people.slice(0, date === today ? 0 : 9).forEach((p) => {
      docs.push({
        path: `${base}/attendance/${attendanceIdFor(eventId, p.id)}`,
        data: { orgId: TRAINING_ORG_ID, eventId, personId: p.id, date, status: 'present', method: 'staff', checkedInAt: stamp(date), programId: null, groupId: null, ...stamps, createdAt: stamp(date), updatedAt: stamp(date) },
      });
    });
  }
  return docs;
}
