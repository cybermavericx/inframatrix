import type { Integration } from './entities/integration.entity';
import type { IntegrationTypeField } from './entities/integration-type.entity';

/**
 * Warn-only flags for a `custom_fields`-behavior integration (e.g. CMS Access): a value matching an
 * `avoidableValues` entry (substring, case-insensitive) or missing from a non-empty `possibleValues`
 * list (exact, case-insensitive) is flagged. Never blocks publish — pure/read-only, mirrored in
 * apps/web/src/lib/integrationFlags.ts for instant client-side feedback; keep both in sync.
 */
export function computeIntegrationFlags(it: Integration): string[] {
  const fields = it.integrationType?.fields;
  if (!fields?.length) return [];
  const values = it.fieldValues ?? {};
  const flags: string[] = [];
  for (const f of fields) {
    const v = (values[f.key] ?? '').trim();
    if (!v) continue;
    const vLower = v.toLowerCase();
    const avoided = f.avoidableValues?.find((a) => a && vLower.includes(a.toLowerCase()));
    if (avoided) {
      flags.push(`${it.integrationType?.name} — ${f.label}: "${v}" matches an avoided pattern ("${avoided}").`);
    }
    if (f.possibleValues?.length && !f.possibleValues.some((p) => p.toLowerCase() === vLower)) {
      flags.push(`${it.integrationType?.name} — ${f.label}: "${v}" is not one of the suggested values.`);
    }
  }
  return flags;
}

const FORBIDDEN_NAME_PARTS = ['password', 'passwd', 'pwd', 'secret'];

/** True if a field's key/label looks like it's meant to hold a password/secret — never store those here. */
export function isForbiddenFieldName(key: string, label: string): boolean {
  const s = `${key} ${label}`.toLowerCase();
  return FORBIDDEN_NAME_PARTS.some((p) => s.includes(p));
}

/** Throws-friendly check over a whole field-defs array; returns the first offending field's label, or null. */
export function findForbiddenField(fields: IntegrationTypeField[] | null | undefined): string | null {
  for (const f of fields ?? []) {
    if (isForbiddenFieldName(f.key ?? '', f.label ?? '')) return f.label || f.key;
  }
  return null;
}
