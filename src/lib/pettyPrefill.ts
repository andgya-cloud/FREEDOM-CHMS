/** A petty cash request made ready on another page, picked up once by New requisition. */
export interface PettyPrefill { orgId: string; category: string; payee: string; lines: { description: string; quantity: string; unitPrice: string }[] }
const PREFILL_KEY = 'petty-prefill';
export function setPettyPrefill(p: PettyPrefill) {
  try { sessionStorage.setItem(PREFILL_KEY, JSON.stringify(p)); } catch { /* private window */ }
}
export function takePettyPrefill(orgId: string): PettyPrefill | null {
  try {
    const v = JSON.parse(sessionStorage.getItem(PREFILL_KEY) ?? 'null') as PettyPrefill | null;
    sessionStorage.removeItem(PREFILL_KEY);
    return v && v.orgId === orgId ? v : null;
  } catch { return null; }
}
