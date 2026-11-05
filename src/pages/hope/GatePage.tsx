import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../state/AuthContext';
import { useToast } from '../../state/ToastContext';
import { useChampions, useChildPhotos, useHopeDays } from '../../state/useHope';
import { friendlyError } from '../../lib/errors';
import { markChampion, markKid } from '../../lib/hopeWrites';
import { PasswordConfirm } from '../../components/PasswordConfirm';
import { arrivalMark } from '../../../functions/src/shared/hopeChampionPay';
import { isCurrentChild } from '../../../functions/src/shared/hope';
import { kidCame, rateFrom, streak } from '../../../functions/src/shared/hopeRegister';
import { cardCode, useQrCamera } from './DoorScan';
import { HopeGate, useHopePage } from './common';
import { Avatar, nowTime } from './registerParts';
import type { Organization } from '../../state/OrgContext';

export function GatePage() {
  return <HopeGate title="Gate mode">{(org) => <Gate org={org} />}</HopeGate>;
}

type Welcome = { ok: boolean; title: string; sub: string; photo?: string | null; name?: string; at: number };

/** A short, friendly sound: high for welcome, low for a card that is not known. */
function beep(ok: boolean) {
  try {
    const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    const ctx = new Ctx();
    const notes = ok ? [660, 880] : [220];
    notes.forEach((f, i) => {
      const o = ctx.createOscillator(), g = ctx.createGain();
      o.frequency.value = f; o.type = 'sine';
      g.gain.setValueAtTime(0.0001, ctx.currentTime + i * 0.12);
      g.gain.exponentialRampToValueAtTime(0.25, ctx.currentTime + i * 0.12 + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + i * 0.12 + 0.18);
      o.connect(g).connect(ctx.destination); o.start(ctx.currentTime + i * 0.12); o.stop(ctx.currentTime + i * 0.12 + 0.2);
    });
    window.setTimeout(() => void ctx.close(), 800);
  } catch { /* no sound on this phone */ }
}

/**
 * Gate mode (v182, 12A): a phone or tablet at the gate with the camera always on. Each child and champion holds up
 * their QR card: a green tick, their name, a sound, and the streak ("Welcome, Amani! 🔥 5 in a row"). It works on
 * iPhones too, keeps the count, keeps the screen awake, and leaving it needs the password of whoever opened it.
 */
function Gate({ org }: { org: Organization }) {
  const h = useHopePage(org);
  const { can } = useAuth();
  const toast = useToast();
  const navigate = useNavigate();
  const { days } = useHopeDays(org.id);
  const champs = useChampions(org.id);
  const photos = useChildPhotos(org.id);
  const video = useRef<HTMLVideoElement>(null);
  const [welcome, setWelcome] = useState<Welcome | null>(null);
  const [typed, setTyped] = useState('');
  const [leaving, setLeaving] = useState(false);
  const [mine, setMine] = useState<Set<string>>(new Set());
  const seen = useRef(new Map<string, number>());
  const today = h.today;
  const marks = useMemo(() => days.find((d) => d.date === today)?.marks ?? {}, [days, today]);
  const kids = rateFrom(Object.values(marks));
  const champMarks = champs.days.find((d) => d.date === today)?.marks ?? {};
  const champsHere = Object.values(champMarks).filter((m) => m?.s === 'present' || m?.s === 'late').length;
  const fail = (err: unknown) => toast.show(friendlyError(err));
  const state = useRef({ h, marks, champs, champMarks, days, photos, mine });
  state.current = { h, marks, champs, champMarks, days, photos, mine };

  function take(raw: string) {
    const code = cardCode(raw);
    const now = Date.now();
    if ((seen.current.get(code) ?? 0) > now - 5000) return;
    seen.current.set(code, now);
    const s = state.current;
    const t = nowTime();
    let w: Welcome;
    if (code.startsWith('CC-')) {
      const x = s.champs.champions.find((y) => y.code === code && y.status === 'active');
      if (!x) w = { ok: false, title: 'This card is not known', sub: code, at: now };
      else {
        const old = s.champMarks[x.id];
        if (old && (old.s === 'present' || old.s === 'late')) w = { ok: true, title: `${x.name.split(' ')[0]}, you are already in`, sub: `Since ${old.in ?? 'earlier'}`, name: x.name, at: now };
        else {
          const m = arrivalMark(t);
          markChampion(org.id, today, x.id, { s: m, in: t, out: null, duty: x.duty || null, r: null }).catch(fail);
          w = { ok: true, title: `Welcome, ${x.name.split(' ')[0]}!`, sub: `Champion · ${t}${m === 'late' ? ' · late' : ''}`, name: x.name, at: now };
        }
      }
    } else {
      const c = s.h.children.find((y) => y.code === code && isCurrentChild(y));
      if (!c) w = { ok: false, title: 'This card is not known', sub: code, at: now };
      else {
        const name = s.h.nameOf(c.id);
        const photo = c.photoConsent?.given ? s.photos.get(c.id) : null;
        if (kidCame(s.marks[c.id]?.s) || s.mine.has(c.id)) w = { ok: true, title: `${name.split(' ')[0]}, you are already in`, sub: `Since ${s.marks[c.id]?.t ?? 'earlier'}`, photo, name, at: now };
        else {
          markKid(org.id, today, c.id, { s: 'present', t, r: null }).catch(fail);
          setMine((m) => new Set(m).add(c.id));
          const fire = streak(c.id, s.days.filter((d) => d.date !== today)) + 1;
          w = { ok: true, title: `Welcome, ${name.split(' ')[0]}!`, sub: fire >= 2 ? `🔥 ${fire} in a row` : `Checked in at ${t}`, photo, name, at: now };
        }
      }
    }
    setWelcome(w);
    beep(w.ok);
    if (navigator.vibrate) navigator.vibrate(w.ok ? 80 : [40, 60, 40]);
  }
  const camera = useQrCamera(video, take);

  // The welcome fades after a few seconds, ready for the next card.
  useEffect(() => { if (!welcome) return; const t = window.setTimeout(() => setWelcome(null), 3500); return () => window.clearTimeout(t); }, [welcome]);
  // Keep the screen awake, and keep Back from leaving.
  useEffect(() => {
    let lock: { release: () => Promise<void> } | null = null;
    const wake = () => { (navigator as unknown as { wakeLock?: { request: (t: string) => Promise<typeof lock> } }).wakeLock?.request('screen').then((l) => { lock = l; }).catch(() => {}); };
    wake();
    const vis = () => { if (document.visibilityState === 'visible') wake(); };
    document.addEventListener('visibilitychange', vis);
    window.history.pushState({ gate: true }, '');
    const back = () => { window.history.pushState({ gate: true }, ''); setLeaving(true); };
    window.addEventListener('popstate', back);
    return () => { document.removeEventListener('visibilitychange', vis); window.removeEventListener('popstate', back); void lock?.release().catch(() => {}); };
  }, []);

  if (!can('attendance.write')) return <div className="page narrow"><p>Gate mode is for the people who mark the register.</p></div>;
  const here = kids.present + [...mine].filter((id) => !kidCame(marks[id]?.s)).length;
  return (
    <div className="gate" role="application" aria-label="Gate mode">
      <header className="gate-top">
        <b>🚪 {org.name}</b>
        <span className="gate-count"><b>{here}</b> {here === 1 ? 'child' : 'children'} · <b>{champsHere}</b> {champsHere === 1 ? 'champion' : 'champions'}</span>
        <button type="button" className="btn btn-quiet btn-small" onClick={() => setLeaving(true)}>Leave</button>
      </header>
      <div className="gate-cam">
        {camera !== 'none' ? <video ref={video} muted playsInline aria-label="Camera" /> : <p className="gate-nocam">The camera could not start. Allow the camera in the phone's settings, or type the code below.</p>}
        <span className="door-frame" aria-hidden="true" />
        {welcome ? (
          <div className={`gate-welcome ${welcome.ok ? 'ok' : 'bad'}`} aria-live="assertive">
            {welcome.name ? <Avatar photo={welcome.photo} name={welcome.name} size={110} /> : <span className="gate-x" aria-hidden="true">✕</span>}
            <b>{welcome.ok ? '✓ ' : ''}{welcome.title}</b>
            <span>{welcome.sub}</span>
          </div>
        ) : <p className="gate-hint">{camera === 'starting' ? 'Starting the camera…' : 'Hold your card up to the camera'}</p>}
      </div>
      <form className="gate-type" onSubmit={(e) => { e.preventDefault(); if (typed.trim()) { seen.current.clear(); take(typed); setTyped(''); } }}>
        <input value={typed} onChange={(e) => setTyped(e.target.value)} placeholder="Or type the code: HC-0012" aria-label="Type the code" autoCapitalize="characters" />
        <button type="submit" className="btn" disabled={!typed.trim()}>Check in</button>
      </form>
      <PasswordConfirm open={leaving} title="Leave Gate mode?" body="Type your password to leave, so nobody else can open the app from the gate." confirmLabel="Leave"
        onCancel={() => setLeaving(false)} onConfirm={() => { setLeaving(false); navigate('/hope/register?d=today', { replace: true }); }} />
    </div>
  );
}
