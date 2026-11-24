import { useEffect, useState, type FormEvent } from 'react';
import { Link, useLocation, useParams } from 'react-router-dom';
import { httpsCallable } from 'firebase/functions';
import { functions } from '../../firebase';
import { formatDateKey } from '../../../functions/src/shared/datetime';
import { progressPath } from '../../../functions/src/shared/classRegister';

type Info = { church: string; programme: string; date: string; topic: string; open: boolean; why: string; needWord?: boolean };
type Later = { token: string; words: { kind: string; label: string; got: boolean; over: boolean }[]; endLabel: string };
type Done = { later?: Later | null; ok: boolean; already?: boolean; added?: boolean; firstName: string; topic?: string; done?: number; total?: number; percent?: number; token?: string; needName?: boolean };
const SAVED = 'classCheckIn.me';

const cleanMessage = (err: unknown) => {
  const e = err as { code?: string; message?: string };
  return e?.code?.startsWith('functions/') && e.message && e.code !== 'functions/internal'
    ? e.message.replace(/\s*\[\d+\]$/, '')
    : 'We could not check you in. Please check your internet and try again, or ask the class leader.';
};
/** This phone's own id, so one phone marks one person per class (Andy, 2026-11-24, 1A). */
const deviceId = (): string => {
  try {
    let id = localStorage.getItem('classCheckIn.device');
    if (!id) { id = [...crypto.getRandomValues(new Uint8Array(16))].map((b) => b.toString(16).padStart(2, '0')).join(''); localStorage.setItem('classCheckIn.device', id); }
    return id;
  } catch { return ''; }
};
const remembered = (): { phone: string; name: string } | null => {
  try { const v = JSON.parse(localStorage.getItem(SAVED) ?? 'null'); return v?.phone ? v : null; } catch { return null; }
};

/**
 * What a student sees after scanning the class QR code (Andy, 2026-11-09, 1A 3A): type your phone number and you
 * are marked present. Someone new types their name too and is added. No sign-in. The phone remembers the number,
 * so next week it is one tap.
 */
export function ClassCheckInPage() {
  const { orgId = '', eventId = '' } = useParams();
  const k = new URLSearchParams(useLocation().search).get('k') ?? '';
  const [info, setInfo] = useState<Info | null>(null);
  const [missing, setMissing] = useState('');
  const me = remembered();
  const [phone, setPhone] = useState(me?.phone ?? '');
  const [name, setName] = useState('');
  const [word, setWord] = useState('');
  const [needName, setNeedName] = useState(false);
  const [notMe, setNotMe] = useState(false);
  const [website, setWebsite] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [done, setDone] = useState<Done | null>(null);

  useEffect(() => {
    httpsCallable<Record<string, unknown>, Info>(functions, 'classRegister')({ action: 'info', orgId, eventId, k })
      .then((r) => setInfo(r.data))
      .catch((err) => setMissing(cleanMessage(err)));
  }, [orgId, eventId, k]);

  async function send(e?: FormEvent) {
    e?.preventDefault();
    setError('');
    if (phone.replace(/\D/g, '').length < 9) return setError('Please type your phone number, for example 0712 345 678.');
    if (needName && name.trim().length < 2) return setError('Please type your full name.');
    if (info?.needWord && !word.trim()) return setError('Please type the code word the leader says in class.');
    setBusy(true);
    try {
      const r = await httpsCallable<Record<string, unknown>, Done>(functions, 'classRegister')({
        action: 'checkin', orgId, eventId, k, phone, word, name: needName ? name : '', website, device: deviceId(),
      });
      if (r.data.needName) { setNeedName(true); return; }
      try { localStorage.setItem(SAVED, JSON.stringify({ phone, name: r.data.firstName })); } catch { /* private window */ }
      setDone(r.data);
    } catch (err) {
      setError(cleanMessage(err));
    } finally {
      setBusy(false);
    }
  }

  if (missing) return <div className="center-card welcome-card"><h1>Class check-in</h1><p>{missing}</p></div>;
  if (!info) return <div className="splash" aria-busy="true"><span className="splash-mark" />Loading…</div>;

  if (done) {
    return (
      <div className="center-card welcome-card">
        <img src="/org/freedom-church-logo.png" alt="" width={80} height={80} />
        <h1>{done.already ? `You are already in, ${done.firstName}` : `You're marked present, ${done.firstName}!`}</h1>
        <p><strong>{info.programme}</strong> · {done.topic || info.topic}</p>
        {done.total ? (
          <>
            <p className="class-pct">{done.percent}%</p>
            <span className="progress" aria-hidden="true"><span style={{ width: `${done.percent}%` }} /></span>
            <p className="muted">{done.done} of {done.total} topics done</p>
          </>
        ) : null}
        {done.added && <p className="muted small">Welcome to {info.programme}! The class leader will check your details.</p>}
        {done.later && <LaterWords orgId={orgId} eventId={eventId} k={k} later={done.later} />}
        {done.token && <Link className={done.later ? 'btn btn-block' : 'btn btn-primary btn-block'} to={progressPath(orgId, done.token)}>See my progress</Link>}
      </div>
    );
  }

  return (
    <div className="center-card welcome-card">
      <img src="/org/freedom-church-logo.png" alt="" width={80} height={80} />
      <h1>{info.programme}</h1>
      <p>{formatDateKey(info.date)}{info.topic ? ` · ${info.topic}` : ''}</p>
      {!info.open ? <p className="error" role="alert">{info.why}</p> : me && !notMe && !needName && !info.needWord ? (
        <div className="stack">
          <button type="button" className="btn btn-primary btn-block btn-lg" disabled={busy} onClick={() => void send()}>
            {busy ? 'Checking in…' : `I'm ${me.name || 'here'}: mark me present`}
          </button>
          <button type="button" className="btn btn-quiet" onClick={() => { setNotMe(true); setPhone(''); }}>Not {me.name || 'me'}?</button>
          {error && <p className="error" role="alert">{error}</p>}
        </div>
      ) : (
        <form className="form" onSubmit={send}>
          <label className="field"><span>Your phone number</span><input type="tel" inputMode="tel" autoComplete="tel" value={phone} maxLength={30} onChange={(e) => setPhone(e.target.value)} placeholder="0712 345 678" autoFocus /></label>
          {info.needWord && (
            <label className="field"><span>Code word (the leader says it in class)</span><input value={word} maxLength={30} autoCapitalize="characters" autoComplete="off" onChange={(e) => setWord(e.target.value)} /></label>
          )}
          {needName && (
            <>
              <p className="notice">We don't have this number yet. Type your name to join {info.programme}.</p>
              <label className="field"><span>Your full name</span><input autoComplete="name" autoCapitalize="words" value={name} maxLength={120} onChange={(e) => setName(e.target.value)} autoFocus /></label>
            </>
          )}
          <label className="welcome-trap" aria-hidden="true">Website<input tabIndex={-1} autoComplete="off" value={website} onChange={(e) => setWebsite(e.target.value)} /></label>
          {error && <p className="error" role="alert">{error}</p>}
          <button type="submit" className="btn btn-primary btn-block btn-lg" disabled={busy}>{busy ? 'Checking in…' : 'Mark me present'}</button>
        </form>
      )}
    </div>
  );
}

/**
 * The later code words (Andy, 2026-11-24, 2A): the leader says a check word at a surprise minute and a last word
 * near the end. The student keeps this page open and types each one when it is said.
 */
function LaterWords({ orgId, eventId, k, later }: { orgId: string; eventId: string; k: string; later: Later }) {
  const [words, setWords] = useState(later.words);
  const [word, setWord] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const waiting = words.filter((w) => !w.got);

  async function send(e: FormEvent) {
    e.preventDefault();
    if (!word.trim()) return;
    setBusy(true);
    setMsg(null);
    try {
      const r = await httpsCallable<Record<string, unknown>, { kind: string; got: string[] }>(functions, 'classRegister')({ action: 'word', orgId, eventId, k, token: later.token, word });
      setWords((ws) => ws.map((w) => ({ ...w, got: r.data.got.includes(w.kind) })));
      setMsg({ ok: true, text: `${words.find((w) => w.kind === r.data.kind)?.label ?? 'Word'} received. Thank you!` });
      setWord('');
    } catch (err) {
      setMsg({ ok: false, text: cleanMessage(err) });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="class-words card">
      <strong>{waiting.length ? 'Keep this page open' : 'All words in. Thank you!'}</strong>
      {waiting.length > 0 && <p className="small">The leader will say {waiting.length === 2 ? 'two more code words' : 'one more code word'} during the class (the last one at about {later.endLabel}). Type each one here when you hear it.</p>}
      <div className="chip-row">
        {words.map((w) => <span key={w.kind} className="chip">{w.got ? '✓' : '○'} {w.label}</span>)}
      </div>
      {waiting.length > 0 && (
        <form className="form" onSubmit={send}>
          <label className="field"><span>Code word</span><input value={word} maxLength={30} autoCapitalize="characters" autoComplete="off" onChange={(e) => setWord(e.target.value)} /></label>
          <button type="submit" className="btn btn-primary btn-block" disabled={busy || !word.trim()}>{busy ? 'Sending…' : 'Send the word'}</button>
        </form>
      )}
      {msg && <p className={msg.ok ? 'small' : 'error'} role={msg.ok ? 'status' : 'alert'}>{msg.text}</p>}
    </div>
  );
}
