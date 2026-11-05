import type { HopeClass } from '../../functions/src/shared/hopeClasses';

/** The class stone as an SVG string, the same drawing as the Stone component. */
export function stoneSvg(c: HopeClass): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32" width="128" height="128"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${c.light}"/><stop offset="1" stop-color="${c.colour}"/></linearGradient></defs>`
    + `<path d="M9 4h14l7 8-14 17L2 12z" fill="url(#g)" stroke="${c.colour}" stroke-width="1.2" stroke-linejoin="round"/>`
    + `<path d="M2 12h28M9 4l3 8 4-8 4 8 3-8M12 12l4 17 4-17" fill="none" stroke="#fff" stroke-opacity=".55" stroke-width="1" stroke-linejoin="round"/>`
    + `<path d="M10 6l2 5H5z" fill="#fff" fill-opacity=".45"/></svg>`;
}

const cache = new Map<string, Promise<string>>();
/** The class stone as a PNG data URL, for PDFs (QR cards). */
export function stonePng(c: HopeClass): Promise<string> {
  let p = cache.get(c.id);
  if (!p) {
    p = new Promise<string>((resolve, reject) => {
      const img = new Image();
      img.onload = () => {
        const cv = document.createElement('canvas');
        cv.width = 128; cv.height = 128;
        cv.getContext('2d')!.drawImage(img, 0, 0, 128, 128);
        resolve(cv.toDataURL('image/png'));
      };
      img.onerror = () => reject(new Error('The stone picture could not be drawn.'));
      img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(stoneSvg(c))}`;
    });
    cache.set(c.id, p);
  }
  return p;
}
