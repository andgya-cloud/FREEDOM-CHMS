import { httpsCallable } from 'firebase/functions';
import { functions } from '../firebase';

/**
 * A child's photo (Andy, 2026-11-05): saved and removed on the server, with the password of the Director, Andy or
 * Doreen (`proof`, from passwordProof). A removed photo goes to the Bin.
 */
export interface PhotoApprover { uid: string; name: string; emails: string[] }
const call = <R,>(data: Record<string, unknown>) => httpsCallable<typeof data, R>(functions, 'hopeChildPhoto', { timeout: 60_000 })(data).then((r) => r.data);

export const listPhotoApprovers = (orgId: string) => call<{ approvers: PhotoApprover[] }>({ orgId, action: 'approvers' }).then((r) => r.approvers);
export const saveChildPhoto = (orgId: string, childId: string, photo: string, proof: string) => call<{ ok: true }>({ orgId, action: 'save', childId, photo, proof });
export const removeChildPhoto = (orgId: string, childId: string, proof: string) => call<{ ok: true }>({ orgId, action: 'remove', childId, proof });
