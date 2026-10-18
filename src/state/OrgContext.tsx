import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { collection, doc, onSnapshot, type Timestamp } from 'firebase/firestore';
import { db } from '../firebase';
import { useAuth } from './AuthContext';
import { readPref, writePref } from '../lib/storage';
import type { OrganizationType } from '../../functions/src/shared/organizations';
import { ESTIMATE } from '../lib/firestoreOptions';

export interface Organization {
  id: string;
  name: string;
  type: OrganizationType;
  parentId: string | null;
  timeZone: string;
  currency: string;
  receiptPrefix: string;
  serviceTimes?: string[];
  /** Programmes run by a college or ministry (classes, sessions, meals). */
  activities?: string[];
  active: boolean;
  /** The practice organization: sample data only. */
  training?: boolean;
  deletedAt: Timestamp | null;
  createdAt?: Timestamp;
}

export const ALL_ORGS = 'all';

interface OrgValue {
  /** Organizations this user can open, excluding ones in the bin. */
  organizations: Organization[];
  /** Including deleted ones, for the settings bin. */
  allIncludingDeleted: Organization[];
  /** The selected organization, or null when the combined view is selected. */
  current: Organization | null;
  currentId: string;
  isCombined: boolean;
  select: (id: string) => void;
  loading: boolean;
}

const OrgContext = createContext<OrgValue | null>(null);

export function OrgProvider({ children }: { children: ReactNode }) {
  const { profile } = useAuth();
  const [orgs, setOrgs] = useState<Organization[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<string>(() => readPref('org') ?? '');

  useEffect(() => {
    if (!profile?.active) {
      setOrgs([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    const toOrg = (id: string, data: Record<string, unknown>) => ({ id, ...data }) as Organization;
    if (profile.allOrgs) {
      return onSnapshot(collection(db, 'organizations'), (snap) => {
        setOrgs(snap.docs.map((d) => toOrg(d.id, d.data(ESTIMATE))));
        setLoading(false);
      }, () => setLoading(false));
    }
    // Users limited to some organizations read each one directly.
    const found = new Map<string, Organization>();
    let remaining = profile.orgIds.length;
    if (remaining === 0) setLoading(false);
    const unsubs = profile.orgIds.map((id) => onSnapshot(doc(db, 'organizations', id), (snap) => {
      if (snap.exists()) found.set(id, toOrg(id, snap.data(ESTIMATE)!));
      else found.delete(id);
      setOrgs([...found.values()]);
      if (--remaining <= 0) setLoading(false);
    }, () => {
      if (--remaining <= 0) setLoading(false);
    }));
    return () => unsubs.forEach((u) => u());
  }, [profile?.active, profile?.allOrgs, profile?.orgIds?.join(',')]);

  const value = useMemo<OrgValue>(() => {
    const live = orgs.filter((o) => !o.deletedAt).sort((a, b) => a.name.localeCompare(b.name));
    const canCombine = !!profile?.allOrgs && live.length > 1;
    let currentId = selected;
    if (currentId === ALL_ORGS && !canCombine) currentId = '';
    if (currentId !== ALL_ORGS && !live.some((o) => o.id === currentId)) {
      // Nothing chosen yet on this device: start on a church campus if there is one.
      currentId = (live.find((o) => o.type === 'church_campus' && !o.training) ?? live[0])?.id ?? '';
    }
    return {
      organizations: live,
      allIncludingDeleted: orgs,
      current: live.find((o) => o.id === currentId) ?? null,
      currentId,
      isCombined: currentId === ALL_ORGS,
      loading,
      select(id) {
        setSelected(id);
        writePref('org', id);
      },
    };
  }, [orgs, selected, loading, profile?.allOrgs]);

  // Remember the effective choice, so adding another organization doesn't switch the view.
  useEffect(() => {
    if (!value.loading && value.currentId && value.currentId !== selected) {
      setSelected(value.currentId);
      writePref('org', value.currentId);
    }
  }, [value.currentId, selected]);

  return <OrgContext.Provider value={value}>{children}</OrgContext.Provider>;
}

export function useOrg(): OrgValue {
  const v = useContext(OrgContext);
  if (!v) throw new Error('useOrg outside OrgProvider');
  return v;
}
