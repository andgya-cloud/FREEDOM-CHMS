import { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useAuth } from '../../state/AuthContext';
import { useToast } from '../../state/ToastContext';
import { useHopeDays } from '../../state/useHope';
import { friendlyError } from '../../lib/errors';
import { feesOwing } from '../../lib/hopeRecords';
import { isCurrentChild } from '../../../functions/src/shared/hope';
import { birthdayThisWeek, missedSaturdays } from '../../../functions/src/shared/hopeRegister';
import { canKeepFees } from '../../../functions/src/shared/hopeRecords';
import { classLabel, classOf, HOPE_CLASSES } from '../../../functions/src/shared/hopeClasses';
import { fillMessage, HOPE_PHONE, MESSAGE_TEMPLATES, recipients, waLink } from '../../../functions/src/shared/hopeMessages';
import { formatPhone } from '../../../functions/src/shared/phone';
import { HopeGate, useHopePage } from './common';
import type { Organization } from '../../state/OrgContext';

export function HopeMessagesPage() {
  return <HopeGate title="WhatsApp parents">{(org) => <Messages org={org} />}</HopeGate>;
}

const SENT_KEY = 'hope-wa-sent';
function loadSent(key: string): Set<string> {
  try { const v = JSON.parse(localStorage.getItem(SENT_KEY) ?? '{}') as Record<string, string[]>; return new Set(v[key] ?? []); } catch { return new Set(); }
}
function keepSent(key: string, sent: Set<string>) {
  try { localStorage.setItem(SENT_KEY, JSON.stringify({ [key]: [...sent] })); } catch { /* private window */ }
}

/**
 * WhatsApp messages to parents (Andy, 2026-11-05, 6A 7A), sent from the Hope Centre phone (0794 645 455). Choose who,
 * choose or write the message, then "Send next" opens WhatsApp with it ready for each parent in turn: one tap to send,
 * then back here for the next. Brothers and sisters with the same parent get one message.
 */
function Messages({ org }: { org: Organization }) {
  const h = useHopePage(org);
  const { profile } = useAuth();
  const toast = useToast();
  const { days } = useHopeDays(org.id);
  const [params, setParams] = useSearchParams();
  const group = params.get('to') || 'all';
  const fees = canKeepFees(profile, org.id);
  const [owing, setOwing] = useState<Set<string> | null>(null);
  const [tpl, setTpl] = useState(MESSAGE_TEMPLATES[0]!.id);
  const [text, setText] = useState(MESSAGE_TEMPLATES[0]!.text);
  useEffect(() => { if (group === 'owing' && fees && !owing) feesOwing(org.id).then((r) => setOwing(new Set(r.owing.map((o) => o.childId))), (err) => toast.show(friendlyError(err))); }, [group, fees, owing, org.id, toast]);

  const GROUPS: [string, string, boolean][] = [
    ['all', 'All parents', true],
    ...HOPE_CLASSES.map((k): [string, string, boolean] => [`class-${k.id}`, `Class: ${classLabel(k)}`, true]),
    ['missed', 'Missed the last 3 Saturdays', true],
    ['owing', 'Fees still to pay this term', fees],
    ['birthdays', 'Birthdays this week', true],
  ];
  const list = useMemo(() => recipients(h.children.filter(isCurrentChild).filter((c) => {
    if (group === 'all') return true;
    if (group === 'missed') return missedSaturdays(c.id, c.enrolledOn, days);
    if (group === 'owing') return !!owing?.has(c.id);
    if (group === 'birthdays') return birthdayThisWeek(c.dateOfBirth, h.today);
    return `class-${classOf(c.dateOfBirth, h.today)?.id}` === group;
  }).map((c) => {
    const guardian = h.byId(h.byId(c.id)?.guardianId ?? '');
    return { id: c.id, name: h.nameOf(c.id), parentName: c.parentName || guardian?.fullName || '', parentPhone: c.parentPhone || guardian?.phone || '' };
  })), [h, group, days, owing]);

  const sentKey = `${h.today}|${group}|${tpl}`;
  const [sent, setSent] = useState<Set<string>>(() => loadSent(sentKey));
  useEffect(() => setSent(loadSent(sentKey)), [sentKey]);
  function mark(phone: string) {
    setSent((s) => { const n = new Set(s); n.add(phone); keepSent(sentKey, n); return n; });
  }
  const next = list.to.find((r) => !sent.has(r.phone));
  const done = list.to.length - list.to.filter((r) => !sent.has(r.phone)).length;

  return (
    <div className="page narrow stack">
      <p><Link to="/hope/more">← More</Link></p>
      <h1>💬 WhatsApp parents</h1>
      <p className="notice small">Send these from the <b>Hope Centre phone ({HOPE_PHONE})</b>, so parents see the Hope number and can reply or call it. Each message opens in WhatsApp ready to send: tap Send there, then come back for the next.</p>

      <section className="card stack">
        <label className="field"><span>Send to</span>
          <select value={group} onChange={(e) => setParams(e.target.value === 'all' ? {} : { to: e.target.value }, { replace: true })}>
            {GROUPS.filter((g) => g[2]).map(([k, label]) => <option key={k} value={k}>{label}</option>)}
          </select>
        </label>
        <label className="field"><span>Message</span>
          <select value={tpl} onChange={(e) => { setTpl(e.target.value); setText(MESSAGE_TEMPLATES.find((t) => t.id === e.target.value)?.text ?? ''); }}>
            {MESSAGE_TEMPLATES.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
          </select>
        </label>
        <label className="field"><span>Words (write {'{parent}'} and {'{child}'} for their names)</span>
          <textarea rows={4} maxLength={900} value={text} onChange={(e) => setText(e.target.value)} />
        </label>
        {list.to[0] && <p className="small muted wa-preview">{fillMessage(text, list.to[0])}</p>}
      </section>

      <section className="card stack">
        <div className="card-head"><h2>{list.to.length} {list.to.length === 1 ? 'parent' : 'parents'}</h2><span className="small muted">{done} sent</span></div>
        {next && text.trim() ? (
          <a className="btn btn-primary btn-big" href={waLink(next.phone, fillMessage(text, next))} target="_blank" rel="noopener noreferrer" onClick={() => mark(next.phone)}>
            🟢 Send next: {next.parentName || 'Parent'} ({next.children.map((c) => c.name.split(' ')[0]).join(', ')})
          </a>
        ) : list.to.length > 0 && <p className="notice notice-ok small">All {list.to.length} sent. 🎉</p>}
        <ul className="link-list wa-list">
          {list.to.map((r) => (
            <li key={r.phone} className={sent.has(r.phone) ? 'sent' : ''}>
              <span className="grow"><b>{r.parentName || 'Parent'}</b><span className="small muted">{r.children.map((c) => c.name).join(', ')} · {formatPhone(r.phone)}</span></span>
              <a className="btn btn-quiet btn-small" href={waLink(r.phone, fillMessage(text, r))} target="_blank" rel="noopener noreferrer" onClick={() => mark(r.phone)}>{sent.has(r.phone) ? '✓ Sent' : 'Send'}</a>
            </li>
          ))}
        </ul>
        {list.noPhone.length > 0 && (
          <details className="small"><summary>{list.noPhone.length} with no parent phone saved</summary>
            <ul>{list.noPhone.map((c) => <li key={c.id}><Link to={`/hope/children/${c.id}`}>{c.name}</Link></li>)}</ul>
          </details>
        )}
        {sent.size > 0 && <button type="button" className="btn btn-quiet btn-small align-start" onClick={() => { const n = new Set<string>(); keepSent(sentKey, n); setSent(n); }}>Start this list again</button>}
      </section>
    </div>
  );
}
