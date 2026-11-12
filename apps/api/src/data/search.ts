import { BadRequestException, ForbiddenException } from '@nestjs/common';
import type { DataSource, EntityMetadata, ObjectLiteral, Repository, SelectQueryBuilder } from 'typeorm';
import type { ColumnMetadata } from 'typeorm/metadata/ColumnMetadata';
import type { RelationMetadata } from 'typeorm/metadata/RelationMetadata';
import { User } from '../users/entities/user.entity';
import { Environment } from '../infra/entities/environment.entity';
import { Integration } from '../infra/entities/integration.entity';
import { IntegrationType } from '../infra/entities/integration-type.entity';
import { IntegrationFieldOption, OPTION_STATUSES } from '../infra/entities/integration-field-option.entity';
import { IntegrationFieldValue } from '../infra/entities/integration-field-value.entity';
import { versionKey } from '../infra/version-key';
import type { AppAbility } from '../common/casl/ability.factory';
import { canReadEntity } from './entity-access';

/** One rule: a dot-path from the searched resource ("server.serverName") + an operator + a value. */
export type SearchRule = { path: string; operator: string; value?: unknown };
/** AND/OR over rules and nested groups. With `any` (a relation path), every rule inside is about the
 *  SAME record of that relation — "a project with an environment that is live AND manual" — compiled
 *  as one EXISTS per group, not one per rule. Rule paths inside are relative to that record. */
export type SearchGroup = { op?: 'and' | 'or'; any?: string; items: (SearchRule | SearchGroup)[] };

export type Kind = 'string' | 'number' | 'date' | 'boolean';
type Inner = (meta: EntityMetadata, alias: string, nested: boolean, depth: number) => string;

const RANGE = ['eq', 'neq', 'in', 'nin', 'gt', 'gte', 'lt', 'lte', 'between', 'isNull', 'notNull'];
/** The whole operator whitelist, by column kind. Anything else is a 400. */
const OPERATORS: Record<Kind, string[]> = {
  string: ['eq', 'neq', 'in', 'nin', 'contains', 'ncontains', 'starts', 'isNull', 'notNull'],
  number: RANGE,
  date: RANGE,
  boolean: ['eq', 'neq', 'isNull', 'notNull'],
};
/**
 * Custom-field paths (environments only — directly, or inside an `any: "environments"` group):
 *   cf:<typeId>:<fieldKey>         the field's value (rules, sort, group-by)
 *   cfstatus:<typeId>:<fieldKey>   its option's status: current | outdated | eol (sort, group-by)
 *   computed:hasOutdatedTechnology true when any of the environment's values is an outdated/eol option
 * The field key may hold any text; it is matched EXACTLY against the type's definition and only ever
 * sent as a bound parameter. Status comes from the option row, so changing an option's status changes
 * results at once without editing any integration.
 *
 * VERSION SEMANTICS (version-kind fields; keys from infra/version-key.ts). A line-level value ("8.3",
 * "10.x") has an unknown patch, so it is treated as "might be":
 *   v_eq   8.3     same key: "8.3" matches "8.3" and "php 8.3"; NOT "8.3.0" (a bare 8.3 is a line)
 *   v_line 8.3.x   the line itself or anything inside it (8.3, 8.3.0, 8.3.35)
 *   v_lt   8.3.36  older: 8.3.35, 8.2, 7.4 — AND a line-level "8.3" (could be an older patch; the UI
 *                  marks it "line only"). v_lt 8.3 (a line) = older than the whole line: 8.2.x down.
 *   v_gt   8.3.36  newer: 8.3.37, 8.4 — AND a line-level "8.3" (could be newer). v_gt 8.3 (a line) =
 *                  newer than the whole line: 8.4 up, never 8.3.x.
 *   v_lte / v_gte  as above, plus the line itself and anything inside it.
 *   status [..]    the value's option status is one of the list (a free-text value has none).
 * Negative rules (neq/nin/ncontains) mean "no value of this field matches" — an environment without
 * the field is included, like neq on a plain column.
 */
const CF_TEXT = ['eq', 'neq', 'in', 'nin', 'contains', 'ncontains', 'starts', 'isNull', 'notNull', 'status'];
const CF_VERSION = [...CF_TEXT, 'v_eq', 'v_line', 'v_lt', 'v_lte', 'v_gt', 'v_gte'];
const COMPUTED = new Set(['hasOutdatedTechnology']);
export const SPECIAL = /^(cf|cfstatus):(\d{1,9}):([\s\S]{1,190})$/;
type Special = { kind: 'computed'; name: string } | { kind: 'cf' | 'cfstatus'; typeId: number; key: string };
type Cols = { value: string; sortKey: string; status: string };
const ALL_OPERATORS = new Set([...Object.values(OPERATORS).flat(), ...CF_VERSION]);

// Hard stops against an abusive request, not UI limits. `depth` counts relation hops + the final field,
// the same as the export field tree (MAX_FIELD_DEPTH), across nested `any` groups too.
const LIMITS = { depth: 4, nesting: 5, rules: 40, list: 200, text: 500, pageSize: 200, offset: 10_000, groups: 1_000, sorts: 3, groupBy: 3, ids: 10_000 };
const SEGMENT = /^[A-Za-z_][A-Za-z0-9_]{0,63}$/;
const DATE = /^\d{4}-\d{2}-\d{2}(?:[ T]\d{2}:\d{2}(?::\d{2}(?:\.\d{1,6})?)?(?:Z|[+-]\d{2}:\d{2})?)?$/;
// a related User is a leaf that exposes only these — the same rule as the export field tree
const NESTED_USER_FIELDS = new Set(['id', 'name', 'email']);

const bad = (message: string): never => { throw new BadRequestException(message); };
const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const onlyKeys = (o: Record<string, unknown>, keys: string[], what: string) => {
  for (const k of Object.keys(o)) if (!keys.includes(k)) bad(`Unknown ${what} property: ${k.slice(0, 40)}`);
};

export function kindOf(col: ColumnMetadata): Kind | null {
  const t = col.type;
  if (t === Boolean || t === 'boolean' || t === 'bool') return 'boolean';
  if (t === Number || ['int', 'integer', 'tinyint', 'smallint', 'mediumint', 'bigint', 'decimal', 'numeric', 'float', 'double', 'real'].includes(t as string)) return 'number';
  if (t === Date || ['date', 'datetime', 'timestamp'].includes(t as string)) return 'date';
  if (t === String || ['varchar', 'char', 'text', 'tinytext', 'mediumtext', 'longtext', 'enum'].includes(t as string)) return 'string';
  return null; // json and anything exotic isn't searchable
}

function splitPath(path: unknown): string[] {
  if (typeof path !== 'string' || !path || path.length > 200) bad('Invalid path.');
  const segs = (path as string).split('.');
  if (!segs.every((s) => SEGMENT.test(s))) bad('Invalid path.');
  return segs;
}

/**
 * Odoo-style server-side search over one resource: nested AND/OR rules on any readable field path
 * (relations at any allowed depth, both directions), `any` groups over to-many relations, sort and
 * multi-level group-by on to-one paths, paging with hard caps.
 *
 * Safety model: every identifier in the SQL comes from TypeORM metadata reached by walking the
 * validated path (never from the request text), every value is a bound parameter, operators come
 * from a fixed whitelist per column kind, and each relation hop needs read permission on its target
 * (403 otherwise). select:false columns (passwords, MFA secrets) and JSON columns can't be named.
 */
export class SearchEngine {
  private readonly params: Record<string, unknown> = {};
  private seq = 0;
  private rules = 0;
  /** custom_fields types named by cf: paths in this request, loaded once before compiling */
  private types = new Map<number, IntegrationType>();

  constructor(private readonly dataSource: DataSource, private readonly ability: AppAbility) {}

  async run(repo: Repository<ObjectLiteral>, body: unknown) {
    if (!isObject(body)) bad('Expected a JSON object.');
    const req = body as Record<string, unknown>;
    onlyKeys(req, ['filter', 'sort', 'groupBy', 'page', 'pageSize', 'output'], 'request');
    if (req.output !== undefined && req.output !== 'ids') bad('output must be "ids".');
    const meta = repo.metadata;
    await this.loadTypes([req.filter, req.sort, req.groupBy]);

    const where = req.filter === undefined ? null : this.group(meta, 'r', this.asGroup(req.filter), false, 0, 1);
    const page = this.int(req.page ?? 1, 1, Number.MAX_SAFE_INTEGER, 'page');
    const pageSize = this.int(req.pageSize ?? 50, 1, LIMITS.pageSize, 'pageSize');
    const offset = (page - 1) * pageSize;
    if (offset > LIMITS.offset) bad(`Can't page past ${LIMITS.offset} rows — narrow the filter instead.`);
    const sorts = this.list(req.sort, LIMITS.sorts, 'sort').map((s) => {
      if (!isObject(s)) bad('Each sort needs a path.');
      onlyKeys(s as Record<string, unknown>, ['path', 'dir'], 'sort');
      const dir = (s as Record<string, unknown>).dir ?? 'asc';
      if (dir !== 'asc' && dir !== 'desc') bad('Sort dir must be asc or desc.');
      return { path: (s as Record<string, unknown>).path, dir: dir === 'desc' ? 'DESC' as const : 'ASC' as const };
    });
    const groupBy = this.list(req.groupBy, LIMITS.groupBy, 'groupBy');

    const base = () => {
      const qb = repo.createQueryBuilder('r');
      if (where) qb.where(`(${where})`, this.params);
      return qb;
    };

    // output "ids" (the list pages): every matching id (capped) with its group-key values, no paging —
    // the page keeps its own rows and only narrows / buckets them, so its columns and actions stay as
    // they are. Group joins are to-one only, so the rows are never multiplied.
    if (req.output === 'ids') {
      const iqb = base();
      const ijoins = new Map<string, string>();
      iqb.select('r.id', 'id');
      groupBy.forEach((p, i) => { iqb.addSelect(this.scalar(meta, iqb, ijoins, p, 'group'), `g${i}`); });
      iqb.addOrderBy('r.id', 'ASC').limit(LIMITS.ids + 1).setParameters(this.params);
      const raw: Record<string, unknown>[] = await iqb.getRawMany();
      const capped = raw.length > LIMITS.ids;
      const list = raw.slice(0, LIMITS.ids);
      return {
        total: capped ? await base().getCount() : list.length,
        ids: list.map((x) => Number(x.id)),
        ...(groupBy.length ? { keys: list.map((x) => groupBy.map((_, i) => x[`g${i}`] ?? null)) } : {}),
        capped,
      };
    }

    // Rows: group keys first so a page reads in group order, then the requested sort, then id (stable).
    const listQb = base();
    const listJoins = new Map<string, string>();
    groupBy.forEach((p, i) => { listQb.addSelect(this.scalar(meta, listQb, listJoins, p, 'group'), `g${i}`).addOrderBy(`g${i}`, 'ASC'); });
    sorts.forEach((s, i) => { listQb.addSelect(this.scalar(meta, listQb, listJoins, s.path, 'sort'), `s${i}`).addOrderBy(`s${i}`, s.dir); });
    // sort/group joins are to-one only, so they never multiply rows — plain offset/limit is exact
    listQb.addOrderBy('r.id', 'ASC').offset(offset).limit(pageSize).setParameters(this.params);

    let groups: GroupNode[] | undefined;
    let groupsCapped = false;
    if (groupBy.length) {
      const gqb = base();
      const joins = new Map<string, string>();
      const exprs = groupBy.map((p) => this.scalar(meta, gqb, joins, p, 'group'));
      gqb.select(exprs[0], 'g0');
      exprs.slice(1).forEach((e, i) => gqb.addSelect(e, `g${i + 1}`));
      gqb.addSelect('COUNT(DISTINCT r.id)', 'cnt');
      exprs.forEach((_, i) => gqb.addGroupBy(`g${i}`).addOrderBy(`g${i}`, 'ASC'));
      gqb.limit(LIMITS.groups + 1).setParameters(this.params);
      const raw: Record<string, unknown>[] = await gqb.getRawMany();
      groupsCapped = raw.length > LIMITS.groups;
      groups = buildTree(raw.slice(0, LIMITS.groups), exprs.length);
    }

    const [rows, total] = await Promise.all([listQb.getMany(), base().getCount()]);
    return { total, page, pageSize, rows, ...(groups ? { groups, groupsCapped } : {}) };
  }

  // ---- request parsing ----

  private asGroup(v: unknown): SearchGroup {
    if (!isObject(v)) bad('A filter group must be an object with items.');
    onlyKeys(v as Record<string, unknown>, ['op', 'any', 'items'], 'filter group');
    return v as SearchGroup;
  }

  /** Finds every cf:/cfstatus: path in the request (lenient walk — real validation happens when
   *  compiling) and loads those types. Unknown ids simply aren't loaded and fail later with a 400. */
  private async loadTypes(parts: unknown[]) {
    const ids = new Set<number>();
    const walk = (v: unknown, depth: number) => {
      if (depth > 12 || ids.size > 50) return;
      if (typeof v === 'string') { const m = SPECIAL.exec(v); if (m) ids.add(Number(m[2])); return; }
      if (Array.isArray(v)) { v.slice(0, 200).forEach((x) => walk(x, depth + 1)); return; }
      if (isObject(v)) for (const k of ['path', 'items']) walk(v[k], depth + 1);
    };
    parts.forEach((p) => walk(p, 0));
    if (!ids.size) return;
    const rows = await this.dataSource.getRepository(IntegrationType).find({ where: [...ids].map((id) => ({ id })) });
    for (const t of rows) this.types.set(t.id, t);
  }

  private list(v: unknown, max: number, what: string): unknown[] {
    if (v === undefined) return [];
    if (!Array.isArray(v)) bad(`${what} must be a list.`);
    if ((v as unknown[]).length > max) bad(`At most ${max} ${what} entries.`);
    return v as unknown[];
  }

  private int(v: unknown, min: number, max: number, what: string): number {
    if (typeof v !== 'number' || !Number.isInteger(v) || v < min || v > max) bad(`${what} must be a whole number from ${min} to ${max}.`);
    return v as number;
  }

  // ---- WHERE compilation ----

  private group(meta: EntityMetadata, alias: string, g: SearchGroup, nested: boolean, depth: number, level: number): string {
    if (level > LIMITS.nesting) bad('Filter is nested too deeply.');
    const op = g.op ?? 'and';
    if (op !== 'and' && op !== 'or') bad('Group op must be and or or.');
    if (!Array.isArray(g.items) || g.items.length === 0) bad('A filter group needs at least one rule.');
    const inner: Inner = (m, a, n, d) => '(' + g.items.map((it) =>
      isObject(it) && 'items' in it
        ? this.group(m, a, this.asGroup(it), n, d, level + 1)
        : this.rule(m, a, it, n, d)).join(op === 'and' ? ' AND ' : ' OR ') + ')';
    if (g.any === undefined) return inner(meta, alias, nested, depth);
    const segs = splitPath(g.any);
    if (depth + segs.length >= LIMITS.depth) bad('Path too deep.');
    return this.via(meta, alias, segs, nested, depth, inner);
  }

  private rule(meta: EntityMetadata, alias: string, raw: unknown, nested: boolean, depth: number): string {
    if (!isObject(raw)) bad('Each rule needs path and operator.');
    const r = raw as Record<string, unknown>;
    onlyKeys(r, ['path', 'operator', 'value'], 'rule');
    if (++this.rules > LIMITS.rules) bad(`At most ${LIMITS.rules} rules.`);
    if (typeof r.operator !== 'string' || !ALL_OPERATORS.has(r.operator)) bad('Unknown operator.');
    const special = this.special(r.path);
    if (special) {
      if (depth + 1 > LIMITS.depth) bad('Path too deep.');
      return this.specialPredicate(meta, alias, special, r.operator as string, r.value);
    }
    const segs = splitPath(r.path);
    if (depth + segs.length > LIMITS.depth) bad('Path too deep.');
    const field = segs.pop() as string;
    return this.via(meta, alias, segs, nested, depth, (m, a, n) => this.predicate(m, a, field, n, r.operator as string, r.value));
  }

  /** Walks relation hops as nested EXISTS — correct for both directions and for many-to-many. */
  private via(meta: EntityMetadata, alias: string, segs: string[], nested: boolean, depth: number, inner: Inner): string {
    if (!segs.length) return inner(meta, alias, nested, depth);
    const [head, ...rest] = segs;
    const rel = this.relation(meta, head, nested);
    const child = this.alias();
    return this.exists(rel, alias, child, this.via(rel.inverseEntityMetadata, child, rest, true, depth + 1, inner));
  }

  private exists(rel: RelationMetadata, parent: string, child: string, body: string): string {
    const t = rel.inverseEntityMetadata;
    const live = t.deleteDateColumn ? ` AND ${this.col(child, t.deleteDateColumn.databaseName)} IS NULL` : '';
    const from = `${this.q(t.tableName)} ${this.q(child)}`;
    if (rel.isManyToOne || (rel.isOneToOne && rel.isOwning)) {
      const jc = rel.joinColumns[0];
      return `EXISTS (SELECT 1 FROM ${from} WHERE ${this.col(child, jc.referencedColumn!.databaseName)} = ${this.col(parent, jc.databaseName)}${live} AND ${body})`;
    }
    if (rel.isOneToMany || rel.isOneToOne) {
      const jc = rel.inverseRelation?.joinColumns[0];
      if (!jc) bad(`Can't search through ${rel.propertyName}.`);
      return `EXISTS (SELECT 1 FROM ${from} WHERE ${this.col(child, jc!.databaseName)} = ${this.col(parent, jc!.referencedColumn!.databaseName)}${live} AND ${body})`;
    }
    // many-to-many: through the junction table, from whichever side owns it
    const owning = rel.isOwning ? rel : rel.inverseRelation;
    const junction = owning?.junctionEntityMetadata;
    if (!owning || !junction) bad(`Can't search through ${rel.propertyName}.`);
    const toParent = rel.isOwning ? owning!.joinColumns[0] : owning!.inverseJoinColumns[0];
    const toTarget = rel.isOwning ? owning!.inverseJoinColumns[0] : owning!.joinColumns[0];
    const j = this.alias();
    return `EXISTS (SELECT 1 FROM ${this.q(junction!.tableName)} ${this.q(j)} INNER JOIN ${from} ON ${this.col(child, toTarget.referencedColumn!.databaseName)} = ${this.col(j, toTarget.databaseName)}`
      + ` WHERE ${this.col(j, toParent.databaseName)} = ${this.col(parent, toParent.referencedColumn!.databaseName)}${live} AND ${body})`;
  }

  private predicate(meta: EntityMetadata, alias: string, field: string, nested: boolean, op: string, value: unknown): string {
    const { col, kind } = this.column(meta, field, nested);
    if (!OPERATORS[kind].includes(op)) bad(`Operator ${op} can't be used on ${field}.`);
    const x = this.col(alias, col.databaseName);
    const one = () => this.param(this.scalarValue(kind, value, field));
    const like = (pattern: (s: string) => string) => {
      if (typeof value !== 'string' || !value || value.length > LIMITS.text) bad(`${field}: expected text.`);
      return this.param(pattern((value as string).replace(/[\\%_]/g, '\\$&'))); // match % and _ literally
    };
    switch (op) {
      case 'isNull': this.noValue(value, op); return `${x} IS NULL`;
      case 'notNull': this.noValue(value, op); return `${x} IS NOT NULL`;
      case 'eq': return `${x} = ${one()}`;
      // Odoo-like: "not X" also keeps records where the field is empty
      case 'neq': return `(${x} <> ${one()} OR ${x} IS NULL)`;
      case 'in': return `${x} IN (${this.listParam(kind, value, field)})`;
      case 'nin': return `(${x} NOT IN (${this.listParam(kind, value, field)}) OR ${x} IS NULL)`;
      case 'contains': return `${x} LIKE ${like((s) => `%${s}%`)}`;
      case 'ncontains': return `(${x} NOT LIKE ${like((s) => `%${s}%`)} OR ${x} IS NULL)`;
      case 'starts': return `${x} LIKE ${like((s) => `${s}%`)}`;
      case 'gt': return `${x} > ${one()}`;
      case 'gte': return `${x} >= ${one()}`;
      case 'lt': return `${x} < ${one()}`;
      case 'lte': return `${x} <= ${one()}`;
      case 'between': {
        if (!Array.isArray(value) || value.length !== 2) bad(`${field}: between needs [from, to].`);
        const [a, b] = value as unknown[];
        return `${x} BETWEEN ${this.param(this.scalarValue(kind, a, field))} AND ${this.param(this.scalarValue(kind, b, field))}`;
      }
    }
    return bad('Unknown operator.');
  }

  // ---- sort / group-by ----

  /** A to-one path as a plain column expression, joining each hop once per query. */
  private scalar(meta: EntityMetadata, qb: SelectQueryBuilder<ObjectLiteral>, joins: Map<string, string>, path: unknown, what: 'sort' | 'group'): string {
    const special = this.special(path);
    if (special) return this.specialScalar(meta, 'r', special, what);
    const segs = splitPath(path);
    if (segs.length > LIMITS.depth) bad('Path too deep.');
    const field = segs.pop() as string;
    let m = meta, alias = 'r', nested = false, prefix = '';
    for (const seg of segs) {
      const rel = this.relation(m, seg, nested);
      if (!(rel.isManyToOne || (rel.isOneToOne && rel.isOwning))) bad(`Can't ${what} by ${seg}: it's a list of records.`);
      prefix += (prefix ? '.' : '') + seg;
      let next = joins.get(prefix);
      if (!next) { next = this.alias(); qb.leftJoin(`${alias}.${seg}`, next); joins.set(prefix, next); }
      alias = next; m = rel.inverseEntityMetadata; nested = true;
    }
    return this.col(alias, this.column(m, field, nested).col.databaseName);
  }

  // ---- custom fields + computed fields ----

  private special(path: unknown): Special | null {
    if (typeof path !== 'string') return null;
    if (path.startsWith('computed:')) {
      const name = path.slice('computed:'.length);
      if (!COMPUTED.has(name)) bad('Unknown computed field.');
      return { kind: 'computed', name };
    }
    if (!/^cf(status)?:/.test(path)) return null;
    const m = SPECIAL.exec(path);
    if (!m) return bad('Invalid custom field path.');
    return { kind: m[1] as 'cf' | 'cfstatus', typeId: Number(m[2]), key: m[3] };
  }

  /** Custom fields hang off environments; also needs read on integrations and integration types. */
  private specialContext(meta: EntityMetadata, s: Special) {
    if (meta.target !== Environment) bad('Custom fields can only be used on environments (or inside an "any: environments" group).');
    if (!canReadEntity(this.ability, Integration) || !canReadEntity(this.ability, IntegrationType)) throw new ForbiddenException();
    if (s.kind === 'computed') return null;
    const type = this.types.get(s.typeId);
    const field = type?.behavior === 'custom_fields' ? type.fields?.find((f) => f?.key === s.key) : undefined;
    if (!field) return bad('Unknown custom field.');
    return field;
  }

  /** FROM/WHERE over the environment's live integrations → their value rows (→ option), optionally for
   *  one (type, key). Table/column names are constants of this codebase; type id and key are params. */
  private cfFrom(env: string, s: Special, pred: (c: Cols) => string, head: (c: Cols) => string): string {
    const [i, v, o] = [this.alias(), this.alias(), this.alias()];
    const t = (e: unknown) => this.q(this.dataSource.getMetadata(e as never).tableName);
    const c: Cols = { value: this.col(v, 'value'), sortKey: this.col(v, 'sort_key'), status: this.col(o, 'status') };
    const scope = s.kind === 'computed' ? '' : ` AND ${this.col(i, 'integration_type_id')} = ${this.param(s.typeId)} AND ${this.col(v, 'field_key')} = ${this.param(s.key)}`;
    return `(SELECT ${head(c)} FROM ${t(Integration)} ${this.q(i)}`
      + ` INNER JOIN ${t(IntegrationFieldValue)} ${this.q(v)} ON ${this.col(v, 'integration_id')} = ${this.col(i, 'id')}`
      + ` LEFT JOIN ${t(IntegrationFieldOption)} ${this.q(o)} ON ${this.col(o, 'id')} = ${this.col(v, 'option_id')}`
      + ` WHERE ${this.col(i, 'environment_id')} = ${this.col(env, 'id')} AND ${this.col(i, 'deleted_at')} IS NULL${scope}`
      + ` AND ${pred(c)})`;
  }

  private cfExists(env: string, s: Special, pred: (c: Cols) => string): string {
    return 'EXISTS ' + this.cfFrom(env, s, pred, () => '1');
  }

  private specialPredicate(meta: EntityMetadata, alias: string, s: Special, op: string, value: unknown): string {
    const field = this.specialContext(meta, s);
    if (s.kind === 'computed') {
      if (op !== 'eq') bad(`Operator ${op} can't be used on ${s.name}.`);
      const on = this.scalarValue('boolean', value, s.name) === 1;
      const ex = this.cfExists(alias, s, (c) => `${c.status} IN ('outdated', 'eol')`);
      return on ? ex : `NOT ${ex}`;
    }
    if (s.kind === 'cfstatus') bad('Use cf:<type>:<key> with operator status in rules; cfstatus: is for sort and group-by.');
    const label = field!.label || field!.key;
    const allowed = field!.kind === 'version' ? CF_VERSION : CF_TEXT;
    if (!allowed.includes(op)) bad(`Operator ${op} can't be used on ${label}.`);
    const has = (pred: (c: Cols) => string) => this.cfExists(alias, s, pred);
    const str = () => this.param(this.scalarValue('string', value, label));
    const like = (pattern: (x: string) => string) => {
      if (typeof value !== 'string' || !value || value.length > LIMITS.text) bad(`${label}: expected text.`);
      return this.param(pattern((value as string).replace(/[\\%_]/g, '\\$&'))); // match % and _ literally
    };
    const list = (items: unknown[]) => {
      const name = `p${++this.seq}`;
      this.params[name] = items;
      return `:...${name}`;
    };
    const strings = () => {
      if (!Array.isArray(value) || value.length === 0 || value.length > LIMITS.list) bad(`${label}: expected a list of 1–${LIMITS.list} values.`);
      return list((value as unknown[]).map((x) => this.scalarValue('string', x, label)));
    };
    const ver = () => {
      const k = versionKey(value);
      if (!k || String(value).length > 64) bad(`${label}: expected a version like 8.3 or 8.3.35.`);
      return this.param(k!.key);
    };
    const inLine = (c: Cols, k: string) => `(${c.sortKey} = ${k} OR ${c.sortKey} LIKE CONCAT(${k}, '.%'))`;
    const lt = (c: Cols, k: string) => `${c.sortKey} < ${k}`;
    const gt = (c: Cols, k: string) => `((${c.sortKey} > ${k} AND ${c.sortKey} NOT LIKE CONCAT(${k}, '.%')) OR ${k} LIKE CONCAT(${c.sortKey}, '.%'))`;
    switch (op) {
      case 'isNull': this.noValue(value, op); return `NOT ${has(() => '1 = 1')}`;
      case 'notNull': this.noValue(value, op); return has(() => '1 = 1');
      case 'eq': { const p = str(); return has((c) => `${c.value} = ${p}`); }
      case 'neq': { const p = str(); return `NOT ${has((c) => `${c.value} = ${p}`)}`; }
      case 'in': { const p = strings(); return has((c) => `${c.value} IN (${p})`); }
      case 'nin': { const p = strings(); return `NOT ${has((c) => `${c.value} IN (${p})`)}`; }
      case 'contains': { const p = like((x) => `%${x}%`); return has((c) => `${c.value} LIKE ${p}`); }
      case 'ncontains': { const p = like((x) => `%${x}%`); return `NOT ${has((c) => `${c.value} LIKE ${p}`)}`; }
      case 'starts': { const p = like((x) => `${x}%`); return has((c) => `${c.value} LIKE ${p}`); }
      case 'status': {
        if (!Array.isArray(value) || !value.length || value.length > 3 || !value.every((x) => (OPTION_STATUSES as readonly unknown[]).includes(x))) {
          bad(`${label}: status takes a list of ${OPTION_STATUSES.join(', ')}.`);
        }
        const p = list([...new Set(value as string[])]);
        return has((c) => `${c.status} IN (${p})`);
      }
      case 'v_eq': { const k = ver(); return has((c) => `${c.sortKey} = ${k}`); }
      case 'v_line': { const k = ver(); return has((c) => inLine(c, k)); }
      case 'v_lt': { const k = ver(); return has((c) => lt(c, k)); }
      case 'v_gt': { const k = ver(); return has((c) => gt(c, k)); }
      case 'v_lte': { const k = ver(); return has((c) => `(${lt(c, k)} OR ${inLine(c, k)})`); }
      case 'v_gte': { const k = ver(); return has((c) => `(${gt(c, k)} OR ${inLine(c, k)})`); }
    }
    return bad('Unknown operator.');
  }

  /** One value per environment for sort/group-by: the field's value (version fields sort by key), its
   *  WORST option status (eol > outdated > current), or the computed flag as 0/1. */
  private specialScalar(meta: EntityMetadata, alias: string, s: Special, what: 'sort' | 'group'): string {
    const field = this.specialContext(meta, s);
    if (s.kind === 'computed') return `(CASE WHEN ${this.cfExists(alias, s, (c) => `${c.status} IN ('outdated', 'eol')`)} THEN 1 ELSE 0 END)`;
    if (s.kind === 'cfstatus') {
      return this.cfFrom(alias, s, () => '1 = 1', (c) => `CASE MAX(CASE ${c.status} WHEN 'eol' THEN 3 WHEN 'outdated' THEN 2 WHEN 'current' THEN 1 END) WHEN 3 THEN 'eol' WHEN 2 THEN 'outdated' WHEN 1 THEN 'current' END`);
    }
    return this.cfFrom(alias, s, () => '1 = 1', (c) => (what === 'sort' && field!.kind === 'version' ? `MIN(${c.sortKey})` : `MIN(${c.value})`));
  }

  // ---- metadata lookups (the only source of identifiers) ----

  private relation(meta: EntityMetadata, key: string, nested: boolean): RelationMetadata {
    const rel = nested && meta.target === User ? undefined : meta.relations.find((r) => r.propertyName === key);
    if (!rel) return bad(`Unknown relation: ${key}`);
    if (!canReadEntity(this.ability, rel.inverseEntityMetadata.target)) throw new ForbiddenException();
    return rel;
  }

  private column(meta: EntityMetadata, field: string, nested: boolean): { col: ColumnMetadata; kind: Kind } {
    if (meta.relations.some((r) => r.propertyName === field)) bad(`${field} is a relation — name one of its fields.`);
    const col = meta.columns.find((c) => c.propertyName === field);
    if (!col || col.isSelect === false || col === meta.deleteDateColumn
      || (nested && meta.target === User && !NESTED_USER_FIELDS.has(field))) return bad(`Unknown field: ${field}`);
    const kind = kindOf(col);
    if (!kind) return bad(`${field} can't be searched.`);
    return { col, kind };
  }

  // ---- values → bound parameters ----

  private scalarValue(kind: Kind, v: unknown, field: string): unknown {
    switch (kind) {
      case 'string':
        if ((typeof v !== 'string' && typeof v !== 'number') || String(v).length > LIMITS.text) bad(`${field}: expected text.`);
        return String(v);
      case 'number': {
        const n = typeof v === 'string' && /^-?\d+(\.\d+)?$/.test(v) ? Number(v) : v;
        if (typeof n !== 'number' || !Number.isFinite(n)) bad(`${field}: expected a number.`);
        return n;
      }
      case 'date':
        if (typeof v !== 'string' || !DATE.test(v)) bad(`${field}: expected a date (YYYY-MM-DD).`);
        return v;
      case 'boolean':
        if (v === true || v === 'true' || v === 1) return 1;
        if (v === false || v === 'false' || v === 0) return 0;
        return bad(`${field}: expected true or false.`);
    }
  }

  private listParam(kind: Kind, v: unknown, field: string): string {
    if (!Array.isArray(v) || v.length === 0 || v.length > LIMITS.list) bad(`${field}: expected a list of 1–${LIMITS.list} values.`);
    const name = `p${++this.seq}`;
    this.params[name] = (v as unknown[]).map((x) => this.scalarValue(kind, x, field));
    return `:...${name}`;
  }

  private noValue(v: unknown, op: string) {
    if (v !== undefined && v !== null) bad(`${op} takes no value.`);
  }

  private param(v: unknown): string {
    const name = `p${++this.seq}`;
    this.params[name] = v;
    return `:${name}`;
  }

  private alias(): string { return `a${++this.seq}`; }
  private q(identifier: string): string { return this.dataSource.driver.escape(identifier); }
  private col(alias: string, column: string): string { return `${this.q(alias)}.${this.q(column)}`; }
}

/** One group-by bucket: its key value, how many records fall in it, and the next level down. */
export type GroupNode = { value: unknown; count: number; children?: GroupNode[] };

/** Flat GROUP BY rows (g0..gN + cnt) → nested tree; a parent's count is the sum of its children's,
 *  exact because group-by paths are to-one only (no row is counted under two parents). */
function buildTree(raw: Record<string, unknown>[], levels: number): GroupNode[] {
  const root: GroupNode[] = [];
  const index = new Map<GroupNode[], Map<string, GroupNode>>();
  for (const row of raw) {
    let list = root;
    for (let i = 0; i < levels; i++) {
      const value = row[`g${i}`] ?? null;
      let byKey = index.get(list);
      if (!byKey) { byKey = new Map(); index.set(list, byKey); }
      const key = JSON.stringify(value);
      let node = byKey.get(key);
      if (!node) {
        node = { value, count: 0, ...(i < levels - 1 ? { children: [] } : {}) };
        byKey.set(key, node);
        list.push(node);
      }
      node.count += Number(row.cnt);
      list = node.children ?? [];
    }
  }
  return root;
}
