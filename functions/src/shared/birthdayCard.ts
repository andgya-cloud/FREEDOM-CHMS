/**
 * The birthday card (Andy, 2026-11-01, 1A-7A): the church's card picture with "Dear Mary," written on it in a script
 * font, sent from the user's own WhatsApp or emailed at 7 a.m. on the day. The same drawing runs in the browser and
 * in the 7 a.m. job, so both cards look the same.
 */

export const CARD_FONT = 'Great Vibes';

export interface CardLayout {
  /** Centre of the name, as a share of the picture's width and height. */
  x: number;
  y: number;
  color: string;
}

/** Above "HAPPY" inside the round label of Freedom Church's card, in its dark green. */
export const DEFAULT_LAYOUT: CardLayout = { x: 0.64, y: 0.272, color: '#1d3b27' };

export const CARD_COLORS: { value: string; label: string }[] = [
  { value: '#1d3b27', label: 'Dark green' },
  { value: '#a8823a', label: 'Gold' },
  { value: '#222222', label: 'Black' },
  { value: '#ffffff', label: 'White' },
];

/** The first name only: "Dear Mary,". */
export function cardGreeting(firstName: string): string {
  const name = firstName.trim().split(/\s+/)[0] ?? '';
  return name ? `Dear ${name},` : '';
}

/** A tidy layout from stored data, falling back to the default for anything missing or odd. */
export function cleanLayout(v: Partial<CardLayout> | null | undefined): CardLayout {
  const frac = (n: unknown, d: number) => (typeof n === 'number' && n >= 0 && n <= 1 ? n : d);
  const color = typeof v?.color === 'string' && /^#[0-9a-f]{6}$/i.test(v.color) ? v.color : DEFAULT_LAYOUT.color;
  return { x: frac(v?.x, DEFAULT_LAYOUT.x), y: frac(v?.y, DEFAULT_LAYOUT.y), color };
}

/** The bit of a 2D canvas this needs; the browser's and @napi-rs/canvas's both fit. */
export interface Ctx2D {
  font: string;
  fillStyle: unknown;
  textAlign: string;
  textBaseline: string;
  measureText(text: string): { width: number };
  fillText(text: string, x: number, y: number): void;
}

/** Writes the greeting on a picture already drawn at width w and height h, shrinking long names to fit. */
export function drawGreeting(ctx: Ctx2D, w: number, h: number, text: string, layout: CardLayout): void {
  if (!text) return;
  let size = Math.round(w * 0.062);
  const maxWidth = w * 0.4;
  const font = (s: number) => `${s}px "${CARD_FONT}"`;
  ctx.font = font(size);
  while (size > 12 && ctx.measureText(text).width > maxWidth) {
    size -= 2;
    ctx.font = font(size);
  }
  ctx.fillStyle = layout.color;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, layout.x * w, layout.y * h);
}

/** The id of this year's card record for a person: one card a year. */
export const cardId = (personId: string, year: string | number) => `${personId}_${year}`;
