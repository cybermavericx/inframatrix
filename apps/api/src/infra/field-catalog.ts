import { BadRequestException, ConflictException } from '@nestjs/common';
import { In, type EntityManager } from 'typeorm';
import { Integration } from './entities/integration.entity';
import { IntegrationType, type IntegrationTypeField } from './entities/integration-type.entity';
import { IntegrationFieldOption } from './entities/integration-field-option.entity';
import { IntegrationFieldValue } from './entities/integration-field-value.entity';
import { versionKey } from './version-key';

/**
 * Technology catalog for `custom_fields` integration types (phase 3).
 *
 * The JSON columns stay the source of truth and keep being written exactly as before (dual-write):
 *   - IntegrationType.fields[].possibleValues  → which fixed-list options exist
 *   - Integration.fieldValues                  → each integration's values
 * This module mirrors them into infra_integration_field_options (adds a status per option) and
 * infra_integration_field_values (one searchable row per value, with a version sort key), and owns
 * the save-time rules. Both sync functions are idempotent: they compute the wanted rows from the JSON
 * and apply only the difference, so running one twice changes nothing the second time.
 *
 * Field keys are user-defined text (spaces, quotes, anything). They are only ever compared in JS or
 * passed as bound values through TypeORM — never put into SQL or a JSON path as text.
 */

export const VALUE_MAX = 1000;
export const OPTION_MAX = 255;

export const isVersionField = (f: IntegrationTypeField) => f.kind === 'version';
/** Same inference as the web editor: no saved mode → 'avoidable' only if that list is the one filled. */
const modeOf = (f: IntegrationTypeField) => f.mode ?? (f.avoidableValues?.length ? 'avoidable' : 'possible');
/** The fixed list for a field (empty = free text). A value outside it is saved but FLAGGED. */
export const fixedList = (f: IntegrationTypeField): string[] =>
  modeOf(f) === 'possible' ? (f.possibleValues ?? []).map((v) => String(v ?? '').trim()).filter(Boolean) : [];

/** Case- and accent-insensitive, like the tables' utf8mb4_unicode_ci collation. */
export const fold = (s: string) => s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
const text = (v: unknown) => (v === null || v === undefined ? '' : String(v)).trim();
const fieldsOf = (t: IntegrationType | null | undefined) =>
  t?.behavior === 'custom_fields' && Array.isArray(t.fields) ? t.fields.filter((f) => f && typeof f.key === 'string' && f.key) : [];

// ---------------------------------------------------------------- save-time rules

/**
 * Rules for a value being SAVED (API create/update and spreadsheet import). Only a value that differs
 * from what is stored for that key is checked, so existing values always keep saving untouched.
 * "Differs" is decided here, against the stored row the caller loaded from the DB, never from
 * anything the browser says.
 *   - version kind → must contain a version number
 *   - at most VALUE_MAX characters
 * A value outside the field's fixed list is NOT refused: it is saved and flagged
 * (computeIntegrationFlags → dashboard "Flagged" card, which opens the project).
 * Returns the messages (empty = OK).
 */
export function checkChangedValues(type: IntegrationType | null | undefined, next: unknown, stored: unknown): string[] {
  const fields = fieldsOf(type);
  if (!fields.length || !next || typeof next !== 'object') return [];
  const nv = next as Record<string, unknown>;
  const sv = (stored && typeof stored === 'object' ? stored : {}) as Record<string, unknown>;
  const errors: string[] = [];
  for (const f of fields) {
    const v = text(nv[f.key]);
    if (!v || v === text(sv[f.key])) continue;
    const label = f.label || f.key;
    if (v.length > VALUE_MAX) { errors.push(`${label}: at most ${VALUE_MAX} characters.`); continue; }
    if (isVersionField(f) && !versionKey(v)) errors.push(`${label}: "${v.slice(0, 80)}" is not a version number (e.g. 8.3 or 8.3.35).`);
  }
  return errors;
}

export function assertChangedValues(type: IntegrationType | null | undefined, next: unknown, stored: unknown) {
  const errors = checkChangedValues(type, next, stored);
  if (errors.length) throw new BadRequestException(errors.join(' '));
}

// ---------------------------------------------------------------- options (per type)

type WantedOption = { fieldKey: string; value: string; sortKey: string | null; position: number };
export type OptionPlan = {
  insert: WantedOption[];
  update: { id: number; patch: Partial<IntegrationFieldOption> }[];
  remove: IntegrationFieldOption[];
  /** removals blocked because values still use them (fieldKey, value, uses) */
  inUse: { fieldKey: string; value: string; uses: number }[];
  /** list entries not mirrored (too long / duplicate) — reported, the JSON keeps them */
  skipped: { fieldKey: string; value: string; reason: string }[];
};

function wantedOptions(type: IntegrationType, skipped: OptionPlan['skipped']): WantedOption[] {
  const out: WantedOption[] = [];
  for (const f of fieldsOf(type)) {
    const seen = new Set<string>();
    fixedList(f).forEach((value, position) => {
      if (value.length > OPTION_MAX) { skipped.push({ fieldKey: f.key, value: value.slice(0, 80), reason: `longer than ${OPTION_MAX}` }); return; }
      if (seen.has(fold(value))) { skipped.push({ fieldKey: f.key, value, reason: 'duplicate in the list' }); return; }
      seen.add(fold(value));
      out.push({ fieldKey: f.key, value, sortKey: isVersionField(f) ? versionKey(value)?.key ?? null : null, position });
    });
  }
  return out;
}

const optKey = (fieldKey: string, value: string) => `${fieldKey}\u0000${fold(value)}`;

/** What syncTypeOptions would do for this type definition (nothing is written). */
export async function planTypeOptions(m: EntityManager, type: IntegrationType): Promise<OptionPlan> {
  const skipped: OptionPlan['skipped'] = [];
  const wanted = wantedOptions(type, skipped);
  const existing = type.id ? await m.find(IntegrationFieldOption, { where: { integrationTypeId: type.id } }) : [];
  const byKey = new Map(existing.map((o) => [optKey(o.fieldKey, o.value), o]));
  const plan: OptionPlan = { insert: [], update: [], remove: [], inUse: [], skipped };
  const keep = new Set<number>();
  for (const w of wanted) {
    const o = byKey.get(optKey(w.fieldKey, w.value));
    if (!o) { plan.insert.push(w); continue; }
    keep.add(o.id);
    const patch: Partial<IntegrationFieldOption> = {};
    if (o.value !== w.value) patch.value = w.value; // same option, re-cased in the list
    if ((o.sortKey ?? null) !== w.sortKey) patch.sortKey = w.sortKey;
    if (o.position !== w.position) patch.position = w.position;
    if (Object.keys(patch).length) plan.update.push({ id: o.id, patch });
  }
  plan.remove = existing.filter((o) => !keep.has(o.id));
  if (plan.remove.length) {
    const rows: { optionId: number; uses: string }[] = await m.createQueryBuilder(IntegrationFieldValue, 'v')
      .select('v.optionId', 'optionId').addSelect('COUNT(*)', 'uses')
      .where({ optionId: In(plan.remove.map((o) => o.id)) }).groupBy('v.optionId').getRawMany();
    const uses = new Map(rows.map((r) => [Number(r.optionId), Number(r.uses)]));
    plan.inUse = plan.remove.filter((o) => uses.has(o.id)).map((o) => ({ fieldKey: o.fieldKey, value: o.value, uses: uses.get(o.id)! }));
  }
  return plan;
}

/** 409 when the new field list would delete options that values still use. Call BEFORE saving. */
export async function assertOptionRemovalsAllowed(m: EntityManager, typeId: number, nextFields: IntegrationTypeField[] | null | undefined, nextBehavior: string) {
  const plan = await planTypeOptions(m, Object.assign(new IntegrationType(), { id: typeId, behavior: nextBehavior, fields: nextFields ?? [] }));
  if (plan.inUse.length) {
    const list = plan.inUse.map((u) => `"${u.value.slice(0, 60)}" (used by ${u.uses})`).join(', ');
    throw new ConflictException(`These options are still in use and can't be removed: ${list}. Change those values first.`);
  }
}

/**
 * Bring a type's option rows in line with its JSON list, then re-sync every integration of that type
 * (option links and sort keys depend on the list and the field kind). Options still used are kept
 * (callers that must refuse that call assertOptionRemovalsAllowed first). Status is never touched.
 */
export async function syncTypeOptions(m: EntityManager, typeId: number, opts: { dryRun?: boolean; excludeEnvironments?: Set<number> } = {}) {
  const type = await m.findOne(IntegrationType, { where: { id: typeId } });
  if (!type) return { inserted: 0, updated: 0, deleted: 0, plan: null };
  const plan = await planTypeOptions(m, type);
  const blocked = new Set(plan.inUse.map((u) => optKey(u.fieldKey, u.value)));
  const removable = plan.remove.filter((o) => !blocked.has(optKey(o.fieldKey, o.value)));
  if (!opts.dryRun) {
    if (plan.insert.length) await m.insert(IntegrationFieldOption, plan.insert.map((w) => ({ ...w, integrationTypeId: typeId, status: 'current' as const })));
    for (const u of plan.update) await m.update(IntegrationFieldOption, u.id, u.patch);
  }
  // values first (re-links them away from removed options), then delete the now-unused options
  const ints = await m.find(Integration, { where: { integrationTypeId: typeId }, select: { id: true } });
  const values = await syncIntegrationValues(m, ints.map((i) => i.id), opts);
  if (!opts.dryRun && removable.length) await m.delete(IntegrationFieldOption, removable.map((o) => o.id));
  return { inserted: plan.insert.length, updated: plan.update.length, deleted: removable.length, plan, values };
}

// ---------------------------------------------------------------- values (per integration)

type ValueRow = Pick<IntegrationFieldValue, 'integrationId' | 'fieldKey' | 'value' | 'sortKey' | 'versionLevel' | 'optionId'>;

export type Unmapped = { integrationId: number; fieldKey: string; reason: string };
export type ValueSync = { inserted: number; updated: number; deleted: number; wanted: number; unmapped: Unmapped[]; outOfList: Unmapped[] };

/**
 * Rebuild the value rows of these integrations from their fieldValues JSON (only keys defined on the
 * type; soft-deleted integrations and non-custom_fields types get none). Idempotent.
 * `excludeEnvironments`: leave integrations of these environments exactly as they are (backfill only).
 */
export async function syncIntegrationValues(
  m: EntityManager, ids: number[], opts: { dryRun?: boolean; excludeEnvironments?: Set<number> } = {},
): Promise<ValueSync> {
  const res: ValueSync = { inserted: 0, updated: 0, deleted: 0, wanted: 0, unmapped: [], outOfList: [] };
  for (let i = 0; i < ids.length; i += 500) {
    const chunk = ids.slice(i, i + 500);
    const ints = await m.find(Integration, { where: { id: In(chunk) }, relations: { integrationType: true }, withDeleted: true });
    const typeIds = [...new Set(ints.map((x) => x.integrationTypeId).filter((x): x is number => !!x))];
    const options = typeIds.length ? await m.find(IntegrationFieldOption, { where: { integrationTypeId: In(typeIds) } }) : [];
    const optionFor = new Map(options.map((o) => [`${o.integrationTypeId}\u0000${optKey(o.fieldKey, o.value)}`, o]));
    const existing = await m.find(IntegrationFieldValue, { where: { integrationId: In(chunk) } });
    const have = new Map(existing.map((v) => [`${v.integrationId}\u0000${v.fieldKey}`, v]));
    const keep = new Set<number>();
    const inserts: ValueRow[] = [];

    for (const it of ints) {
      if (it.environmentId && opts.excludeEnvironments?.has(it.environmentId)) {
        existing.filter((v) => v.integrationId === it.id).forEach((v) => keep.add(v.id));
        continue;
      }
      const fields = it.deletedAt ? [] : fieldsOf(it.integrationType);
      const json = (it.fieldValues && typeof it.fieldValues === 'object' ? it.fieldValues : {}) as Record<string, unknown>;
      const defined = new Set(fields.map((f) => f.key));
      for (const k of Object.keys(json)) if (fields.length && !defined.has(k) && text(json[k])) res.unmapped.push({ integrationId: it.id, fieldKey: k, reason: 'key not defined on the type' });
      for (const f of fields) {
        const value = text(json[f.key]);
        if (!value) continue;
        if (value.length > VALUE_MAX) { res.unmapped.push({ integrationId: it.id, fieldKey: f.key, reason: `longer than ${VALUE_MAX}` }); continue; }
        res.wanted++;
        const vk = isVersionField(f) ? versionKey(value) : null;
        if (isVersionField(f) && !vk) res.unmapped.push({ integrationId: it.id, fieldKey: f.key, reason: 'not a version number (copied, no sort key)' });
        const option = optionFor.get(`${it.integrationTypeId}\u0000${optKey(f.key, value)}`);
        const list = fixedList(f);
        if (list.length && !list.some((o) => fold(o) === fold(value))) res.outOfList.push({ integrationId: it.id, fieldKey: f.key, reason: 'value not in the fixed list (kept as is)' });
        const row: ValueRow = { integrationId: it.id, fieldKey: f.key, value, sortKey: vk?.key ?? null, versionLevel: vk?.level ?? null, optionId: option?.id ?? null };
        const cur = have.get(`${it.id}\u0000${f.key}`);
        if (!cur) { inserts.push(row); continue; }
        keep.add(cur.id);
        const patch: Partial<ValueRow> = {};
        if (cur.value !== row.value) patch.value = row.value;
        if ((cur.sortKey ?? null) !== row.sortKey) patch.sortKey = row.sortKey;
        if ((cur.versionLevel ?? null) !== row.versionLevel) patch.versionLevel = row.versionLevel;
        if ((cur.optionId ?? null) !== row.optionId) patch.optionId = row.optionId;
        if (Object.keys(patch).length) { res.updated++; if (!opts.dryRun) await m.update(IntegrationFieldValue, cur.id, patch); }
      }
    }
    const stale = existing.filter((v) => !keep.has(v.id));
    res.deleted += stale.length;
    res.inserted += inserts.length;
    if (!opts.dryRun) {
      if (stale.length) await m.delete(IntegrationFieldValue, stale.map((v) => v.id));
      if (inserts.length) await m.insert(IntegrationFieldValue, inserts);
    }
  }
  return res;
}

// ---------------------------------------------------------------- reads for the API

/** Every option of a type with its usage count (how many values use it). */
export async function optionsWithUsage(m: EntityManager, typeId: number) {
  const rows: Record<string, unknown>[] = await m.createQueryBuilder(IntegrationFieldOption, 'o')
    .leftJoin(IntegrationFieldValue, 'v', 'v.option_id = o.id')
    .select(['o.id AS id', 'o.field_key AS fieldKey', 'o.value AS value', 'o.sort_key AS sortKey', 'o.status AS status', 'o.position AS position'])
    .addSelect('COUNT(v.id)', 'usage')
    .where('o.integration_type_id = :typeId', { typeId })
    .groupBy('o.id').orderBy('o.field_key').addOrderBy('o.position').getRawMany();
  return rows.map((r) => ({ ...r, id: Number(r.id), position: Number(r.position), usage: Number(r.usage) }));
}

/** Per-integration value status for list screens: { [integrationId]: { [fieldKey]: { status, level } } }. */
export async function valueStatusFor(m: EntityManager, integrationIds: number[]) {
  const out: Record<number, Record<string, { status: string | null; level: string | null }>> = {};
  if (!integrationIds.length) return out;
  const rows: Record<string, unknown>[] = await m.createQueryBuilder(IntegrationFieldValue, 'v')
    .leftJoin(IntegrationFieldOption, 'o', 'o.id = v.option_id')
    .select(['v.integration_id AS integrationId', 'v.field_key AS fieldKey', 'v.version_level AS level', 'o.status AS status'])
    .where({ integrationId: In(integrationIds) }).getRawMany();
  for (const r of rows) {
    const id = Number(r.integrationId);
    (out[id] ??= {})[String(r.fieldKey)] = { status: (r.status as string) ?? null, level: (r.level as string) ?? null };
  }
  return out;
}

// ---------------------------------------------------------------- spreadsheet import

/**
 * Hooks for the generic Excel import (data.controller upsertRows), so an imported row obeys the same
 * rules as an API save and its searchable rows stay in sync. `before` throws → that row is skipped and
 * reported (the import's usual per-row error); `after` runs once the row is written.
 */
export function importHooks(m: EntityManager, target: unknown) {
  if (target === Integration) {
    return {
      before: async (obj: Record<string, unknown>, existing: Record<string, unknown> | null) => {
        if (!('fieldValues' in obj) && !('integrationTypeId' in obj)) return;
        const typeId = (obj.integrationTypeId ?? existing?.integrationTypeId) as number | null | undefined;
        if (!typeId) return;
        const next = 'fieldValues' in obj ? obj.fieldValues : existing?.fieldValues;
        const before = existing && existing.integrationTypeId === typeId ? existing.fieldValues : null;
        assertChangedValues(await m.findOne(IntegrationType, { where: { id: typeId } }), next, before);
      },
      after: async (id: number) => { await syncIntegrationValues(m, [id]); },
    };
  }
  if (target === IntegrationType) {
    return {
      before: async (obj: Record<string, unknown>, existing: Record<string, unknown> | null) => {
        if (!existing || !('fields' in obj || 'behavior' in obj)) return;
        await assertOptionRemovalsAllowed(m, Number(existing.id),
          ('fields' in obj ? obj.fields : existing.fields) as IntegrationTypeField[] | null,
          String(obj.behavior ?? existing.behavior));
      },
      after: async (id: number) => { await syncTypeOptions(m, id); },
    };
  }
  return null;
}
