import { CalendarBoard } from './CalendarBoard';

/** /calendar: the events calendar on its own page, for every place and everyone who works there (Andy, 2026-11-14). */
export function CalendarPage() {
  return (
    <div className="page narrow fin-wide">
      <h1>Calendar</h1>
      <CalendarBoard />
    </div>
  );
}
