import { useEffect, useRef, useState } from 'react';
import { normalizeCode } from '../../../functions/src/shared/hope';
import { normalizeChampionCode } from '../../../functions/src/shared/hopeChampionPay';

type Detector = { detect: (source: HTMLVideoElement) => Promise<{ rawValue: string }[]> };
type DetectorClass = new (opts: { formats: string[] }) => Detector;

/**
 * The camera reading QR codes (v182, 12A): the phone's own reader where it has one (Android Chrome), otherwise the
 * jsQR reader on each frame, so iPhones scan too. Calls onRaw with each code it sees.
 */
export function useQrCamera(video: React.RefObject<HTMLVideoElement | null>, onRaw: (raw: string) => void): 'starting' | 'on' | 'none' {
  const [camera, setCamera] = useState<'starting' | 'on' | 'none'>('starting');
  const cb = useRef(onRaw);
  cb.current = onRaw;
  useEffect(() => {
    const Det = (window as unknown as { BarcodeDetector?: DetectorClass }).BarcodeDetector;
    let stream: MediaStream | null = null;
    let stop = false;
    let timer = 0;
    if (!navigator.mediaDevices?.getUserMedia) { setCamera('none'); return; }
    const canvas = document.createElement('canvas');
    const read = async (v: HTMLVideoElement): Promise<string[]> => {
      if (Det) return (await new Det({ formats: ['qr_code'] }).detect(v)).map((r) => r.rawValue);
      const { default: jsQR } = await import('jsqr');
      const w = Math.min(640, v.videoWidth || 640), h = Math.round(w * ((v.videoHeight || 480) / (v.videoWidth || 640)));
      if (!w || !h) return [];
      canvas.width = w; canvas.height = h;
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      if (!ctx) return [];
      ctx.drawImage(v, 0, 0, w, h);
      const r = jsQR(ctx.getImageData(0, 0, w, h).data, w, h, { inversionAttempts: 'dontInvert' });
      return r?.data ? [r.data] : [];
    };
    navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' }, audio: false }).then(async (s) => {
      if (stop) { s.getTracks().forEach((t) => t.stop()); return; }
      stream = s;
      const v = video.current!;
      v.srcObject = s;
      await v.play().catch(() => {});
      setCamera('on');
      const loop = async () => {
        if (stop) return;
        try { for (const raw of await read(v)) if (raw) cb.current(raw); } catch { /* a frame that could not be read */ }
        timer = window.setTimeout(() => void loop(), 250);
      };
      void loop();
    }).catch(() => setCamera('none'));
    return () => { stop = true; window.clearTimeout(timer); stream?.getTracks().forEach((t) => t.stop()); };
  }, [video]);
  return camera;
}

/** Turns what a card says into a code: HC-0012, CC-0003, or a bare number as a child's code. */
export function cardCode(raw: string): string {
  return normalizeCode(/^\s*\d+\s*$/.test(raw) ? `HC-${raw.trim()}` : raw) ?? normalizeChampionCode(raw) ?? raw.trim().toUpperCase();
}

/**
 * QR check-in at the door (Andy, 2026-11-05, v173 12A): the phone's camera reads a child's card and checks them in.
 * Phones that cannot read QR codes in the browser (such as iPhones) type the code from the card instead.
 */
export function DoorScan({ onCode, onClose }: { onCode: (code: string) => string; onClose: () => void }) {
  const video = useRef<HTMLVideoElement>(null);
  const [last, setLast] = useState<{ text: string; ok: boolean } | null>(null);
  const [typed, setTyped] = useState('');
  const seen = useRef(new Map<string, number>());
  const handle = useRef(onCode);
  handle.current = onCode;

  function take(raw: string) {
    const code = cardCode(raw);
    const now = Date.now();
    if ((seen.current.get(code) ?? 0) > now - 4000) return;
    seen.current.set(code, now);
    const text = handle.current(code);
    setLast({ text, ok: text.startsWith('✓') });
    if (navigator.vibrate) navigator.vibrate(text.startsWith('✓') ? 80 : [40, 60, 40]);
  }

  const camera = useQrCamera(video, take);

  return (
    <section className="card stack door-scan" aria-label="Scan check-in cards">
      <div className="card-head"><h2>📷 Scan cards at the door</h2><button type="button" className="btn btn-quiet" onClick={onClose}>Done</button></div>
      {camera !== 'none' ? (
        <div className="door-video"><video ref={video} muted playsInline aria-label="Camera" /><span className="door-frame" aria-hidden="true" /></div>
      ) : <p className="small muted">The camera could not start. Allow the camera, or type the code from the card.</p>}
      {camera === 'starting' && <p className="small muted">Starting the camera… Allow the camera if the phone asks.</p>}
      {last && <p className={`door-last ${last.ok ? 'ok' : 'bad'}`} aria-live="assertive">{last.text}</p>}
      <form className="field-row" onSubmit={(e) => { e.preventDefault(); if (typed.trim()) { seen.current.clear(); take(typed); setTyped(''); } }}>
        <label className="field"><span>Or type the code</span><input value={typed} onChange={(e) => setTyped(e.target.value)} placeholder="HC-0012 or CC-0003" autoCapitalize="characters" /></label>
        <button type="submit" className="btn align-end" disabled={!typed.trim()}>Check in</button>
      </form>
    </section>
  );
}
