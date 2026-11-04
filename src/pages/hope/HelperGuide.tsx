import { useEffect, useState } from 'react';
import { useAuth } from '../../state/AuthContext';

const STEPS: [string, string, string][] = [
  ['🙋', 'Say you are here', 'When you arrive, tap the big "I\'m here" button. Your time is saved.'],
  ['🖼️', 'Tap each child', 'Open the Children\'s register. Tap a child\'s photo as they come in. A green tick means they are here.'],
  ['☑️', 'Or tick boxes', 'Prefer a list? Tap "Tick list" and tick the box next to each child.'],
  ['✅', 'Finish', 'At the end, tap "Finish". Children without a tick are marked absent.'],
];

const seenKey = (uid: string) => `hope.helperGuide.${uid}`;

/**
 * A short picture guide for helpers (Andy, 2026-11-04, 10A). It shows by itself the first time a helper signs
 * in on a device, and again from "How it works".
 */
export function HelperGuide({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { profile } = useAuth();
  const [first, setFirst] = useState(false);
  const [step, setStep] = useState(0);
  useEffect(() => {
    if (!profile) return;
    try { if (!localStorage.getItem(seenKey(profile.uid))) setFirst(true); } catch { /* storage blocked: skip the guide */ }
  }, [profile]);
  const shown = open || first;
  useEffect(() => { if (shown) setStep(0); }, [shown]);
  if (!shown) return null;
  function close() {
    if (profile) { try { localStorage.setItem(seenKey(profile.uid), '1'); } catch { /* ignore */ } }
    setFirst(false);
    onClose();
  }
  const [ico, title, text] = STEPS[step]!;
  const last = step === STEPS.length - 1;
  return (
    <div className="hp-guide" role="dialog" aria-modal="true" aria-labelledby="hp-guide-title">
      <div className="card hp-guide-card">
        <span className="hp-guide-ico" aria-hidden="true">{ico}</span>
        <p className="small muted">Step {step + 1} of {STEPS.length}</p>
        <h2 id="hp-guide-title">{title}</h2>
        <p>{text}</p>
        <div className="hp-guide-dots" aria-hidden="true">{STEPS.map((_, i) => <i key={i} className={i === step ? 'on' : ''} />)}</div>
        <div className="chips">
          {step > 0 && <button type="button" className="btn btn-quiet" onClick={() => setStep(step - 1)}>Back</button>}
          <button type="button" className="btn btn-primary" autoFocus onClick={() => (last ? close() : setStep(step + 1))}>{last ? 'Got it' : 'Next'}</button>
          {!last && <button type="button" className="btn btn-quiet" onClick={close}>Skip</button>}
        </div>
      </div>
    </div>
  );
}
