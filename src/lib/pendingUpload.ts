/**
 * A file chosen on the one Upload page (v182, 7A), waiting for the page that checks it: the KE-014 list, the
 * children list, the champions list or photos. Taken once.
 */
type Rows = (string | number | Date | null)[][];
let sheet: { kind: string; rows: Rows; fileName: string } | null = null;
let photos: File[] | null = null;
export function holdSheet(kind: string, rows: Rows, fileName: string) { sheet = { kind, rows, fileName }; }
export function takeSheet(kind: string) { const s = sheet && sheet.kind === kind ? sheet : null; if (s) sheet = null; return s; }
export function holdPhotos(files: File[]) { photos = files; }
export function takePhotos() { const p = photos; photos = null; return p; }
