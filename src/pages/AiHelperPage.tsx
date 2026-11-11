import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../state/AuthContext';
import { useOrg } from '../state/OrgContext';
import { aiFeaturesFor } from '../lib/aiFeatures';
import { aiUsage } from '../lib/aiWrite';
import { AI_MARK } from '../components/Ai';

/**
 * The AI Helper page (Andy, 2026-11-11, 1A 4A 6A): everything the helper can do in this organisation, for this person's
 * role, each one a tap away; and, for Andy and Settings managers, how much of the month's 300 has been used.
 */
export function AiHelperPage() {
  const { can } = useAuth();
  const { current } = useOrg();
  const features = aiFeaturesFor(current?.type, can);
  const manager = can('settings.manage') || can('users.manage');
  const [use, setUse] = useState<{ used: number; cap: number; guideUsed?: number; guideCap?: number } | null>(null);
  useEffect(() => {
    if (!current || !manager) return;
    let stop = false;
    aiUsage(current.id).then((u) => { if (!stop) setUse(u); }).catch(() => undefined);
    return () => { stop = true; };
  }, [current, manager]);

  return (
    <div className="page narrow">
      <h1><span className="ai-label">{AI_MARK}</span> AI Helper</h1>
      <p className="lead">The helper drafts and suggests. You always check its work: nothing is sent or saved until you tap.</p>
      {features.length === 0 ? <p className="muted">There is no AI help for your role here yet.</p> : (
        <ul className="ai-list">
          {features.map((f) => (
            <li key={f.id}><Link to={f.to}><b>{AI_MARK} {f.title}</b><span className="small">{f.detail}</span></Link></li>
          ))}
        </ul>
      )}
      {manager && (
        <section className="card stack">
          <h2>This month</h2>
          {use ? (
            <>
              <div className="ai-meter" role="meter" aria-valuemin={0} aria-valuemax={use.cap} aria-valuenow={use.used} aria-label="AI use this month"><span style={{ width: `${Math.min(100, Math.round((use.used / use.cap) * 100))}%` }} /></div>
              <p className="small"><strong>{use.used} of {use.cap}</strong> used this month for {current?.name}. It starts again on the 1st. Each person can use up to 30 a day.</p>
              {use.guideCap != null && <p className="small"><strong>Just ask Andy:</strong> {use.guideUsed ?? 0} of {use.guideCap} AI answers this month (20 a day for each person). Its ready answers are free and are not counted.</p>}
            </>
          ) : <p className="small muted">Loading…</p>}
          <p className="small muted">The spending limit you set in the Claude Console is the final safety net.</p>
        </section>
      )}
      <p className="small muted">What the helper never does: approve money, match a payment by itself, judge a child's safety, or see private notes. Only first names, numbers and the words on the screen are sent.</p>
    </div>
  );
}
