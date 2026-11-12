import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '../lib/api';
import {
  isGroup, LIST_OPS, NO_VALUE, OPS, STATUSES,
  type FieldKind, type PickedField, type SearchGroup, type SearchRule, type ServerView,
} from '../lib/serverFilter';
import { ValueSuggest } from './ValueSuggest';
import { optionLabel } from '../lib/labels';

// The server-side Filter + Group-by panel (phase 4), one for every list. Driven by
// GET /data/:resource/fields: every field of the record and of its related records (any depth the API
// allows, only what this user can read), with operators by field type; plus, on environments, the
// technology fields (PHP, WordPress…, their status, "has outdated technology"). Applies to the URL
// (?sf=…); the API checks every path, operator and value again.

type FieldsNode = {
  own: { name: string; label: string; kind: FieldKind | null; options?: string[] }[];
  relations: { key: string; label: string; cardinality: 'one' | 'many' }[];
  special?: { path: string; label: string; kind: FieldKind | 'boolean'; options?: string[] }[];
};

const join = (a: string, b: string) => (a ? `${a}.${b}` : b);

function useFields(resource: string, path: string) {
  return useQuery({
    queryKey: ['data-fields', resource, path],
    staleTime: 60_000,
    queryFn: async () => (await api.get(`/data/${resource}/fields`, { params: path ? { path } : {} })).data as FieldsNode,
  });
}

/** Drill-in field picker. `base` = the related list a sub-group is about ('' = the record itself).
 *  mode 'filter': any field (to-many hops allowed — "any related record matches"); mode 'group':
 *  to-one hops only (a record falls in exactly one group). Technology fields only at the base node. */
function FieldPicker({ resource, base, mode, onPick, onClose }: {
  resource: string; base: string; mode: 'filter' | 'group'; onPick: (f: PickedField) => void; onClose: () => void;
}) {
  const [trail, setTrail] = useState<{ key: string; label: string }[]>([]);
  const [q, setQ] = useState('');
  const rel = trail.map((t) => t.key).join('.');
  const { data, isLoading, error } = useFields(resource, join(base, rel));
  const prefix = trail.map((t) => t.label).join(' › ');
  const ql = q.trim().toLowerCase();
  const hit = (s: string) => !ql || s.toLowerCase().includes(ql);
  const item = (key: string, label: string, onClick: () => void, arrow = false) => (
    <button key={key} type="button" className="picker-item" onClick={onClick}
      style={{ display: 'flex', justifyContent: 'space-between', gap: 8, width: '100%', textAlign: 'left', background: 'transparent', border: 'none', padding: '6px 9px', borderRadius: 6, cursor: 'pointer', color: 'var(--text)', fontSize: 13.5 }}>
      <span>{label}</span>{arrow && <span style={{ opacity: 0.6 }}>›</span>}
    </button>
  );
  const special = !rel ? (data?.special ?? []).filter((s) => (mode === 'group' ? true : s.kind !== 'status')) : [];
  return (
    <div style={{ position: 'absolute', top: 'calc(100% + 4px)', left: 0, zIndex: 50, width: 320, background: 'var(--surface-2, #15203a)', border: '1px solid var(--border)', borderRadius: 8, boxShadow: 'var(--shadow, 0 8px 24px rgba(0,0,0,.4))', padding: 8 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6 }}>
        {trail.length > 0 && <button type="button" className="btn btn-ghost btn-sm" title="Back" onClick={() => setTrail((t) => t.slice(0, -1))}>←</button>}
        <strong style={{ fontSize: 13, flex: 1 }}>{prefix || 'Fields'}</strong>
        <button type="button" className="btn btn-ghost btn-sm" title="Close" onClick={onClose}>✕</button>
      </div>
      <input className="input" autoFocus placeholder="Search fields…" value={q} onChange={(e) => setQ(e.target.value)} style={{ marginBottom: 6 }} />
      <div style={{ maxHeight: 260, overflowY: 'auto' }}>
        {isLoading && <span className="muted" style={{ padding: 6, fontSize: 13 }}>Loading…</span>}
        {error && <span className="error-text" style={{ padding: 6, fontSize: 13 }}>Can't load fields.</span>}
        {special.filter((s) => hit(s.label)).map((s) => item(s.path, s.label, () => onPick({
          path: s.path, label: s.label, kind: s.path.startsWith('computed:') ? 'computed' : (s.kind as FieldKind), options: s.options,
        })))}
        {(data?.own ?? []).filter((f) => f.kind && hit(f.label)).map((f) => item('f-' + f.name, f.label, () => onPick({
          path: join(rel, f.name), label: prefix ? `${prefix} › ${f.label}` : f.label, kind: f.kind as FieldKind, options: f.options,
        })))}
        {(data?.relations ?? []).filter((r) => (mode === 'group' ? r.cardinality === 'one' : true) && trail.length < 3 && hit(r.label)).map((r) =>
          item('r-' + r.key, r.cardinality === 'many' ? `${r.label} (any)` : r.label, () => { setTrail((t) => [...t, { key: r.key, label: r.label }]); setQ(''); }, true))}
      </div>
    </div>
  );
}

type RuleDraft = { path: string; label: string; kind: FieldKind; options?: string[]; operator: string; value: unknown };
type GroupDraft = { any: string; anyLabel: string; op: 'and' | 'or'; rules: RuleDraft[] };
type Item = { rule: RuleDraft } | { group: GroupDraft };

/** Field kinds whose values are free text, so the value box offers the field's existing values. */
const SUGGEST_KINDS = new Set<FieldKind>(['string', 'text', 'version']);

/** "is any of" text box: keeps what you type (so a trailing comma survives) and saves the list. */
function ListText({ resource, path, value, onChange, suggest }: { resource: string; path: string; value: string[]; onChange: (v: string[]) => void; suggest: boolean }) {
  const [text, setText] = useState(value.join(', '));
  const set = (t: string) => { setText(t); onChange(t.split(',').map((x) => x.trim()).filter(Boolean)); };
  return suggest
    ? <ValueSuggest resource={resource} path={path} value={text} onChange={set} list placeholder="value1, value2, …" />
    : <input className="input" style={{ flex: 1 }} placeholder="value1, value2, …" value={text} onChange={(e) => set(e.target.value)} />;
}

function ValueInput({ r, resource, path, onChange }: { r: RuleDraft; resource: string; path: string; onChange: (v: unknown) => void }) {
  if (NO_VALUE.has(r.operator)) return <span className="muted" style={{ flex: 1, fontSize: 13 }}>— no value —</span>;
  const opts = r.operator === 'status' ? STATUSES : r.options;
  if (LIST_OPS.has(r.operator)) {
    const arr = Array.isArray(r.value) ? (r.value as string[]) : [];
    if (opts?.length) {
      return (
        <div style={{ flex: 1, display: 'flex', flexWrap: 'wrap', gap: 8 }}>
          {opts.map((o) => (
            <label key={o} style={{ fontSize: 13, display: 'flex', gap: 4, alignItems: 'center' }}>
              <input type="checkbox" checked={arr.includes(o)} onChange={(e) => onChange(e.target.checked ? [...arr, o] : arr.filter((x) => x !== o))} />{optionLabel(o)}
            </label>
          ))}
        </div>
      );
    }
    return <ListText resource={resource} path={path} value={arr} onChange={onChange} suggest={SUGGEST_KINDS.has(r.kind)} />;
  }
  if (r.kind === 'boolean' || r.kind === 'computed') {
    return (
      <select className="input" style={{ flex: 1 }} value={String(r.value ?? 'true')} onChange={(e) => onChange(e.target.value === 'true')}>
        <option value="true">Yes</option><option value="false">No</option>
      </select>
    );
  }
  const type = r.kind === 'date' ? 'date' : r.kind === 'number' ? 'number' : 'text';
  if (r.operator === 'between') {
    const [a, b] = Array.isArray(r.value) ? (r.value as string[]) : ['', ''];
    return (
      <div style={{ flex: 1, display: 'flex', gap: 6 }}>
        <input className="input" type={type} value={a ?? ''} onChange={(e) => onChange([e.target.value, b ?? ''])} />
        <span className="muted">and</span>
        <input className="input" type={type} value={b ?? ''} onChange={(e) => onChange([a ?? '', e.target.value])} />
      </div>
    );
  }
  if (opts?.length && (r.operator === 'eq' || r.operator === 'neq')) {
    return (
      <select className="input" style={{ flex: 1 }} value={String(r.value ?? '')} onChange={(e) => onChange(e.target.value)}>
        <option value="">—</option>{opts.map((o) => <option key={o} value={o}>{optionLabel(o)}</option>)}
      </select>
    );
  }
  const placeholder = r.kind === 'version' ? 'e.g. 8.3.36 or 8.3' : '';
  if (SUGGEST_KINDS.has(r.kind)) {
    return <ValueSuggest resource={resource} path={path} value={String(r.value ?? '')} onChange={onChange} placeholder={placeholder} />;
  }
  return <input className="input" style={{ flex: 1 }} type={type} value={String(r.value ?? '')}
    placeholder={placeholder} onChange={(e) => onChange(e.target.value)} />;
}

function RuleRow({ resource, base, r, onChange, onRemove }: {
  resource: string; base: string; r: RuleDraft; onChange: (r: RuleDraft) => void; onRemove: () => void;
}) {
  const [picking, setPicking] = useState(false);
  const ops = OPS[r.kind] ?? [];
  return (
    <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
      <div style={{ position: 'relative', minWidth: 220 }}>
        <button type="button" className="input" style={{ width: '100%', textAlign: 'left', cursor: 'pointer' }} onClick={() => setPicking((p) => !p)}>
          {r.label || 'Choose a field…'} <span style={{ opacity: 0.6, float: 'right' }}>▾</span>
        </button>
        {picking && (
          <FieldPicker resource={resource} base={base} mode="filter" onClose={() => setPicking(false)}
            onPick={(f) => { setPicking(false); onChange({ ...f, operator: (OPS[f.kind] ?? [])[0]?.v ?? 'eq', value: f.kind === 'computed' ? true : undefined }); }} />
        )}
      </div>
      {r.path && (
        <select className="input" style={{ width: 'auto', minWidth: 130 }} value={r.operator}
          onChange={(e) => onChange({ ...r, operator: e.target.value, value: LIST_OPS.has(e.target.value) ? [] : r.kind === 'computed' || r.kind === 'boolean' ? true : '' })}>
          {ops.map((o) => <option key={o.v} value={o.v}>{o.label}</option>)}
        </select>
      )}
      {r.path && <ValueInput key={r.path + '|' + r.operator} r={r} resource={resource} path={join(base, r.path)} onChange={(value) => onChange({ ...r, value })} />}
      <button type="button" className="btn btn-ghost btn-sm" title="Remove" onClick={onRemove}>🗑</button>
    </div>
  );
}

const blankRule = (): RuleDraft => ({ path: '', label: '', kind: 'string', operator: 'eq', value: '' });

function toRule(r: RuleDraft): SearchRule | null {
  if (!r.path) return null;
  if (NO_VALUE.has(r.operator)) return { path: r.path, operator: r.operator };
  let v = r.value;
  if (LIST_OPS.has(r.operator)) { if (!Array.isArray(v) || !v.length) return null; }
  else if (r.operator === 'between') { if (!Array.isArray(v) || v.some((x) => x === '' || x == null)) return null; v = (v as string[]).map((x) => (r.kind === 'number' ? Number(x) : x)); }
  else if (r.kind === 'boolean' || r.kind === 'computed') v = v !== false;
  else if (v === '' || v == null) return null;
  else if (r.kind === 'number') v = Number(v);
  return { path: r.path, operator: r.operator, value: v };
}

/** Rebuild drafts from the URL state (labels come from ?sf=…'s `l`; kinds are re-learned on edit). */
function fromView(v: ServerView | null): { op: 'and' | 'or'; items: Item[]; groupBy: { path: string; label: string }[] } {
  const l = v?.l ?? {};
  const kindOf = (x: SearchRule): FieldKind => {
    if (x.path.startsWith('computed:')) return 'computed';
    if (x.operator.startsWith('v_')) return 'version';
    if (x.path.startsWith('cf:')) return 'text';
    if (typeof x.value === 'boolean') return 'boolean';
    if (typeof x.value === 'number' || (Array.isArray(x.value) && typeof x.value[0] === 'number')) return 'number';
    return 'string';
  };
  const k = v?.k ?? {};
  const draft = (x: SearchRule, base = ''): RuleDraft => {
    const meta = k[join(base, x.path)];
    return { path: x.path, label: l[join(base, x.path)] ?? l[x.path] ?? x.path, kind: meta?.kind ?? kindOf(x), options: meta?.options, operator: x.operator, value: x.value };
  };
  const items: Item[] = (v?.f?.items ?? []).map((x) => (isGroup(x)
    ? { group: { any: x.any ?? '', anyLabel: l[`any:${x.any}`] ?? x.any ?? '', op: x.op === 'or' ? 'or' : 'and', rules: x.items.filter((y) => !isGroup(y)).map((y) => draft(y as SearchRule, x.any)) } }
    : { rule: draft(x) }));
  return { op: v?.f?.op === 'or' ? 'or' : 'and', items, groupBy: (v?.g ?? []).map((p) => ({ path: p, label: l[p] ?? p })) };
}

export function FilterPanel({ resource, initial, onApply, onClose }: {
  resource: string; initial: ServerView | null; onApply: (v: ServerView | null) => void; onClose: () => void;
}) {
  const start = fromView(initial);
  const [op, setOp] = useState<'and' | 'or'>(start.op);
  const [items, setItems] = useState<Item[]>(start.items.length ? start.items : [{ rule: blankRule() }]);
  const [groupBy, setGroupBy] = useState(start.groupBy);
  const [pickGroup, setPickGroup] = useState(false);
  const [pickMany, setPickMany] = useState(false);
  const root = useFields(resource, '');
  const manyRels = (root.data?.relations ?? []).filter((r) => r.cardinality === 'many');

  const setItem = (i: number, it: Item) => setItems((xs) => xs.map((x, j) => (j === i ? it : x)));
  const delItem = (i: number) => setItems((xs) => xs.filter((_, j) => j !== i));

  const apply = () => {
    const labels: Record<string, string> = {};
    const kinds: NonNullable<ServerView['k']> = {};
    const out: (SearchRule | SearchGroup)[] = [];
    for (const it of items) {
      if ('rule' in it) {
        const r = toRule(it.rule);
        if (r) { out.push(r); labels[r.path] = it.rule.label; kinds[r.path] = { kind: it.rule.kind, options: it.rule.options }; }
      } else {
        const rs = it.group.rules.map(toRule).filter((x): x is SearchRule => !!x);
        if (!rs.length) continue;
        out.push({ op: it.group.op, any: it.group.any, items: rs });
        labels[`any:${it.group.any}`] = it.group.anyLabel;
        it.group.rules.forEach((r) => { if (r.path) { labels[join(it.group.any, r.path)] = `${it.group.anyLabel} › ${r.label}`; kinds[join(it.group.any, r.path)] = { kind: r.kind, options: r.options }; } });
      }
    }
    groupBy.forEach((g) => { labels[g.path] = g.label; });
    onApply(out.length || groupBy.length ? { f: out.length ? { op, items: out } : null, g: groupBy.map((g) => g.path), l: labels, k: kinds } : null);
    onClose();
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 900 }}>
        <div className="card-body">
          <h3 style={{ marginTop: 0 }}>Filter &amp; group</h3>
          <div style={{ marginBottom: 10, fontSize: 14 }}>
            Match{' '}
            <select className="input" style={{ width: 'auto', display: 'inline-block', padding: '2px 8px' }} value={op} onChange={(e) => setOp(e.target.value as 'and' | 'or')}>
              <option value="and">all</option><option value="or">any</option>
            </select>{' '}of these conditions:
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {items.map((it, i) => ('rule' in it ? (
              <RuleRow key={i} resource={resource} base="" r={it.rule} onChange={(rule) => setItem(i, { rule })} onRemove={() => delItem(i)} />
            ) : (
              <div key={i} style={{ border: '1px solid var(--border)', borderRadius: 8, padding: 10 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8, fontSize: 14 }}>
                  <strong>Any {it.group.anyLabel}</strong> where{' '}
                  <select className="input" style={{ width: 'auto', padding: '2px 8px' }} value={it.group.op} onChange={(e) => setItem(i, { group: { ...it.group, op: e.target.value as 'and' | 'or' } })}>
                    <option value="and">all</option><option value="or">any</option>
                  </select>
                  <span className="muted" style={{ fontSize: 12.5 }}>of these hold on the same {it.group.anyLabel.toLowerCase().replace(/s$/, '')}</span>
                  <button type="button" className="btn btn-ghost btn-sm" style={{ marginLeft: 'auto' }} onClick={() => delItem(i)}>Remove group</button>
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {it.group.rules.map((r, k) => (
                    <RuleRow key={k} resource={resource} base={it.group.any} r={r}
                      onChange={(nr) => setItem(i, { group: { ...it.group, rules: it.group.rules.map((x, j) => (j === k ? nr : x)) } })}
                      onRemove={() => setItem(i, { group: { ...it.group, rules: it.group.rules.filter((_, j) => j !== k) } })} />
                  ))}
                </div>
                <button type="button" className="btn btn-ghost btn-sm" style={{ marginTop: 6, color: 'var(--primary-2)' }}
                  onClick={() => setItem(i, { group: { ...it.group, rules: [...it.group.rules, blankRule()] } })}>+ Condition</button>
              </div>
            )))}
          </div>

          <div style={{ display: 'flex', gap: 8, marginTop: 10, flexWrap: 'wrap', position: 'relative' }}>
            <button type="button" className="btn btn-ghost btn-sm" style={{ color: 'var(--primary-2)' }} onClick={() => setItems((xs) => [...xs, { rule: blankRule() }])}>+ Condition</button>
            {manyRels.length > 0 && (
              <div style={{ position: 'relative' }}>
                <button type="button" className="btn btn-ghost btn-sm" style={{ color: 'var(--primary-2)' }} onClick={() => setPickMany((p) => !p)}>+ Conditions on one related record…</button>
                {pickMany && (
                  <div style={{ position: 'absolute', top: 'calc(100% + 4px)', left: 0, zIndex: 50, minWidth: 220, background: 'var(--surface-2, #15203a)', border: '1px solid var(--border)', borderRadius: 8, padding: 6 }}>
                    {manyRels.map((r) => (
                      <button key={r.key} type="button" className="btn btn-ghost btn-sm" style={{ display: 'block', width: '100%', textAlign: 'left' }}
                        onClick={() => { setPickMany(false); setItems((xs) => [...xs, { group: { any: r.key, anyLabel: r.label, op: 'and', rules: [blankRule()] } }]); }}>{r.label}</button>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>

          <h4 style={{ margin: '18px 0 6px' }}>Group by</h4>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            {groupBy.map((g, i) => (
              <span key={g.path} className="badge badge-gray" style={{ display: 'inline-flex', gap: 6, alignItems: 'center', fontSize: 13 }}>
                {i > 0 && <span className="muted">›</span>}{g.label}
                <button type="button" className="btn btn-ghost btn-sm" style={{ padding: '0 4px' }} title="Remove level" onClick={() => setGroupBy((xs) => xs.filter((_, j) => j !== i))}>✕</button>
              </span>
            ))}
            {groupBy.length < 3 && (
              <div style={{ position: 'relative' }}>
                <button type="button" className="btn btn-ghost btn-sm" style={{ color: 'var(--primary-2)' }} onClick={() => setPickGroup((p) => !p)}>+ {groupBy.length ? 'Sub-group' : 'Group'} by…</button>
                {pickGroup && (
                  <FieldPicker resource={resource} base="" mode="group" onClose={() => setPickGroup(false)}
                    onPick={(f) => { setPickGroup(false); if (!groupBy.some((g) => g.path === f.path)) setGroupBy((xs) => [...xs, { path: f.path, label: f.label }]); }} />
                )}
              </div>
            )}
          </div>

          <div style={{ marginTop: 18 }}>
            <button className="btn btn-primary" onClick={apply}>Apply</button>
            <button className="btn btn-ghost" style={{ marginLeft: 8 }} onClick={onClose}>Cancel</button>
            {initial && <button className="btn btn-ghost" style={{ marginLeft: 8 }} onClick={() => { onApply(null); onClose(); }}>Clear</button>}
          </div>
        </div>
      </div>
    </div>
  );
}
