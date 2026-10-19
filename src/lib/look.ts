import type { Organization } from '../state/OrgContext';

/**
 * Each organization can have its own interface. "cockpit" is the dark, curved layout made for Freedom Church;
 * "glass" is the frosted-glass panel over a blurred room made for ADIA Training Centre; everything else keeps the standard look. A new look is added here and in styles.css.
 */
export type Look = 'standard' | 'cockpit' | 'glass';

export function lookFor(org: Pick<Organization, 'type'> | null | undefined): Look {
  if (org?.type === 'church_campus') return 'cockpit';
  return org?.type === 'college' ? 'glass' : 'standard';
}

/** "Africa/Nairobi" becomes "Nairobi", "America/New_York" becomes "New York". */
export function cityOf(timeZone: string): string {
  return (timeZone.split('/').pop() ?? timeZone).replace(/_/g, ' ');
}

/** The time on the clock in the header, in the organization's own time zone, for example "12:31 PM". */
export function clockText(now: Date, timeZone: string): string {
  return new Intl.DateTimeFormat('en-US', { hour: 'numeric', minute: '2-digit', hour12: true, timeZone }).format(now);
}
