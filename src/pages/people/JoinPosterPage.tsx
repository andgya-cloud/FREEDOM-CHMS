import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import QRCode from 'qrcode';
import { useOrg } from '../../state/OrgContext';
import { useToast } from '../../state/ToastContext';

const loadImage = (src: string) => new Promise<HTMLImageElement>((resolve, reject) => {
  const img = new Image();
  img.onload = () => resolve(img);
  img.onerror = () => reject(new Error('The logo could not be loaded.'));
  img.src = src;
});

/** Splits text into lines that fit the width. */
function wrap(ctx: CanvasRenderingContext2D, text: string, width: number): string[] {
  const lines: string[] = [];
  let line = '';
  for (const word of text.split(' ')) {
    const next = line ? `${line} ${word}` : word;
    if (ctx.measureText(next).width > width && line) { lines.push(line); line = word; } else line = next;
  }
  if (line) lines.push(line);
  return lines;
}

/**
 * The QR code as a picture to hand out (Andy, 2026-11-02): church green behind a white card with the logo, the
 * invitation, the QR code and the link. 1080 × 1350, the size WhatsApp and printers both handle well.
 */
async function qrPicture(url: string, churchName: string): Promise<File> {
  const W = 1080, H = 1350;
  const canvas = document.createElement('canvas');
  canvas.width = W; canvas.height = H;
  const ctx = canvas.getContext('2d')!;
  const bg = ctx.createLinearGradient(0, 0, W, H);
  bg.addColorStop(0, '#2f6b45'); bg.addColorStop(0.6, '#0f3b25'); bg.addColorStop(1, '#0b2e1c');
  ctx.fillStyle = bg; ctx.fillRect(0, 0, W, H);
  // The white card with a gold edge
  const x = 60, y = 60, w = W - 120, h = H - 120, r = 44;
  ctx.beginPath(); ctx.roundRect(x, y, w, h, r); ctx.fillStyle = '#ffffff'; ctx.fill();
  ctx.lineWidth = 6; ctx.strokeStyle = '#c9a24e'; ctx.stroke();
  const logo = await loadImage('/org/freedom-church-logo.png').catch(() => null);
  let top = y + 50;
  if (logo) { const lh = 150, lw = (logo.naturalWidth / logo.naturalHeight) * lh; ctx.drawImage(logo, (W - lw) / 2, top, lw, lh); top += lh + 30; }
  ctx.textAlign = 'center'; ctx.fillStyle = '#0f3b25';
  ctx.font = 'bold 58px system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';
  for (const line of wrap(ctx, `Join the ${churchName} family`, w - 120)) { top += 64; ctx.fillText(line, W / 2, top); }
  ctx.fillStyle = '#3f5247'; ctx.font = '34px system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';
  top += 30;
  for (const line of wrap(ctx, 'Scan with your phone camera and tell us about you and your family.', w - 160)) { top += 44; ctx.fillText(line, W / 2, top); }
  const size = Math.min(560, H - 60 - 150 - top);
  const qr = document.createElement('canvas');
  await QRCode.toCanvas(qr, url, { width: size, margin: 1, errorCorrectionLevel: 'M', color: { dark: '#0b3d24', light: '#ffffff' } });
  top += 36;
  ctx.drawImage(qr, (W - size) / 2, top, size, size);
  top += size + 50;
  ctx.fillStyle = '#17241c'; ctx.font = '30px system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';
  ctx.fillText(url.replace(/^https?:\/\//, ''), W / 2, top);
  ctx.fillStyle = '#8a958e'; ctx.font = '22px system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';
  ctx.fillText('Powered by Insight-IQ', W / 2, y + h - 30);
  const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('The picture could not be made.'))), 'image/png'));
  return new File([blob], 'Freedom-family-sign-up-QR.png', { type: 'image/png' });
}

/**
 * The "Join the Freedom family" QR poster and link (Andy, 2026-11-02, 6A): print it for the door, or send the link
 * on WhatsApp. People who fill it in appear on the People page as families.
 */
export function JoinPosterPage() {
  const { current } = useOrg();
  const toast = useToast();
  const [svg, setSvg] = useState('');
  const url = current ? `${window.location.origin}/join/${current.id}` : '';

  useEffect(() => {
    if (!url) return;
    QRCode.toString(url, { type: 'svg', margin: 1, errorCorrectionLevel: 'M', color: { dark: '#0b3d24', light: '#ffffff' } })
      .then(setSvg)
      .catch(() => setSvg(''));
  }, [url]);

  if (!current) return <div className="page narrow"><p>Choose an organization at the top.</p></div>;
  if (current.type !== 'church_campus') {
    return <div className="page narrow"><p><Link to="/people">← People</Link></p><p>The family sign-up is for Freedom Church campuses.</p></div>;
  }
  const message = `Join the ${current.name} family! Please fill in your details and your family's here: ${url}`;
  const copy = () => navigator.clipboard?.writeText(url).then(() => toast.show('Link copied'), () => toast.show(url));
  const download = async () => {
    try {
      const file = await qrPicture(url, current.name);
      const a = document.createElement('a');
      a.href = URL.createObjectURL(file);
      a.download = file.name;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 4000);
      toast.show('QR code saved to your downloads');
    } catch (err) { toast.show(err instanceof Error ? err.message : 'The picture could not be made.'); }
  };
  const share = async () => {
    try {
      const file = await qrPicture(url, current.name);
      await navigator.share({ files: [file], text: message });
    } catch (err) { if ((err as Error)?.name !== 'AbortError') void download(); }
  };
  const canShareFiles = typeof navigator !== 'undefined' && !!navigator.canShare && navigator.canShare({ files: [new File([''], 'x.png', { type: 'image/png' })] });

  return (
    <div className="page narrow">
      <p className="no-print"><Link to="/people">← People</Link></p>
      <section className="card welcome-poster">
        <img src="/org/freedom-church-logo.png" alt="" width={110} height={110} />
        <h1>Join the {current.name} family</h1>
        <p className="welcome-poster-lead">Scan with your phone camera and tell us about you and your family.</p>
        {svg ? <div className="welcome-qr" dangerouslySetInnerHTML={{ __html: svg }} /> : <p className="muted">Making the QR code…</p>}
        <p className="muted small welcome-url">{url}</p>
      </section>
      <div className="dialog-actions no-print">
        <button type="button" className="btn btn-primary" onClick={() => void download()}>Download the QR code</button>
        {canShareFiles && <button type="button" className="btn" onClick={() => void share()}>Share the QR picture</button>}
        <button type="button" className="btn" onClick={() => window.print()}>Print the poster</button>
        <a className="btn" href={`https://wa.me/?text=${encodeURIComponent(message)}`} target="_blank" rel="noopener noreferrer">Send the link on WhatsApp</a>
        <button type="button" className="btn btn-quiet" onClick={() => void copy()}>Copy the link</button>
      </div>
      <p className="muted small no-print">Families who fill it in appear straight away on the People page, marked "New sign-up" with what each person said (Member, Regular or Not a member) until you or Doreen confirm it.</p>
    </div>
  );
}
