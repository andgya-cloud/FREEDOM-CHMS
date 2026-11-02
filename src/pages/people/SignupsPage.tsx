import { useState } from 'react';
import { Link } from 'react-router-dom';
import { collection, query, where } from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import { db, functions } from '../../firebase';
import { useAuth } from '../../state/AuthContext';
import { useOrg } from '../../state/OrgContext';
import { usePeople, type Person } from '../../state/PeopleContext';
import { useToast } from '../../state/ToastContext';
import { useLiveQuery } from '../../lib/useQuery';
import { friendlyError } from '../../lib/errors';
import { canKeepAccounts } from '../../../functions/src/shared/permissions';
import { formatPhone } from '../../../functions/src/shared/phone';
import { formatDateKey } from '../../../functions/src/shared/datetime';
import {
  aboutLines, approvedStatus, birthdayText, changeRows, SIGNUP_RELATION_LABELS, updatesFor,
  type CleanSignup, type SignupPerson, type SignupRelation,
} from '../../../functions/src/shared/familySignup';

export interface SignupDoc {
  id: string;
  orgId: string;
  state: 'waiting' | 'approved' | 'rejected';
  date: string;
  fullName: string;
  count: number;
  form: CleanSignup;
  matches: { me: string | null; family: (string | null)[] };
  decidedByName?: string | null;
}

/** Waiting family sign-ups, for Andrew and Doreen only (rules allow nobody else to read them). */
export function useWaitingSignups(orgId: string | undefined, enabled: boolean) {
  return useLiveQuery<SignupDoc>(
    () => (orgId && enabled ? query(collection(db, 'organizations', orgId, 'signups'), where('state', '==', 'waiting')) : null),
    [orgId, enabled],
  );
}

const STATUS_WORDS: Record<string, string> = { member: 'Member', regular: 'Regular', visitor: 'Visitor' };

/** One person on the form: new, or already in People with what will change. */
function PersonOnForm({ p, relation, existing, status, extra }: {
  p: SignupPerson; relation: SignupRelation | 'me'; existing: Person | null; status: string;
  extra: { howHeard?: string | null; serviceAttended?: string | null };
}) {
  const role = relation === 'me' ? 'Filled in the form' : SIGNUP_RELATION_LABELS[relation];
  if (existing) {
    const rows = changeRows(existing, updatesFor(existing, p, status as Person['status'], extra));
    return (
      <div className="signup-person">
        <p><b>{p.fullName}</b> <span className="muted small">· {role} · already in People</span> <Link className="small" to={`/people/${existing.orgId}/${existing.id}`}>Open</Link></p>
        {rows.length === 0
          ? <p className="muted small">Nothing new to update.</p>
          : (
            <table className="signup-changes">
              <thead><tr><th>Detail</th><th>Now</th><th>New</th></tr></thead>
              <tbody>{rows.map((r) => <tr key={r.label}><td>{r.label}</td><td className="muted">{r.now}</td><td><b>{r.next}</b></td></tr>)}</tbody>
            </table>
          )}
      </div>
    );
  }
  const lines = [
    p.phone && `Phone ${formatPhone(p.phone)}`, p.email, p.gender, p.birthday && `Born ${birthdayText(p.birthday)}${p.birthYear ? ` ${p.birthYear}` : ''}`,
    `Will be ${STATUS_WORDS[status] ?? status}`, ...aboutLines(p.about).filter((l) => l.label !== 'Age range' || !p.birthYear).map((l) => `${l.label}: ${l.value}`),
    extra.howHeard && `First came through: ${extra.howHeard}`, extra.serviceAttended && `Usual service: ${extra.serviceAttended}`,
  ].filter(Boolean);
  return (
    <div className="signup-person">
      <p><b>{p.fullName}</b> <span className="muted small">· {role} · <span className="signup-new">new</span></span></p>
      <p className="small muted">{lines.join(' · ')}</p>
    </div>
  );
}

function SignupCard({ s }: { s: SignupDoc }) {
  const { byId } = usePeople();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const live = (id: string | null | undefined) => { const p = id ? byId(id) : undefined; return p && !p.deletedAt ? p : null; };
  const parentClaim = s.form.me.claim ?? 'regular';
  const decide = async (decision: 'approve' | 'reject') => {
    setBusy(true);
    try {
      const r = await httpsCallable<{ orgId: string; id: string; decision: string }, { people: number }>(functions, 'decideSignup')({ orgId: s.orgId, id: s.id, decision });
      toast.show(decision === 'approve' ? `Approved: ${r.data.people} ${r.data.people === 1 ? 'person' : 'people'} on the People page` : 'Not added');
    } catch (err) { toast.show(friendlyError(err)); setBusy(false); }
  };
  return (
    <section className="card signup-card" aria-label={`Sign-up from ${s.fullName}`}>
      <h2>{s.fullName}{s.count > 1 ? ` and family (${s.count})` : ''}</h2>
      <p className="muted small">Filled in {formatDateKey(s.date)}{s.form.weddingDate ? ` · Wedding date ${formatDateKey(s.form.weddingDate)}` : ''}</p>
      <PersonOnForm p={s.form.me} relation="me" existing={live(s.matches?.me)} status={approvedStatus(s.form.me, parentClaim)}
        extra={{ howHeard: s.form.me.howHeard, serviceAttended: s.form.me.serviceAttended }} />
      {s.form.family.map((m, i) => (
        <PersonOnForm key={i} p={m} relation={m.relation} existing={live(s.matches?.family?.[i])} status={approvedStatus(m, parentClaim)} extra={{}} />
      ))}
      <div className="button-row">
        <button type="button" className="btn btn-primary" disabled={busy} onClick={() => void decide('approve')}>{busy ? 'Saving…' : 'Approve'}</button>
        <button type="button" className="btn btn-quiet" disabled={busy} onClick={() => void decide('reject')}>Don&apos;t add</button>
      </div>
    </section>
  );
}

/** "Approve sign-ups" (Andy, 2026-11-02, 1A 2A): each family form waits here until Andrew or Doreen approve it. */
export function SignupsPage() {
  const { profile } = useAuth();
  const { current } = useOrg();
  const keeper = canKeepAccounts(profile) && current?.type === 'church_campus';
  const { rows, loading } = useWaitingSignups(current?.id, keeper);
  const waiting = [...rows].sort((a, b) => a.date.localeCompare(b.date));
  return (
    <div className="page narrow">
      <p><Link to="/people">← People</Link></p>
      <h1>Approve sign-ups</h1>
      {!keeper
        ? <p>Only Andrew and Doreen approve family sign-ups.</p>
        : (
          <>
            <p className="muted small">Families who filled in the sign-up form. Nothing reaches the People page until you approve it. For people already there, you see what will change.</p>
            {loading ? <p className="muted">Loading…</p> : waiting.length === 0 ? <p className="card muted">No sign-ups waiting. 🎉</p> : waiting.map((s) => <SignupCard key={s.id} s={s} />)}
            <p className="small"><Link to="/people/join-qr">Family sign-up QR code</Link></p>
          </>
        )}
    </div>
  );
}
