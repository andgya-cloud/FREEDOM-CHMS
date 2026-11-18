import { parseGoogleBooks, parseOpenLibrary, type FoundBook } from '../../functions/src/shared/library';

async function getJson(url: string, signal: AbortSignal): Promise<unknown> {
  const r = await fetch(url, { signal });
  if (!r.ok) throw new Error(String(r.status));
  return r.json();
}

/**
 * Looks a book up in the world's library catalogues (Andy, 2026-11-18): Open Library, the Internet Archive's
 * catalogue of tens of millions of books from libraries around the world, then Google Books if that finds
 * nothing. Only the words typed are sent; nothing about ADIA or its people. Needs the internet.
 */
export async function searchWorldBooks(q: string, signal: AbortSignal): Promise<FoundBook[]> {
  const words = q.trim();
  if (words.length < 3) return [];
  const isbn = words.replace(/[\s-]/g, '');
  const byIsbn = /^(97[89])?\d{9}[\dX]$/i.test(isbn);
  const ol = `https://openlibrary.org/search.json?${byIsbn ? `isbn=${isbn}` : `q=${encodeURIComponent(words)}`}&limit=12&fields=title,subtitle,author_name,isbn,first_publish_year,subject`;
  let found: FoundBook[] = [];
  try { found = parseOpenLibrary(await getJson(ol, signal)); } catch (err) { if ((err as { name?: string }).name === 'AbortError') throw err; }
  if (found.length) return found;
  const gb = `https://www.googleapis.com/books/v1/volumes?q=${encodeURIComponent(byIsbn ? `isbn:${isbn}` : words)}&maxResults=12&printType=books`;
  try { found = parseGoogleBooks(await getJson(gb, signal)); } catch (err) { if ((err as { name?: string }).name === 'AbortError') throw err; }
  return found;
}
