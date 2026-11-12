// Display text for stored dropdown values. The stored value never changes (filters, badges, the API
// and exports keep using it); only what the user reads does.

/** Words that keep their casing instead of becoming "Uat" etc. */
const KEEP: Record<string, string> = { uat: 'UAT', eol: 'EOL' };

/** "on_hold" → "On hold", "HALF_YEARLY" → "Half yearly", "uat" → "UAT". Names that are already
 *  written for people ("CloudPanel", "AWS", "On-prem", "Y") are returned unchanged. */
export function optionLabel(value: unknown): string {
  const v = value == null ? '' : String(value);
  if (KEEP[v.toLowerCase()]) return KEEP[v.toLowerCase()];
  const codeLike = /^[a-z][a-z0-9_]*$/.test(v) || (/^[A-Z][A-Z0-9_]+$/.test(v) && (v.includes('_') || v.length >= 4));
  if (!codeLike) return v;
  const words = v.toLowerCase().replace(/_/g, ' ');
  return words.charAt(0).toUpperCase() + words.slice(1);
}
