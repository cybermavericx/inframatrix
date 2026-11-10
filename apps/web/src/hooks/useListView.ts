import { useMemo, useState } from 'react';
import type { FieldDef } from '../modules/resources';
import { matchesCustom, type CustomFilterDef } from '../components/CustomFilterModal';
import { fmtDate, isDateField } from '../lib/dates';
import { useServerView } from './useServerView';

/** One group header in the list: nested levels come from the server Group-by (depth 0..2); `rows`
 *  is filled on the innermost level only, `count` is how many records the group holds. */
export type GroupEntry = { key: string; label: string; depth: number; count: number; rows: Row[] };

// ── The reusable list "control panel" (Odoo-style): one hook owns search + a single Filter
//    (field/operator/value rules over ANY field of the resource's form view PLUS any column shown
//    in the list) + column sort + group-by, and returns the processed rows. Every list screen
//    (CrudPage + the custom Projects/Users pages) uses this same function — only the columns/fields
//    it is given change from module to module. Pair it with <ListToolbar/> for the matching UI. ──

export type Row = Record<string, unknown>;

/** Read a (possibly dot-pathed, e.g. 'server.serverName') value out of a row. */
export function getPath(obj: unknown, path: string): unknown {
  return path.split('.').reduce<unknown>((o, k) => (o == null ? undefined : (o as Record<string, unknown>)[k]), obj);
}

/** Default free-text haystack for a row: every value, walking nested relation objects one level. */
export function defaultRowText(row: Row): string {
  const parts: string[] = [];
  const walk = (v: unknown, depth: number) => {
    if (v == null) return;
    if (typeof v === 'object') { if (depth > 1) return; Object.values(v as object).forEach((x) => walk(x, depth + 1)); }
    else parts.push(String(v));
  };
  // skip internal/synthetic fields (prefixed with '_', e.g. _hasAttachment) so they never pollute
  // free-text search — they exist only to be targeted by the Filter.
  for (const [k, v] of Object.entries(row)) { if (!k.startsWith('_')) walk(v, 1); }
  return parts.join(' ').toLowerCase();
}

export interface UseListViewOptions {
  rows: Row[];
  /** Column keys shown/sortable/groupable (dot-paths allowed). */
  columns: string[];
  /** Field defs from the resource's form view — the primary list of things the Filter can target. */
  fields: FieldDef[];
  /** Extra filter-only fields not shown as list columns (e.g. aggregates over child records such as
   *  a project's environment URLs / integration values). Array-valued cells match if ANY element does. */
  extraFilterFields?: FieldDef[];
  /** Override the free-text search haystack for a row (default: deep-walk all values). */
  searchText?: (row: Row) => string;
  /** Permission resource (e.g. 'infra.servers'): turns on the server Filter / Group-by panel. */
  resource?: string;
}

export function useListView({ rows: allRows, columns, fields, extraFilterFields, searchText, resource }: UseListViewOptions) {
  // the server Filter narrows the rows the page already has (by id); everything below works on those
  const server = useServerView(resource);
  const rows = useMemo(
    () => (server.ids ? allRows.filter((r) => server.ids!.has(Number(r.id))) : allRows),
    [allRows, server.ids],
  );
  const [search, setSearch] = useState('');
  // click a header to sort: 1st click ascending, 2nd descending.
  const [sort, setSort] = useState<{ col: string; dir: 'asc' | 'desc' } | null>(null);
  // the single Filter (field/operator/value rules + any/all) and group-by-a-field.
  const [customFilter, setCustomFilter] = useState<CustomFilterDef | null>(null);
  const [showCustom, setShowCustom] = useState(false);
  const [groupBy, setGroupByState] = useState('');
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set());

  const onSort = (col: string) => setSort((s) => (s?.col === col ? { col, dir: s.dir === 'asc' ? 'desc' : 'asc' } : { col, dir: 'asc' }));
  const setGroupBy = (v: string) => { setGroupByState(v); setCollapsedGroups(new Set()); };
  const toggleGroup = (k: string) => setCollapsedGroups((p) => { const n = new Set(p); if (n.has(k)) n.delete(k); else n.add(k); return n; });
  const clearAll = () => { setSearch(''); setCustomFilter(null); setGroupBy(''); if (server.state) server.clear(); };

  // Filterable fields = the form-view fields PLUS any list column not already covered by a field
  // (e.g. 'poc.name', 'publishState') so anything visible in the list is also filterable.
  const filterFields = useMemo<FieldDef[]>(() => {
    const out = [...fields, ...(extraFilterFields ?? [])];
    const have = new Set(out.map((f) => f.name));
    for (const col of columns) {
      if (have.has(col)) continue;
      have.add(col);
      out.push({ name: col, label: col.replace(/\./g, ' '), type: isDateField(col) ? 'date' : undefined });
    }
    return out;
  }, [fields, extraFilterFields, columns]);
  const fieldByName = useMemo(() => new Map(filterFields.map((f) => [f.name, f])), [filterFields]);

  // Display value of a field for one row: relation label for refs, Yes/No for checkboxes, dd mmm yyyy
  // for dates — i.e. exactly what the user sees, so a rule filters on the visible value (not a raw id).
  const displayValue = (row: Row, name: string): unknown => {
    const f = fieldByName.get(name);
    if (f?.type === 'ref') {
      const rel = getPath(row, name.replace(/Id$/, ''));
      if (rel && typeof rel === 'object') return (rel as Record<string, unknown>)[f.refLabel ?? 'name'];
      return getPath(row, name);
    }
    const v = getPath(row, name);
    if (Array.isArray(v)) return v; // aggregate over child records — match per-element (see evalRule)
    if (typeof v === 'boolean') return v ? 'Yes' : 'No';
    if (f && (f.type === 'date' || f.type === 'datetime-local')) return v ? fmtDate(String(v)) : v;
    return v;
  };

  const isDate = (name: string) => {
    const f = fieldByName.get(name);
    return f?.type === 'date' || f?.type === 'datetime-local' || isDateField(name);
  };

  // Distinct real values per field (capped) → the value dropdown in the Filter, so you pick from
  // what actually exists instead of guessing. Select/checkbox fields use their declared options.
  const valueOptions = useMemo(() => {
    const m = new Map<string, string[]>();
    for (const f of filterFields) {
      if (f.type === 'checkbox') { m.set(f.name, ['Yes', 'No']); continue; }
      if (f.type === 'select' && f.options?.length) { m.set(f.name, f.options); continue; }
      const seen = new Set<string>();
      for (const r of allRows) {
        const dv = displayValue(r, f.name);
        // array cells (aggregates over child records) contribute each distinct element
        for (const x of Array.isArray(dv) ? dv : [dv]) {
          const s = x == null ? '' : String(x).trim();
          if (s) seen.add(s);
        }
        if (seen.size > 500) break;
      }
      m.set(f.name, [...seen].sort((a, b) => a.localeCompare(b, undefined, { numeric: true })));
    }
    return m;
    // displayValue is stable enough (depends on filterFields); recompute when fields or data change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filterFields, allRows]);
  const valuesFor = (name: string) => valueOptions.get(name) ?? [];

  // Apply the Filter (on display values), then free-text search.
  const cfFiltered = customFilter ? rows.filter((r) => matchesCustom((fn) => displayValue(r, fn), customFilter)) : rows;
  const q = search.trim().toLowerCase();
  const textOf = searchText ?? defaultRowText;
  const filtered = !q ? cfFiltered : cfFiltered.filter((r) => textOf(r).includes(q));

  // optional sort by the clicked column (numbers numerically, dates/strings naturally, blanks last)
  const sorted = useMemo(() => {
    if (!sort) return filtered;
    const dir = sort.dir === 'asc' ? 1 : -1;
    return [...filtered].sort((a, b) => {
      const va = getPath(a, sort.col), vb = getPath(b, sort.col);
      const ea = va == null || va === '', eb = vb == null || vb === '';
      if (ea && eb) return 0;
      if (ea) return 1;            // blanks always sink to the bottom
      if (eb) return -1;
      const na = Number(va), nb = Number(vb);
      const bothNum = typeof va !== 'boolean' && typeof vb !== 'boolean' && !Number.isNaN(na) && !Number.isNaN(nb);
      const r = bothNum ? na - nb : String(va).localeCompare(String(vb), undefined, { numeric: true, sensitivity: 'base' });
      return r * dir;
    });
  }, [filtered, sort]);

  // group-by: bucket the (filtered+sorted) rows into collapsible groups with counts — up to 3 nested
  // levels from the server Group-by (any to-one field, technology fields), else one level by a column.
  const serverGroupBy = useMemo(() => server.state?.g ?? [], [server.state]);
  const groupLabel = (v: unknown) => (v == null || v === '' ? '(none)' : typeof v === 'boolean' ? (v ? 'Yes' : 'No') : fmtDate(String(v)));
  const allGroups = useMemo<GroupEntry[] | null>(() => {
    const levels = serverGroupBy.length && server.keysById ? serverGroupBy.length : groupBy ? 1 : 0;
    if (!levels) return null;
    const keyOf = (r: Row): unknown[] => (serverGroupBy.length && server.keysById
      ? (server.keysById.get(Number(r.id)) ?? serverGroupBy.map(() => null))
      : [getPath(r, groupBy)]);
    type Node = { label: string; rows: Row[]; kids: Map<string, Node> };
    const root: Node = { label: '', rows: [], kids: new Map() };
    for (const r of sorted) {
      let node = root;
      keyOf(r).slice(0, levels).forEach((v) => {
        const label = groupLabel(v);
        let next = node.kids.get(label);
        if (!next) { next = { label, rows: [], kids: new Map() }; node.kids.set(label, next); }
        next.rows.push(r);
        node = next;
      });
    }
    const out: GroupEntry[] = [];
    const walk = (n: Node, depth: number, prefix: string) => {
      const kids = [...n.kids.values()].sort((a, b) => a.label.localeCompare(b.label, undefined, { numeric: true }));
      for (const k of kids) {
        const key = prefix ? `${prefix} › ${k.label}` : k.label;
        const leaf = depth === levels - 1;
        out.push({ key, label: k.label, depth, count: k.rows.length, rows: leaf ? k.rows : [] });
        if (!leaf) walk(k, depth + 1, key);
      }
    };
    walk(root, 0, '');
    return out;
  }, [sorted, groupBy, server.keysById, serverGroupBy]);
  // a collapsed group hides its nested groups too
  const groups = useMemo(() => allGroups?.filter((g) => ![...collapsedGroups].some((c) => g.key !== c && g.key.startsWith(c + ' › '))) ?? null, [allGroups, collapsedGroups]);

  const active = !!(search.trim() || customFilter || groupBy || server.state);

  return {
    // config (consumed by the toolbar / filter modal)
    columns, filterFields, valuesFor, isDate,
    // search
    search, setSearch,
    // sort
    sort, onSort,
    // the single Filter
    customFilter, setCustomFilter, showCustom, setShowCustom,
    // group-by
    groupBy, setGroupBy, collapsedGroups, toggleGroup,
    // the server Filter / Group-by panel (null-safe: server.available is false without a resource)
    server, resource,
    // results
    rows: sorted,
    groups,
    total: allRows.length,
    visibleCount: sorted.length,
    active,
    clearAll,
  };
}

export type ListView = ReturnType<typeof useListView>;
