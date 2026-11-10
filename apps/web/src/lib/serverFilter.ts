// Shared types + helpers for the server-side Filter / Group-by panel (phase 4). The panel builds a
// request for POST /data/:resource/search (apps/api/src/data/search.ts) and keeps it in the URL
// (?sf=…) so a filtered, grouped list is bookmarkable and shareable. The API re-validates everything:
// these lists only decide what the panel offers.

export type SearchRule = { path: string; operator: string; value?: unknown };
export type SearchGroup = { op?: 'and' | 'or'; any?: string; items: (SearchRule | SearchGroup)[] };
export const isGroup = (x: SearchRule | SearchGroup): x is SearchGroup => Array.isArray((x as SearchGroup).items);

/** Column kinds from GET /data/:resource/fields, plus the technology kinds (custom fields). */
export type FieldKind = 'string' | 'number' | 'date' | 'boolean' | 'version' | 'text' | 'status' | 'computed';

/** One pickable field: `path` is relative to the panel's base (root, or a related list's group). */
export type PickedField = { path: string; label: string; kind: FieldKind; options?: string[] };

export type Op = { v: string; label: string };
const STR: Op[] = [
  { v: 'eq', label: 'is' }, { v: 'neq', label: 'is not' }, { v: 'in', label: 'is any of' }, { v: 'nin', label: 'is none of' },
  { v: 'contains', label: 'contains' }, { v: 'ncontains', label: 'does not contain' }, { v: 'starts', label: 'starts with' },
  { v: 'isNull', label: 'is empty' }, { v: 'notNull', label: 'is set' },
];
const RANGE: Op[] = [
  { v: 'eq', label: '=' }, { v: 'neq', label: '≠' }, { v: 'gt', label: '>' }, { v: 'gte', label: '≥' }, { v: 'lt', label: '<' }, { v: 'lte', label: '≤' },
  { v: 'between', label: 'between' }, { v: 'isNull', label: 'is empty' }, { v: 'notNull', label: 'is set' },
];
const VERSION: Op[] = [
  { v: 'v_eq', label: 'version =' }, { v: 'v_line', label: 'in line (e.g. 8.3 → 8.3.x)' },
  { v: 'v_lt', label: 'older than' }, { v: 'v_lte', label: 'older than or =' }, { v: 'v_gt', label: 'newer than' }, { v: 'v_gte', label: 'newer than or =' },
  ...STR, { v: 'status', label: 'status is' },
];
/** Operators per kind — the same whitelist the API enforces (anything else is a 400 there). */
export const OPS: Record<FieldKind, Op[]> = {
  string: STR,
  text: [...STR, { v: 'status', label: 'status is' }],
  version: VERSION,
  number: RANGE,
  date: RANGE,
  boolean: [{ v: 'eq', label: 'is' }, { v: 'neq', label: 'is not' }, { v: 'isNull', label: 'is empty' }, { v: 'notNull', label: 'is set' }],
  computed: [{ v: 'eq', label: 'is' }],
  status: [],
};
export const NO_VALUE = new Set(['isNull', 'notNull']);
export const LIST_OPS = new Set(['in', 'nin', 'status']);
export const STATUSES = ['current', 'outdated', 'eol'];

/** What lives in ?sf= : the filter, the group-by paths, and the labels the panel shows for them. */
export type ServerView = { f?: SearchGroup | null; g?: string[]; l?: Record<string, string>; k?: Record<string, { kind: FieldKind; options?: string[] }> };

export const SF_PARAM = 'sf';
/** URL keys that are NOT a page's column filters (pages treat every other key as one). */
export const RESERVED_PARAMS = new Set(['view', SF_PARAM]);

export function readServerView(raw: string | null): ServerView | null {
  if (!raw) return null;
  try {
    const v = JSON.parse(raw) as ServerView;
    if (!v || typeof v !== 'object') return null;
    const f = v.f && isGroup(v.f) && v.f.items.length ? v.f : null;
    const g = Array.isArray(v.g) ? v.g.filter((x) => typeof x === 'string').slice(0, 3) : [];
    if (!f && !g.length) return null;
    return { f, g, l: v.l && typeof v.l === 'object' ? v.l : {}, k: v.k && typeof v.k === 'object' ? v.k : {} };
  } catch {
    return null;
  }
}

/** Count of rules (for the toolbar button). */
export function ruleCount(g: SearchGroup | null | undefined): number {
  if (!g) return 0;
  return g.items.reduce((n, x) => n + (isGroup(x) ? ruleCount(x) : 1), 0);
}
