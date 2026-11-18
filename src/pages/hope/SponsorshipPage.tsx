import { useCallback, useEffect, useMemo, useState } from 'react';
import QRCode from 'qrcode';
import { doc, getDoc } from 'firebase/firestore';
import { db } from '../../firebase';
import { useClubs, useHope, useHopeDays } from '../../state/useHope';
import { ageOn } from '../../../functions/src/shared/hope';
import { sponsorUpdatePdf } from '../../lib/sponsorUpdate';
import { sponsorPage } from './sponsorPages';
import { useAuth } from '../../state/AuthContext';
import { usePeople } from '../../state/PeopleContext';
import { useToast } from '../../state/ToastContext';
import type { Organization } from '../../state/OrgContext';
import { canDeletePhotoReport } from '../../../functions/src/shared/hopePhotos';
import { formatDateKey } from '../../../functions/src/shared/datetime';
import { normalizePhone } from '../../../functions/src/shared/phone';
import {
  AMOUNT_PER, AMOUNT_PER_LABELS, BIO_MAX, MAX_BANKS, amountLabel, cleanAmount, pledgeFor, thankYouText, type SponsorBank, type SponsorSettings,
} from '../../../functions/src/shared/hopeSponsorPage';
import {
  loadSponsorAdmin, markPledge, saveSponsorChild, saveSponsorSettings, sendSponsorUpdate, sponsorError, sponsorLink, type AdminChild, type PdfFile, type Pledge, type SponsorAdmin,
} from '../../lib/hopeSponsor';
import { HopeGate } from './common';
import { ConfirmDialog } from '../../components/ConfirmDialog';
import './sponsor.css';

type Tab = 'pledges' | 'children' | 'settings' | 'share';
const TABS: [Tab, string][] = [['pledges', 'Sponsors'], ['children', 'Children'], ['settings', 'Amount and bank'], ['share', 'Share the page']];

export function SponsorshipPage() {
  return <HopeGate title="Sponsorship">{(org) => <Sponsorship org={org} />}</HopeGate>;
}

/**
 * Sponsorship (Andy, 2026-11-18, 1): in the Hope menu, for Diana, Andy and Doreen. Who pledged and Money received
 * (10A), each child's bio, amount and Hide (4A, 5A), the suggested amount and bank details (5A, 8A), and the link and
 * QR poster to share (11A).
 */
function Sponsorship({ org }: { org: Organization }) {
  const { profile } = useAuth();
  const toast = useToast();
  const [tab, setTab] = useState<Tab>(() => (new URLSearchParams(window.location.search).get('tab') as Tab) || 'pledges');
  const [data, setData] = useState<SponsorAdmin | null>(null);
  const [error, setError] = useState('');
  const reload = useCallback(() => loadSponsorAdmin(org.id).then((d) => { setData(d); setError(''); }, (err) => setError(sponsorError(err))), [org.id]);
  useEffect(() => { void reload(); }, [reload]);

  if (!canDeletePhotoReport(profile, org.id)) {
    return <div className="page narrow"><h1>Sponsorship</h1><div className="card"><p>Only the Director, Mr Andrew or Doreen manage sponsorship.</p></div></div>;
  }
  const waiting = data?.pledges.filter((p) => p.state === 'waiting').length ?? 0;
  const pick = (t: Tab) => { setTab(t); const u = new URL(window.location.href); u.searchParams.set('tab', t); window.history.replaceState(null, '', u); };
  return (
    <div className="page">
      <h1>Sponsorship</h1>
      <p className="muted">Well-wishers choose a child on the public page and get the bank details. Here you see who pledged and mark the money when it arrives.</p>
      <div className="chips" role="tablist">
        {TABS.map(([t, label]) => (
          <button key={t} type="button" role="tab" aria-selected={tab === t} className={`chip${tab === t ? ' chip-on' : ''}`} onClick={() => pick(t)}>
            {label}{t === 'pledges' && waiting ? ` (${waiting})` : ''}
          </button>
        ))}
      </div>
      {error && <p className="error" role="alert">{error}</p>}
      {!data && !error && <p className="muted">Loading…</p>}
      {data && tab === 'pledges' && <Pledges org={org} data={data} reload={reload} toast={toast.show} />}
      {data && tab === 'children' && <Children org={org} data={data} reload={reload} toast={toast.show} />}
      {data && tab === 'settings' && <Settings org={org} settings={data.settings} onSaved={(s) => setData({ ...data, settings: s })} toast={toast.show} />}
      {tab === 'share' && <Share org={org} toast={toast.show} />}
    </div>
  );
}

type Show = (m: string) => void;

function Pledges({ org, data, reload, toast }: { org: Organization; data: SponsorAdmin; reload: () => Promise<void>; toast: Show }) {
  const [busy, setBusy] = useState('');
  const [sure, setSure] = useState<{ p: Pledge; action: 'received' | 'cancel' } | null>(null);
  const makePack = useSponsorPack(org, data);
  const waiting = data.pledges.filter((p) => p.state === 'waiting');
  const done = data.pledges.filter((p) => p.state !== 'waiting');
  const act = async (p: Pledge, action: 'received' | 'cancel') => {
    setBusy(p.id);
    try {
      // The welcome pack (4A): each child's Sponsor update, emailed with the thank-you.
      const pdf = action === 'received' && p.email && p.childIds.length ? await makePack(p).catch(() => null) : null;
      const r = await markPledge(org.id, p.id, action, pdf);
      toast(action === 'received' ? `Money received for ${p.ref}.${r.emailed ? ' A thank-you email went to the giver.' : ''}` : `${p.ref} cancelled. The children are back on the page.`);
      await reload();
    } catch (err) { toast(sponsorError(err)); }
    setBusy(''); setSure(null);
  };
  const update = async (p: Pledge) => {
    setBusy(p.id);
    try {
      const pdf = await makePack(p);
      await sendSponsorUpdate(org.id, p.id, pdf);
      toast(`The update went to ${p.email}.`);
      await reload();
    } catch (err) { toast(sponsorError(err)); }
    setBusy('');
  };
  const whatsapp = (p: Pledge) => {
    const phone = normalizePhone(p.phone);
    const text = thankYouText(p.name.split(/\s+/)[0] ?? p.name, pledgeFor(p.childNames, p.general), p.ref, data.settings);
    return `https://wa.me/${phone ? phone.replace(/^\+/, '') : ''}?text=${encodeURIComponent(text)}`;
  };
  const row = (p: Pledge) => (
    <article key={p.id} className="card sps-pledge">
      <div className="sps-pledge-head">
        <b>{p.ref}</b>
        <span className={`sps-pill ${p.state}`}>{p.state === 'waiting' ? 'Waiting for money' : p.state === 'received' ? 'Money received' : 'Cancelled'}</span>
      </div>
      <p className="sps-who"><b>{p.name}</b>{p.country ? ` · ${p.country}` : ''}</p>
      <p className="small">For <b>{pledgeFor(p.childNames, p.general).join(', ')}</b></p>
      <p className="small muted">{[p.email, p.phone].filter(Boolean).join(' · ') || 'No email or phone given'}</p>
      <p className="small muted">
        Chose on {formatDateKey(p.date)}
        {p.state === 'waiting' && p.childIds.length > 0 && ` · children held until ${formatDateKey(p.holdUntil)}`}
        {p.state === 'received' && p.receivedOn && ` · received ${formatDateKey(p.receivedOn)}${p.receivedByName ? ` by ${p.receivedByName}` : ''}`}
      </p>
      {p.state === 'waiting' && (
        <div className="dialog-actions">
          <button type="button" className="btn btn-primary btn-small" disabled={!!busy} onClick={() => setSure({ p, action: 'received' })}>Money received</button>
          {p.phone && <a className="btn btn-small" href={whatsapp(p)} target="_blank" rel="noopener noreferrer">🟢 Thank-you on WhatsApp</a>}
          <button type="button" className="btn btn-quiet btn-small" disabled={!!busy} onClick={() => setSure({ p, action: 'cancel' })}>Not coming</button>
        </div>
      )}
      {p.state === 'received' && p.email && p.childIds.length > 0 && (
        <div className="dialog-actions">
          <button type="button" className="btn btn-small" disabled={!!busy} onClick={() => void update(p)}>{busy === p.id ? 'Sending…' : '✉️ Send term update'}</button>
          {p.lastUpdateOn && <span className="small muted">Last sent {formatDateKey(p.lastUpdateOn)}</span>}
        </div>
      )}
    </article>
  );
  return (
    <>
      {waiting.length === 0 ? <div className="card"><p className="muted">No one is waiting. New pledges appear here and you get an email for each one.</p></div> : <div className="sps-list">{waiting.map(row)}</div>}
      {done.length > 0 && (
        <details className="card sps-done">
          <summary>Received and cancelled ({done.length})</summary>
          <div className="sps-list">{done.map(row)}</div>
        </details>
      )}
      <ConfirmDialog
        open={!!sure}
        title={sure?.action === 'received' ? `Has the money for ${sure.p.ref} arrived?` : `Cancel ${sure?.p.ref ?? ''}?`}
        body={!sure ? '' : sure.action === 'received'
          ? `${pledgeFor(sure.p.childNames, sure.p.general).join(', ')} will be marked Sponsored by ${sure.p.name}${sure.p.childIds.length ? ' and leave the public page' : ''}.${sure.p.email ? ' A thank-you email goes to the giver.' : ''}`
          : `Use this when the money is not coming.${sure.p.childIds.length ? ' The children go back on the public page straight away.' : ''}`}
        confirmLabel={busy ? 'Saving…' : sure?.action === 'received' ? 'Yes, money received' : 'Yes, cancel it'}
        onConfirm={() => { if (sure && !busy) void act(sure.p, sure.action); }}
        onCancel={() => { if (!busy) setSure(null); }}
      />
    </>
  );
}

type Filter = 'page' | 'hidden' | 'sponsored' | 'all';
function Children({ org, data, reload, toast }: { org: Organization; data: SponsorAdmin; reload: () => Promise<void>; toast: Show }) {
  const { byId } = usePeople();
  const [filter, setFilter] = useState<Filter>('page');
  const [open, setOpen] = useState('');
  const name = (id: string) => byId(id)?.fullName ?? 'Child';
  const rows = useMemo(() => data.children
    .filter((c) => filter === 'all' || (filter === 'sponsored' ? c.sponsored : filter === 'hidden' ? !c.sponsored && c.hidden : !c.sponsored && !c.hidden))
    .sort((a, b) => name(a.id).localeCompare(name(b.id))),
  [data.children, filter, byId]);
  const count = (f: Filter) => data.children.filter((c) => f === 'all' || (f === 'sponsored' ? c.sponsored : f === 'hidden' ? !c.sponsored && c.hidden : !c.sponsored && !c.hidden)).length;
  const missingBio = data.children.filter((c) => !c.sponsored && !c.hidden && !c.bio).length;
  return (
    <>
      <div className="card sps-filter">
        <label className="field">
          <span>Show</span>
          <select value={filter} onChange={(e) => setFilter(e.target.value as Filter)}>
            <option value="page">On the public page ({count('page')})</option>
            <option value="hidden">Hidden from the page ({count('hidden')})</option>
            <option value="sponsored">Already sponsored ({count('sponsored')})</option>
            <option value="all">All current children ({count('all')})</option>
          </select>
        </label>
        <p className="small muted">The public sees the first name, age, class stone, the short bio you write here and the photo (only where the parent said yes). Well-wishers cannot change any of it.{filter === 'page' && missingBio ? ` ${missingBio} still need a bio.` : ''}</p>
      </div>
      <div className="sps-list">
        {rows.map((c) => <ChildRow key={c.id} org={org} c={c} name={name(c.id)} open={open === c.id} onOpen={() => setOpen(open === c.id ? '' : c.id)} settings={data.settings} reload={reload} toast={toast} />)}
        {rows.length === 0 && <div className="card"><p className="muted">No children here.</p></div>}
      </div>
    </>
  );
}

function ChildRow({ org, c, name, open, onOpen, settings, reload, toast }: {
  org: Organization; c: AdminChild; name: string; open: boolean; onOpen: () => void; settings: SponsorSettings; reload: () => Promise<void>; toast: Show;
}) {
  const [bio, setBio] = useState(c.bio);
  const [amount, setAmount] = useState(c.amount ? String(c.amount) : '');
  const [hidden, setHidden] = useState(c.hidden);
  const [photoOk, setPhotoOk] = useState(c.photoOk);
  const [busy, setBusy] = useState(false);
  const first = name.split(/\s+/)[0] ?? name;
  const save = async () => {
    setBusy(true);
    try { await saveSponsorChild(org.id, c.id, { bio, hidden, amount: cleanAmount(amount), photoOk: photoOk && c.consent === true }); toast(`Saved for ${first}`); await reload(); } catch (err) { toast(sponsorError(err)); }
    setBusy(false);
  };
  const state = c.sponsored ? `Sponsored by ${c.sponsorName}` : c.hidden ? 'Hidden' : c.held ? 'Chosen, waiting for money' : 'On the page';
  return (
    <article className="card sps-child">
      <button type="button" className="sps-child-head" onClick={onOpen} aria-expanded={open}>
        <span className="grow"><b>{name}</b> <span className="small muted">{c.code}</span><br /><span className="small muted">{c.bio || (c.sponsored ? '' : 'No bio yet')}</span></span>
        <span className={`sps-pill ${c.sponsored ? 'received' : c.hidden ? 'cancelled' : c.held ? 'waiting' : 'page'}`}>{state}</span>
      </button>
      {open && (
        <div className="sps-child-edit">
          <p className="small muted">The page shows <b>{first}</b>{c.photo && c.photoOk ? ' with the photo' : ' with the first letter of the name, no photo'}.</p>
          {c.consent === true ? (
            <label className="check"><input type="checkbox" checked={photoOk} onChange={(e) => setPhotoOk(e.target.checked)} /> <span>The parent agreed: the photo may appear on the sponsorship page{c.photo ? '' : ' (add a photo on the child’s page)'}</span></label>
          ) : <p className="small muted">No photo consent on file, so no photo can be shown.</p>}
          <label className="field">
            <span>Short bio <small className="muted">({bio.length}/{BIO_MAX}) what they love or dream of, no surname, school or home</small></span>
            <textarea rows={2} maxLength={BIO_MAX} value={bio} onChange={(e) => setBio(e.target.value)} placeholder="Loves football and wants to be a nurse." />
          </label>
          <label className="field">
            <span>Suggested amount for {first} <small className="muted">leave empty to use {amountLabel(settings.amount, settings.per) || 'no amount'}</small></span>
            <input inputMode="numeric" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="KES" />
          </label>
          {!c.sponsored && (
            <label className="check"><input type="checkbox" checked={hidden} onChange={(e) => setHidden(e.target.checked)} /> Hide {first} from the public page</label>
          )}
          <div className="dialog-actions"><button type="button" className="btn btn-primary btn-small" onClick={() => void save()} disabled={busy}>{busy ? 'Saving…' : 'Save'}</button></div>
        </div>
      )}
    </article>
  );
}

const BLANK_BANK: SponsorBank = { bank: '', branch: '', accountName: '', accountNumber: '', swift: '', note: '' };
function Settings({ org, settings, onSaved, toast }: { org: Organization; settings: SponsorSettings; onSaved: (s: SponsorSettings) => void; toast: Show }) {
  const [amount, setAmount] = useState(settings.amount ? String(settings.amount) : '');
  const [per, setPer] = useState(settings.per);
  const [banks, setBanks] = useState<SponsorBank[]>(settings.banks.length ? settings.banks : [BLANK_BANK]);
  const [paybill, setPaybill] = useState(settings.paybill);
  const [busy, setBusy] = useState(false);
  const setBank = (i: number, k: keyof SponsorBank, v: string) => setBanks((b) => b.map((x, j) => (j === i ? { ...x, [k]: v } : x)));
  const save = async () => {
    setBusy(true);
    try { const r = await saveSponsorSettings(org.id, { amount: cleanAmount(amount), per, banks, paybill }); onSaved(r.settings); setBanks(r.settings.banks.length ? r.settings.banks : [BLANK_BANK]); toast('Saved. The public page shows it now.'); } catch (err) { toast(sponsorError(err)); }
    setBusy(false);
  };
  const box = (i: number, k: keyof SponsorBank, label: string, hint = '') => (
    <label className="field"><span>{label}{hint && <small className="muted"> {hint}</small>}</span><input value={banks[i]![k]} onChange={(e) => setBank(i, k, e.target.value)} /></label>
  );
  return (
    <>
      <section className="card">
        <h2>Suggested amount</h2>
        <p className="small muted">Shown on the page for each child. Givers can always give any amount. You can set a different amount for one child in Children.</p>
        <div className="sps-amount">
          <label className="field"><span>Amount (KES)</span><input inputMode="numeric" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="e.g. 3000" /></label>
          <label className="field"><span>Per</span>
            <select value={per} onChange={(e) => setPer(e.target.value as typeof per)}>{AMOUNT_PER.map((p) => <option key={p} value={p}>{AMOUNT_PER_LABELS[p]}</option>)}</select>
          </label>
        </div>
      </section>
      {banks.map((_, i) => (
        <section key={i} className="card">
          <div className="sps-pledge-head"><h2>Bank {banks.length > 1 ? i + 1 : ''}</h2>
            {banks.length > 1 && <button type="button" className="btn btn-quiet btn-small" onClick={() => setBanks((b) => b.filter((__, j) => j !== i))}>Remove</button>}
          </div>
          <div className="sps-bank">
            {box(i, 'bank', 'Bank')}
            {box(i, 'branch', 'Branch')}
            {box(i, 'accountName', 'Account name')}
            {box(i, 'accountNumber', 'Account number')}
            {box(i, 'swift', 'SWIFT code', 'for givers abroad')}
            {box(i, 'note', 'Note', 'optional, e.g. "For US dollars"')}
          </div>
        </section>
      ))}
      {banks.length < MAX_BANKS && <p><button type="button" className="btn btn-small" onClick={() => setBanks((b) => [...b, BLANK_BANK])}>+ Add another bank</button></p>}
      <section className="card">
        <h2>M-Pesa</h2>
        <label className="field"><span>Paybill number <small className="muted">leave empty to hide M-Pesa. The account is the giver's reference, like SP-0012.</small></span>
          <input inputMode="numeric" value={paybill} onChange={(e) => setPaybill(e.target.value)} /></label>
      </section>
      <div className="dialog-actions"><button type="button" className="btn btn-primary" onClick={() => void save()} disabled={busy}>{busy ? 'Saving…' : 'Save'}</button></div>
    </>
  );
}

const loadImage = (src: string) => new Promise<HTMLImageElement>((resolve, reject) => {
  const img = new Image(); img.onload = () => resolve(img); img.onerror = () => reject(new Error('no image')); img.src = src;
});

/** The QR poster (11A): lavender, the invitation, the QR code and the link. 1080 × 1350 for WhatsApp and printing. */
async function posterPicture(url: string): Promise<File> {
  const W = 1080, H = 1350;
  const canvas = document.createElement('canvas'); canvas.width = W; canvas.height = H;
  const ctx = canvas.getContext('2d')!;
  const bg = ctx.createLinearGradient(0, 0, W, H); bg.addColorStop(0, '#7a5bb5'); bg.addColorStop(1, '#2b2440');
  ctx.fillStyle = bg; ctx.fillRect(0, 0, W, H);
  ctx.beginPath(); ctx.roundRect(60, 60, W - 120, H - 120, 44); ctx.fillStyle = '#ffffff'; ctx.fill();
  ctx.lineWidth = 6; ctx.strokeStyle = '#e0a526'; ctx.stroke();
  const font = (px: number, bold = false) => `${bold ? 'bold ' : ''}${px}px system-ui, -apple-system, "Segoe UI", Roboto, sans-serif`;
  ctx.textAlign = 'center';
  ctx.fillStyle = '#5b3f8f'; ctx.font = font(30, true); ctx.fillText('FREEDOM HOPE CENTRE · NAIROBI', W / 2, 160);
  ctx.fillStyle = '#2b2440'; ctx.font = font(70, true); ctx.fillText('Choose a child', W / 2, 260); ctx.fillText('to walk with', W / 2, 340);
  ctx.fillStyle = '#6c6584'; ctx.font = font(34);
  ctx.fillText('Scan with your phone camera to see the', W / 2, 410); ctx.fillText('children waiting for a sponsor.', W / 2, 455);
  const size = 560;
  const qr = document.createElement('canvas');
  await QRCode.toCanvas(qr, url, { width: size, margin: 1, errorCorrectionLevel: 'M', color: { dark: '#2b2440', light: '#ffffff' } });
  ctx.drawImage(qr, (W - size) / 2, 500, size, size);
  ctx.fillStyle = '#2b2440'; ctx.font = font(28); ctx.fillText(url.replace(/^https?:\/\//, ''), W / 2, 1120);
  const logo = await loadImage('/logo-mark.png').catch(() => null);
  ctx.fillStyle = '#8a84a0'; ctx.font = font(22);
  const label = 'Powered by Insight-IQ';
  const tw = ctx.measureText(label).width;
  if (logo) ctx.drawImage(logo, W / 2 - tw / 2 - 34, 1230 - 21, 26, 26);
  ctx.fillText(label, W / 2, 1230);
  const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('The picture could not be made.'))), 'image/png'));
  return new File([blob], 'Hope-Centre-sponsor-a-child-QR.png', { type: 'image/png' });
}

function Share({ org, toast }: { org: Organization; toast: Show }) {
  const url = sponsorLink(org.id);
  const [svg, setSvg] = useState('');
  useEffect(() => {
    QRCode.toString(url, { type: 'svg', margin: 1, errorCorrectionLevel: 'M', color: { dark: '#2b2440', light: '#ffffff' } }).then(setSvg, () => setSvg(''));
  }, [url]);
  const message = `Freedom Hope Centre in Nairobi has children waiting for a sponsor. You can choose a child to walk with here: ${url}`;
  const download = async () => {
    try {
      const file = await posterPicture(url);
      const a = document.createElement('a'); a.href = URL.createObjectURL(file); a.download = file.name; a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 4000);
      toast('QR poster saved to your downloads');
    } catch (err) { toast(err instanceof Error ? err.message : 'The picture could not be made.'); }
  };
  return (
    <section className="card welcome-poster">
      <h2>Sponsor a child</h2>
      <p className="muted">Anyone can open this link. They see the children waiting for a sponsor and can only choose, never change anything.</p>
      {svg ? <div className="welcome-qr" dangerouslySetInnerHTML={{ __html: svg }} /> : <p className="muted">Making the QR code…</p>}
      <p className="small welcome-url">{url}</p>
      <div className="dialog-actions">
        <button type="button" className="btn btn-primary" onClick={() => void download()}>Download the QR poster</button>
        <a className="btn" href={`https://wa.me/?text=${encodeURIComponent(message)}`} target="_blank" rel="noopener noreferrer">Send the link on WhatsApp</a>
        <button type="button" className="btn" onClick={() => navigator.clipboard?.writeText(url).then(() => toast('Link copied'), () => toast(url))}>Copy the link</button>
        <a className="btn btn-quiet" href={url} target="_blank" rel="noopener noreferrer">Open the page</a>
      </div>
    </section>
  );
}

/**
 * Each child's Sponsor update for the sponsor (Andy, 2026-11-18, 4A): first name only, no Child ID or school, and the
 * photo only where the parent agreed to the sponsorship page. One PDF for all the children in the pledge.
 */
function useSponsorPack(org: Organization, data: SponsorAdmin) {
  const h = useHope(org);
  const { days } = useHopeDays(org.id);
  const clubs = useClubs(org.id);
  const { byId } = usePeople();
  return async (p: Pledge): Promise<PdfFile> => {
    const pages = [];
    for (const id of p.childIds) {
      const child = h.children.find((c) => c.id === id);
      if (!child) continue;
      const ok = data.children.find((c) => c.id === id)?.photoOk === true;
      const photo = ok ? String((await getDoc(doc(db, `organizations/${org.id}/childPhotos/${id}`)).catch(() => null))?.get('photo') ?? '') || null : null;
      const name = byId(id)?.fullName ?? p.childNames[p.childIds.indexOf(id)] ?? 'Child';
      pages.push(sponsorPage({ child: { ...child, sponsorName: child.sponsorName || p.name }, name, age: ageOn(child.dateOfBirth, h.today), today: h.today, days, clubs: clubs.clubs, wins: clubs.wins, photo }));
    }
    if (!pages.length) throw new Error('The children could not be found. Please try again.');
    const file = await sponsorUpdatePdf(org, pages, h.today.slice(0, 4), { sponsorCopy: true });
    const buf = new Uint8Array(await file.arrayBuffer());
    let bin = '';
    for (let i = 0; i < buf.length; i += 0x8000) bin += String.fromCharCode(...buf.subarray(i, i + 0x8000));
    return { name: file.name, data: btoa(bin) };
  };
}
