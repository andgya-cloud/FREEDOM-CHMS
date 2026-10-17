import { useEffect, useState } from 'react';
import { doc, onSnapshot } from 'firebase/firestore';
import { db } from '../firebase';
import { useAuth } from './AuthContext';

export interface AppSettings {
  inactivityMinutes: number;
  regularAttender: { minWeeks: number; ofLastWeeks: number };
  timeZone: string;
  currency: string;
}

export const DEFAULT_SETTINGS: AppSettings = {
  inactivityMinutes: 15,
  regularAttender: { minWeeks: 3, ofLastWeeks: 8 },
  timeZone: 'Africa/Nairobi',
  currency: 'KES',
};

export function useAppSettings(): AppSettings {
  const { profile } = useAuth();
  const [settings, setSettings] = useState<AppSettings>(DEFAULT_SETTINGS);
  useEffect(() => {
    if (!profile?.active) return;
    return onSnapshot(doc(db, 'settings', 'app'), (snap) => {
      if (snap.exists()) setSettings({ ...DEFAULT_SETTINGS, ...(snap.data() as Partial<AppSettings>) });
    }, () => undefined);
  }, [profile?.active]);
  return settings;
}
