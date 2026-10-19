import { useEffect, useId, useState, type FormEvent } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { doc, onSnapshot } from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import { db, functions } from '../../firebase';
import { useAuth, type Profile } from '../../state/AuthContext';
import { useOrg } from '../../state/OrgContext';
import { useRoles } from '../../state/useRoles';
import { useToast } from '../../state/ToastContext';
import { friendlyError } from '../../lib/errors';
import { generateTemporaryPassword } from '../../lib/generatePassword';
import { PasswordChecklist } from '../../components/PasswordChecklist';
import { ConfirmDialog } from '../../components/ConfirmDialog';
import { GRANTABLE_PERMISSIONS, PERMISSION_LABELS, TEAM_ROLE_ID } from '../../../functions/src/shared/permissions';
import { passwordProblems } from '../../../functions/src/shared/password';

interface FormState {
  displayName: string;
  email: string;
  roleId: string;
  allOrgs: boolean;
  orgIds: string[];
  extraPermissions: string[];
  password: string;
  active: boolean;
}

const ROLE_HINTS: Record<string, string> = {
  admin: ': everyday work, including recording gifts and receipts',
  head: ': runs one organization and adds its staff, never sees money',
  staff: ': everyday work in their organization, never sees money',
};

const EMPTY: FormState = { displayName: '', email: '', roleId: 'admin', allOrgs: false, orgIds: [], extraPermissions: [], password: '', active: true };

export function UserFormPage() {
  const { uid } = useParams();
  const isNew = !uid;
  const { profile: me, can } = useAuth();
  const { organizations } = useOrg();
  // An organization head (not the pastor) adds Staff for their own organizations only; the server checks this too.
  const teamOnly = !can('users.manage');
  const myOrgs = teamOnly ? organizations.filter((o) => me?.orgIds?.includes(o.id)) : organizations;
  const roles = useRoles();
  const toast = useToast();
  const navigate = useNavigate();
  const [form, setForm] = useState<FormState>(() => ({
    ...EMPTY, password: generateTemporaryPassword(),
    ...(teamOnly ? { roleId: TEAM_ROLE_ID, orgIds: me?.orgIds?.length === 1 ? [...me.orgIds] : [] } : {}),
  }));
  const [loaded, setLoaded] = useState(isNew);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [resetPw, setResetPw] = useState('');
  const [confirmOff, setConfirmOff] = useState(false);
  const tempPwId = useId();

  useEffect(() => {
    if (!uid) return;
    return onSnapshot(doc(db, 'users', uid), (snap) => {
      const u = snap.data() as Profile | undefined;
      if (u) {
        setForm({
          displayName: u.displayName, email: u.email, roleId: u.roleId, allOrgs: u.allOrgs, orgIds: u.orgIds ?? [],
          extraPermissions: u.extraPermissions ?? [], password: '', active: u.active,
        });
      }
      setLoaded(true);
    });
  }, [uid]);

  const role = roles.find((r) => r.id === form.roleId);
  const set = <K extends keyof FormState>(k: K, v: FormState[K]) => setForm((f) => ({ ...f, [k]: v }));
  const toggle = (k: 'orgIds' | 'extraPermissions', v: string) =>
    setForm((f) => ({ ...f, [k]: f[k].includes(v) ? f[k].filter((x) => x !== v) : [...f[k], v] }));

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError('');
    if (form.displayName.trim().length < 2) return setError('Enter the person’s name.');
    if (isNew && !/^\S+@\S+\.\S+$/.test(form.email)) return setError('Enter a valid email.');
    if (isNew && passwordProblems(form.password, form.email).length) return setError('The temporary password is not strong enough.');
    if (!role?.isOwner && !form.allOrgs && form.orgIds.length === 0) return setError('Choose at least one organization.');
    setBusy(true);
    try {
      const payload = teamOnly
        ? { displayName: form.displayName.trim(), orgIds: form.orgIds }
        : {
          displayName: form.displayName.trim(), roleId: form.roleId, allOrgs: form.allOrgs, orgIds: form.orgIds,
          extraPermissions: role?.isOwner ? [] : form.extraPermissions,
        };
      if (isNew) {
        await httpsCallable(functions, 'createUser')({ ...payload, email: form.email.trim(), password: form.password });
        toast.show(`Account created. Give ${form.displayName.split(' ')[0]} the temporary password: ${form.password}`);
      } else {
        await httpsCallable(functions, 'updateUser')({ uid, ...payload });
        toast.show('Account updated.');
      }
      navigate('/settings/users');
    } catch (err) {
      setError(friendlyError(err));
    } finally {
      setBusy(false);
    }
  }

  async function setActive(active: boolean) {
    setConfirmOff(false);
    try {
      await httpsCallable(functions, 'updateUser')({ uid, active });
      toast.show(active ? 'Account switched on.' : 'Account switched off and signed out everywhere.');
    } catch (err) {
      setError(friendlyError(err));
    }
  }

  async function resetPassword() {
    setError('');
    const pw = resetPw || generateTemporaryPassword(form.email);
    if (passwordProblems(pw, form.email).length) return setError('The new password is not strong enough.');
    try {
      await httpsCallable(functions, 'resetUserPassword')({ uid, password: pw });
      setResetPw('');
      toast.show(`Password reset. New temporary password: ${pw}`);
    } catch (err) {
      setError(friendlyError(err));
    }
  }

  if (!loaded) return <div className="page"><p>Loading…</p></div>;

  return (
    <div className="page narrow">
      <p><Link to="/settings/users">← Staff accounts</Link></p>
      <h1>{isNew ? 'Add a staff account' : form.displayName}</h1>
      <form className="form" onSubmit={submit}>
        <label className="field">
          <span>Full name</span>
          <input value={form.displayName} onChange={(e) => set('displayName', e.target.value)} />
        </label>
        <label className="field">
          <span>Email</span>
          <input type="email" value={form.email} disabled={!isNew} onChange={(e) => set('email', e.target.value)} />
        </label>
        {teamOnly ? (
          <p className="hint">Role: <strong>Staff</strong>. They can record people, attendance, programmes and follow-ups, and never see money.</p>
        ) : (
          <fieldset className="field">
            <legend>Role</legend>
            {roles.map((r) => (
              <label key={r.id} className="check">
                <input type="radio" name="role" checked={form.roleId === r.id} onChange={() => set('roleId', r.id)} disabled={uid === me?.uid} />
                <span><strong>{r.name}</strong>{r.isOwner ? ': full access to everything' : ROLE_HINTS[r.id] ?? ''}</span>
              </label>
            ))}
          </fieldset>
        )}

        {!role?.isOwner && (
          <>
            <fieldset className="field">
              <legend>Organizations</legend>
              {!teamOnly && (
                <label className="check">
                  <input type="checkbox" checked={form.allOrgs} onChange={(e) => set('allOrgs', e.target.checked)} />
                  <span>All organizations, including new ones</span>
                </label>
              )}
              {!form.allOrgs && myOrgs.map((o) => (
                <label key={o.id} className="check">
                  <input type="checkbox" checked={form.orgIds.includes(o.id)} onChange={() => toggle('orgIds', o.id)} />
                  <span>{o.name}</span>
                </label>
              ))}
            </fieldset>
            {!teamOnly && <fieldset className="field">
              <legend>Also allow</legend>
              <p className="hint">Off by default for admins.</p>
              {GRANTABLE_PERMISSIONS.map((p) => (
                <label key={p} className="check">
                  <input type="checkbox" checked={form.extraPermissions.includes(p)} onChange={() => toggle('extraPermissions', p)} />
                  <span>{PERMISSION_LABELS[p]}</span>
                </label>
              ))}
            </fieldset>}
          </>
        )}

        {isNew && (
          <div className="field">
            <label htmlFor={tempPwId}>Temporary password</label>
            <div className="input-with-button">
              <input id={tempPwId} value={form.password} onChange={(e) => set('password', e.target.value)} />
              <button type="button" className="btn btn-quiet" onClick={() => set('password', generateTemporaryPassword(form.email))}>New</button>
            </div>
            <PasswordChecklist password={form.password} email={form.email} />
            <small className="hint">They will be asked to choose their own password at first sign-in.</small>
          </div>
        )}

        {error && <p className="error" role="alert">{error}</p>}
        <button type="submit" className="btn btn-primary btn-block" disabled={busy}>{busy ? 'Saving…' : isNew ? 'Create account' : 'Save changes'}</button>
      </form>

      {!isNew && uid !== me?.uid && (
        <section className="card">
          <h2>Password</h2>
          <div className="input-with-button">
            <input placeholder="Leave empty to generate one" value={resetPw} onChange={(e) => setResetPw(e.target.value)} />
            <button type="button" className="btn" onClick={resetPassword}>Reset password</button>
          </div>
          <h2>Access</h2>
          {form.active
            ? <button type="button" className="btn btn-danger" onClick={() => setConfirmOff(true)}>Switch off this account</button>
            : <button type="button" className="btn" onClick={() => setActive(true)}>Switch account back on</button>}
        </section>
      )}

      <ConfirmDialog
        open={confirmOff}
        title="Switch off this account?"
        body="They will be signed out on every device and cannot sign in until you switch the account back on. Their past work stays."
        confirmLabel="Switch off"
        danger
        onConfirm={() => void setActive(false)}
        onCancel={() => setConfirmOff(false)}
      />
    </div>
  );
}
