/**
 * Version sort keys — one rule for stored values, fixed-list options and search operands.
 *
 *   - The FIRST run of digits-and-dots in the text is the version ("php 8.4" → 8.4, "Laravel 10.x" → 10).
 *     Any prefix/suffix ("PHP ", "-beta", " LTS") is kept in the value but ignored for ordering.
 *   - Up to 4 numeric parts, each zero-padded to 6 digits, joined with '.':
 *       8.3.35 → 000008.000003.000035      8.3 → 000008.000003
 *   - Fewer than 3 parts, or an explicit ".x", is LINE level (patch unknown). A bare "8.3" is the 8.3
 *     line, NOT 8.3.0 — "8.3" and "8.3.0" have different keys.
 *   - No digits (or a part over 6 digits) → null: not a version.
 *
 * Keys compare as plain bytes (columns are ascii_bin): '.' sorts before every digit, so a line key is
 * less than every exact key inside that line. The operators in data/search.ts rely on that — see
 * VERSION SEMANTICS there for how a line-level value behaves in < / > / line match.
 */
export type VersionKey = { key: string; level: 'line' | 'exact' };

const RUN = /(\d+(?:\.\d+){0,3})(\.[xX*])?/;

export function versionKey(raw: unknown): VersionKey | null {
  if (typeof raw !== 'string' && typeof raw !== 'number') return null;
  const m = RUN.exec(String(raw));
  if (!m) return null;
  const parts = m[1].split('.');
  if (parts.some((p) => p.length > 6)) return null;
  const key = parts.map((p) => p.padStart(6, '0')).join('.');
  return { key, level: parts.length >= 3 && !m[2] ? 'exact' : 'line' };
}
