import { useEffect, useRef, useState } from 'react';
import { normalizeCode } from '../../../functions/src/shared/hope';

type Detector = { detect: (source: HTMLVideoElement) => Promise<{ rawValue: string }[]> };
type DetectorClass = new (opts: { formats: string[] }) => Detector;

/**
 * QR check-in at the door (Andy, 2026-11-05, v173 12A): the phone's camera reads a child's card and checks them in.
 * Phones that cannot read QR codes in the browser (such as iPhones) type the code from the card instead.
 */
export function DoorScan({ onCode, onClose }: { onCode: (code: string) => string; onClose: () => void }) {
  const video = useRef<HTMLVideoElement>(null);
  const [last, setLast] = useState<{ text: string; ok: boolean } | null>(null);
  const [typed, setTyped] = useState('');
  const [camera, setCamera] = useState<'starting' | 'on' | 'none'>('starting');
  const seen = useRef(new Map<string, number>());
  const handle = useRef(onCode);
  handle.current = onCode;

  function take(raw: string) {
    const code = normalizeCode(/^\s*\d+\s*$/.test(raw) ? `HC-${raw.trim()}` : raw) ?? raw.trim().toUpperCase();
    const now = Date.now();
    if ((seen.current.get(code) ?? 0) > now - 4000) return;
    seen.current.set(code, now);
    const text = handle.current(code);
    setLast({ text, ok: text.startsWith('✓') });
    if (navigator.vibrate) navigator.vibrate(text.startsWith('✓') ? 80 : [40, 60, 40]);
  }

  useEffect(() => {
    const Det = (window as unknown as { BarcodeDetector?: DetectorClass }).BarcodeDetector;
    let stream: MediaStream | null = null;
    let stop = false;
    let timer = 0;
    if (!Det || !navigator.mediaDevices?.getUserMedia) { setCamera('none'); return; }
    const detector = new Det({ formats: ['qr_code'] });
    navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' }, audio: false }).then(async (s) => {
      if (stop) { s.getTracks().forEach((t) => t.stop()); return; }
      stream = s;
      const v = video.current!;
      v.srcObject = s;
      await v.play().catch(() => {});
      setCamera('on');
      const loop = async () => {
        if (stop) return;
        try { for (const r of await detector.detect(v)) if (r.rawValue) take(r.rawValue); } catch { /* a frame that could not be read */ }
        timer = window.setTimeout(() => void loop(), 300);
      };
      void loop();
    }).catch(() => setCamera('none'));
    return () => { stop = true; window.clearTimeout(timer); stream?.getTracks().forEach((t) => t.stop()); };
  }, []);

  return (
    <section className="card stack door-scan" aria-label="Scan check-in cards">
      <div className="card-head"><h2>📷 Scan cards at the door</h2><button type="button" className="btn btn-quiet" onClick={onClose}>Done</button></div>
      {camera !== 'none' ? (
        <div className="door-video"><video ref={video} muted playsInline aria-label="Camera" /><span className="door-frame" aria-hidden="true" /></div>
      ) : <p className="small muted">This phone cannot read QR codes here. Type the code from the card instead.</p>}
      {camera === 'starting' && <p className="small muted">Starting the camera… Allow the camera if the phone asks.</p>}
      {last && <p className={`door-last ${last.ok ? 'ok' : 'bad'}`} aria-live="assertive">{last.text}</p>}
      <form className="field-row" onSubmit={(e) => { e.preventDefault(); if (typed.trim()) { seen.current.clear(); take(typed); setTyped(''); } }}>
        <label className="field"><span>Or type the code</span><input value={typed} onChange={(e) => setTyped(e.target.value)} placeholder="HC-0012" autoCapitalize="characters" /></label>
        <button type="submit" className="btn align-end" disabled={!typed.trim()}>Check in</button>
      </form>
    </section>
  );
}
