import { useMemo, useRef, useState } from 'react';
import { friendlyError } from '../../lib/errors';
import { downloadFile } from '../../lib/givingPdf';
import { fromBase64, hostCall, toBase64, useJobChurch, useTeamManager, useHostSettings, useHosts, useRota } from '../../lib/serviceHosts';
import { usePeople } from '../../state/PeopleContext';
import { useAuth } from '../../state/AuthContext';
import { canKeepAccounts } from '../../../functions/src/shared/permissions';
import type { Organization } from '../../state/OrgContext';
import { downloadRota } from '../../lib/rotaDownload';
import { localDateKey } from '../../../functions/src/shared/datetime';
import {
  addDays, clock, dayLabel, daysBetween, DOC_MAX_BYTES, isAway, nextFree, PLAN_WEEKS, plannedDates, WEEKDAYS,
  type AwaySpan, type HostService, type HostSettings, type RotaSlot, type SpecialService, type Team, TEAM_INFO,
} from '../../../functions/src/shared/serviceHosts';
import './serviceHosts.css';

/**
 * Service hosts (Andy, 2026-11-17): who hosts each service for the next three months, the hosts themselves, and
 * the services and requirements document. Andy chooses every host; "Suggest fair turns" only fills in suggestions.
 */
export function ServiceHostsPage({ team = 'host' }: { team?: Team }) {
  const org = useJobChurch();
  const manager = useTeamManager(team, org?.id);
  const [msg, setMsg] = useState('');
  const t = TEAM_INFO[team];
  if (!org) return <div className="page narrow"><h1>{t.title}</h1><p>{t.title} is part of Freedom Church.</p></div>;
  if (!manager) return <div className="page narrow"><h1>{t.title}</h1><p>{team === 'prayer' ? 'Only Mr Andrew, Doreen and the people they choose see the Sunday prayer schedule.' : 'Only Mr Andrew and the leaders he chooses plan this schedule.'}</p></div>;
  return (
    <div className="page narrow sh-page">
      <h1 className="sh-band sh-band-title" style={{ background: t.colour }}>{t.icon} {t.title}</h1>
      <p className="muted">One {t.role} leads each {team === 'prayer' ? 'prayer time' : 'service'}. They get an email at 6 PM a week before (to say Yes or I can't), then 3 days, 2 days and the day before.</p>
      <DownloadRow org={org} team={team} say={setMsg} />
      {msg && <p className="notice" role="status" onClick={() => setMsg('')}>{msg}</p>}
      <Schedule team={team} orgId={org.id} serviceTimes={org.serviceTimes} tz={org.timeZone || 'Africa/Nairobi'} say={setMsg} />
      <Hosts team={team} orgId={org.id} say={setMsg} />
      <SettingsFold team={team} orgId={org.id} serviceTimes={org.serviceTimes} say={setMsg} />
    </div>
  );
}

type Say = (m: string) => void;

/** Download this schedule as PDF or Excel (Andy, 2026-11-17; each on its own since 2026-11-26). */
function DownloadRow({ org, team, say }: { org: Organization; team: Team; say: Say }) {
  const [busy, setBusy] = useState('');
  async function get(kind: 'pdf' | 'xlsx') {
    setBusy(kind);
    try { await downloadRota(org, kind, [team]); } catch (e) { say(friendlyError(e)); } finally { setBusy(''); }
  }
  return (
    <div className="sh-actions">
      <span className="muted small">Download the {TEAM_INFO[team].title} calendar:</span>
      <button type="button" className="btn btn-small" disabled={!!busy} onClick={() => void get('pdf')}>{busy === 'pdf' ? 'Making…' : '⬇ PDF'}</button>
      <button type="button" className="btn btn-small" disabled={!!busy} onClick={() => void get('xlsx')}>{busy === 'xlsx' ? 'Making…' : '⬇ Excel'}</button>
    </div>
  );
}

const ANSWER = { pending: { label: 'Waiting', cls: 'sh-wait' }, yes: { label: '✓ Accepted', cls: 'sh-yes' }, no: { label: "✗ Can't", cls: 'sh-no' } } as const;

function Schedule({ team, orgId, serviceTimes, tz, say }: { team: Team; orgId: string; serviceTimes?: string[]; tz: string; say: Say }) {
  const today = localDateKey(new Date(), tz);
  const from = addDays(today, 1);
  const to = addDays(from, PLAN_WEEKS * 7);
  const settings = useHostSettings(team, orgId, serviceTimes);
  const hosts = useHosts(team, orgId);
  const rota = useRota(team, orgId, addDays(today, -180), to);
  const [busy, setBusy] = useState('');
  const dates = useMemo(() => plannedDates(settings, from), [settings, from]);
  const byId = useMemo(() => new Map(rota.map((r) => [r.id, r])), [rota]);
  const suggested = rota.filter((r) => r.status === 'suggested' && r.date >= from);
  const active = hosts.filter((h) => h.active);

  async function run(key: string, fn: () => Promise<string | void>) {
    setBusy(key);
    try { const m = await fn(); if (m) say(m); } catch (err) { say(friendlyError(err)); } finally { setBusy(''); }
  }
  const assign = (slotId: string, hostId: string) => run(slotId, async () => { await hostCall({ team, orgId, action: 'assign', slotId, hostId }); });
  async function whatsapp(slot: RotaSlot) {
    // Opened before the call returns, so the phone does not block the new window.
    const w = window.open('', '_blank');
    await run(`wa${slot.id}`, async () => {
      const r = await hostCall<{ phone: string; text: string }>({ team, orgId, action: 'whatsapp', slotId: slot.id });
      const url = `https://wa.me/${r.phone}?text=${encodeURIComponent(r.text)}`;
      if (w) w.location.href = url; else window.location.href = url;
    });
  }

  return (
    <section className="card">
      <div className="card-head"><h2>Schedule</h2></div>
      {active.length === 0 ? <p className="muted">Add your people below first.</p> : (
        <div className="sh-actions">
          <button type="button" className="btn" disabled={!!busy} onClick={() => run('suggest', async () => {
            const r = await hostCall<{ suggested: number }>({ team, orgId, action: 'suggest' });
            return r.suggested ? `${r.suggested} dates have a suggestion. Check them, then press Use suggestions.` : 'Every date already has someone.';
          })}>Suggest fair turns</button>
          {suggested.length > 0 && (
            <>
              <button type="button" className="btn btn-primary" disabled={!!busy} onClick={() => run('use', async () => { await hostCall({ team, orgId, action: 'useSuggestions' }); return 'Done. They will be reminded at 6 PM, starting a week before their date.'; })}>Use {suggested.length} suggestions</button>
              <button type="button" className="btn" disabled={!!busy} onClick={() => run('clear', async () => { await hostCall({ team, orgId, action: 'clearSuggestions' }); })}>Clear suggestions</button>
            </>
          )}
        </div>
      )}
      {active.length > 0 && <p className="muted small">Suggestions give everyone fair turns, nobody twice in a row, and skip the days someone is away. Nothing is sent until you choose.</p>}
      <ul className="sh-list">
        {dates.map((d) => {
          const r = byId.get(d.id);
          const days = daysBetween(today, d.date);
          const chosen = r?.status === 'set';
          const a = chosen ? ANSWER[r!.answer] : null;
          const free = r?.answer === 'no' ? nextFree(d.date, hosts, rota.filter((x) => x.id !== d.id), [r.hostId ?? '']) : null;
          return (
            <li key={d.id} className={`sh-row${r?.status === 'suggested' ? ' sh-suggested' : ''}${!r ? ' sh-empty' : ''}`}>
              <div className="sh-when">
                <strong>{dayLabel(d.date, false)}</strong>
                <span className="muted small">{d.serviceName}{d.time ? ` · ${clock(d.time)}` : ''}</span>
              </div>
              <div className="sh-who">
                <select aria-label={`Who leads on ${dayLabel(d.date, false)}`} value={r?.hostId ?? ''} disabled={busy === d.id} onChange={(e) => void assign(d.id, e.target.value)}>
                  <option value="">Choose someone…</option>
                  {active.map((h) => <option key={h.id} value={h.id} disabled={isAway(h, d.date)}>{h.name}{isAway(h, d.date) ? ' (away)' : ''}</option>)}
                  {r?.hostId && !active.some((h) => h.id === r.hostId) && <option value={r.hostId}>{r.hostName}</option>}
                </select>
                <span className="sh-status">
                  {r?.status === 'suggested' && <><span className="badge">Suggested</span> <button type="button" className="btn btn-small" disabled={!!busy} onClick={() => void assign(d.id, r.hostId!)}>Use</button></>}
                  {a && <span className={`badge ${a.cls}`}>{a.label}</span>}
                  {chosen && r!.answer !== 'no' && days <= 7 && <button type="button" className="btn btn-small sh-wa" disabled={!!busy} onClick={() => void whatsapp(r!)}>WhatsApp</button>}
                </span>
                {r?.answer === 'no' && <span className="small sh-no-text">{r.reason ? `"${r.reason}" · ` : ''}{free ? `${free.name} is free that day.` : 'Nobody else is free that day.'}</span>}
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

const blank = { id: '', name: '', phone: '', email: '', personId: null as string | null, active: true, away: [] as AwaySpan[] };

function Hosts({ team, orgId, say }: { team: Team; orgId: string; say: Say }) {
  const hosts = useHosts(team, orgId);
  const rota = useRota(team, orgId, addDays(localDateKey(), -180), addDays(localDateKey(), PLAN_WEEKS * 7));
  const [edit, setEdit] = useState<typeof blank | null>(null);
  const turns = useMemo(() => {
    const m = new Map<string, number>();
    for (const r of rota) if (r.status === 'set' && r.hostId && r.answer !== 'no') m.set(r.hostId, (m.get(r.hostId) ?? 0) + 1);
    return m;
  }, [rota]);
  return (
    <section className="card">
      <div className="card-head">
        <h2>{TEAM_INFO[team].roles} ({hosts.filter((h) => h.active).length})</h2>
        {!edit && <button type="button" className="btn btn-primary btn-small" onClick={() => setEdit({ ...blank })}>+ Add a person</button>}
      </div>
      {edit && <HostForm team={team} orgId={orgId} value={edit} done={(m) => { setEdit(null); if (m) say(m); }} />}
      {hosts.length === 0 && !edit && <p className="muted">Nobody yet. Press Add a person for each one who can lead.</p>}
      <ul className="row-list sh-hosts">
        {hosts.map((h) => (
          <li key={h.id}>
            <button type="button" className="sh-host" onClick={() => setEdit({ id: h.id, name: h.name, phone: h.phone, email: h.email, personId: h.personId, active: h.active, away: h.away ?? [] })}>
              <span><strong>{h.name}</strong>{!h.active && <span className="badge"> Resting</span>}</span>
              <span className="muted small">{[h.phone, h.email].filter(Boolean).join(' · ') || 'No contact yet'}</span>
              <span className="muted small">{turns.get(h.id) ?? 0} turns{(h.away ?? []).some((a) => a.to >= localDateKey()) ? ' · has away dates' : ''}</span>
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}

function HostForm({ team, orgId, value, done }: { team: Team; orgId: string; value: typeof blank; done: (m?: string) => void }) {
  const { people } = usePeople();
  const [f, setF] = useState(value);
  const [find, setFind] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const set = (p: Partial<typeof blank>) => setF((x) => ({ ...x, ...p }));
  const matches = find.trim().length < 2 ? [] : people
    .filter((p) => p.orgId === orgId && !p.deletedAt && p.fullName.toLowerCase().includes(find.trim().toLowerCase()))
    .slice(0, 6);

  async function save() {
    setBusy(true); setErr('');
    try {
      const r = await hostCall<{ welcomed: boolean }>({ team, orgId, action: 'saveHost', ...f });
      done(f.id ? 'Saved.' : r.welcomed ? `${f.name} is added, and a welcome email with the requirements has gone to them.` : `${f.name} is added.`);
    } catch (e) { setErr(friendlyError(e)); setBusy(false); }
  }
  async function remove() {
    if (!window.confirm(`Remove ${f.name} from this list? Their coming dates become empty.`)) return;
    setBusy(true);
    try { await hostCall({ team, orgId, action: 'removeHost', id: f.id }); done(`${f.name} is removed.`); } catch (e) { setErr(friendlyError(e)); setBusy(false); }
  }

  return (
    <div className="sh-form">
      {!f.id && (
        <label className="field"><span>Find in People (or type below)</span>
          <input value={find} placeholder="Type a name" onChange={(e) => setFind(e.target.value)} />
        </label>
      )}
      {matches.length > 0 && (
        <div className="chips">
          {matches.map((p) => (
            <button key={p.id} type="button" className="chip" onClick={() => { set({ name: p.fullName, phone: p.whatsapp || p.phone || '', email: p.email || '', personId: p.id }); setFind(''); }}>{p.fullName}</button>
          ))}
        </div>
      )}
      <label className="field"><span>Name</span><input value={f.name} maxLength={100} onChange={(e) => set({ name: e.target.value })} /></label>
      <div className="field-row">
        <label className="field"><span>Phone (WhatsApp)</span><input value={f.phone} inputMode="tel" placeholder="07…" onChange={(e) => set({ phone: e.target.value })} /></label>
        <label className="field"><span>Email</span><input value={f.email} type="email" onChange={(e) => set({ email: e.target.value })} /></label>
      </div>
      <fieldset className="field">
        <legend>Away dates</legend>
        {f.away.map((a, i) => (
          <div key={i} className="sh-away">
            <input type="date" aria-label="Away from" value={a.from} onChange={(e) => set({ away: f.away.map((x, j) => (j === i ? { ...x, from: e.target.value, to: x.to < e.target.value ? e.target.value : x.to } : x)) })} />
            <span>to</span>
            <input type="date" aria-label="Away until" value={a.to} min={a.from} onChange={(e) => set({ away: f.away.map((x, j) => (j === i ? { ...x, to: e.target.value } : x)) })} />
            <button type="button" className="btn btn-small" aria-label="Remove these dates" onClick={() => set({ away: f.away.filter((_, j) => j !== i) })}>✕</button>
          </div>
        ))}
        <button type="button" className="btn btn-small" onClick={() => { const d = localDateKey(); set({ away: [...f.away, { from: d, to: d }] }); }}>+ Add away dates</button>
      </fieldset>
      {f.id && <label className="sh-check"><input type="checkbox" checked={!f.active} onChange={(e) => set({ active: !e.target.checked })} /> Resting for now (not suggested, keeps their history)</label>}
      {err && <p className="error" role="alert">{err}</p>}
      <div className="sh-actions">
        <button type="button" className="btn btn-primary" disabled={busy || f.name.trim().length < 2} onClick={() => void save()}>{busy ? 'Saving…' : f.id ? 'Save' : 'Add'}</button>
        <button type="button" className="btn" disabled={busy} onClick={() => done()}>Cancel</button>
        {f.id && <button type="button" className="btn btn-danger" disabled={busy} onClick={() => void remove()}>Remove</button>}
      </div>
    </div>
  );
}

function SettingsFold({ team, orgId, serviceTimes, say }: { team: Team; orgId: string; serviceTimes?: string[]; say: Say }) {
  const s = useHostSettings(team, orgId, serviceTimes);
  return (
    <details className="card sh-fold">
      <summary><strong>{team === 'prayer' ? 'Prayer times' : 'Services'} and requirements document</strong></summary>
      <DocBox team={team} orgId={orgId} doc={s.doc} say={say} />
      <ServicesBox team={team} key={JSON.stringify([s.services, s.specials])} orgId={orgId} settings={s} say={say} />
    </details>
  );
}

function DocBox({ team, orgId, doc, say }: { team: Team; orgId: string; doc: HostSettings['doc']; say: Say }) {
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  // Only Mr Andrew and Doreen put up, replace or remove the document; everyone else only opens it (Andy, 2026-11-27).
  const { profile } = useAuth();
  const keeper = canKeepAccounts(profile);
  async function upload(file: File | undefined) {
    if (!file) return;
    if (file.size > DOC_MAX_BYTES) { say('The document must be smaller than 6 MB.'); return; }
    setBusy(true);
    try { await hostCall({ team, orgId, action: 'uploadDoc', name: file.name, base64: await toBase64(file) }); say('The requirements document is saved. It goes with every email from now on.'); }
    catch (e) { say(friendlyError(e)); } finally { setBusy(false); if (input.current) input.current.value = ''; }
  }
  async function view() {
    setBusy(true);
    try { const r = await hostCall<{ name: string; type: string; base64: string }>({ team, orgId, action: 'downloadDoc' }); downloadFile(fromBase64(r.base64, r.name, r.type)); }
    catch (e) { say(friendlyError(e)); } finally { setBusy(false); }
  }
  return (
    <div className="sh-doc">
      <h3>Requirements document</h3>
      <p className="muted small">Sent with the welcome email and every reminder.</p>
      {doc ? <p>📄 <strong>{doc.name}</strong> <span className="muted small">· {Math.max(1, Math.round(doc.size / 1024))} KB</span></p> : <p className="notice-warn notice">{keeper ? `No document yet. Upload your ${TEAM_INFO[team].role} requirements (PDF or Word).` : 'No document yet. Mr Andrew or Doreen will put it here.'}</p>}
      <input ref={input} type="file" hidden accept=".pdf,.doc,.docx,.odt,.txt" onChange={(e) => void upload(e.target.files?.[0])} />
      <div className="sh-actions">
        {keeper && <button type="button" className="btn btn-primary btn-small" disabled={busy} onClick={() => input.current?.click()}>{busy ? 'Please wait…' : doc ? 'Replace' : 'Upload document'}</button>}
        {doc && <button type="button" className="btn btn-small" disabled={busy} onClick={() => void view()}>Open</button>}
        {doc && keeper && <button type="button" className="btn btn-small" disabled={busy} onClick={() => { if (window.confirm('Remove the requirements document?')) void hostCall({ team, orgId, action: 'removeDoc' }).catch((e) => say(friendlyError(e))); }}>Remove</button>}
      </div>
    </div>
  );
}

function ServicesBox({ team, orgId, settings, say }: { team: Team; orgId: string; settings: HostSettings; say: Say }) {
  const [services, setServices] = useState<HostService[]>(settings.services);
  const [specials, setSpecials] = useState<SpecialService[]>(settings.specials.filter((x) => x.date >= localDateKey()));
  const [busy, setBusy] = useState(false);
  async function save() {
    setBusy(true);
    try { await hostCall({ team, orgId, action: 'saveSettings', services, specials }); say('Services saved.'); } catch (e) { say(friendlyError(e)); } finally { setBusy(false); }
  }
  return (
    <div className="sh-services">
      <h3>{team === 'prayer' ? 'Prayer times that need a leader' : 'Services that need a host'}</h3>
      {services.map((sv, i) => (
        <div key={sv.key} className="sh-svc">
          <input aria-label="Service name" value={sv.name} maxLength={60} onChange={(e) => setServices(services.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))} />
          <select aria-label="Day" value={sv.weekday} onChange={(e) => setServices(services.map((x, j) => (j === i ? { ...x, weekday: Number(e.target.value) } : x)))}>
            {WEEKDAYS.map((w, k) => <option key={w} value={k}>{w}</option>)}
          </select>
          <input aria-label="Time" type="time" value={sv.time} onChange={(e) => setServices(services.map((x, j) => (j === i ? { ...x, time: e.target.value } : x)))} />
          {services.length > 1 && <button type="button" className="btn btn-small" aria-label="Remove this service" onClick={() => setServices(services.filter((_, j) => j !== i))}>✕</button>}
        </div>
      ))}
      <button type="button" className="btn btn-small" onClick={() => setServices([...services, { key: `svc${Date.now().toString(36)}`, name: team === 'prayer' ? 'Midweek prayer' : 'Bible study', weekday: 3, time: '20:00' }])}>+ Add a weekly service</button>
      <h3>{team === 'prayer' ? 'Special prayer times (one date)' : 'Special services (one date)'}</h3>
      {specials.map((sp, i) => (
        <div key={sp.key} className="sh-svc">
          <input aria-label="Service name" value={sp.name} maxLength={60} onChange={(e) => setSpecials(specials.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))} />
          <input aria-label="Date" type="date" value={sp.date} onChange={(e) => setSpecials(specials.map((x, j) => (j === i ? { ...x, date: e.target.value } : x)))} />
          <input aria-label="Time" type="time" value={sp.time} onChange={(e) => setSpecials(specials.map((x, j) => (j === i ? { ...x, time: e.target.value } : x)))} />
          <button type="button" className="btn btn-small" aria-label="Remove this service" onClick={() => setSpecials(specials.filter((_, j) => j !== i))}>✕</button>
        </div>
      ))}
      <button type="button" className="btn btn-small" onClick={() => setSpecials([...specials, { key: `x${Date.now().toString(36)}`, name: team === 'prayer' ? 'Special prayer' : 'Special service', date: addDays(localDateKey(), 7), time: '18:00' }])}>+ Add a special service</button>
      <div><button type="button" className="btn btn-primary" disabled={busy} onClick={() => void save()}>{busy ? 'Saving…' : 'Save services'}</button></div>
    </div>
  );
}

