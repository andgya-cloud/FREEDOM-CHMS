import { useMemo } from 'react';
import { httpsCallable } from 'firebase/functions';
import { collection, doc, query, where } from 'firebase/firestore';
import { db, functions } from '../firebase';
import { useLiveDoc, useLiveQuery } from './useQuery';
import { useOrg, type Organization } from '../state/OrgContext';
import { useAuth } from '../state/AuthContext';
import { settingsOr, type HostSettings, type RotaSlot, type ServiceHost } from '../../functions/src/shared/serviceHosts';

/** Every change to Service hosts goes through the serviceHosts function (Andy, 2026-11-17). */
export const hostCall = <R,>(data: Record<string, unknown> & { orgId: string; action: string }) =>
  httpsCallable<typeof data, R>(functions, 'serviceHosts', { timeout: 120_000 })(data).then((r) => r.data);

/** The church these pages are about: the one chosen, or the first church. */
export function useChurch(): Organization | null {
  const { current, organizations } = useOrg();
  return current?.type === 'church_campus' ? current : organizations.find((o) => o.type === 'church_campus') ?? null;
}

export function useHostManager(): boolean {
  const { can } = useAuth();
  return can('rota.manage') || can('users.manage');
}

export function useHostSettings(orgId: string, serviceTimes?: string[], on = true): HostSettings {
  const { data } = useLiveDoc<Partial<HostSettings>>(() => (orgId && on ? doc(db, 'organizations', orgId, 'serviceHostSettings', 'main') : null), [orgId, on]);
  return useMemo(() => settingsOr(data, serviceTimes), [data, serviceTimes]);
}

export function useHosts(orgId: string, on = true): ServiceHost[] {
  const { rows } = useLiveQuery<ServiceHost>(() => (orgId && on ? query(collection(db, 'organizations', orgId, 'serviceHosts'), where('deletedAt', '==', null)) : null), [orgId, on]);
  return rows.sort((a, b) => a.name.localeCompare(b.name));
}

export function useRota(orgId: string, from: string, to: string): RotaSlot[] {
  const { rows } = useLiveQuery<RotaSlot>(() => (orgId ? query(collection(db, 'organizations', orgId, 'serviceRota'), where('date', '>=', from), where('date', '<=', to)) : null), [orgId, from, to]);
  return rows;
}

export function toBase64(file: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).replace(/^data:[^,]*,/, ''));
    r.onerror = () => reject(r.error);
    r.readAsDataURL(file);
  });
}

export function fromBase64(b64: string, name: string, type: string): File {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new File([bytes], name, { type });
}
