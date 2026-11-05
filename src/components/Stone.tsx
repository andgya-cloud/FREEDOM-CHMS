import type { HopeClass } from '../../functions/src/shared/hopeClasses';

/** The class's stone (Andy, 2026-11-05, 5A): a cut gem in the stone's colour. */
export function Stone({ c, size = 22 }: { c: HopeClass; size?: number }) {
  const g = `st-${c.id}`;
  return (
    <svg className="hope-stone" width={size} height={size} viewBox="0 0 32 32" role="img" aria-label={c.name}>
      <defs>
        <linearGradient id={g} x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor={c.light} /><stop offset="1" stopColor={c.colour} /></linearGradient>
      </defs>
      <path d="M9 4h14l7 8-14 17L2 12z" fill={`url(#${g})`} stroke={c.colour} strokeWidth="1.2" strokeLinejoin="round" />
      <path d="M2 12h28M9 4l3 8 4-8 4 8 3-8M12 12l4 17 4-17" fill="none" stroke="#fff" strokeOpacity=".55" strokeWidth="1" strokeLinejoin="round" />
      <path d="M10 6l2 5H5z" fill="#fff" fillOpacity=".45" />
    </svg>
  );
}

/** "💎 Sapphire" as a small chip: the stone and the class name. */
export function ClassChip({ c, size = 18 }: { c: HopeClass | null; size?: number }) {
  if (!c) return <span className="hope-class-chip none">No class yet</span>;
  return <span className="hope-class-chip" style={{ borderColor: c.colour, color: c.colour }}><Stone c={c} size={size} />{c.name}</span>;
}
