import { useState } from 'react';
import { Link } from 'react-router-dom';
import type { Person } from '../state/PeopleContext';
import { useToast } from '../state/ToastContext';
import { useAuth } from '../state/AuthContext';
import { addToFamily, notSameFamily } from '../state/useFamilies';
import { friendlyError } from '../lib/errors';
import { PERSON_STATUS_LABELS } from '../../functions/src/shared/people';
import { formatPhone } from '../../functions/src/shared/phone';
import { StatusPicker } from './StatusPicker';
import type { RowPick } from './PersonRow';
import { familyName, FAMILY_ROLE_LABELS, roleOf, type FamilySuggestion } from '../../functions/src/shared/families';

/** The first parent who can take a WhatsApp message (6A). */
export function familyWhatsApp(members: readonly Person[]): Person | undefined {
  return members.find((p) => roleOf(p) !== 'child' && p.whatsapp && !p.whatsappConsent?.stoppedAt);
}

/** One family on the People page (Andy, 2026-11-01, 1A): its name, then each person on their own line. */
export function FamilyCard({ members, name, edit, pickFor }: { members: Person[]; name?: string | null; edit?: boolean; pickFor?: (p: Person) => RowPick | undefined }) {
  const title = familyName(members, name);
  const wa = familyWhatsApp(members);
  return (
    <li className="row family-row">
      <div className="family-head">
        <span className="family-title"><b>{title}</b> <span className="muted small">· {members.length}</span></span>
        {wa && <a className="btn btn-small" href={`https://wa.me/${wa.whatsapp!.replace(/\D/g, '')}`} target="_blank" rel="noopener noreferrer" aria-label={`WhatsApp ${wa.fullName}`}>WhatsApp {wa.firstName}</a>}
      </div>
      <ul className="family-members">
        {members.map((p) => (
          <li key={p.id} className={`family-member-row${pickFor?.(p)?.on ? ' row-picked' : ''}`}>
            {pickFor && <input type="checkbox" className="row-pick" checked={!!pickFor(p)?.on} onChange={pickFor(p)?.toggle} aria-label={`Choose ${p.fullName}`} />}
            <Link to={`/people/${p.orgId}/${p.id}`} className="family-member">
              <span className="row-title">
                {p.fullName}
                <span className="muted small family-role">{FAMILY_ROLE_LABELS[roleOf(p)]}</span>
                {!edit && <span className={`badge badge-${p.status}`}>{PERSON_STATUS_LABELS[p.status]}</span>}
              </span>
              <span className="row-detail">{formatPhone(p.phone) || 'No phone'}</span>
            </Link>
            {edit && <StatusPicker person={p} />}
          </li>
        ))}
      </ul>
    </li>
  );
}

/** Families the app thinks belong together; nothing is joined until someone taps Yes (4A). */
export function FamilySuggestions({ orgId, suggestions, existing }: { orgId: string; suggestions: FamilySuggestion<Person>[]; existing: Set<string> }) {
  const { can } = useAuth();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [done, setDone] = useState<Set<string>>(new Set());
  const left = suggestions.filter((s) => !done.has(s.key));
  if (!can('people.write') || left.length === 0) return null;
  const answer = (s: FamilySuggestion<Person>, yes: boolean) => {
    setDone((d) => new Set(d).add(s.key));
    (yes ? addToFamily(s.anchor, s.member, s.role) : notSameFamily(orgId, s.key, existing.has(`no_${s.key}`)))
      .catch((err) => toast.show(friendlyError(err)));
    if (yes) toast.show(`${s.member.firstName} joined ${familyName([s.anchor])}.`);
  };
  return (
    <section className="card family-suggest">
      <button type="button" className="family-suggest-head" aria-expanded={open} onClick={() => setOpen(!open)}>
        <b>{left.length === 1 ? '1 possible family to check' : `${left.length} possible families to check`}</b>
        <span className="muted small">{open ? 'Hide' : 'Check'}</span>
      </button>
      {open && (
        <ul className="plain stack">
          {left.map((s) => (
            <li key={s.key} className="family-suggest-row">
              <span><b>{s.member.fullName}</b> with <b>{s.anchor.fullName}</b>, as {FAMILY_ROLE_LABELS[s.role].toLowerCase()}<br /><span className="muted small">{s.reason}</span></span>
              <span className="family-suggest-actions">
                <button type="button" className="btn btn-primary btn-small" onClick={() => answer(s, true)}>Yes, same family</button>
                <button type="button" className="btn btn-small" onClick={() => answer(s, false)}>No</button>
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
