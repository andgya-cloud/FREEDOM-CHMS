import { initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
initializeApp({ projectId: 'demo-freedom-chms' });
const db = getFirestore();
for (const c of await db.doc(`organizations/${process.argv[2]}`).listCollections()) await db.recursiveDelete(c);
console.log('wiped');
