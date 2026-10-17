/**
 * Phone numbers are stored in international form (+2547XXXXXXXX) so the same
 * person typed as 0712 345 678, 712345678 or +254 712 345 678 is recognised
 * as one number. Kenya (+254) is the default country.
 */
export const DEFAULT_COUNTRY_CODE = '254';

/** Returns +<digits>, or null when the text cannot be a phone number. */
export function normalizePhone(input: string | null | undefined, countryCode = DEFAULT_COUNTRY_CODE): string | null {
  if (!input) return null;
  const trimmed = input.trim();
  const hasPlus = trimmed.startsWith('+') || trimmed.startsWith('00');
  let digits = trimmed.replace(/\D/g, '');
  if (trimmed.startsWith('00')) digits = digits.slice(2);
  if (!digits) return null;

  let full: string;
  if (hasPlus) {
    full = digits;
  } else if (digits.startsWith(countryCode) && digits.length === countryCode.length + 9) {
    full = digits;
  } else if (digits.startsWith('0') && digits.length === 10) {
    full = countryCode + digits.slice(1);
  } else if (digits.length === 9 && /^[17]/.test(digits)) {
    full = countryCode + digits;
  } else {
    return null;
  }
  if (full.length < 9 || full.length > 15) return null;
  if (full.startsWith(countryCode) && full.length !== countryCode.length + 9) return null;
  return `+${full}`;
}

/** +254712345678 -> 0712 345 678 for Kenyan numbers; other numbers keep their + form. */
export function formatPhone(e164: string | null | undefined, countryCode = DEFAULT_COUNTRY_CODE): string {
  if (!e164) return '';
  const digits = e164.replace(/\D/g, '');
  if (digits.startsWith(countryCode) && digits.length === countryCode.length + 9) {
    const local = `0${digits.slice(countryCode.length)}`;
    return `${local.slice(0, 4)} ${local.slice(4, 7)} ${local.slice(7)}`;
  }
  return e164;
}

/** Digits only, for wa.me links: +254712345678 -> 254712345678 */
export function phoneDigits(e164: string | null | undefined): string {
  return (e164 ?? '').replace(/\D/g, '');
}
