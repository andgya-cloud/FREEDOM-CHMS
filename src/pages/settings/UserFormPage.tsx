import { useEffect, useId, useState, type FormEvent } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { formatPhone, normalizePhone } from '../../../functions/src/shared/phone';
import { doc, onSnapshot } from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import { db, functions } from '../../firebase';
import { useAuth, type Profile } from '../../state/AuthContext';
import { useOrg } from '../../state/OrgContext';
import { useRoles } from '../../state/useRoles';
import { useSchool } from '../../state/useSchool';
import { useToast } from '../../state/ToastContext';
import { friendlyError } from '../../lib/errors';
import { generateTemporaryPassword } from '../../lib/generatePassword';
import { PasswordChecklist } from '../../components/PasswordChecklist';
import { ConfirmDialog } from '../../components/ConfirmDialog';
import { GRANTABLE_PERMISSIONS, PERMISSION_LABELS, PETTY_TITLES, PRINCIPAL_ROLE_ID, SIGNATORY_ROLE_ID, TEAM_ROLE_ID, TRAINER_ROLE_ID } from '../../../functions/src/shared/permissions';
import { PasswordInput } from '../../components/PasswordInput';
import { passwordProblems } from '../../../functions/src/shared/password';
import { passwordProof } from '../../lib/pettyPin';

interface FormState {
  displayName: string;
  email: string;
  roleId: string;
  allOrgs: boolean;
  orgIds: string[];
  extraPermissions: string[];
  password: string;
  active: boolean;
  pettyTitle: string;
  phone: string;
  /** A trainer's departments: ADIA programme ids. */
  departments: string[];
  /** Classes ticked under v107, by name, until the programmes load. */
  legacyClasses: string[];
}

const ROLE_HINTS: Record<string, string> = {
  admin: ': everyday work, including recording gifts and receipts',
  head: ': runs one organization and adds its staff, never sees money',
  staff: ': everyday work in their organization, never sees money',
  signatory: ': raises and signs petty cash requests, top-ups and resets, and sees nothing else',
  principal: ': ADIA students, attendance, Exam Records and graduation, with each student\'s fee balance; nothing else',
  trainer: ': keys in marks for their own ADIA classes in Exam Records, and sees nothing else',
};

const EMPTY: FormState = { displayName: '', email: '', roleId: 'admin', allOrgs: false, orgIds: [], extraPermissions: [], password: '', active: true, pettyTitle: '', phone: '', departments: [], legacyClasses: [] };

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
  const [pwDone, setPwDone] = useState<{ email: string; works: boolean; temporary: string } | null>(null);
  const [confirmOff, setConfirmOff] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const tempPwId = useId();

  useEffect(() => {
    if (!uid) return;
    return onSnapshot(doc(db, 'users', uid), (snap) => {
      const u = snap.data() as Profile | undefined;
      if (u) {
        setForm({
          displayName: u.displayName, email: u.email, roleId: u.roleId, allOrgs: u.allOrgs, orgIds: u.orgIds ?? [],
          extraPermissions: [...new Set((u.extraPermissions ?? []).map((x: string) => (x === 'pettycash.check' ? 'pettycash.approve' : x)))], password: '', active: u.active, pettyTitle: u.pettyTitle ?? '', phone: formatPhone(u.phone) || '', departments: u.trainerCourseIds ?? [], legacyClasses: u.trainerCourseIds ? [] : u.registerClasses ?? [],
        });
      }
      setLoaded(true);
    });
  }, [uid]);

  const role = roles.find((r) => r.id === form.roleId);
  const signatory = form.roleId === SIGNATORY_ROLE_ID;
  // The principal works at ADIA only, with no extra ticks (Andy, 2026-10-25).
  // A trainer works at ADIA only too, in Exam Records (Andy, 2026-10-25).
  const principal = form.roleId === PRINCIPAL_ROLE_ID || form.roleId === TRAINER_ROLE_ID;
  const colleges = organizations.filter((o) => o.type === 'college').map((o) => o.id);
  // A trainer's department: one of ADIA's programmes (Andy, 2026-10-28, 1A).
  const school = useSchool(form.roleId === TRAINER_ROLE_ID ? colleges[0] ?? '' : '');
  const programmes = school.courses.filter((c) => c.active !== false);
  // An account saved with register classes by name picks up those programmes once they load.
  useEffect(() => {
    if (!form.legacyClasses.length || !programmes.length) return;
    setForm((f) => ({ ...f, departments: programmes.filter((c) => f.legacyClasses.includes(c.name)).map((c) => c.id), legacyClasses: [] }));
  }, [form.legacyClasses, programmes.length]); // eslint-disable-line react-hooks/exhaustive-deps
  // The voucher title is for the petty cash signatories, the pastor included when they sign.
  const showTitle = !teamOnly && (signatory || !!role?.isOwner);
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
    if (signatory && !form.pettyTitle) return setError('Choose the title printed under their signature.');
    if (principal && (form.allOrgs || form.orgIds.some((id) => !colleges.includes(id)))) return setError(`The ${form.roleId === TRAINER_ROLE_ID ? 'trainer' : 'principal'} works at ADIA only. Untick the other organizations.`);
    if (form.roleId === TRAINER_ROLE_ID && !teamOnly && form.departments.length === 0) return setError('Tick the department this trainer teaches.');
    if (form.phone.trim() && !normalizePhone(form.phone)) return setError('Check the WhatsApp number, e.g. 0712 345 678.');
    setBusy(true);
    try {
      const payload = teamOnly
        ? { displayName: form.displayName.trim(), orgIds: form.orgIds, phone: form.phone.trim() }
        : {
          displayName: form.displayName.trim(), roleId: form.roleId, allOrgs: form.allOrgs, orgIds: form.orgIds,
          extraPermissions: role?.isOwner || signatory || principal ? [] : form.extraPermissions,
          pettyTitle: showTitle ? form.pettyTitle : '',
          phone: form.phone.trim(),
          departments: form.roleId === TRAINER_ROLE_ID ? form.departments : [],
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

  async function deleteAccount() {
    setConfirmDelete(false);
    try {
      await httpsCallable(functions, 'deleteUser')({ uid });
      toast.show(`${form.displayName}'s account was deleted.`);
      navigate('/settings/users');
    } catch (err) {
      setError(friendlyError(err));
    }
  }

  async function resetPassword() {
    setError('');
    const pw = resetPw || generateTemporaryPassword(form.email);
    if (passwordProblems(pw, form.email).length) return setError('The new password is not strong enough.');
    try {
      const keep = !!resetPw;
      const res = await httpsCallable<object, { ok: boolean; loginEmail?: string }>(functions, 'resetUserPassword')({ uid, password: pw, keep });
      setResetPw('');
      const loginEmail = res.data.loginEmail || form.email;
      // Prove it at once with a real sign-in, so a problem shows here and not later at the signing box.
      const works = await passwordProof('', loginEmail, pw).then(() => true).catch(() => false);
      setPwDone({ email: loginEmail, works, temporary: keep ? '' : pw });
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
                <input type="radio" name="role" checked={form.roleId === r.id} onChange={() => setForm((f) => (r.id === PRINCIPAL_ROLE_ID || r.id === TRAINER_ROLE_ID ? { ...f, roleId: r.id, allOrgs: false, orgIds: colleges } : { ...f, roleId: r.id }))} disabled={uid === me?.uid} />
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
            {!teamOnly && !signatory && !principal && <fieldset className="field">
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

        {form.roleId === TRAINER_ROLE_ID && !teamOnly && (
          <fieldset className="field">
            <legend>Department</legend>
            {programmes.length === 0 ? <p className="small muted">ADIA has no programmes yet.</p> : programmes.map((c) => (
              <label key={c.id} className="check">
                <input type="checkbox" checked={form.departments.includes(c.id)}
                  onChange={() => setForm((f) => ({ ...f, departments: f.departments.includes(c.id) ? f.departments.filter((x) => x !== c.id) : [...f.departments, c.id] }))} />
                {c.name}
              </label>
            ))}
            <small className="hint">They see only this department's students (names and admission numbers), mark its register for today or yesterday, and key in marks for its courses given to them in Exam Records. Nothing else.</small>
          </fieldset>
        )}

        {showTitle && (
          <label className="field">
            <span>Title on petty cash vouchers</span>
            <select value={form.pettyTitle} onChange={(e) => set('pettyTitle', e.target.value)}>
              <option value="">{signatory ? 'Choose a title' : 'None'}</option>
              {PETTY_TITLES.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
            <small className="hint">Printed under their signature. Any two stakeholders approve a request.</small>
          </label>
        )}

        <label className="field">
          <span>WhatsApp number</span>
          <input type="tel" inputMode="tel" autoComplete="off" value={form.phone} onChange={(e) => set('phone', e.target.value)} placeholder="e.g. 0712 345 678" />
          <small className="hint">Petty cash notices (please approve, approved) go to this number and to their email.</small>
        </label>

        {isNew && (
          <div className="field">
            <label htmlFor={tempPwId}>Temporary password</label>
            <div className="input-with-button">
              <PasswordInput id={tempPwId} shown autoComplete="new-password" value={form.password} onChange={(e) => set('password', e.target.value)} />
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
            <PasswordInput shown autoComplete="new-password" placeholder="Leave empty to generate one" value={resetPw} onChange={(e) => setResetPw(e.target.value)} />
            <button type="button" className="btn" onClick={() => { setPwDone(null); void resetPassword(); }}>Set password</button>
          </div>
          <small className="hint">Type the password you want {form.displayName.split(' ')[0] || 'them'} to use. It works for signing in and for signing petty cash.</small>
          {pwDone && (pwDone.works
            ? <p className="small" role="status">✓ Saved and checked. {form.displayName.split(' ')[0]} signs in with <strong>{pwDone.email}</strong>{pwDone.temporary ? <> and the temporary password <strong>{pwDone.temporary}</strong> (they will choose their own)</> : ' and the password you typed'}. The same password signs petty cash.</p>
            : <p className="error" role="alert">The password was saved for petty cash signing, but a test sign-in with {pwDone.email} failed. Check that this is their sign-in email.</p>)}
          <h2>Access</h2>
          {form.active
            ? <button type="button" className="btn btn-danger" onClick={() => setConfirmOff(true)}>Switch off this account</button>
            : <button type="button" className="btn" onClick={() => setActive(true)}>Switch account back on</button>}
          <h2>Delete staff member</h2>
          <p className="hint">Removes their sign-in for good. What they recorded stays, with their name on it. To stop them only for a while, switch the account off instead.</p>
          <button type="button" className="btn btn-danger" onClick={() => setConfirmDelete(true)}>Delete this account</button>
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
      <ConfirmDialog
        open={confirmDelete}
        title={`Delete ${form.displayName}'s account?`}
        body="They will be signed out and can never sign in with this account again. This cannot be undone. Their past work stays."
        confirmLabel="Delete account"
        danger
        onConfirm={() => void deleteAccount()}
        onCancel={() => setConfirmDelete(false)}
      />
    </div>
  );
}
