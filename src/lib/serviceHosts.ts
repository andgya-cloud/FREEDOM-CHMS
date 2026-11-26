import { useMemo } from 'react';
import { httpsCallable } from 'firebase/functions';
import { collection, doc, query, where } from 'firebase/firestore';
import { db, functions } from '../firebase';
import { useLiveDoc, useLiveQuery } from './useQuery';
import { useOrg, type Organization } from '../state/OrgContext';
import { useAuth } from '../state/AuthContext';
import { isHostManagerAt, isPrayerManager } from '../../functions/src/shared/permissions';
import { settingsOr, TEAM_INFO, type HostSettings, type RotaSlot, type ServiceHost, type Team } from '../../functions/src/shared/serviceHosts';

/** Every change to Service hosts goes through the serviceHosts function (Andy, 2026-11-17). */
export const hostCall = <R,>(data: Record<string, unknown> & { orgId: string; action: string; team: Team }) =>
  httpsCallable<typeof data, R>(functions, 'serviceHosts', { timeout: 120_000 })(data).then((r) => r.data);

/** The church these pages are about: the one chosen, or the first church. */
export function useChurch(): Organization | null {
  const { current, organizations } = useOrg();
  return current?.type === 'church_campus' ? current : organizations.find((o) => o.type === 'church_campus') ?? null;
}

/** Who plans the Service hosts at this church (Andy, 2026-11-26): its own tick, or the limited one (Diana). */
export function useHostManager(orgId?: string): boolean {
  const { profile } = useAuth();
  return !!orgId && isHostManagerAt(profile, orgId);
}

/** Sunday prayer is its own (Andy, 2026-11-26): only Andy, Doreen and the limited "Sunday prayer" tick (Elizabeth). */
export function usePrayerManager(orgId?: string): boolean {
  const { profile } = useAuth();
  return isPrayerManager(profile, orgId);
}

/** Who plans a team's schedule at a church. */
export function useTeamManager(team: Team, orgId?: string): boolean {
  const host = useHostManager(orgId);
  const prayer = usePrayerManager(orgId);
  return team === 'prayer' ? prayer : host;
}

/**
 * The church for the Service hosts and Sunday prayer pages: the one on the account, or the church that a
 * "Freedom Church, limited" job reaches (Diana at Hope, Elizabeth at ADIA).
 */
export function useJobChurch(): Organization | null {
  const church = useChurch();
  const { limitedOrg } = useOrg();
  return church ?? limitedOrg;
}

export function useHostSettings(team: Team, orgId: string, serviceTimes?: string[], on = true): HostSettings {
  const { data } = useLiveDoc<Partial<HostSettings>>(() => (orgId && on ? doc(db, 'organizations', orgId, TEAM_INFO[team].col.settings, 'main') : null), [team, orgId, on]);
  return useMemo(() => settingsOr(data, serviceTimes, team), [data, serviceTimes, team]);
}

export function useHosts(team: Team, orgId: string, on = true): ServiceHost[] {
  const { rows } = useLiveQuery<ServiceHost>(() => (orgId && on ? query(collection(db, 'organizations', orgId, TEAM_INFO[team].col.people), where('deletedAt', '==', null)) : null), [team, orgId, on]);
  return rows.sort((a, b) => a.name.localeCompare(b.name));
}

export function useRota(team: Team, orgId: string, from: string, to: string): RotaSlot[] {
  const { rows } = useLiveQuery<RotaSlot>(() => (orgId ? query(collection(db, 'organizations', orgId, TEAM_INFO[team].col.rota), where('date', '>=', from), where('date', '<=', to)) : null), [team, orgId, from, to]);
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
