import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import QRCode from 'qrcode';
import { useOrg } from '../../state/OrgContext';
import { useToast } from '../../state/ToastContext';

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
        <button type="button" className="btn btn-primary" onClick={() => window.print()}>Print the poster</button>
        <a className="btn" href={`https://wa.me/?text=${encodeURIComponent(message)}`} target="_blank" rel="noopener noreferrer">Send the link on WhatsApp</a>
        <button type="button" className="btn btn-quiet" onClick={() => void copy()}>Copy the link</button>
      </div>
      <p className="muted small no-print">Families who fill it in appear straight away on the People page, marked "New sign-up" with what each person said (Member, Regular or Not a member) until you or Doreen confirm it.</p>
    </div>
  );
}
