import { useEffect, useState } from 'react';
import { collection, doc, serverTimestamp, setDoc } from 'firebase/firestore';
import { db, auth } from '../firebase';
import { useLiveDoc, useLiveQuery } from './useQuery';
import { createStamps } from './records';
import { trackWrite } from './sync';
import { CARD_FONT, cardId, cleanLayout, drawGreeting, type CardLayout } from '../../functions/src/shared/birthdayCard';

export const DEFAULT_CARD = '/cards/birthday.jpg';

export interface CardDesign extends CardLayout { image: string | null }
interface CardDoc extends Partial<CardLayout> { image?: string | null }

/** The organization's birthday card: its own picture and name position, or Freedom Church's card. */
export function useCardDesign(orgId: string): { design: CardDesign; exists: boolean; loading: boolean } {
  const { data, loading } = useLiveDoc<CardDoc>(() => (orgId ? doc(db, 'organizations', orgId, 'cards', 'birthday') : null), [orgId]);
  const image = data?.image ?? null;
  return { design: { image, ...cleanLayout(data) }, exists: !!data, loading };
}

let fontLoad: Promise<unknown> | null = null;
function loadFont() {
  fontLoad ??= new FontFace(CARD_FONT, 'url(/fonts/GreatVibes-Regular.ttf)').load()
    .then((f) => { document.fonts.add(f); })
    .catch(() => { fontLoad = null; });
  return fontLoad;
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('The card picture could not be loaded.'));
    img.src = src;
  });
}

/** Draws the card with the greeting onto a canvas. */
export async function drawCard(canvas: HTMLCanvasElement, design: CardDesign, greeting: string): Promise<void> {
  const [img] = await Promise.all([loadImage(design.image ?? DEFAULT_CARD), loadFont()]);
  canvas.width = img.naturalWidth;
  canvas.height = img.naturalHeight;
  const ctx = canvas.getContext('2d')!;
  ctx.drawImage(img, 0, 0);
  drawGreeting(ctx, canvas.width, canvas.height, greeting, design);
}

/** The card as a JPEG file named for the person. */
export async function cardFile(design: CardDesign, greeting: string, firstName: string): Promise<File> {
  const canvas = document.createElement('canvas');
  await drawCard(canvas, design, greeting);
  const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('The card could not be made.'))), 'image/jpeg', 0.9));
  return new File([blob], `Happy-birthday-${firstName.replace(/[^A-Za-z0-9]+/g, '-') || 'card'}.jpg`, { type: 'image/jpeg' });
}

/** Cards made ahead, so pressing Send shares straight away (phones only allow sharing right after a tap). */
export function useCardFiles(design: CardDesign, people: { id: string; greeting: string; firstName: string }[]): Map<string, File> {
  const [files, setFiles] = useState(new Map<string, File>());
  const key = `${design.image?.length ?? 0}|${design.x}|${design.y}|${design.color}|${people.map((p) => `${p.id}:${p.greeting}`).join(',')}`;
  useEffect(() => {
    let live = true;
    void Promise.all(people.map(async (p) => [p.id, await cardFile(design, p.greeting, p.firstName)] as const))
      .then((list) => { if (live) setFiles(new Map(list)); })
      .catch(() => {});
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  return files;
}

export interface CardSent { id: string; personId: string; year: number; whatsappAt?: unknown; whatsappBy?: string; whatsappByName?: string; emailAt?: unknown; emailTo?: string }

/** This year's (and next year's, near New Year) card records. */
export function useCardsSent(orgId: string, enabled: boolean): Map<string, CardSent> {
  const { rows } = useLiveQuery<CardSent>(() => (orgId && enabled ? collection(db, 'organizations', orgId, 'birthdayCards') : null), [orgId, enabled]);
  return new Map(rows.map((r) => [r.id, r]));
}

/** Records that the card went on WhatsApp, with who sent it (6A). */
export function markCardSent(orgId: string, personId: string, year: number, byName: string, existing: boolean) {
  const ref = doc(db, 'organizations', orgId, 'birthdayCards', cardId(personId, year));
  const mark = { whatsappAt: serverTimestamp(), whatsappBy: auth.currentUser?.uid ?? '', whatsappByName: byName.slice(0, 120) };
  return trackWrite(existing ? setDoc(ref, mark, { merge: true }) : setDoc(ref, { orgId, personId, year, ...mark }));
}

/** Saves a new card picture or name position (7A). `image` null goes back to Freedom Church's card. */
export function saveCardDesign(orgId: string, exists: boolean, design: CardDesign) {
  const ref = doc(db, 'organizations', orgId, 'cards', 'birthday');
  const data = { orgId, image: design.image, x: design.x, y: design.y, color: design.color };
  return trackWrite(exists
    ? setDoc(ref, { ...data, updatedAt: serverTimestamp(), updatedBy: auth.currentUser?.uid ?? '' }, { merge: true })
    : setDoc(ref, { ...data, ...createStamps() }));
}

/** Shrinks an uploaded picture to a JPEG under about 650 KB, so it fits in one record. */
export async function shrinkPicture(file: File): Promise<string> {
  const url = URL.createObjectURL(file);
  try {
    const img = await loadImage(url);
    let width = Math.min(1080, img.naturalWidth);
    for (let i = 0; i < 6; i++) {
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = Math.round(img.naturalHeight * (width / img.naturalWidth));
      canvas.getContext('2d')!.drawImage(img, 0, 0, canvas.width, canvas.height);
      const data = canvas.toDataURL('image/jpeg', 0.85);
      if (data.length <= 650_000) return data;
      width = Math.round(width * 0.82);
    }
    throw new Error('That picture is too large. Please choose a smaller one.');
  } finally {
    URL.revokeObjectURL(url);
  }
}
