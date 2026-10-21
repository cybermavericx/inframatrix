// Centralised date helpers. Inputs stay native (<input type="date"> → 'yyyy-mm-dd'); only DISPLAY is
// formatted to the house style "dd mmm yyyy" (e.g. 07 Jun 2026). Datetimes add the time.

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** A 'yyyy-mm-dd' (optionally with a time) string, complete and in range. Rejects partial input
 *  like '0002-01-01' typed mid-keystroke (year < 1900) so we never act on a half-typed date. */
export function isValidYmd(v: unknown): v is string {
  if (typeof v !== 'string') return false;
  const m = /^(\d{4})-(\d{2})-(\d{2})(?:[T ]\d{2}:\d{2})?/.exec(v.trim());
  if (!m) return false;
  const y = +m[1], mo = +m[2], d = +m[3];
  if (y < 1900 || y > 3000 || mo < 1 || mo > 12 || d < 1 || d > 31) return false;
  return true;
}

/** Format a date-ish value as "dd mmm yyyy" (date) or "dd mmm yyyy, HH:MM" (datetime). Returns the
 *  raw string unchanged if it isn't a recognisable date, so non-date cells are unaffected. */
export function fmtDate(v: unknown): string {
  if (v == null || v === '') return '';
  const s = String(v);
  const m = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2}))?/.exec(s);
  if (!m) return s;
  const y = +m[1], mo = +m[2], d = +m[3];
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return s;
  const base = `${String(d).padStart(2, '0')} ${MONTHS[mo - 1]} ${y}`;
  return m[4] != null ? `${base}, ${m[4]}:${m[5]}` : base;
}

/** True when a column name looks like a date column (used to auto-format table/detail cells). */
export function isDateField(name: string): boolean {
  return /(date|^from$|^to$|expiry|tenure|scheduled|firedAt|resolvedAt|sentAt|At$|periodFrom|periodTo)/i.test(name);
}
