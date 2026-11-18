import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { useParams } from 'react-router-dom';
import { HOPE_CLASSES } from '../../../functions/src/shared/hopeClasses';
import {
  amountLabel, DATA_CONSENT, DEFAULT_DROP_OFF, giftLines, MAX_CHILDREN, MAX_QTY, namesList, bankLines, needCost, NEED_GROUPS, OTHER_MAX, SAFETY_PROMISE,
  type GiveBy, type Often, type SponsorNeed,
} from '../../../functions/src/shared/hopeSponsorPage';
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
  const [gift, setGift] = useState<GiftPick>(EMPTY_GIFT);
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
  const giftCount = Object.keys(gift.needs).length + (gift.otherOn && gift.other.trim() ? 1 : 0) + (gift.most && gift.giveBy === 'money' ? 1 : 0);
  const next = () => {
    if (general && !giftCount) { flash(gift.otherOn ? 'Please write what you would like to give.' : 'Please tick what you would like to give for the Hope Centre.'); return; }
    setOpen(true);
  };

  if (error) return <div className="sp"><div className="sp-wrap"><p className="sp-error">{error}</p></div></div>;
  if (!data) return <div className="sp"><div className="sp-wrap"><p className="sp-loading">Opening the Hope Centre…</p></div></div>;
  if (sent) return <ThankYou data={data} sent={sent} onBack={() => { setSent(null); setPicked([]); setGeneral(false); setGift(EMPTY_GIFT); void loadSponsorPage(orgId).then(setData, () => undefined); window.scrollTo(0, 0); }} />;

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
          <span><b>Support the Hope Centre</b><span>Food, school things, clothes, health and more for all the children. Tap to see the list.</span></span>
          <span className="sp-tick" aria-hidden="true">✓</span>
        </button>
        {general && <NeedsPicker needs={data.settings.needs} gift={gift} setGift={setGift} flash={flash} />}

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
          <span>{chosen.length ? `You chose ${namesList(chosen)}${general && giftCount ? ` (${giftCount} ${giftCount === 1 ? 'gift' : 'gifts'})` : ''}` : 'Pick a child or the Hope Centre'}</span>
          <button type="button" className="sp-btn" disabled={!chosen.length} onClick={next}>Continue</button>
        </div>
      </div>
      {open && <PledgeForm orgId={orgId} chosen={chosen} childIds={picked} general={general} gift={general ? giftForm(gift) : null} giftList={general ? giftLines(giftPreview(gift, data.settings.needs)) : []} onClose={() => setOpen(false)}
        onSent={(r) => { setOpen(false); setSent(r); window.scrollTo(0, 0); }} />}
      {note && <div className="sp-toast" role="status">{note}</div>}
    </div>
  );
}

function PledgeForm({ orgId, chosen, childIds, general, gift, giftList, onClose, onSent }: {
  orgId: string; chosen: string[]; childIds: string[]; general: boolean; gift: Record<string, unknown> | null; giftList: string[]; onClose: () => void; onSent: (r: PledgeResult & { first: string; email: string }) => void;
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
      const r = await sendPledge(orgId, { childIds, general, gift, name, email, phone, country, website, promise, dataConsent: consent });
      onSent({ ...r, first: name.trim().split(/\s+/)[0] ?? '', email: email.trim() });
    } catch (err) { setError(sponsorError(err, 'We could not send your details. Please check your internet and try again.')); setBusy(false); }
  };
  return (
    <div className="sp-sheet" role="dialog" aria-modal="true" aria-labelledby="sp-form-title">
      <form className="sp-card" onSubmit={(e) => void submit(e)} noValidate>
        <h3 id="sp-form-title">Thank you for your kind heart</h3>
        <div className="sp-chips">{chosen.map((n) => <span key={n}>{n}</span>)}</div>
        {giftList.length > 0 && <ul className="sp-giftlist">{giftList.map((l) => <li key={l}>{l}</li>)}</ul>}
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
  const kids = sent.names.filter((n) => n !== 'the Hope Centre').length;
  const money = sent.money !== false;
  const items = sent.gift?.giveBy === 'items';
  const lines = giftLines(sent.gift);
  return (
    <div className="sp">
      <div className="sp-wrap">
        <article className="sp-letter">
          <p className="sp-brand"><span className="sp-heart" aria-hidden="true">♥</span>Freedom Hope Centre</p>
          <h1>Thank you, {sent.first}!</h1>
          <p>Your love for {namesList(sent.names)} means more than words can say. Because of people like you, the children at Freedom Hope Centre can stay in school, eat well and grow up knowing they are loved.</p>
          {lines.length > 0 && (
            <div className="sp-bank sp-giftbox">
              <b>For the Hope Centre you chose{items ? ' to bring' : ''}:</b>
              <ul className="sp-giftlist">{lines.map((l) => <li key={l}>{l}</li>)}</ul>
            </div>
          )}
          {items && <p className="sp-bank sp-dropoff"><b>📦 Bringing the items</b><span>{s.dropOff || DEFAULT_DROP_OFF} Please mention <b>{sent.ref}</b>.</span></p>}
          {money && <>
          <p>Please send your gift{items ? ' for the children' : ''} to the account below and write <b>{sent.ref}</b> as the reference, so we know it is from you.{sent.amount && kids ? ` The suggested gift is ${sent.amount} for each child, but any amount helps.` : ''}</p>
          {s.banks.map((b, i) => (
            <dl key={i} className="sp-bank">
              <div><dt>Bank</dt><dd>{b.bank}{b.branch ? `, ${b.branch}` : ''}</dd></div>
              {b.accountName && <div><dt>Account name</dt><dd>{b.accountName}</dd></div>}
              {b.accountNumber && <div><dt>Account number</dt><dd>{b.accountNumber}</dd></div>}
              {b.swift && <div><dt>SWIFT code</dt><dd>{b.swift}</dd></div>}
              {b.bankCode && <div><dt>Bank code</dt><dd>{b.bankCode}</dd></div>}
              {b.branchCode && <div><dt>Branch code</dt><dd>{b.branchCode}</dd></div>}
              {b.note && <div><dt>Note</dt><dd>{b.note}</dd></div>}
            </dl>
          ))}
          {s.paybill && (
            <dl className="sp-bank">
              <div><dt>M-Pesa Paybill</dt><dd>{s.paybill}</dd></div>
              <div><dt>Account</dt><dd>{sent.ref}</dd></div>
            </dl>
          )}
          </>}
          <p className="sp-ref">Your reference: <b>{sent.ref}</b></p>
          <div className="sp-row start">
            {money && <button type="button" className="sp-btn" onClick={copy}>Copy bank details</button>}
            <button type="button" className="sp-btn ghost" onClick={onBack}>See the children again</button>
          </div>
          {copied && <p className="sp-small" role="status">{copied}</p>}
          <p className="sp-small">{sent.email ? `We have also sent this note to ${sent.email}.` : 'Keep this page or copy the details above.'}{kids ? ` Once your gift arrives, we will send you news and a photo of ${one ? sent.names[0] : 'the children'} each term.` : ' When your gift reaches the children, we will let you know.'}</p>
          <p className="sp-small">With love and gratitude,<br /><b>Freedom Hope Centre</b> · Freedom Church Nairobi · 0794 645 455</p>
          <p className="sp-powered"><img src="/logo-mark.png" alt="" width={16} height={16} />Powered by Insight-IQ</p>
        </article>
      </div>
    </div>
  );
}


/** What the giver has ticked for the Hope Centre, while they choose. */
interface GiftPick { needs: Record<string, number>; giveBy: GiveBy; most: boolean; mostAmount: string; often: Often; otherOn: boolean; other: string }
const EMPTY_GIFT: GiftPick = { needs: {}, giveBy: 'money', most: false, mostAmount: '', often: 'once', otherOn: false, other: '' };

const giftForm = (g: GiftPick) => ({
  giveBy: g.giveBy, other: g.otherOn ? g.other.trim() : '',
  needs: Object.entries(g.needs).map(([id, qty]) => ({ id, qty })),
  mostNeeded: g.giveBy === 'money' && g.most ? { amount: g.mostAmount, often: g.often } : null,
});
/** The same choices in the shape of a saved gift, to list and add up on the screen. */
function giftPreview(g: GiftPick, list: readonly SponsorNeed[]) {
  const amt = Number(g.mostAmount.replace(/[,\s]/g, ''));
  return {
    giveBy: g.giveBy, other: g.otherOn ? g.other.trim() : '',
    needs: list.filter((n) => n.id in g.needs).map((n) => ({ id: n.id, label: n.label, qty: n.count ? g.needs[n.id]! : null, cost: n.cost })),
    mostNeeded: g.giveBy === 'money' && g.most ? { amount: Number.isFinite(amt) && amt >= 1 ? Math.round(amt) : null, often: g.often } : null,
  };
}

/**
 * The needs list under "Support the Hope Centre" (Andy, 2026-11-18, 1A-10A): money or items (3A), "Where most needed"
 * (9A), the starred "Most needed now" first (5A), each item with its typical cost (2A) and a "how many" box (4A), and
 * Others with a box to write in.
 */
function NeedsPicker({ needs, gift, setGift, flash }: { needs: SponsorNeed[]; gift: GiftPick; setGift: (f: (g: GiftPick) => GiftPick) => void; flash: (m: string) => void }) {
  const set = (patch: Partial<GiftPick>) => setGift((g) => ({ ...g, ...patch }));
  const toggle = (n: SponsorNeed) => setGift((g) => {
    const next = { ...g.needs };
    if (n.id in next) delete next[n.id]; else next[n.id] = 1;
    return { ...g, needs: next };
  });
  const qty = (n: SponsorNeed, v: number) => setGift((g) => ({ ...g, needs: { ...g.needs, [n.id]: Math.max(1, Math.min(MAX_QTY, Math.round(v) || 1)) } }));
  const stars = needs.filter((n) => n.star);
  const total = giftPreview(gift, needs).needs.reduce((t, n) => t + (n.cost ?? 0) * (n.qty ?? 1), 0);
  const item = (n: SponsorNeed) => {
    const on = n.id in gift.needs;
    return (
      <div key={n.id} className={`sp-need${on ? ' on' : ''}`}>
        <button type="button" className="sp-need-tick" aria-pressed={on} onClick={() => toggle(n)}>
          <span className="sp-box" aria-hidden="true">✓</span>
          <span className="sp-need-text"><span>{n.star && <span aria-label="Most needed">⭐ </span>}{n.label}</span>{n.cost ? <small>{needCost(n)}</small> : null}</span>
        </button>
        {on && n.count && (
          <span className="sp-qty" role="group" aria-label={`How many: ${n.label}`}>
            <button type="button" onClick={() => qty(n, gift.needs[n.id]! - 1)} aria-label="One less">−</button>
            <input inputMode="numeric" value={gift.needs[n.id]} onChange={(e) => qty(n, Number(e.target.value.replace(/\D/g, '')))} aria-label="How many" />
            <button type="button" onClick={() => { if (gift.needs[n.id]! >= MAX_QTY) flash('Thank you! Please call us for very large gifts.'); qty(n, gift.needs[n.id]! + 1); }} aria-label="One more">+</button>
          </span>
        )}
      </div>
    );
  };
  return (
    <section className="sp-needs" aria-label="The Hope Centre's needs">
      <p className="sp-needs-q">How would you like to give?</p>
      <div className="sp-give">
        <button type="button" className={gift.giveBy === 'money' ? 'on' : ''} aria-pressed={gift.giveBy === 'money'} onClick={() => set({ giveBy: 'money' })}><span aria-hidden="true">💳</span> Send money<small>We buy what you tick</small></button>
        <button type="button" className={gift.giveBy === 'items' ? 'on' : ''} aria-pressed={gift.giveBy === 'items'} onClick={() => set({ giveBy: 'items' })}><span aria-hidden="true">📦</span> Bring the items<small>Drop them at the Hope Centre</small></button>
      </div>

      {gift.giveBy === 'money' && (
        <div className={`sp-need sp-most${gift.most ? ' on' : ''}`}>
          <button type="button" className="sp-need-tick" aria-pressed={gift.most} onClick={() => set({ most: !gift.most })}>
            <span className="sp-box" aria-hidden="true">✓</span>
            <span className="sp-need-text"><span><b>💛 Where most needed</b></span><small>Any amount. The Hope Centre uses it where the children need it most.</small></span>
          </button>
          {gift.most && (
            <span className="sp-most-in">
              <input inputMode="numeric" placeholder="Amount in KES (optional)" value={gift.mostAmount} onChange={(e) => set({ mostAmount: e.target.value })} aria-label="Amount in KES" />
              <select value={gift.often} onChange={(e) => set({ often: e.target.value as Often })} aria-label="How often">
                <option value="once">Once</option>
                <option value="monthly">Every month</option>
              </select>
            </span>
          )}
        </div>
      )}

      {stars.length > 0 && (
        <div className="sp-group sp-stars">
          <h3>⭐ Most needed now</h3>
          {stars.map(item)}
        </div>
      )}
      <p className="sp-sub sp-fold-hint">Tap a group to see what is needed.</p>
      {NEED_GROUPS.map((g) => {
        const list = needs.filter((n) => n.group === g.id && !n.star);
        if (!list.length) return null;
        const ticked = list.filter((n) => n.id in gift.needs).length;
        // Each group folds so the list stays short on a phone (simplicity); tap a group to open it.
        return (
          <details key={g.id} className="sp-group sp-fold">
            <summary><span aria-hidden="true">{g.icon}</span> {g.label}<small>{ticked ? `${ticked} ticked` : `${list.length} items`}</small></summary>
            {list.map(item)}
          </details>
        );
      })}
      <div className="sp-group">
        <h3><span aria-hidden="true">✏️</span> Others</h3>
        <div className={`sp-need${gift.otherOn ? ' on' : ''}`}>
          <button type="button" className="sp-need-tick" aria-pressed={gift.otherOn} onClick={() => set({ otherOn: !gift.otherOn })}>
            <span className="sp-box" aria-hidden="true">✓</span>
            <span className="sp-need-text"><span>Something else</span><small>Tell us what you would like to give</small></span>
          </button>
        </div>
        {gift.otherOn && (
          <label className="sp-other">What would you like to give?
            <textarea rows={2} maxLength={OTHER_MAX} value={gift.other} onChange={(e) => set({ other: e.target.value })} placeholder="e.g. a bicycle for the centre, or 20 story books" autoFocus />
          </label>
        )}
      </div>
      {total > 0 && <p className="sp-estimate">Typical cost of what you ticked: <b>about KES {total.toLocaleString('en-US')}</b>. Any amount helps.</p>}
    </section>
  );
}
