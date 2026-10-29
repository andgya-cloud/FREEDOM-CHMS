import { useMemo, useState } from 'react';
import { initialOf, matchesStudent } from '../lib/studentSearch';

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('');

/**
 * Search for every list of students (Andy, 2026-10-29, 2C 3A 4A): a box that narrows the list as you type a name
 * or an admission number, and an A to Z bar that shows the names under one letter. Tap the letter again for all.
 */
export function useStudentFinder() {
  const [q, setQ] = useState('');
  const [letter, setLetter] = useState('');
  const match = (name: string, admissionNo = '') => matchesStudent(q, name, admissionNo) && (!letter || initialOf(name) === letter);
  return { q, setQ, letter, setLetter, match, active: !!(q.trim() || letter) };
}

export function StudentFinder({ finder, names, shown, total, placeholder = 'Find by name or admission number', className = '' }: {
  finder: ReturnType<typeof useStudentFinder>;
  /** Every name in the list, so letters with nobody under them are greyed out. */
  names: string[];
  /** How many the list shows now, and of how many. */
  shown?: number; total?: number;
  placeholder?: string; className?: string;
}) {
  const { q, setQ, letter, setLetter, active } = finder;
  return (
    <div className={`student-finder no-print ${className}`}>
      <input type="search" className="search" placeholder={placeholder} aria-label="Find a student" value={q} onChange={(e) => setQ(e.target.value)} />
      <AzBar names={names} letter={letter} onLetter={setLetter} onAll={active ? () => { setQ(''); setLetter(''); } : undefined} />
      {active && shown != null && total != null && <p className="small muted finder-count">{shown === 0 ? 'Nobody matches.' : `Showing ${shown} of ${total}.`}</p>}
    </div>
  );
}

/** The A to Z bar on its own, for lists that already have their own search box (the class registers). */
export function AzBar({ names, letter, onLetter, onAll }: { names: string[]; letter: string; onLetter: (l: string) => void; onAll?: () => void }) {
  const have = useMemo(() => new Set(names.map(initialOf)), [names]);
  return (
    <div className="az-bar no-print" role="group" aria-label="Names starting with">
      {ALPHABET.map((l) => (
        <button key={l} type="button" className={`az${letter === l ? ' az-on' : ''}`} disabled={!have.has(l)} aria-pressed={letter === l}
          onClick={() => onLetter(letter === l ? '' : l)}>{l}</button>
      ))}
      {onAll && <button type="button" className="az az-all" onClick={onAll}>All</button>}
    </div>
  );
}
