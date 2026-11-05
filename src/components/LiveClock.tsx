import { useEffect, useState } from 'react';
import { cityOf, clockText } from '../lib/look';

/** The time in the header (Freedom Church look), kept in step with the organization's time zone. */
export function LiveClock({ timeZone }: { timeZone: string }) {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = window.setInterval(() => setNow(new Date()), 15_000);
    return () => window.clearInterval(id);
  }, []);
  return (
    <div className="live-clock" aria-label={`Time in ${cityOf(timeZone)}`}>
      <span className="live-clock-time">{clockText(now, timeZone)}</span>
      <span className="live-clock-city">{cityOf(timeZone)}</span>
    </div>
  );
}
