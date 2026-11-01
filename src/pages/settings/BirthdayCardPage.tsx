import { useEffect, useRef, useState, type MouseEvent } from 'react';
import { Link } from 'react-router-dom';
import type { Organization } from '../../state/OrgContext';
import { useToast } from '../../state/ToastContext';
import { OrgGate } from '../../components/OrgGate';
import { friendlyError } from '../../lib/errors';
import { drawCard, saveCardDesign, shrinkPicture, useCardDesign, type CardDesign } from '../../lib/birthdayCard';
import { CARD_COLORS, cardGreeting, DEFAULT_LAYOUT } from '../../../functions/src/shared/birthdayCard';

/**
 * The birthday card's picture (Andy, 2026-11-01, 7A): upload a new design, tap where the name goes, pick its colour,
 * or go back to Freedom Church's card.
 */
export function BirthdayCardPage() {
  return <OrgGate title="Birthday card">{(org) => <BirthdayCard org={org} />}</OrgGate>;
}

function BirthdayCard({ org }: { org: Organization }) {
  const { design: saved, exists, loading } = useCardDesign(org.id);
  const toast = useToast();
  const [draft, setDraft] = useState<CardDesign | null>(null);
  const [busy, setBusy] = useState(false);
  const canvas = useRef<HTMLCanvasElement>(null);
  const design = draft ?? saved;
  const changed = draft !== null;

  useEffect(() => {
    if (canvas.current && !loading) void drawCard(canvas.current, design, cardGreeting('Mary')).catch(() => {});
  }, [design, loading]);

  const place = (e: MouseEvent<HTMLCanvasElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    const x = Math.min(1, Math.max(0, (e.clientX - r.left) / r.width));
    const y = Math.min(1, Math.max(0, (e.clientY - r.top) / r.height));
    setDraft({ ...design, x: Math.round(x * 1000) / 1000, y: Math.round(y * 1000) / 1000 });
  };

  const upload = async (file: File | undefined) => {
    if (!file) return;
    try {
      setDraft({ ...design, image: await shrinkPicture(file) });
    } catch (err) { toast.show(friendlyError(err)); }
  };

  const save = async () => {
    setBusy(true);
    try {
      await saveCardDesign(org.id, exists, design);
      setDraft(null);
      toast.show('Birthday card saved');
    } catch (err) { toast.show(friendlyError(err)); } finally { setBusy(false); }
  };

  return (
    <div className="page narrow">
      <p><Link to="/settings">← Settings</Link></p>
      <h1>Birthday card</h1>
      <p className="muted small">This card goes to each person on their birthday, with their first name written on it. Tap the card to move the name.</p>
      <div className="card birthday-card-edit">
        <canvas ref={canvas} className="birthday-card-preview" onClick={place} aria-label="Birthday card preview. Tap to move the name." />
        <div className="form-row">
          <label>Name colour{' '}
            <select value={design.color} onChange={(e) => setDraft({ ...design, color: e.target.value })}>
              {CARD_COLORS.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
            </select>
          </label>
        </div>
        <div className="button-row">
          <label className="btn">
            Upload a new picture
            <input type="file" accept="image/*" hidden onChange={(e) => { void upload(e.target.files?.[0]); e.target.value = ''; }} />
          </label>
          {(design.image || design.x !== DEFAULT_LAYOUT.x || design.y !== DEFAULT_LAYOUT.y || design.color !== DEFAULT_LAYOUT.color) && (
            <button type="button" className="btn btn-quiet" onClick={() => setDraft({ image: null, ...DEFAULT_LAYOUT })}>Back to Freedom Church's card</button>
          )}
        </div>
        {changed && (
          <div className="button-row">
            <button type="button" className="btn btn-primary" disabled={busy} onClick={() => void save()}>{busy ? 'Saving…' : 'Save'}</button>
            <button type="button" className="btn btn-quiet" disabled={busy} onClick={() => setDraft(null)}>Cancel</button>
          </div>
        )}
      </div>
    </div>
  );
}
