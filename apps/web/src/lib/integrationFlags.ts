/**
 * Client-side mirror of apps/api/src/infra/integration-fields.util.ts — keep both in sync.
 * Warn-only flags for a `custom_fields`-behavior integration (e.g. CMS Access): a value matching an
 * `avoidableValues` entry (substring, case-insensitive) or missing from a non-empty `possibleValues`
 * list (exact, case-insensitive) is flagged. Never blocks anything — used for instant inline feedback.
 */
export interface IntegrationTypeField {
  key: string;
  label: string;
  possibleValues: string[];
  avoidableValues: string[];
  /** Which list the editor shows/edits for this field — a field is either a closed mandatory list
   *  ('possible') or an open denylist ('avoidable'), never both. Defaults to 'possible' when unset
   *  (older field defs saved before this toggle existed); see inferMode below. */
  mode?: 'possible' | 'avoidable';
}

/** Mode to use when a field predates the toggle (no `mode` saved): infer from whichever list is
 *  already populated, defaulting to 'possible' if both are empty. */
export function inferMode(field: IntegrationTypeField): 'possible' | 'avoidable' {
  if (field.mode) return field.mode;
  return field.avoidableValues?.length ? 'avoidable' : 'possible';
}

const FORBIDDEN_NAME_PARTS = ['password', 'passwd', 'pwd', 'secret'];

/** True if a field's key/label looks like it's meant to hold a password/secret — never store those here. */
export function isForbiddenFieldName(key: string, label: string): boolean {
  const s = `${key} ${label}`.toLowerCase();
  return FORBIDDEN_NAME_PARTS.some((p) => s.includes(p));
}

/** Flags for one field's current value against its own possible/avoidable lists. */
export function computeFieldFlags(field: IntegrationTypeField, rawValue: string | undefined | null): string[] {
  const v = (rawValue ?? '').trim();
  if (!v) return [];
  const vLower = v.toLowerCase();
  const flags: string[] = [];
  const avoided = field.avoidableValues?.find((a) => a && vLower.includes(a.toLowerCase()));
  if (avoided) flags.push(`"${v}" matches an avoided pattern ("${avoided}").`);
  if (field.possibleValues?.length && !field.possibleValues.some((p) => p.toLowerCase() === vLower)) {
    flags.push(`"${v}" is not one of the suggested values.`);
  }
  return flags;
}

/** Flags across every field of a custom_fields integration row (fields defs + row.fieldValues). */
export function computeIntegrationFlags(fields: IntegrationTypeField[] | undefined, fieldValues: Record<string, string> | undefined): string[] {
  if (!fields?.length) return [];
  const values = fieldValues ?? {};
  return fields.flatMap((f) => computeFieldFlags(f, values[f.key]).map((msg) => `${f.label}: ${msg}`));
}
