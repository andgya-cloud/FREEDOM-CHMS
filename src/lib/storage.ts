/** Small per-device preferences. Storage can be unavailable (private mode), so every access is guarded. */
export function readPref(key: string): string | null {
  try {
    return localStorage.getItem(`fchms.${key}`);
  } catch {
    return null;
  }
}

export function writePref(key: string, value: string | null): void {
  try {
    if (value === null) localStorage.removeItem(`fchms.${key}`);
    else localStorage.setItem(`fchms.${key}`, value);
  } catch {
    /* preference simply isn't remembered */
  }
}
