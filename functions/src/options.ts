import { setGlobalOptions } from 'firebase-functions/v2';

// Imported first by index.ts so it runs before any function is defined.
// Region is set at deploy time (functions/.env); keep it next to the Firestore database.
setGlobalOptions({ region: process.env.FUNCTIONS_REGION || 'africa-south1', maxInstances: 10 });
