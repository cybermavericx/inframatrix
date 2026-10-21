import { useState } from 'react';
import type { FieldDef } from '../modules/resources';

/** One condition: a field, an operator, and (for most operators) a value. */
export type FilterRule = { field: string; op: string; value: string };
/** A set of rules combined with ANY (OR) or ALL (AND). */
export type CustomFilterDef = { match: 'any' | 'all'; rules: FilterRule[] };

export const FILTER_OPS: { v: string; label: string }[] = [
  { v: 'in', label: 'is in' },
  { v: 'not_in', label: 'is not in' },
  { v: 'eq', label: '=' },
  { v: 'neq', label: '!=' },
  { v: 'contains', label: 'contains' },
  { v: 'not_contains', label: 'does not contain' },
  { v: 'gte', label: '≥' },
  { v: 'lte', label: '≤' },
  { v: 'set', label: 'is set' },
  { v: 'not_set', label: 'is not set' },
];
const NO_VALUE = new Set(['set', 'not_set']);

/** Compare two strings numerically when both look like numbers, else lexicographically (works for
 *  ISO 'yyyy-mm-dd' dates). Returns <0, 0, >0. */
function cmp(a: string, b: string): number {
  const na = Number(a), nb = Number(b);
  if (a !== '' && b !== '' && !Number.isNaN(na) && !Number.isNaN(nb)) return na - nb;
  return a < b ? -1 : a > b ? 1 : 0;
}

/** Positive counterpart of a negative operator (used for "any child matches" on array cells). */
const NEGATED: Record<string, string> = { not_contains: 'contains', not_in: 'in', neq: 'eq' };

/** Evaluate one rule against a cell value. `in`/`not in` treat the value as a comma-separated list.
 *  When the cell is an ARRAY (e.g. a project's environment URLs / integration values), the row matches
 *  if ANY element matches — and a negative op (not contains / not in / !=) matches only when NO element
 *  does. This is what lets "projects whose environment URL contains X" work from the project list. */
export function evalRule(cell: unknown, op: string, value: string): boolean {
  if (Array.isArray(cell)) {
    if (op === 'set') return cell.length > 0;
    if (op === 'not_set') return cell.length === 0;
    const pos = NEGATED[op];
    if (pos) return !cell.some((el) => evalRule(el, pos, value));
    return cell.some((el) => evalRule(el, op, value));
  }
  const s = cell == null ? '' : (typeof cell === 'boolean' ? (cell ? 'yes' : 'no') : String(cell));
  const sl = s.trim().toLowerCase();
  const vl = value.trim().toLowerCase();
  const list = vl.split(',').map((x) => x.trim()).filter(Boolean);
  switch (op) {
    case 'in': return list.includes(sl);
    case 'not_in': return !list.includes(sl);
    case 'eq': return sl === vl;
    case 'neq': return sl !== vl;
    case 'contains': return sl.includes(vl);
    case 'not_contains': return !sl.includes(vl);
    case 'gte': return cmp(sl, vl) >= 0;
    case 'lte': return cmp(sl, vl) <= 0;
    case 'set': return sl !== '';
    case 'not_set': return sl === '';
    default: return true;
  }
}

/** Does a row satisfy a custom filter? (ANY = at least one rule; ALL = every rule.) */
export function matchesCustom(getVal: (field: string) => unknown, f: CustomFilterDef): boolean {
  const active = f.rules.filter((r) => r.field && (NO_VALUE.has(r.op) || r.value.trim() !== ''));
  if (!active.length) return true;
  const results = active.map((r) => evalRule(getVal(r.field), r.op, r.value));
  return f.match === 'all' ? results.every(Boolean) : results.some(Boolean);
}

export function CustomFilterModal({
  fields, valuesFor, isDate, initial, onApply, onClose,
}: {
  fields: FieldDef[];
  /** Distinct real values for a field, shown as pick-or-type suggestions. */
  valuesFor?: (fieldName: string) => string[];
  /** Whether a field should use a date picker. */
  isDate?: (fieldName: string) => boolean;
  initial: CustomFilterDef | null;
  onApply: (f: CustomFilterDef | null) => void;
  onClose: () => void;
}) {
  const first = fields[0]?.name ?? '';
  const [match, setMatch] = useState<'any' | 'all'>(initial?.match ?? 'any');
  const [rules, setRules] = useState<FilterRule[]>(
    initial?.rules?.length ? initial.rules : [{ field: first, op: 'contains', value: '' }],
  );
  const setRule = (i: number, patch: Partial<FilterRule>) => setRules((rs) => rs.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  const addRule = () => setRules((rs) => [...rs, { field: first, op: 'contains', value: '' }]);
  const delRule = (i: number) => setRules((rs) => rs.filter((_, j) => j !== i));

  const fieldOf = (name: string) => fields.find((f) => f.name === name);

  // ── Odoo-style field picker: a searchable popover whose top level lists the record's own fields
  //    plus each "relation" (group) as a drill-in (Environments ▸ / Integrations ▸). `pickerRow` is
  //    which rule's picker is open; `pickerGroup` is the relation currently drilled into. ──
  const groups = [...new Set(fields.filter((f) => f.group).map((f) => f.group as string))];
  const topFields = fields.filter((f) => !f.group);
  const [pickerRow, setPickerRow] = useState<number | null>(null);
  const [pickerGroup, setPickerGroup] = useState<string | null>(null);
  const [pickerQ, setPickerQ] = useState('');
  const openPicker = (i: number) => { setPickerRow(pickerRow === i ? null : i); setPickerGroup(null); setPickerQ(''); };
  const pick = (i: number, name: string) => { setRule(i, { field: name }); setPickerRow(null); };
  const fieldChip = (name: string) => { const f = fieldOf(name); return f ? (f.group ? `${f.group} › ${f.label}` : f.label) : name; };
  const PickItem = ({ label, arrow, onClick }: { label: string; arrow?: boolean; onClick: () => void }) => (
    <button type="button" onClick={onClick}
      style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, textAlign: 'left', background: 'transparent', border: 'none', padding: '7px 9px', borderRadius: 6, cursor: 'pointer', color: 'var(--text)', fontSize: 13.5 }}
      onMouseEnter={(e) => { (e.currentTarget as HTMLButtonElement).style.background = 'rgba(255,255,255,.06)'; }}
      onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.background = 'transparent'; }}>
      <span>{label}</span>{arrow && <span style={{ opacity: 0.6 }}>›</span>}
    </button>
  );
  const apply = () => {
    const valid = rules.filter((r) => r.field && (NO_VALUE.has(r.op) || r.value.trim() !== ''));
    onApply(valid.length ? { match, rules } : null);
    onClose();
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 860 }}>
        <div className="card-body">
          <h3 style={{ marginTop: 0 }}>Filter</h3>
          <div style={{ marginBottom: 12, fontSize: 14 }}>
            Match{' '}
            <select className="input" style={{ width: 'auto', display: 'inline-block', padding: '2px 8px' }} value={match} onChange={(e) => setMatch(e.target.value as 'any' | 'all')}>
              <option value="any">any</option>
              <option value="all">all</option>
            </select>{' '}
            of the following rules:
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {rules.map((r, i) => {
              const fd = fieldOf(r.field);
              const noValue = NO_VALUE.has(r.op);
              const listOp = r.op === 'in' || r.op === 'not_in';
              const selectOpts = fd?.type === 'select' && fd.options?.length ? fd.options : null;
              const dateField = !listOp && isDate?.(r.field);
              const suggestions = !listOp && !selectOpts ? (valuesFor?.(r.field) ?? []) : [];
              const q = pickerQ.trim().toLowerCase();
              return (
                <div key={i} style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                  <div style={{ position: 'relative', minWidth: 200, flex: '0 0 auto' }}>
                    <button type="button" className="input" style={{ width: '100%', textAlign: 'left', cursor: 'pointer', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }} onClick={() => openPicker(i)}>
                      <span>{fieldChip(r.field)}</span><span style={{ opacity: 0.6 }}>▾</span>
                    </button>
                    {pickerRow === i && (
                      <div style={{ position: 'absolute', top: 'calc(100% + 4px)', left: 0, zIndex: 40, width: 300, background: 'var(--surface-2, #15203a)', border: '1px solid var(--border)', borderRadius: 8, boxShadow: 'var(--shadow, 0 8px 24px rgba(0,0,0,.4))', padding: 8 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6 }}>
                          {pickerGroup && <button type="button" className="btn btn-ghost btn-sm" title="Back" onClick={() => setPickerGroup(null)}>←</button>}
                          <strong style={{ fontSize: 13, flex: 1 }}>{pickerGroup ?? 'Fields'}</strong>
                          <button type="button" className="btn btn-ghost btn-sm" title="Close" onClick={() => setPickerRow(null)}>✕</button>
                        </div>
                        <input className="input" autoFocus placeholder="Search…" value={pickerQ} onChange={(e) => setPickerQ(e.target.value)} style={{ marginBottom: 6 }} />
                        <div style={{ maxHeight: 240, overflowY: 'auto', display: 'flex', flexDirection: 'column' }}>
                          {q ? (
                            (() => {
                              const matches = fields.filter((f) => f.label.toLowerCase().includes(q) || (f.group ?? '').toLowerCase().includes(q));
                              return matches.length
                                ? matches.map((f) => <PickItem key={f.name} label={f.group ? `${f.group} › ${f.label}` : f.label} onClick={() => pick(i, f.name)} />)
                                : <span className="muted" style={{ padding: '6px 9px', fontSize: 13 }}>No fields match.</span>;
                            })()
                          ) : pickerGroup ? (
                            fields.filter((f) => f.group === pickerGroup).map((f) => <PickItem key={f.name} label={f.label} onClick={() => pick(i, f.name)} />)
                          ) : (
                            <>
                              {topFields.map((f) => <PickItem key={f.name} label={f.label} onClick={() => pick(i, f.name)} />)}
                              {groups.map((g) => <PickItem key={'grp-' + g} label={g} arrow onClick={() => { setPickerGroup(g); setPickerQ(''); }} />)}
                            </>
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                  <select className="input" style={{ minWidth: 120, flex: '0 0 auto' }} value={r.op} onChange={(e) => setRule(i, { op: e.target.value })}>
                    {FILTER_OPS.map((o) => <option key={o.v} value={o.v}>{o.label}</option>)}
                  </select>
                  {noValue ? (
                    <span style={{ flex: 1, minWidth: 160 }} className="muted">— no value needed —</span>
                  ) : selectOpts ? (
                    <select className="input" style={{ flex: 1, minWidth: 160 }} value={r.value} onChange={(e) => setRule(i, { value: e.target.value })}>
                      <option value="">—</option>
                      {selectOpts.map((o) => <option key={o} value={o}>{o}</option>)}
                    </select>
                  ) : dateField ? (
                    <input className="input" type="date" style={{ flex: 1, minWidth: 160 }} value={r.value} onChange={(e) => setRule(i, { value: e.target.value })} />
                  ) : (
                    <>
                      <input className="input" style={{ flex: 1, minWidth: 160 }} list={suggestions.length ? `vals-${i}` : undefined}
                        value={r.value} onChange={(e) => setRule(i, { value: e.target.value })}
                        placeholder={listOp ? 'value1, value2, …' : 'pick or type a value…'} />
                      {suggestions.length > 0 && (
                        <datalist id={`vals-${i}`}>{suggestions.slice(0, 500).map((o) => <option key={o} value={o} />)}</datalist>
                      )}
                    </>
                  )}
                  <button type="button" className="btn btn-ghost btn-sm" title="Remove rule" disabled={rules.length === 1} onClick={() => delRule(i)}>🗑</button>
                </div>
                </div>
              );
            })}
          </div>

          <button type="button" className="btn btn-ghost btn-sm" style={{ marginTop: 10, color: 'var(--primary-2)' }} onClick={addRule}>+ New Rule</button>

          <div style={{ marginTop: 16 }}>
            <button className="btn btn-primary" onClick={apply}>Apply</button>
            <button className="btn btn-ghost" style={{ marginLeft: 8 }} onClick={onClose}>Cancel</button>
            {initial && <button className="btn btn-ghost" style={{ marginLeft: 8 }} onClick={() => { onApply(null); onClose(); }}>Clear filter</button>}
          </div>
        </div>
      </div>
    </div>
  );
}
