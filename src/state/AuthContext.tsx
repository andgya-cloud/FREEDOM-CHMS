import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { markIntroPending } from '../components/AdiaIntro';
import { onAuthStateChanged, signInWithEmailAndPassword, signOut as fbSignOut, type User } from 'firebase/auth';
import { doc, onSnapshot, type Timestamp } from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import { useNavigate } from 'react-router-dom';
import { auth, db, functions } from '../firebase';
import { TRAINER_ROLE_ID, can as canDo, canAccessOrg, type Permission } from '../../functions/src/shared/permissions';

export interface Profile {
  uid: string;
  email: string;
  displayName: string;
  roleId: string;
  permissions: string[];
  extraPermissions: string[];
  orgIds: string[];
  allOrgs: boolean;
  active: boolean;
  mustChangePassword?: boolean;
  /** Petty cash voucher title, such as Accountant. */
  pettyTitle?: string;
  phone?: string;
  /** A trainer's classes whose register they mark (ADIA programme names). */
  registerClasses?: string[];
  /** A trainer's departments (ADIA programme ids). */
  trainerCourseIds?: string[];
  lastSignInAt?: Timestamp;
}

interface AuthValue {
  user: User | null;
  profile: Profile | null;
  loading: boolean;
  can: (permission: Permission) => boolean;
  canAccessOrg: (orgId: string) => boolean;
  signIn: (email: string, password: string) => Promise<void>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [authReady, setAuthReady] = useState(false);
  const [profileReady, setProfileReady] = useState(false);
  const navigate = useNavigate();

  useEffect(() => onAuthStateChanged(auth, (u) => {
    setUser(u);
    setAuthReady(true);
    if (!u) {
      setProfile(null);
      setProfileReady(true);
    } else {
      setProfileReady(false);
    }
  }), []);

  useEffect(() => {
    if (!user) return;
    return onSnapshot(
      doc(db, 'users', user.uid),
      (snap) => {
        setProfile(snap.exists() ? ({ uid: snap.id, ...snap.data() } as Profile) : null);
        setProfileReady(true);
      },
      () => {
        setProfile(null);
        setProfileReady(true);
      },
    );
  }, [user]);

  const value = useMemo<AuthValue>(() => ({
    user,
    profile,
    loading: !authReady || (!!user && !profileReady),
    // A trainer never reads people, even on an account saved before that rule (Andy, 2026-10-28).
    can: (p) => !(p === 'people.read' && profile?.roleId === TRAINER_ROLE_ID) && canDo(profile, p),
    canAccessOrg: (orgId) => canAccessOrg(profile, orgId),
    async signIn(email, password) {
      await signInWithEmailAndPassword(auth, email.trim(), password);
      markIntroPending();
      // Recorded in the audit log by the server; doesn't block the sign-in.
      httpsCallable(functions, 'recordSignIn')().catch(() => undefined);
    },
    async signOut() {
      await fbSignOut(auth);
      // The next person to sign in starts on Today, not on the last person's page.
      navigate('/', { replace: true });
    },
  }), [user, profile, authReady, profileReady, navigate]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthValue {
  const v = useContext(AuthContext);
  if (!v) throw new Error('useAuth outside AuthProvider');
  return v;
}
