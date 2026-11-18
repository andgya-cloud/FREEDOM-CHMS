import { httpsCallable } from 'firebase/functions';
import { functions } from '../firebase';
import type { PledgeState, SponsorSettings } from '../../functions/src/shared/hopeSponsorPage';

/** Calls for the Hope Centre sponsorship page (Andy, 2026-11-18). All go through the hopeSponsor function. */
const call = <T,>(data: Record<string, unknown>) => httpsCallable<Record<string, unknown>, T>(functions, 'hopeSponsor', { timeout: 60_000 })(data).then((r) => r.data);

export interface PublicChild { key: string; name: string; age: number | null; stone: string | null; bio: string; amount: number | null; photo: boolean; held: boolean }
export interface SponsorPageData { name: string; settings: SponsorSettings; children: PublicChild[] }
export interface PledgeResult { ref: string; names: string[]; text: string; amount: string }
export interface AdminChild { id: string; code: string; sponsorName: string; sponsored: boolean; hidden: boolean; bio: string; amount: number | null; held: boolean; photo: boolean; consent: boolean | null; photoOk: boolean }
export interface Pledge {
  id: string; ref: string; state: PledgeState; childIds: string[]; childNames: string[]; general: boolean;
  name: string; email: string; phone: string; country: string; date: string; holdUntil: string; receivedOn?: string | null; receivedByName?: string | null; lastUpdateOn?: string | null;
}
export interface SponsorAdmin { settings: SponsorSettings; children: AdminChild[]; pledges: Pledge[]; today: string }

export const loadSponsorPage = (orgId: string) => call<SponsorPageData>({ orgId, action: 'page' });
export const loadSponsorPhoto = (orgId: string, key: string) => call<{ photo: string }>({ orgId, action: 'photo', key }).then((r) => r.photo);
export const sendPledge = (orgId: string, form: Record<string, unknown>) => call<PledgeResult>({ orgId, action: 'pledge', ...form });
export const loadSponsorAdmin = (orgId: string) => call<SponsorAdmin>({ orgId, action: 'admin' });
export const saveSponsorSettings = (orgId: string, settings: SponsorSettings) => call<{ settings: SponsorSettings }>({ orgId, action: 'settings', settings });
export const saveSponsorChild = (orgId: string, childId: string, v: { bio: string; hidden: boolean; amount: number | null; photoOk: boolean }) => call<{ ok: true }>({ orgId, action: 'child', childId, ...v });
export interface PdfFile { name: string; data: string }
export const markPledge = (orgId: string, id: string, action: 'received' | 'cancel', pdf?: PdfFile | null) => call<{ ok: true; emailed?: boolean }>({ orgId, action, id, pdf: pdf ?? null });
export const deletePledge = (orgId: string, id: string) => call<{ ok: true }>({ orgId, action: 'delete', id });
export const sendSponsorUpdate = (orgId: string, id: string, pdf: PdfFile) => call<{ ok: true }>({ orgId, action: 'update', id, pdf });

/** The server's own words when it explains a problem; otherwise a plain message. */
export function sponsorError(err: unknown, fallback = 'Something went wrong. Please check your internet and try again.') {
  const e = err as { code?: string; message?: string };
  return e?.code?.startsWith('functions/') && e.message && e.code !== 'functions/internal' ? e.message.replace(/\s*\[\d+\]$/, '') : fallback;
}

/** The public link for well-wishers. */
export const sponsorLink = (orgId: string) => `${window.location.origin}/sponsor/${orgId}`;
