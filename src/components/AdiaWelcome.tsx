import type { ReactNode } from 'react';
import { useAuth } from '../state/AuthContext';
import type { Organization } from '../state/OrgContext';
import { firstNameOf, timeGreeting } from './Greeting';
import { SceneVideo } from './SceneVideo';

/**
 * ADIA's welcome card (Andy, 2026-11-11: "everyone sees this"): the date, "Good evening, Andrew", the school's
 * name and the crest video. On Today for most staff, and at the top of the trainers' and lab technicians' first page.
 */
export function AdiaWelcome({ org, summary, children }: { org: Organization; summary: string; children?: ReactNode }) {
  const { profile } = useAuth();
  const first = firstNameOf(profile?.displayName);
  const greet = `${timeGreeting(org.timeZone || 'Africa/Nairobi')}${first ? `, ${first}` : ''}`;
  return (
    <section className="card lav-hero">
      <div className="lav-hero-text">
        <span className="lav-eyebrow"><i aria-hidden="true" />{new Intl.DateTimeFormat('en-GB', { weekday: 'long', day: 'numeric', month: 'long', timeZone: org.timeZone || 'Africa/Nairobi' }).format(new Date())}</span>
        <h1 className="lav-greet">{greet}</h1>
        <p className="lav-org"><em>{org.name}</em></p>
        <p>{summary}</p>
      </div>
      <div className="lav-scene">
        <SceneVideo />
        {children}
      </div>
    </section>
  );
}
