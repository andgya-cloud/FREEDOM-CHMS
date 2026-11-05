import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import QRCode from 'qrcode';
import { useOrg } from '../../state/OrgContext';

/**
 * The QR poster for the door (Andy, 2026-10-31, 3A). Visitors scan it and fill in their own card
 * (WelcomeCardPage); print it, or show it on a tablet at the welcome desk.
 */
export function WelcomePosterPage() {
  const { current } = useOrg();
  const [svg, setSvg] = useState('');
  const url = current ? `${window.location.origin}/welcome/${current.id}` : '';

  useEffect(() => {
    if (!url) return;
    QRCode.toString(url, { type: 'svg', margin: 1, errorCorrectionLevel: 'M', color: { dark: '#0b3d24', light: '#ffffff' } })
      .then(setSvg)
      .catch(() => setSvg(''));
  }, [url]);

  if (!current) return <div className="page narrow"><p>Choose an organization at the top.</p></div>;
  if (current.type !== 'church_campus') {
    return <div className="page narrow"><p><Link to="/people">← People</Link></p><p>The visitor card is for Freedom Church campuses.</p></div>;
  }

  return (
    <div className="page narrow">
      <p className="no-print"><Link to="/people">← People</Link></p>
      <section className="card welcome-poster">
        <img src="/org/freedom-church-logo.png" alt="" width={110} height={110} />
        <h1>Welcome to {current.name}!</h1>
        <p className="welcome-poster-lead">New here? Scan with your phone camera and tell us about yourself.</p>
        {svg ? <div className="welcome-qr" dangerouslySetInnerHTML={{ __html: svg }} /> : <p className="muted">Making the QR code…</p>}
        <p className="muted small welcome-url">{url}</p>
      </section>
      <div className="dialog-actions no-print">
        <button type="button" className="btn btn-primary" onClick={() => window.print()}>Print the poster</button>
        <a className="btn" href={url} target="_blank" rel="noopener noreferrer">Open the card</a>
      </div>
      <p className="muted small no-print">Cards that visitors send appear in People as visitors, with their welcome follow-ups, the same as cards an usher types in.</p>
    </div>
  );
}
