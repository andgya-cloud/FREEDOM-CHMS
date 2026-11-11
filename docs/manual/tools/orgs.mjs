import { initializeApp } from 'firebase-admin/app';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import { getAuth } from 'firebase-admin/auth';
initializeApp({ projectId: 'demo-freedom-chms' });
const db = getFirestore();
const u = (await getAuth().getUserByEmail('pastor@example.org')).uid;
const st = { createdAt: FieldValue.serverTimestamp(), createdBy: u, updatedAt: FieldValue.serverTimestamp(), updatedBy: u, deletedAt: null, deletedBy: null };
const orgs = {
  church: { name: 'Freedom Church Nairobi', type: 'church_campus', receiptPrefix: 'FCN', serviceTimes: ['Sunday 10:00'] },
  adia: { name: 'ADIA Training Centre', type: 'college', receiptPrefix: 'ADIA', serviceTimes: [] },
  hope: { name: 'Freedom Hope Center', type: 'ministry', receiptPrefix: 'FHC', serviceTimes: [] },
};
for (const [id, o] of Object.entries(orgs)) await db.doc(`organizations/${id}`).set({ ...o, parentId: null, timeZone: 'Africa/Nairobi', currency: 'KES', activities: [], active: true, ...st });
const user = (await db.doc(`users/${u}`).get()).data();
console.log(JSON.stringify(user));
await db.doc(`users/${u}`).update({ orgIds: Object.keys(orgs) });
