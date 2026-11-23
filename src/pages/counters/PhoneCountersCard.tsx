import { useEffect, useState } from 'react';
import { httpsCallable } from 'firebase/functions';
import { functions } from '../../firebase';
import { useToast } from '../../state/ToastContext';
import { friendlyError } from '../../lib/errors';
import { COUNTER_INFO, counterInvite, waPhone, type CounterJob } from '../../../functions/src/shared/counters';
import './counters.css';

type Job = { job: CounterJob; person: string; phone: string; active: boolean; link: string };
const call = (data: Record<string, unknown>) => httpsCallable<typeof data, { jobs: Job[]; church: string; childrenFromClasses?: boolean; teensFromClasses?: boolean }>(functions, 'serviceCounters', { timeout: 60_000 })(data).then((r) => r.data);

/**
 * Who counts what on their phone (Andy, 2026-11-23, 1A 3A 5A): one person per number. Type their name and phone,
 * then send them their link on WhatsApp. "New link" stops an old link; "Switch off" pauses one.
 */
export function PhoneCountersCard({ orgId }: { orgId: string }) {
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [jobs, setJobs] = useState<Job[] | null>(null);
  const [church, setChurch] = useState('Freedom Church');
  const [fromClasses, setFromClasses] = useState(false);
  const [teensFrom, setTeensFrom] = useState(false);
  const [draft, setDraft] = useState<Partial<Record<CounterJob, { person: string; phone: string }>>>({});
  const [busy, setBusy] = useState<CounterJob | null>(null);

  useEffect(() => {
    if (!open || jobs) return;
    call({ orgId, action: 'jobs' }).then((r) => { setJobs(r.jobs); setChurch(r.church); setFromClasses(!!r.childrenFromClasses); setTeensFrom(!!r.teensFromClasses); }).catch((e) => toast.show(friendlyError(e)));
  }, [open, jobs, orgId, toast]);

  async function act(job: CounterJob, data: Record<string, unknown>, done: string) {
    setBusy(job);
    try {
      const r = await call({ orgId, job, ...data });
      setJobs(r.jobs);
      setDraft((d) => { const n = { ...d }; delete n[job]; return n; });
      toast.show(done);
    } catch (e) { toast.show(friendlyError(e)); } finally { setBusy(null); }
  }

  const copy = async (link: string) => {
    try { await navigator.clipboard.writeText(link); toast.show('Link copied.'); } catch { window.prompt('Copy this link', link); }
  };

  return (
    <details className="card fold" onToggle={(e) => setOpen((e.target as HTMLDetailsElement).open)}>
      <summary>📱 Phone counters</summary>
      <p className="muted small">One person counts each number on their own phone, with no password. Their numbers show here live.</p>
      {!jobs ? <p className="muted">Loading…</p> : (
        <ul className="ctr-jobs">
          {fromClasses && <li className="small muted">🧒 Children{teensFrom ? ' and Teens' : ''} come from the Sunday school teachers, class by class.</li>}
          {jobs.filter((j) => !(fromClasses && j.job === 'children') && !(teensFrom && j.job === 'teens')).map((j) => {
            const info = COUNTER_INFO[j.job];
            const d = draft[j.job] ?? { person: j.person, phone: j.phone };
            const changed = d.person !== j.person || d.phone !== j.phone;
            const wa = waPhone(j.phone);
            return (
              <li key={j.job} className={`ctr-jobrow${j.person && !j.active ? ' ctr-off' : ''}`}>
                <div className="ctr-jobhead">
                  <b>{info.emoji} {info.label}</b>
                  {j.person && <span className={`badge${j.active ? '' : ' muted'}`}>{j.active ? 'On' : 'Switched off'}</span>}
                </div>
                <div className="ctr-jobfields">
                  <input value={d.person} maxLength={80} placeholder="Who counts this?" aria-label={`${info.label}: name`}
                    onChange={(e) => setDraft((x) => ({ ...x, [j.job]: { ...d, person: e.target.value } }))} />
                  <input value={d.phone} maxLength={30} inputMode="tel" placeholder="Phone (for WhatsApp)" aria-label={`${info.label}: phone`}
                    onChange={(e) => setDraft((x) => ({ ...x, [j.job]: { ...d, phone: e.target.value } }))} />
                </div>
                <div className="ctr-jobbuttons">
                  {changed && <button type="button" className="btn btn-primary" disabled={busy === j.job} onClick={() => void act(j.job, { action: 'saveJob', person: d.person, phone: d.phone }, 'Saved.')}>Save</button>}
                  {j.person && j.link && !changed && j.active && (
                    <>
                      {wa
                        ? <a className="btn ctr-wa" href={`https://wa.me/${wa}?text=${encodeURIComponent(counterInvite(j.job, j.person, j.link, church))}`} target="_blank" rel="noreferrer">Send link on WhatsApp</a>
                        : null}
                      <button type="button" className="btn" onClick={() => void copy(j.link)}>Copy link</button>
                      <button type="button" className="btn" disabled={busy === j.job} onClick={() => { if (window.confirm(`Make a new link for ${info.label}? The old link stops working.`)) void act(j.job, { action: 'newLink' }, 'New link made. Send it again.'); }}>New link</button>
                    </>
                  )}
                  {j.person && !changed && (
                    <button type="button" className="btn" disabled={busy === j.job} onClick={() => void act(j.job, { action: 'switch', active: !j.active }, j.active ? 'Switched off.' : 'Switched on.')}>
                      {j.active ? 'Switch off' : 'Switch on'}
                    </button>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </details>
  );
}
