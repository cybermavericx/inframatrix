import { Fragment, useEffect, useMemo, useRef, useState, type ChangeEvent, type FormEvent } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient, keepPreviousData } from '@tanstack/react-query';
import { api, API_ORIGIN } from '../lib/api';
import { useAuth } from '../auth/AuthContext';
import type { CrudConfig, FieldDef, RowAction } from '../modules/resources';
import { RESOURCES } from '../modules/resources';
import { MultiRefSelect } from './MultiRefSelect';
import { FieldDefsEditor } from './RecordForm';
import { ReminderModal } from './ReminderModal';
import { RecordDetail } from './RecordDetail';
import { ResolveModal } from './ResolveModal';
import { useToast } from './Toast';
import { useListView, getPath, defaultRowText } from '../hooks/useListView';
import { useImportExport } from '../hooks/useImportExport';
import { ExportPicker } from './ExportPicker';
import { ListToolbar } from './ListToolbar';
import { fmtDate } from '../lib/dates';

type Row = Record<string, unknown>;

/** A record that is blocking a delete, surfaced from the API's 409 so we can link straight to it. */
interface Blocker { resource: string; id: number; label: string; }
interface BlockedInfo { message: string; hint?: string; blockers: Blocker[]; blockersTotal: number; }

/** Pull the structured blocker list out of a 409 response (null if it isn't a blocked-delete error). */
function errBlockers(e: unknown): BlockedInfo | null {
  const d = (e as { response?: { data?: Record<string, unknown> } }).response?.data;
  const blockers = d?.blockers as Blocker[] | undefined;
  if (!Array.isArray(blockers) || !blockers.length) return null;
  return {
    message: String(d?.message ?? 'Cannot delete — still referenced.'),
    hint: d?.hint ? String(d.hint) : undefined,
    blockers,
    blockersTotal: Number(d?.blockersTotal ?? blockers.length),
  };
}
/** 'jobbag.vendor-services' → { route:'/jobbag/vendor-services', title:'Vendor Services' } */
function resourceMeta(resource: string): { route: string; title: string } {
  const cfg = RESOURCES.find((r) => r.resource === resource);
  return { route: '/' + resource.replace('.', '/'), title: cfg?.title ?? resource };
}
/** Friendly labels + relation lookups for FK URL filters (e.g. ?vendorId=5 → "Vendor: Acme"). */
const FILTER_LABELS: Record<string, { title: string; rel: string; relLabel: string }> = {
  vendorId: { title: 'Vendor', rel: 'vendor', relLabel: 'vendorName' },
  vendorServiceId: { title: 'Service', rel: 'vendorService', relLabel: 'serviceName' },
  clientId: { title: 'Client', rel: 'client', relLabel: 'name' },
};
const AUDIT = ['id', 'createdAt', 'updatedAt', 'deletedAt', 'createdBy', 'updatedBy'];
const RELATION_KEYS = ['project', 'server', 'gitProvider', 'integrationType', 'account', 'environment', 'poc', 'checklistSubmittedBy', 'publishState', 'vendor', 'vendorService', 'client'];

function errMsg(e: unknown) {
  const ax = e as { response?: { data?: { message?: string | string[]; reasons?: string[] } } };
  const d = ax.response?.data;
  if (d?.reasons?.length) return `${d.message ?? 'Not allowed'}\n• ${d.reasons.join('\n• ')}`;
  const m = d?.message;
  return Array.isArray(m) ? m.join(', ') : (m ?? 'Request failed');
}
function badgeClass(v: string): string {
  const s = v.toLowerCase();
  if (['published', 'active', 'started', 'y', 'yes', 'true'].includes(s)) return 'badge badge-green';
  if (['ready', 'created', 'request_created'].includes(s)) return 'badge badge-blue';
  if (['draft', 'on_hold', 'maintenance', 'scheduled'].includes(s)) return 'badge badge-amber';
  if (['expired', 'dropped', 'failed', 'decommissioned', 'n', 'no', 'false'].includes(s)) return 'badge badge-red';
  return 'badge badge-gray';
}

/** Searchable relation picker: type to filter existing records and click one to select,
 *  or create a new one inline. Selecting sets the real FK id directly (no fragile text→id
 *  round-trip), and the menu options use onMouseDown so a click lands before the input blurs.
 *  Case/space-insensitive matching surfaces existing entries so you don't make duplicates. */
function RefSelect({ field, value, onChange }: { field: FieldDef; value: unknown; onChange: (v: number | null) => void }) {
  const qc = useQueryClient();
  const { data = [] } = useQuery({
    queryKey: [field.refEndpoint],
    queryFn: async () => (await api.get(field.refEndpoint as string)).data as Row[],
    staleTime: 60_000,
  });
  const labelKey = field.refLabel as string;
  const labelOf = (o: Row) => String(o[labelKey] ?? `#${o.id}`);
  const norm = (s: string) => s.trim().toLowerCase();
  const selected = data.find((o) => o.id === value) ?? null;
  const [text, setText] = useState('');
  const [open, setOpen] = useState(false);
  const boxRef = useRef<HTMLDivElement>(null);

  // keep the input in sync with the selected record (and after the list loads)
  useEffect(() => { setText(selected ? labelOf(selected) : ''); /* eslint-disable-next-line */ }, [value, data.length]);
  // close the menu when clicking outside the control
  useEffect(() => {
    const onDoc = (e: MouseEvent) => { if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, []);

  const q = norm(text);
  const exact = q ? data.find((o) => norm(labelOf(o)) === q) : undefined;
  // show the whole list when nothing is typed (or the typed text is just the current selection),
  // otherwise filter by substring
  const showAll = !q || (selected && norm(labelOf(selected)) === q);
  const filtered = showAll ? data : data.filter((o) => norm(labelOf(o)).includes(q));

  const pick = (o: Row) => { onChange(o.id as number); setText(labelOf(o)); setOpen(false); };

  const create = useMutation({
    mutationFn: () => api.post(field.refEndpoint as string, { [labelKey]: text.trim() }),
    onSuccess: async (r) => {
      await qc.invalidateQueries({ queryKey: [field.refEndpoint] });
      onChange(r.data.id as number);
      setText(String(r.data[labelKey] ?? text.trim()));
      setOpen(false);
    },
    onError: (e) => alert(errMsg(e)),
  });

  return (
    <div ref={boxRef} style={{ position: 'relative' }}>
      <input
        className="input"
        placeholder="type to search…"
        value={text}
        onFocus={() => setOpen(true)}
        onChange={(e) => {
          setText(e.target.value);
          setOpen(true);
          const m = data.find((o) => norm(labelOf(o)) === norm(e.target.value));
          onChange(m ? (m.id as number) : null);
        }}
      />
      {open && (
        <div
          role="listbox"
          style={{
            position: 'absolute', top: 'calc(100% + 4px)', left: 0, right: 0, zIndex: 30,
            maxHeight: 220, overflowY: 'auto', background: 'var(--surface-2, #15203a)',
            border: '1px solid var(--border)', borderRadius: 'var(--radius-sm, 8px)',
            boxShadow: 'var(--shadow, 0 8px 24px rgba(0,0,0,.4))',
          }}
        >
          {filtered.map((o) => {
            const isSel = o.id === value;
            return (
              <div
                key={String(o.id)}
                role="option"
                aria-selected={isSel}
                onMouseDown={(e) => { e.preventDefault(); pick(o); }}
                style={{
                  padding: '7px 11px', cursor: 'pointer', fontSize: 13.5,
                  background: isSel ? 'var(--primary, #2563eb)' : 'transparent',
                  color: isSel ? '#fff' : 'var(--text)',
                }}
                onMouseEnter={(e) => { if (!isSel) (e.currentTarget as HTMLDivElement).style.background = 'rgba(255,255,255,.06)'; }}
                onMouseLeave={(e) => { if (!isSel) (e.currentTarget as HTMLDivElement).style.background = 'transparent'; }}
              >
                {labelOf(o)}
              </div>
            );
          })}
          {!filtered.length && !text.trim() && (
            <div className="muted" style={{ padding: '7px 11px', fontSize: 13 }}>No options yet</div>
          )}
          {text.trim() && !exact && (
            <div
              onMouseDown={(e) => { e.preventDefault(); if (!create.isPending) create.mutate(); }}
              style={{ padding: '7px 11px', cursor: 'pointer', fontSize: 13, borderTop: filtered.length ? '1px solid var(--border)' : undefined, color: 'var(--primary-2)' }}
            >
              {create.isPending ? 'Creating…' : `➕ Create "${text.trim()}"`}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function FileField({ value, onChange }: { value: unknown; onChange: (p: string | null) => void }) {
  const [busy, setBusy] = useState(false);
  const onPick = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setBusy(true);
    const fd = new FormData();
    fd.append('file', file);
    try {
      const r = await api.post('/uploads', fd);
      onChange(r.data.path);
    } catch {
      alert('Upload failed — the file was not attached. Please try again.');
    } finally {
      setBusy(false);
      e.target.value = '';
    }
  };
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
      {value ? <a href={API_ORIGIN + String(value)} target="_blank" rel="noreferrer" style={{ color: 'var(--primary-2)' }}>{String(value).split('/').pop()}</a> : null}
      <input type="file" onChange={onPick} />
      {busy && <span className="muted">uploading…</span>}
      {value ? <button type="button" className="btn btn-ghost btn-sm" onClick={() => onChange(null)}>clear</button> : null}
    </div>
  );
}

export default function CrudPage({ config }: { config: CrudConfig }) {
  const { ability } = useAuth();
  const qc = useQueryClient();
  const toast = useToast();
  const canRead = ability.can('read', config.resource);
  const canCreate = ability.can('create', config.resource) && !config.readOnly;
  const canUpdate = ability.can('update', config.resource) && !config.readOnly;
  const canDelete = ability.can('delete', config.resource);
  // Import still goes through the generic /data/:resource engine; export now opens the field-picker
  // (Odoo-style: pick exactly which fields, in what order, XLSX or CSV) instead of a fixed dump.
  const { fileRef, importXlsx } = useImportExport({ resource: config.resource, invalidate: [[config.endpoint]], onSuccess: (m) => toast.notify(m), onError: (m) => toast.error(m) });
  const [exporting, setExporting] = useState(false);
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const badgeCols = new Set(config.badgeColumns ?? []);

  const [editing, setEditing] = useState<Row | null>(null);
  const [viewing, setViewing] = useState<Row | null>(null);
  const [blocked, setBlocked] = useState<BlockedInfo | null>(null);
  const [reminderFor, setReminderFor] = useState<{ id: number; label?: string } | null>(null);
  const [resolveFor, setResolveFor] = useState<Row | null>(null);
  const [err, setErr] = useState('');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const { data: rows = [], isLoading } = useQuery({
    queryKey: [config.endpoint],
    queryFn: async () => (await api.get(config.endpoint)).data as Row[],
    enabled: canRead,
    placeholderData: keepPreviousData,
  });

  // Read-only nested child records (e.g. a vendor's services), grouped by their foreign key.
  const child = config.childList;
  const { data: childRows = [] } = useQuery({
    queryKey: [child?.endpoint],
    queryFn: async () => (await api.get(child!.endpoint)).data as Row[],
    enabled: canRead && !!child,
    staleTime: 30_000,
  });
  const childrenByFk = useMemo(() => {
    const m = new Map<unknown, Row[]>();
    if (child) for (const c of childRows) {
      const k = c[child.foreignKey];
      (m.get(k) ?? m.set(k, []).get(k)!).push(c);
    }
    return m;
  }, [child, childRows]);
  const toggleExpand = (id: string) =>
    setExpanded((p) => { const n = new Set(p); if (n.has(id)) n.delete(id); else n.add(id); return n; });

  const save = useMutation({
    mutationFn: (row: Row) => {
      const payload: Row = { ...row };
      [...AUDIT, ...RELATION_KEYS].forEach((k) => delete payload[k]);
      config.fields.forEach((f) => {
        if (f.type === 'datetime-local' && typeof payload[f.name] === 'string' && payload[f.name]) {
          payload[f.name] = (payload[f.name] as string).replace('T', ' ') + ':00';
        }
        // a field hidden by its showWhen condition is cleared (e.g. renewableType when Renewable=N)
        if (f.showWhen && !f.showWhen.in.includes(String(payload[f.showWhen.field] ?? ''))) payload[f.name] = null;
      });
      // empty strings -> null (prevents 500s on date/number/ref columns)
      Object.keys(payload).forEach((k) => { if (payload[k] === '') payload[k] = null; });
      return row.id ? api.patch(`${config.endpoint}/${row.id}`, payload) : api.post(config.endpoint, payload);
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: [config.endpoint] }); setEditing(null); setErr(''); toast.notify('Saved'); },
    onError: (e) => { setErr(errMsg(e)); toast.error('Could not save'); },
  });

  // A blocked delete (409 with a `blockers` list) opens the click-through dialog; anything else toasts.
  const onDeleteError = (e: unknown) => { const b = errBlockers(e); if (b) setBlocked(b); else toast.error(errMsg(e)); };

  const del = useMutation({
    mutationFn: (id: unknown) => api.delete(`${config.endpoint}/${id}`),
    onSuccess: () => { qc.invalidateQueries({ queryKey: [config.endpoint] }); toast.notify('Deleted'); },
    onError: onDeleteError,
  });

  const action = useMutation({
    mutationFn: (path: string) => api.post(path, {}),
    onSuccess: () => { qc.invalidateQueries({ queryKey: [config.endpoint] }); toast.notify('Done'); },
    onError: (e) => toast.error(errMsg(e)),
  });

  const bulkDelete = useMutation({
    mutationFn: async (ids: string[]) => { for (const id of ids) await api.delete(`${config.endpoint}/${id}`); },
    onSuccess: () => { qc.invalidateQueries({ queryKey: [config.endpoint] }); setSelected(new Set()); toast.notify('Deleted'); },
    onError: (e) => toast.error(errMsg(e)),
  });
  const bulkAction = useMutation({
    mutationFn: async ({ ids, act }: { ids: string[]; act: RowAction }) => {
      const errs: string[] = [];
      for (const id of ids) { try { await api.post(act.path({ id }), {}); } catch (e) { errs.push(`#${id}: ${errMsg(e)}`); } }
      if (errs.length) throw new Error(errs.join('\n'));
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: [config.endpoint] }); setSelected(new Set()); toast.notify('Done'); },
    onError: (e) => { qc.invalidateQueries({ queryKey: [config.endpoint] }); setSelected(new Set()); toast.error((e as Error).message); },
  });

  if (!canRead) return <div className="card"><div className="card-body">You do not have access to {config.title}.</div></div>;

  const setField = (f: FieldDef, value: unknown) => setEditing((p) => {
    const next = { ...(p ?? {}), [f.name]: value };
    // optional config hook: compute derived fields (e.g. Payments Period to / Due date)
    return config.derive ? { ...next, ...config.derive(f.name, next) } : next;
  });
  // dates render in the house style "dd mmm yyyy"; fmtDate leaves non-dates unchanged
  const fmt = (v: unknown) => (typeof v === 'boolean' ? (v ? 'Yes' : 'No') : v == null || typeof v === 'object' ? '' : fmtDate(String(v)));
  const inputType = (t?: string) =>
    t === 'email' ? 'email' : t === 'datetime-local' ? 'datetime-local' : t === 'date' ? 'date' : t === 'number' ? 'number' : 'text';

  // Optional column filters from the URL (e.g. /infra/servers?provider=Azure) — used by dashboard drill-downs.
  // `view` is reserved (it carries the opened record's id, Odoo-style) and is NOT a column filter.
  const filterEntries = [...searchParams.entries()].filter(([k]) => k !== 'view');
  const urlFiltered = filterEntries.length
    ? rows.filter((r) => filterEntries.every(([k, v]) => String(getPath(r, k) ?? '').toLowerCase() === String(v).toLowerCase()))
    : rows;

  // The opened record's id lives in the URL (?view=<id>) so it is visible, shareable and deep-linkable.
  const viewId = searchParams.get('view');
  const openView = (id: unknown) => setSearchParams((p) => { const n = new URLSearchParams(p); n.set('view', String(id)); return n; });
  const closeView = () => setSearchParams((p) => { const n = new URLSearchParams(p); n.delete('view'); return n; }, { replace: true });
  useEffect(() => {
    if (!viewId) { setViewing(null); return; }
    const row = rows.find((r) => String(r.id) === viewId);
    if (row) setViewing(row);
  }, [viewId, rows]);

  // The shared list control panel: search (across nested relations + a vendor's child records),
  // per-column quick filters, the custom filter, column sort and group-by — all from one hook.
  const searchText = child
    ? (row: Row) => { let t = defaultRowText(row); for (const c of (childrenByFk.get(row.id) ?? [])) t += ' ' + defaultRowText(c); return t; }
    : undefined;
  const view = useListView({ rows: urlFiltered, columns: config.columns, fields: config.fields, extraFilterFields: config.filterRelations, searchText });
  const { sort, onSort, groups, collapsedGroups, toggleGroup } = view;
  const filtered = view.rows;

  const selectable = canDelete || !!config.actions?.length;
  const colSpanAll =
    config.columns.length + (selectable ? 1 : 0) + (child ? 1 : 0) + 1; // +1 = always-present actions column
  const allIds = filtered.map((r) => String(r.id));
  const allSelected = allIds.length > 0 && allIds.every((id) => selected.has(id));
  const toggleAll = () => setSelected(allSelected ? new Set() : new Set(allIds));
  const toggleOne = (id: string) => setSelected((p) => { const n = new Set(p); if (n.has(id)) n.delete(id); else n.add(id); return n; });

  // One data row (+ its expandable child list). Reused for the plain and the grouped table bodies.
  const renderRow = (row: Row) => {
    const kids = child ? (childrenByFk.get(row.id) ?? []) : [];
    const isOpen = expanded.has(String(row.id));
    return (
      <Fragment key={String(row.id)}>
        <tr onClick={() => openView(row.id)} style={{ cursor: 'pointer' }}>
          {selectable && <td onClick={(e) => e.stopPropagation()}><input type="checkbox" checked={selected.has(String(row.id))} onChange={() => toggleOne(String(row.id))} /></td>}
          {child && (
            <td onClick={(e) => e.stopPropagation()}>
              <button className="btn btn-ghost btn-sm" title={`${kids.length} ${child.title.toLowerCase()}`}
                style={{ padding: '2px 7px', minWidth: 34 }} onClick={() => toggleExpand(String(row.id))}>
                {isOpen ? '▾' : '▸'} {kids.length}
              </button>
            </td>
          )}
          {config.columns.map((c) => (
            <td key={c}>
              {badgeCols.has(c) && getPath(row, c) != null
                ? <span className={badgeClass(String(getPath(row, c)))}>{fmt(getPath(row, c))}</span>
                : fmt(getPath(row, c))}
            </td>
          ))}
          <td onClick={(e) => e.stopPropagation()}>
            {(config.actions ?? []).filter((a) => !a.visible || a.visible(row)).map((a) => (
              canUpdate && (
                <button key={a.label} className="btn btn-ghost btn-sm" style={{ marginRight: 6 }}
                  onClick={() => { if (!a.confirm || confirm(a.confirm)) action.mutate(a.path(row)); }}>
                  {a.label}
                </button>
              )
            ))}
            {(config.relatedLinks ?? []).map((rl) => (
              <button key={rl.label} className="btn btn-ghost btn-sm" style={{ marginRight: 6 }} onClick={() => navigate(rl.to(row))}>{rl.label} ↗</button>
            ))}
            {config.reminderTarget && canUpdate && (
              <button className="btn btn-ghost btn-sm" style={{ marginRight: 6 }} title="Add a reminder for this record"
                onClick={() => setReminderFor({ id: row.id as number, label: String(getPath(row, config.columns[0]) ?? '') })}>⏰ Remind</button>
            )}
            {config.resolvable && ['WAITING', 'DUE', 'PENDING_RESOLVED'].includes(String(row.status)) && (
              <button className="btn btn-ghost btn-sm" style={{ marginRight: 6 }} onClick={() => setResolveFor(row)}>Resolve</button>
            )}
            {canUpdate && <button className="btn btn-ghost btn-sm" onClick={() => { setErr(''); setEditing({ ...row }); }}>Edit</button>}
            {canDelete && <button className="btn btn-danger btn-sm" style={{ marginLeft: 6 }} onClick={() => { if (confirm('Delete this record?')) del.mutate(row.id); }}>Del</button>}
          </td>
        </tr>
        {child && isOpen && (
          <tr>
            <td colSpan={colSpanAll} style={{ background: 'var(--bg-2)', padding: '8px 16px' }}>
              {kids.length === 0 ? (
                <span className="muted" style={{ fontSize: 13 }}>No {child.title.toLowerCase()} yet.</span>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                  <div className="muted" style={{ fontSize: 11.5, textTransform: 'uppercase', letterSpacing: '.04em' }}>{child.title}</div>
                  {kids.map((s) => (
                    <button key={String(s.id)} type="button" className="kid-link"
                      onClick={() => navigate(`${child.linkPath}?view=${s.id}`)}
                      style={{ display: 'flex', alignItems: 'center', gap: 10, textAlign: 'left', background: 'transparent', border: 'none', padding: '4px 6px', borderRadius: 6, cursor: 'pointer', color: 'var(--text)' }}
                      onMouseEnter={(e) => (e.currentTarget.style.background = 'rgba(255,255,255,.05)')}
                      onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}>
                      <span style={{ color: 'var(--primary-2)', fontWeight: 600 }}>{fmt(s[child.label]) || `#${s.id}`}</span>
                      {(child.meta ?? []).filter((m) => s[m] != null && s[m] !== '').map((m) => (
                        <span key={m} className="muted" style={{ fontSize: 12.5 }}>· {m}: {fmt(s[m])}</span>
                      ))}
                      <span className="muted" style={{ marginLeft: 'auto', fontSize: 12 }}>open ↗</span>
                    </button>
                  ))}
                </div>
              )}
            </td>
          </tr>
        )}
      </Fragment>
    );
  };

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (!editing) return;
    // date-range validation (e.g. "to" cannot precede "from")
    for (const r of config.dateRanges ?? []) {
      const from = editing[r.from] as string;
      const to = editing[r.to] as string;
      if (from && to && to < from) {
        const lbl = (k: string) => config.fields.find((f) => f.name === k)?.label ?? k;
        setErr(`"${lbl(r.to)}" cannot be earlier than "${lbl(r.from)}".`);
        return;
      }
    }
    save.mutate(editing);
  };

  return (
    <div>
      <div className="page-head">
        <h1>{config.title}</h1>
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
          <button className="btn btn-ghost" onClick={() => setExporting(true)}>Export</button>
          {canCreate && <button className="btn btn-ghost" onClick={() => fileRef.current?.click()}>Import</button>}
          <input ref={fileRef} type="file" accept=".xlsx" hidden onChange={importXlsx} />
          {canCreate && <button className="btn btn-primary" onClick={() => { setErr(''); setEditing({}); }}>+ New</button>}
        </div>
      </div>

      {exporting && (
        <ExportPicker resource={config.resource} title={config.title} defaultFields={config.columns}
          ids={selected.size > 0 ? [...selected] : undefined} onClose={() => setExporting(false)} />
      )}

      {filterEntries.length > 0 && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10, flexWrap: 'wrap' }}>
          {filterEntries.map(([k, v]) => {
            const meta = FILTER_LABELS[k];
            const name = meta ? (filtered[0]?.[meta.rel] as Record<string, unknown> | undefined)?.[meta.relLabel] : undefined;
            return <span key={k} className="badge badge-blue">{(meta?.title ?? k.replace(/\./g, ' '))}: {name != null ? String(name) : v}</span>;
          })}
          <span className="muted" style={{ fontSize: 12.5 }}>· {filtered.length} of {rows.length}</span>
          <button className="btn btn-ghost btn-sm" onClick={() => setSearchParams({})}>Clear filter</button>
        </div>
      )}

      {editing && (
        <div className="modal-backdrop" onClick={() => { setEditing(null); setErr(''); }}>
        <form className="modal" onClick={(e) => e.stopPropagation()} onSubmit={onSubmit}>
          <div className="card-body">
            <h3 style={{ marginTop: 0 }}>{editing.id ? 'Edit' : 'New'} {config.title.replace(/s$/, '')}</h3>
            <div className="grid-2">
              {config.fields.filter((f) => !f.showWhen || f.showWhen.in.includes(String(editing[f.showWhen.field] ?? ''))).map((f) => (
                <div key={f.name} className={'field' + (f.type === 'textarea' || f.type === 'file' || f.type === 'multiref' || f.type === 'field-defs' ? ' col-span' : '')}>
                  <label>{f.label}</label>
                  {f.type === 'textarea' ? (
                    <textarea className="input" rows={3} value={(editing[f.name] as string) ?? ''} onChange={(e) => setField(f, e.target.value)} />
                  ) : f.type === 'select' && f.allowCustom ? (
                    <>
                      <input className="input" list={`dl-${f.name}`} placeholder="select or type a new value…"
                        value={(editing[f.name] as string) ?? ''} onChange={(e) => setField(f, e.target.value)} />
                      <datalist id={`dl-${f.name}`}>{f.options?.map((o) => <option key={o} value={o} />)}</datalist>
                    </>
                  ) : f.type === 'select' ? (
                    <select className="input" value={(editing[f.name] as string) ?? ''} onChange={(e) => setField(f, e.target.value)}>
                      <option value="">—</option>
                      {f.options?.map((o) => <option key={o} value={o}>{o}</option>)}
                    </select>
                  ) : f.type === 'ref' ? (
                    <RefSelect field={f} value={editing[f.name]} onChange={(v) => setField(f, v)} />
                  ) : f.type === 'multiref' ? (
                    <MultiRefSelect endpoint={f.refEndpoint as string} labelKey={f.refLabel ?? 'name'}
                      value={Array.isArray(editing[f.name]) ? (editing[f.name] as number[]) : []}
                      onChange={(ids) => setField(f, ids)} />
                  ) : f.type === 'file' ? (
                    <FileField value={editing[f.name]} onChange={(p) => setField(f, p)} />
                  ) : f.type === 'field-defs' ? (
                    <FieldDefsEditor value={editing[f.name]} onChange={(v) => setField(f, v)} />
                  ) : f.type === 'checkbox' ? (
                    <div style={{ paddingTop: 6 }}>
                      <input type="checkbox" checked={!!editing[f.name]} onChange={(e) => setField(f, e.target.checked)} />
                    </div>
                  ) : (
                    <input
                      className="input"
                      type={inputType(f.type)}
                      value={(editing[f.name] as string | number) ?? ''}
                      onChange={(e) => setField(f, f.type === 'number' ? Number(e.target.value) : e.target.value)}
                    />
                  )}
                </div>
              ))}
            </div>
            {err && <div className="error-text" style={{ whiteSpace: 'pre-line' }}>{err}</div>}
            <button className="btn btn-primary" disabled={save.isPending}>{save.isPending ? 'Saving…' : 'Save'}</button>
            <button type="button" className="btn btn-ghost" style={{ marginLeft: 8 }} onClick={() => { setEditing(null); setErr(''); }}>Cancel</button>
          </div>
        </form>
        </div>
      )}

      {viewing && (
        <RecordDetail
          title={config.title.replace(/s$/, '')}
          fields={config.fields}
          record={viewing}
          child={child ? {
            title: child.title,
            rows: childrenByFk.get(viewing.id) ?? [],
            label: child.label,
            meta: child.meta,
            linkPath: child.linkPath,
          } : undefined}
          relatedPanels={config.relatedPanels}
          parentType={config.parentType ?? config.key}
          parentLabel={String(getPath(viewing, config.columns[0] ?? 'id') ?? '')}
          relatedLinks={config.relatedLinks}
          canEdit={canUpdate}
          onEdit={() => { setErr(''); setEditing({ ...viewing }); closeView(); }}
          onClose={closeView}
        />
      )}

      {/* Blocked-delete dialog: each referencing record links straight to itself (Odoo-style). */}
      {blocked && (
        <div className="modal-backdrop" onClick={() => setBlocked(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="card-body">
              <h3 style={{ marginTop: 0 }}>Can’t delete — still referenced</h3>
              <p style={{ marginTop: 0 }}>{blocked.message}</p>
              <label style={{ display: 'block', marginBottom: 6 }}>
                Referencing record{blocked.blockersTotal > 1 ? 's' : ''}
                {blocked.blockersTotal > blocked.blockers.length ? ` (showing ${blocked.blockers.length} of ${blocked.blockersTotal})` : ''}
              </label>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4, maxHeight: 320, overflow: 'auto' }}>
                {blocked.blockers.map((b) => {
                  const meta = resourceMeta(b.resource);
                  return (
                    <button key={b.resource + b.id} type="button" className="kid-link"
                      onClick={() => { setBlocked(null); navigate(`${meta.route}?view=${b.id}`); }}
                      style={{ display: 'flex', gap: 10, alignItems: 'center', textAlign: 'left', background: 'var(--bg-2)', border: '1px solid var(--border)', padding: '6px 10px', borderRadius: 6, cursor: 'pointer', color: 'var(--text)' }}>
                      <span className="badge badge-gray">{meta.title}</span>
                      <span style={{ color: 'var(--primary-2)', fontWeight: 600 }}>#{b.id}</span>
                      <span>{b.label}</span>
                      <span className="muted" style={{ marginLeft: 'auto', fontSize: 12 }}>open ↗</span>
                    </button>
                  );
                })}
              </div>
              {blocked.hint && <p className="muted" style={{ fontSize: 12.5, marginTop: 12 }}>{blocked.hint}</p>}
              <div style={{ marginTop: 16 }}>
                <button className="btn btn-ghost" onClick={() => setBlocked(null)}>Close</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {config.reminderTarget && reminderFor && (
        <ReminderModal parentType={config.reminderTarget} parentId={reminderFor.id} parentLabel={reminderFor.label} onClose={() => setReminderFor(null)} />
      )}

      {resolveFor && (
        <ResolveModal reminderId={resolveFor.id as number} title={(resolveFor.title as string) ?? undefined}
          recurring={!!resolveFor.recurrence && resolveFor.recurrence !== 'NONE'}
          onClose={() => setResolveFor(null)}
          onSaved={() => qc.invalidateQueries({ queryKey: [config.endpoint] })} />
      )}

      {selectable && selected.size > 0 && (
        <div className="card" style={{ marginBottom: 12 }}>
          <div className="card-body" style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '12px 16px' }}>
            <strong>{selected.size} selected</strong>
            <button className="btn btn-ghost btn-sm" onClick={() => setExporting(true)}>Export selected</button>
            {(config.actions ?? []).map((a) => (
              <button key={a.label} className="btn btn-ghost btn-sm" disabled={bulkAction.isPending} onClick={() => bulkAction.mutate({ ids: [...selected], act: a })}>{a.label} selected</button>
            ))}
            {canDelete && <button className="btn btn-danger btn-sm" disabled={bulkDelete.isPending} onClick={() => { if (confirm(`Delete ${selected.size} record(s)?`)) bulkDelete.mutate([...selected]); }}>Delete selected</button>}
            <button className="btn btn-ghost btn-sm" onClick={() => setSelected(new Set())}>Clear</button>
          </div>
        </div>
      )}

      <ListToolbar view={view} placeholder={`Search ${config.title.toLowerCase()}… (any field)`} />

      <div className="card">
        <table className="table">
          <thead>
            <tr>
              {selectable && <th style={{ width: 36 }}><input type="checkbox" checked={allSelected} onChange={toggleAll} /></th>}
              {child && <th style={{ width: 32 }}></th>}
              {config.columns.map((c) => (
                <th key={c} onClick={() => onSort(c)} style={{ cursor: 'pointer', userSelect: 'none', whiteSpace: 'nowrap' }} title="Click to sort">
                  {c.replace(/\./g, ' ')}{sort?.col === c ? (sort.dir === 'asc' ? ' ▲' : ' ▼') : ''}
                </th>
              ))}
              <th style={{ width: 220 }}></th>
            </tr>
          </thead>
          <tbody>
            {isLoading && rows.length === 0 &&
              [0, 1, 2].map((i) => (
                <tr key={i}>
                  {selectable && <td><div className="skel" /></td>}
                  {child && <td><div className="skel" /></td>}
                  {config.columns.map((c) => <td key={c}><div className="skel" /></td>)}
                  <td><div className="skel" /></td>
                </tr>
              ))}
            {!isLoading && filtered.length === 0 && (
              <tr><td colSpan={colSpanAll} className="empty">{filterEntries.length ? 'No records match this filter.' : 'No records yet.'}</td></tr>
            )}
            {groups
              ? groups.map(([key, gRows]) => (
                  <Fragment key={'grp-' + key}>
                    <tr onClick={() => toggleGroup(key)} style={{ cursor: 'pointer', background: 'var(--bg-2)' }}>
                      <td colSpan={colSpanAll} style={{ fontWeight: 600, padding: '7px 12px' }}>
                        {collapsedGroups.has(key) ? '▸' : '▾'} {key} <span className="muted" style={{ fontWeight: 400 }}>({gRows.length})</span>
                      </td>
                    </tr>
                    {!collapsedGroups.has(key) && gRows.map(renderRow)}
                  </Fragment>
                ))
              : filtered.map(renderRow)}
          </tbody>
        </table>
      </div>
    </div>
  );
}
