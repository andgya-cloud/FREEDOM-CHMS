import { useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useOrg, type Organization } from '../../state/OrgContext';
import { usePeople } from '../../state/PeopleContext';
import { useToast } from '../../state/ToastContext';
import { useProgramMarks, usePrograms, useProgramSessions, type Program } from '../../state/usePrograms';
import { APP_URL, classKey, codeFor, openClass, secondsLeft } from '../../lib/classRegister';
import { friendlyError } from '../../lib/errors';
import { attended, doorName } from '../../../functions/src/shared/attendance';
import { formatDateKey, localDateKey, zonedParts } from '../../../functions/src/shared/datetime';
import { programSessionIdFor } from '../../../functions/src/shared/programs';
import { checkInPath, isWindowOpen, plannedOn, scanWindow } from '../../../functions/src/shared/classRegister';

/**
 * The class leader's screen (Andy, 2026-11-09, 1A): a big QR code that changes every minute, for a phone held up
 * or a projector. Students scan it and type their phone number; the count below goes up as they check in.
 */
export function ClassQrPage() {
  const { orgId = '', programId = '' } = useParams();
  const { organizations } = useOrg();
  const org = organizations.find((o) => o.id === orgId);
  const { programs, loading } = usePrograms(orgId);
  const program = programs.find((p) => p.id === programId);
  if (!org || !program) {
    return <div className="door"><p>{loading ? 'Loading…' : 'This programme was not found.'}</p><Link className="btn" to="/programs">Back</Link></div>;
  }
  return <QrScreen org={org} program={program} />;
}

function QrScreen({ org, program }: { org: Organization; program: Program }) {
  const toast = useToast();
  const { byId } = usePeople();
  const today = localDateKey(new Date(), org.timeZone);
  const planned = plannedOn(program.plan, today);
  const { sessions } = useProgramSessions(org.id, program.id);
  const marks = useProgramMarks(org.id, program.id);
  const eventId = programSessionIdFor(today, program.id, null);
  const existing = sessions.find((s) => s.id === eventId);
  const [picked, setPicked] = useState(planned?.topicId ?? program.topics[0]?.id ?? '');
  const topicId = existing?.topicIds?.[0] ?? picked;
  const topic = program.topics.find((t) => t.id === topicId);
  const [key, setKey] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [code, setCode] = useState('');
  const [left, setLeft] = useState(secondsLeft());
  const [qr, setQr] = useState('');

  const present = useMemo(() => marks
    .filter((m) => m.eventId === eventId && !m.deletedAt && attended(m.status))
    .sort((a, b) => (b.checkedInAt?.toMillis?.() ?? 0) - (a.checkedInAt?.toMillis?.() ?? 0)), [marks, eventId]);

  async function start() {
    if (!topicId) return;
    setBusy(true);
    try {
      const { synced } = openClass(org, program, today, topicId, planned && planned.topicId === topicId ? planned : null, !!existing);
      await synced;
      setKey(await classKey(org.id, eventId));
    } catch (err) {
      toast.show(friendlyError(err));
    } finally {
      setBusy(false);
    }
  }

  // A new code every minute; the countdown every second.
  useEffect(() => {
    if (!key) return;
    let stop = false;
    const tick = async () => {
      setLeft(secondsLeft());
      const c = await codeFor(key);
      if (!stop) setCode((old) => (old === c ? old : c));
    };
    void tick();
    const t = window.setInterval(() => void tick(), 1000);
    return () => { stop = true; window.clearInterval(t); };
  }, [key]);

  const url = code ? `${APP_URL}${checkInPath(org.id, eventId, code)}` : '';
  useEffect(() => {
    if (!url) return;
    let stop = false;
    void import('qrcode').then(({ default: QRCode }) => QRCode.toDataURL(url, { margin: 1, width: 720, errorCorrectionLevel: 'M', color: { dark: '#0b3d24', light: '#ffffff' } }))
      .then((img) => { if (!stop) setQr(img); });
    return () => { stop = true; };
  }, [url]);

  const now = zonedParts(new Date(), org.timeZone);
  const window_ = scanWindow(program);
  const closed = !!planned && !isWindowOpen(program, now.hour * 60 + now.minute);

  return (
    <div className="door class-qr">
      <header className="door-head">
        <Link className="btn btn-quiet" to={`/programs/${org.id}/${program.id}`}>← Back</Link>
        <span className="door-count" aria-label={`${present.length} checked in`}>{present.length} in</span>
      </header>
      <main className="door-main class-qr-main">
        <p className="muted">{program.name} · {formatDateKey(today)}{planned ? ` · ${planned.label}` : ' · Make-up class'}</p>
        <h1 className="class-qr-topic">{topic?.name ?? 'Choose the topic'}</h1>

        {!key ? (
          <div className="stack class-qr-start">
            {!existing && (
              <label className="field">
                <span>{planned ? 'Topic tonight (from the calendar)' : 'No class on the calendar today. Which topic is this make-up class?'}</span>
                <select value={picked} onChange={(e) => setPicked(e.target.value)}>
                  {program.topics.map((t, i) => <option key={t.id} value={t.id}>{i + 1}. {t.name}</option>)}
                </select>
              </label>
            )}
            {planned && <p className="muted small">Check-in is open {window_.label}.</p>}
            <button type="button" className="btn btn-primary btn-lg" disabled={busy || !topicId} onClick={() => void start()}>
              {busy ? 'Opening…' : 'Show the QR code'}
            </button>
          </div>
        ) : (
          <>
            {closed && <p className="notice notice-warn">Check-in for this class is open {window_.label}. Scans outside those hours are turned away.</p>}
            <div className="class-qr-code">
              {qr ? <img src={qr} alt="Scan to check in" /> : <span className="muted">Making the code…</span>}
            </div>
            <p className="class-qr-hint"><strong>Scan with your phone camera</strong>, then type your phone number. <span className="muted">New code in {left}s</span></p>
          </>
        )}

        {present.length > 0 && (
          <div className="class-qr-names" aria-label="Checked in">
            {present.slice(0, 18).map((m) => <span key={m.id} className="chip">{doorName(byId(m.personId)?.fullName ?? 'Someone')}</span>)}
            {present.length > 18 && <span className="chip">+{present.length - 18} more</span>}
          </div>
        )}
        {existing && <p className="small"><Link to={`/attendance/${org.id}/${eventId}`}>Mark someone by hand</Link></p>}
      </main>
    </div>
  );
}
