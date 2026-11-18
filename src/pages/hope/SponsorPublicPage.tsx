import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { useParams } from 'react-router-dom';
import { HOPE_CLASSES } from '../../../functions/src/shared/hopeClasses';
import { amountLabel, DATA_CONSENT, MAX_CHILDREN, namesList, bankLines, SAFETY_PROMISE } from '../../../functions/src/shared/hopeSponsorPage';
import { Stone } from '../../components/Stone';
import { loadSponsorPage, loadSponsorPhoto, sendPledge, sponsorError, type PledgeResult, type SponsorPageData } from '../../lib/hopeSponsor';
import './sponsor.css';

const COUNTRIES = ['Kenya', 'Uganda', 'Tanzania', 'Rwanda', 'South Africa', 'United Kingdom', 'United States', 'Canada', 'Germany', 'Netherlands', 'Norway', 'Sweden', 'Australia', 'Other'];

/**
 * The public sponsorship page (Andy, 2026-11-18): anyone may open it, no sign-in. Well-wishers see the children with
 * no sponsor yet and can only look and choose; nothing here changes a child's details.
 */
export function SponsorPublicPage() {
  const { orgId = '' } = useParams();
  const [data, setData] = useState<SponsorPageData | null>(null);
  const [error, setError] = useState('');
  const [photos, setPhotos] = useState<Record<string, string>>({});
  const [picked, setPicked] = useState<string[]>([]);
  const [general, setGeneral] = useState(false);
  const [open, setOpen] = useState(false);
  const [sent, setSent] = useState<(PledgeResult & { first: string; email: string }) | null>(null);
  const [note, setNote] = useState('');

  useEffect(() => {
    document.title = 'Sponsor a child · Freedom Hope Centre';
    loadSponsorPage(orgId).then(setData, (err) => setError(sponsorError(err, 'We could not open the page. Please check your internet and try again.')));
  }, [orgId]);

  // Photos come one by one after the page shows, four at a time.
  useEffect(() => {
    if (!data) return;
    const queue = data.children.filter((c) => c.photo).map((c) => c.key);
    let stop = false;
    const next = async () => {
      while (!stop && queue.length) {
        const key = queue.shift()!;
        const photo = await loadSponsorPhoto(orgId, key).catch(() => '');
        if (photo && !stop) setPhotos((p) => ({ ...p, [key]: photo }));
      }
    };
    void Promise.all([next(), next(), next(), next()]);
    return () => { stop = true; };
  }, [data, orgId]);

  const flash = (m: string) => { setNote(m); window.setTimeout(() => setNote(''), 2200); };
  const toggle = (key: string) => setPicked((p) => {
    if (p.includes(key)) return p.filter((k) => k !== key);
    if (p.length >= MAX_CHILDREN) { flash(`You can choose up to ${MAX_CHILDREN} children at a time.`); return p; }
    return [...p, key];
  });
  const byKey = useMemo(() => new Map((data?.children ?? []).map((c) => [c.key, c])), [data]);
  const chosen = [...picked.map((k) => byKey.get(k)?.name ?? ''), ...(general ? ['the Hope Centre'] : [])].filter(Boolean);

  if (error) return <div className="sp"><div className="sp-wrap"><p className="sp-error">{error}</p></div></div>;
  if (!data) return <div className="sp"><div className="sp-wrap"><p className="sp-loading">Opening the Hope Centre…</p></div></div>;
  if (sent) return <ThankYou data={data} sent={sent} onBack={() => { setSent(null); setPicked([]); setGeneral(false); void loadSponsorPage(orgId).then(setData, () => undefined); window.scrollTo(0, 0); }} />;

  const waiting = data.children.filter((c) => !c.held).length;
  const amount = amountLabel(data.settings.amount, data.settings.per);
  return (
    <div className="sp">
      <header className="sp-hero">
        <div className="sp-wrap">
          <p className="sp-brand"><span className="sp-heart" aria-hidden="true">♥</span>Freedom Hope Centre · Nairobi</p>
          <h1>Choose a child to <em>walk with</em></h1>
          <p className="sp-lead">Every Saturday, children come to the Hope Centre for a meal, lessons, mentoring and play. The children below do not have a sponsor yet. Your gift helps with school fees, meals and uniforms.</p>
          <div className="sp-facts">
            <span>{waiting} {waiting === 1 ? 'child' : 'children'} waiting</span>
            {amount && <span>Suggested {amount}</span>}
            <span>Any amount helps</span>
          </div>
        </div>
      </header>

      <main className="sp-wrap">
        <h2>Not ready to pick one child?</h2>
        <button type="button" className={`sp-general${general ? ' on' : ''}`} aria-pressed={general} onClick={() => setGeneral((g) => !g)}>
          <span className="sp-gift" aria-hidden="true">🎁</span>
          <span><b>Support the Hope Centre</b><span>Meals, books, uniforms and Saturday programmes for all the children.</span></span>
          <span className="sp-tick" aria-hidden="true">✓</span>
        </button>

        <h2>Children waiting for a sponsor</h2>
        <p className="sp-sub">Tap one or more children (up to {MAX_CHILDREN}).</p>
        {data.children.length === 0 ? <p className="sp-empty">Every child has a sponsor right now. Thank you! You can still support the Hope Centre above.</p> : (
          <div className="sp-grid">
            {data.children.map((c) => {
              const stone = HOPE_CLASSES.find((s) => s.id === c.stone) ?? null;
              const on = picked.includes(c.key);
              return (
                <button key={c.key} type="button" className={`sp-kid${on ? ' on' : ''}${c.held ? ' held' : ''}`} aria-pressed={on} disabled={c.held} onClick={() => toggle(c.key)}>
                  <span className="sp-pic">
                    {photos[c.key] ? <img src={photos[c.key]} alt="" loading="lazy" /> : <span className="sp-initial" style={stone ? { color: stone.colour } : undefined}>{c.name[0]}</span>}
                  </span>
                  {c.held && <span className="sp-held">Someone is sponsoring</span>}
                  <span className="sp-tick" aria-hidden="true">✓</span>
                  <span className="sp-body">
                    <span className="sp-name">{c.name}</span>
                    <span className="sp-meta">{stone && <Stone c={stone} size={16} />}{[c.age != null ? `${c.age} years` : '', stone?.name ?? ''].filter(Boolean).join(' · ')}</span>
                    {c.bio && <span className="sp-bio">{c.bio}</span>}
                    {c.amount && c.amount !== data.settings.amount && <span className="sp-amt">Suggested {amountLabel(c.amount, data.settings.per)}</span>}
                  </span>
                </button>
              );
            })}
          </div>
        )}
        <p className="sp-privacy">To protect the children, we show first names only. Details are kept by the Hope Centre and cannot be changed from this page.</p>
        <p className="sp-powered">Powered by Insight-IQ</p>
      </main>

      <div className="sp-bar">
        <div className="sp-bar-in">
          <span>{chosen.length ? `You chose ${namesList(chosen)}` : 'Pick a child or the Hope Centre'}</span>
          <button type="button" className="sp-btn" disabled={!chosen.length} onClick={() => setOpen(true)}>Continue</button>
        </div>
      </div>
      {open && <PledgeForm orgId={orgId} chosen={chosen} childIds={picked} general={general} onClose={() => setOpen(false)}
        onSent={(r) => { setOpen(false); setSent(r); window.scrollTo(0, 0); }} />}
      {note && <div className="sp-toast" role="status">{note}</div>}
    </div>
  );
}

function PledgeForm({ orgId, chosen, childIds, general, onClose, onSent }: {
  orgId: string; chosen: string[]; childIds: string[]; general: boolean; onClose: () => void; onSent: (r: PledgeResult & { first: string; email: string }) => void;
}) {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [country, setCountry] = useState('');
  const [website, setWebsite] = useState('');
  const [promise, setPromise] = useState(false);
  const [consent, setConsent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (name.trim().length < 2) { setError('Please write your name.'); return; }
    if (childIds.length && !promise) { setError('Please tick the promise to keep the children safe.'); return; }
    if (!consent) { setError('Please tick that we may keep your details.'); return; }
    setBusy(true); setError('');
    try {
      const r = await sendPledge(orgId, { childIds, general, name, email, phone, country, website, promise, dataConsent: consent });
      onSent({ ...r, first: name.trim().split(/\s+/)[0] ?? '', email: email.trim() });
    } catch (err) { setError(sponsorError(err, 'We could not send your details. Please check your internet and try again.')); setBusy(false); }
  };
  return (
    <div className="sp-sheet" role="dialog" aria-modal="true" aria-labelledby="sp-form-title">
      <form className="sp-card" onSubmit={(e) => void submit(e)} noValidate>
        <h3 id="sp-form-title">Thank you for your kind heart</h3>
        <div className="sp-chips">{chosen.map((n) => <span key={n}>{n}</span>)}</div>
        <label htmlFor="sp-name">Your name<input id="sp-name" value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" required autoFocus /></label>
        <label htmlFor="sp-email">Email <small>optional, we send your thank-you note here</small><input id="sp-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" /></label>
        <label htmlFor="sp-phone">Phone number <small>optional</small><input id="sp-phone" type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} autoComplete="tel" /></label>
        <label htmlFor="sp-country">Country <small>optional</small>
          <select id="sp-country" value={country} onChange={(e) => setCountry(e.target.value)}>
            <option value="">Choose</option>
            {COUNTRIES.map((c) => <option key={c}>{c}</option>)}
          </select>
        </label>
        {/* Left empty by people; robots fill it in (12A). */}
        <input className="sp-hp" tabIndex={-1} autoComplete="off" aria-hidden="true" value={website} onChange={(e) => setWebsite(e.target.value)} name="website" />
        {childIds.length > 0 && (
          <label className="sp-tickline" htmlFor="sp-promise"><input id="sp-promise" type="checkbox" checked={promise} onChange={(e) => { setPromise(e.target.checked); setError(''); }} /><span><b>Child-safety promise.</b> {SAFETY_PROMISE}</span></label>
        )}
        <label className="sp-tickline" htmlFor="sp-consent"><input id="sp-consent" type="checkbox" checked={consent} onChange={(e) => { setConsent(e.target.checked); setError(''); }} /><span>{DATA_CONSENT} We never share them.</span></label>
        {error && <p className="sp-err" role="alert">{error}</p>}
        <div className="sp-row">
          <button type="button" className="sp-btn ghost" onClick={onClose} disabled={busy}>Back</button>
          <button type="submit" className="sp-btn" disabled={busy}>{busy ? 'Sending…' : 'Send'}</button>
        </div>
      </form>
    </div>
  );
}

function ThankYou({ data, sent, onBack }: { data: SponsorPageData; sent: PledgeResult & { first: string; email: string }; onBack: () => void }) {
  const [copied, setCopied] = useState('');
  const s = data.settings;
  const copy = () => {
    const txt = bankLines(s, sent.ref).join('\n').trim();
    navigator.clipboard?.writeText(txt).then(() => setCopied('Bank details copied'), () => setCopied('Press and hold the details to copy them'));
    window.setTimeout(() => setCopied(''), 2500);
  };
  const one = sent.names.length === 1 && sent.names[0] !== 'the Hope Centre';
  return (
    <div className="sp">
      <div className="sp-wrap">
        <article className="sp-letter">
          <p className="sp-brand"><span className="sp-heart" aria-hidden="true">♥</span>Freedom Hope Centre</p>
          <h1>Thank you, {sent.first}!</h1>
          <p>Your love for {namesList(sent.names)} means more than words can say. Because of people like you, the children at Freedom Hope Centre can stay in school, eat well and grow up knowing they are loved.</p>
          <p>Please send your gift to the account below and write <b>{sent.ref}</b> as the reference, so we know it is from you.{sent.amount ? ` The suggested gift is ${sent.amount} for each child, but any amount helps.` : ''}</p>
          {s.banks.map((b, i) => (
            <dl key={i} className="sp-bank">
              <div><dt>Bank</dt><dd>{b.bank}{b.branch ? `, ${b.branch}` : ''}</dd></div>
              {b.accountName && <div><dt>Account name</dt><dd>{b.accountName}</dd></div>}
              {b.accountNumber && <div><dt>Account number</dt><dd>{b.accountNumber}</dd></div>}
              {b.swift && <div><dt>SWIFT code</dt><dd>{b.swift}</dd></div>}
              {b.note && <div><dt>Note</dt><dd>{b.note}</dd></div>}
            </dl>
          ))}
          {s.paybill && (
            <dl className="sp-bank">
              <div><dt>M-Pesa Paybill</dt><dd>{s.paybill}</dd></div>
              <div><dt>Account</dt><dd>{sent.ref}</dd></div>
            </dl>
          )}
          <p className="sp-ref">Your reference: <b>{sent.ref}</b></p>
          <div className="sp-row start">
            <button type="button" className="sp-btn" onClick={copy}>Copy bank details</button>
            <button type="button" className="sp-btn ghost" onClick={onBack}>See the children again</button>
          </div>
          {copied && <p className="sp-small" role="status">{copied}</p>}
          <p className="sp-small">{sent.email ? `We have also sent this note to ${sent.email}.` : 'Keep this page or copy the details above.'} Once your gift arrives, we will send you news and a photo of {one ? sent.names[0] : 'the children'} each term.</p>
          <p className="sp-small">With love and gratitude,<br /><b>Freedom Hope Centre</b> · Freedom Church Nairobi · 0794 645 455</p>
          <p className="sp-powered"><img src="/logo-mark.png" alt="" width={16} height={16} />Powered by Insight-IQ</p>
        </article>
      </div>
    </div>
  );
}
