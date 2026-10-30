import { useAuth } from '../state/AuthContext';
import { useOrg } from '../state/OrgContext';

/** "Andrew" from "Andrew Guya": the first word of the name on the staff account. */
export function firstNameOf(displayName: string | null | undefined): string {
  return (displayName ?? '').trim().split(/\s+/)[0] ?? '';
}

/** "Good morning", "Good afternoon" or "Good evening" by the organization's own clock. */
export function timeGreeting(timeZone = 'Africa/Nairobi', now = new Date()): string {
  const hour = Number(new Intl.DateTimeFormat('en-GB', { hour: 'numeric', hourCycle: 'h23', timeZone }).format(now));
  return hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';
}

/**
 * "Good evening, Alphonse" on the first page of people who do not see Today (lecturers, lab technicians,
 * petty cash signers), so everyone is greeted by their first name (Andy, 2026-10-30, 4A).
 */
export function Greeting() {
  const { profile } = useAuth();
  const { current } = useOrg();
  const name = firstNameOf(profile?.displayName);
  return <p className="greet-line">{timeGreeting(current?.timeZone || 'Africa/Nairobi')}{name ? `, ${name}` : ''}</p>;
}
