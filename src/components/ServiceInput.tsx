import { useId } from 'react';
import { splitServiceName } from '../../functions/src/shared/attendance';

/** Suggestions for the service box: names used before (without their times) and the organization's lists. */
export function serviceSuggestions(names: string[]): string[] {
  return [...new Set(names.map((n) => splitServiceName(n).service).filter(Boolean))].sort((a, b) => a.localeCompare(b));
}

/** Type the service and its time (Andy, 2026-11-03), instead of a fixed "Sunday 10:00 service". */
export function ServiceInput({ service, time, onService, onTime, suggestions }: {
  service: string; time: string; onService: (v: string) => void; onTime: (v: string) => void; suggestions: string[];
}) {
  const listId = useId();
  return (
    <div className="service-input">
      <label className="field"><span>Service</span>
        <input value={service} maxLength={100} list={listId} placeholder="For example Main service" autoComplete="off" onChange={(e) => onService(e.target.value)} />
        <datalist id={listId}>{suggestions.map((s) => <option key={s} value={s} />)}</datalist>
      </label>
      <label className="field service-time"><span>Time</span>
        <input type="time" value={time} onChange={(e) => onTime(e.target.value)} />
      </label>
    </div>
  );
}
