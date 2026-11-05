import { httpsCallable } from 'firebase/functions';
import { functions } from '../firebase';
import { CHAMPION_SIGN_MINUTES, type ChampionSigner } from '../../functions/src/shared/hopeChampionPay';

/**
 * Champions' details, appreciation and extras (Andy, 2026-11-05): saved on the server with two signatures, Andy or
 * Doreen and the Director. One pair of signatures lasts a few minutes on this phone.
 */
export interface ChampionSignerRow { uid: string; name: string; role: ChampionSigner; emails: string[] }
export interface ChampionChange { id?: string; name: string; phone: string; email: string; duty: string; status: 'active' | 'left'; joinedOn: string | null; weeklyPay: number | null; monthlyPay: number | null }
export interface ChampionSave { champions?: ChampionChange[]; addExtras?: { championId: string; month: string; amount: number; reason: string }[]; removeExtras?: string[] }

const call = <R,>(data: Record<string, unknown>) => httpsCallable<typeof data, R>(functions, 'hopeChampionEdit', { timeout: 60_000 })(data).then((r) => r.data);
export const listChampionSigners = (orgId: string) => call<{ signers: ChampionSignerRow[] }>({ orgId, action: 'signers' }).then((r) => r.signers);
export const saveChampionChanges = (orgId: string, proofs: [string, string], save: ChampionSave) =>
  call<{ saved: number; signedBy: string }>({ orgId, action: 'save', proofs, ...save });

let kept: { orgId: string; proofs: [string, string]; names: string; at: number } | null = null;
export function keptSignatures(orgId: string) {
  return kept && kept.orgId === orgId && Date.now() - kept.at < CHAMPION_SIGN_MINUTES * 60_000 ? kept : null;
}
export function keepSignatures(orgId: string, proofs: [string, string], names: string) { kept = { orgId, proofs, names, at: Date.now() }; }
export function forgetSignatures() { kept = null; }

/** A champion's full details for the server, with some fields changed. */
export function championChange(c: { id: string; name: string; phone: string; email: string; duty: string; status: 'active' | 'left'; joinedOn: string | null; weeklyPay?: number | null; monthlyPay?: number | null },
  changes: Partial<ChampionChange> = {}): ChampionChange {
  return { id: c.id, name: c.name, phone: c.phone ?? '', email: c.email ?? '', duty: c.duty ?? '', status: c.status, joinedOn: c.joinedOn ?? null, weeklyPay: c.weeklyPay ?? null, monthlyPay: c.monthlyPay ?? null, ...changes };
}
