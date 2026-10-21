import { useEffect, useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api';

type FieldMeta = { name: string; label: string };
type RelMeta = { key: string; label: string; cardinality: 'one' | 'many'; labelField: string | null };
type FieldsResponse = { own: FieldMeta[]; relations: RelMeta[]; hasImportUid?: boolean };
/** A selected field: its full dot-path (own name, or "relation.relation....field"), display label, and
 *  whether it's a "linked" field — a single to-one hop landing on that relation's name-matched label
 *  column (e.g. a Project's `poc.name`) — genuinely editable and re-imported by matching the typed name
 *  against existing records, vs. every other relation-drilled field, which is reference-only. */
type Picked = { path: string; label: string; linked?: boolean };

const templatesKey = (resource: string) => `export-templates:${resource}`;

function loadTemplates(resource: string): Record<string, string[]> {
  try { return JSON.parse(localStorage.getItem(templatesKey(resource)) ?? '{}'); } catch { return {}; }
}
function saveTemplates(resource: string, t: Record<string, string[]>) {
  try { localStorage.setItem(templatesKey(resource), JSON.stringify(t)); } catch { /* private-mode/quota — silently skip */ }
}

/** A small self-contained toggle switch (no new global CSS needed) — used for "Import-friendly" so it
 *  reads as an on/off product control rather than a plain checkbox buried in a paragraph. */
function Toggle({ checked, onChange, disabled }: { checked: boolean; onChange: (v: boolean) => void; disabled?: boolean }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      style={{
        width: 34, height: 19, borderRadius: 999, border: 'none', padding: 2, flexShrink: 0,
        background: checked ? 'var(--primary, #2563eb)' : 'var(--border)',
        cursor: disabled ? 'not-allowed' : 'pointer', opacity: disabled ? 0.5 : 1,
        transition: 'background .15s', marginTop: 1,
      }}
    >
      <span style={{
        display: 'block', width: 15, height: 15, borderRadius: '50%', background: '#fff',
        transform: checked ? 'translateX(15px)' : 'translateX(0)', transition: 'transform .15s',
      }} />
    </button>
  );
}

/** One node of the lazily-loaded field tree: this entity's own fields + its immediate relations
 *  (fetched on first expand). `path` is '' for the root resource, else the dotted relation chain to
 *  reach this entity (e.g. "environments" or "environments.project"). */
function FieldTreeNode({
  resource, path, label, title, q, cardinality, labelField, pickedPaths, onAdd, onAddAll, depth,
}: {
  resource: string;
  path: string;
  /** full chain label ("Environments: Server") — what a picked field is named in the "to export" list */
  label?: string;
  /** just this relation's own name ("Server") — the tree's indentation already shows where it sits */
  title?: string;
  /** filter text typed above the tree (matches field names in the nodes that are open) */
  q: string;
  cardinality?: 'one' | 'many';
  /** This node's OWN labelField (only meaningful when depth === 1 and cardinality === 'one') — the one
   *  own-field name that's genuinely editable/re-importable, per relationLinksFor's convention. */
  labelField?: string | null;
  pickedPaths: Set<string>;
  onAdd: (path: string, label: string, linked: boolean) => void;
  onAddAll: (fields: FieldMeta[], pathPrefix: string, label?: string, linkedField?: string | null) => void;
  depth: number;
}) {
  const [open, setOpen] = useState(depth === 0); // root's own content is always visible
  const { data, isLoading } = useQuery({
    queryKey: ['/data', resource, 'fields', path],
    queryFn: async () => (await api.get(`/data/${resource}/fields`, { params: path ? { path } : undefined })).data as FieldsResponse,
    enabled: open,
    staleTime: 5 * 60_000,
  });

  const abs = (name: string) => (path ? `${path}.${name}` : name);

  return (
    <div>
      {depth > 0 && (
        <div onClick={() => setOpen((o) => !o)} style={{ cursor: 'pointer', padding: '5px 6px', paddingLeft: 6 + (depth - 1) * 14, fontSize: 13, fontWeight: 600, userSelect: 'none', display: 'flex', alignItems: 'center', gap: 6 }}>
          <span>{open ? '▾' : '▸'} {title ?? label}</span>
          {cardinality === 'many' && <span className="badge badge-gray" style={{ fontSize: 10 }}>multiple</span>}
        </div>
      )}
      {open && (
        isLoading || !data ? (
          <div className="muted" style={{ padding: '4px 6px', paddingLeft: 20 + depth * 14, fontSize: 12.5 }}>Loading…</div>
        ) : (
          <>
            {data.own.length > 0 && (
              <div style={{ display: 'flex', justifyContent: 'flex-end', paddingRight: 6 }}>
                <button type="button" className="btn btn-ghost btn-sm" style={{ fontSize: 11, padding: '0 6px' }}
                  onClick={() => onAddAll(data.own, path, label, depth === 1 && cardinality === 'one' ? labelField : null)}>+ Add all {title ? `(${title})` : 'fields'}</button>
              </div>
            )}
            {data.own.filter((f) => !q || f.label.toLowerCase().includes(q)).map((f) => {
              const p = abs(f.name);
              const isLinked = depth === 1 && cardinality === 'one' && f.name === labelField;
              return (
                <div key={p} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '4px 6px', paddingLeft: 20 + depth * 14, fontSize: 13, opacity: pickedPaths.has(p) ? 0.4 : 1 }}>
                  <span style={{ flex: 1 }}>
                    {f.label}
                    {isLinked && <span className="badge badge-green" style={{ fontSize: 9.5, marginLeft: 6 }} title="Matched by name on import — pick an existing name, or a new one blocks the row">editable</span>}
                  </span>
                  <button type="button" className="btn btn-ghost btn-sm" style={{ padding: '0 8px' }} disabled={pickedPaths.has(p)}
                    onClick={() => onAdd(p, label ? `${label}: ${f.label}` : f.label, isLinked)}>+</button>
                </div>
              );
            })}
            {data.relations.map((r) => (
              <FieldTreeNode key={r.key} resource={resource} path={abs(r.key)} label={label ? `${label}: ${r.label}` : r.label} title={r.label} q={q}
                cardinality={r.cardinality} labelField={r.labelField} pickedPaths={pickedPaths} onAdd={onAdd} onAddAll={onAddAll} depth={depth + 1} />
            ))}
          </>
        )
      )}
    </div>
  );
}

/**
 * Odoo-style export field picker: choose exactly which fields — this resource's own columns, or an
 * arbitrary-depth drill-in through its relations (to-one AND to-many/reverse, e.g. a Server's hosted
 * Environments) — in what order, as XLSX or CSV, optionally "import-compatible" (adds the record's
 * stable id so re-importing the sheet updates instead of duplicating). Used from every list view's
 * Export button, from bulk "Export selected", and from a filtered related panel.
 */
export function ExportPicker({
  resource, title, filter, ids, defaultFields, onClose,
}: {
  resource: string;
  title?: string;
  /** Pre-applied row filter, e.g. { key: 'serverId', value: 5 } from a related panel. */
  filter?: { key: string; value: string | number; label?: string };
  /** Pre-applied row selection (e.g. checked rows in a list view's bulk-select) — takes precedence over `filter`. */
  ids?: (string | number)[];
  /** Initial selection (own field names or dotted relation paths) — e.g. the calling list's visible columns. */
  defaultFields?: string[];
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const { data: rootMeta } = useQuery({
    queryKey: ['/data', resource, 'fields', ''],
    queryFn: async () => (await api.get(`/data/${resource}/fields`)).data as FieldsResponse,
  });

  const [picked, setPicked] = useState<Picked[]>([]);
  const [format, setFormat] = useState<'xlsx' | 'csv'>('xlsx');
  const [importCompatible, setImportCompatible] = useState(false);
  const [templateName, setTemplateName] = useState('');
  const [templates, setTemplates] = useState<Record<string, string[]>>({});
  const [busy, setBusy] = useState(false);
  const [fieldQ, setFieldQ] = useState('');

  useEffect(() => { setTemplates(loadTemplates(resource)); }, [resource]);

  // Resolves a dotted path to its display label (+ whether it's "linked" — a single to-one hop landing
  // on that relation's own labelField), fetching (and caching, via react-query) whatever intermediate
  // relation levels aren't already loaded — used for both seeding defaultFields and loading a saved
  // template, either of which may reference a path deeper than what's been expanded in the tree yet.
  const resolveField = async (path: string): Promise<{ label: string; linked: boolean } | null> => {
    const segs = path.split('.');
    const own = segs[segs.length - 1];
    let parentPath = '';
    let page = rootMeta;
    const relLabels: string[] = [];
    let singleHopRel: RelMeta | null = null;
    for (const seg of segs.slice(0, -1)) {
      const rel = page?.relations.find((r) => r.key === seg);
      if (!rel) return null;
      singleHopRel = segs.length === 2 ? rel : null; // only meaningful when this is the ONE hop
      relLabels.push(rel.label);
      parentPath = parentPath ? `${parentPath}.${seg}` : seg;
      page = await qc.fetchQuery({
        queryKey: ['/data', resource, 'fields', parentPath],
        queryFn: async () => (await api.get(`/data/${resource}/fields`, { params: { path: parentPath } })).data as FieldsResponse,
        staleTime: 5 * 60_000,
      });
    }
    const field = page?.own.find((f) => f.name === own);
    if (!field) return null;
    const linked = !!singleHopRel && singleHopRel.cardinality === 'one' && singleHopRel.labelField === own;
    return { label: [...relLabels, field.label].join(': '), linked };
  };

  // Seed the selection once root metadata is in: from defaultFields where they resolve, falling back
  // to every own field so a first-time Export still gets something sensible.
  useEffect(() => {
    if (!rootMeta || picked.length) return;
    let cancelled = false;
    (async () => {
      const resolved: Picked[] = [];
      for (const p of defaultFields ?? []) {
        const r = await resolveField(p);
        if (r) resolved.push({ path: p, label: r.label, linked: r.linked });
      }
      if (!cancelled) setPicked(resolved.length ? resolved : rootMeta.own.map((f) => ({ path: f.name, label: f.label })));
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rootMeta]);

  const pickedPaths = useMemo(() => new Set(picked.map((p) => p.path)), [picked]);
  const add = (path: string, label: string, linked?: boolean) => setPicked((p) => (p.some((x) => x.path === path) ? p : [...p, { path, label, linked }]));
  const addAll = (fields: FieldMeta[], pathPrefix: string, groupLabel?: string, linkedField?: string | null) => setPicked((p) => {
    const existing = new Set(p.map((x) => x.path));
    const additions = fields
      .map((f) => ({ path: pathPrefix ? `${pathPrefix}.${f.name}` : f.name, label: groupLabel ? `${groupLabel}: ${f.label}` : f.label, linked: !!linkedField && f.name === linkedField }))
      .filter((x) => !existing.has(x.path));
    return [...p, ...additions];
  });
  const remove = (path: string) => setPicked((p) => p.filter((x) => x.path !== path));
  const move = (i: number, dir: -1 | 1) => setPicked((p) => {
    const j = i + dir;
    if (j < 0 || j >= p.length) return p;
    const next = [...p];
    [next[i], next[j]] = [next[j], next[i]];
    return next;
  });

  const doExport = async () => {
    if (!picked.length) return;
    setBusy(true);
    try {
      const params = new URLSearchParams();
      params.set('fields', picked.map((p) => p.path).join(','));
      params.set('format', format);
      if (importCompatible) params.set('importCompatible', '1');
      if (ids?.length) params.set('ids', ids.join(','));
      else if (filter) params.set(filter.key, String(filter.value));
      const res = await api.get(`/data/${resource}/export?${params.toString()}`, { responseType: 'blob' });
      const url = URL.createObjectURL(res.data as Blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${resource.replace(/\./g, '-')}${ids?.length || filter ? '-filtered' : ''}.${format}`;
      a.click();
      URL.revokeObjectURL(url);
      onClose();
    } catch {
      alert('Export failed — please try again.');
    } finally {
      setBusy(false);
    }
  };

  const applyTemplate = async (name: string) => {
    const paths = templates[name] ?? [];
    const resolved = await Promise.all(paths.map(async (p) => {
      const r = await resolveField(p);
      return { path: p, label: r?.label ?? p, linked: r?.linked };
    }));
    setPicked(resolved);
  };

  const saveTemplate = () => {
    const name = templateName.trim();
    if (!name) return;
    const next = { ...templates, [name]: picked.map((p) => p.path) };
    setTemplates(next);
    saveTemplates(resource, next);
    setTemplateName('');
  };

  const deleteTemplate = (name: string) => {
    const next = { ...templates };
    delete next[name];
    setTemplates(next);
    saveTemplates(resource, next);
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" style={{ maxWidth: 880, width: '92vw' }} onClick={(e) => e.stopPropagation()}>
        <div className="card-body">
          <h3 style={{ marginTop: 0 }}>Export {title ?? resource}</h3>
          {ids?.length ? (
            <p className="muted" style={{ marginTop: -6, fontSize: 12.5 }}>Scoped to: {ids.length} selected record{ids.length === 1 ? '' : 's'}</p>
          ) : filter ? (
            <p className="muted" style={{ marginTop: -6, fontSize: 12.5 }}>Scoped to: {filter.label ?? `${filter.key} = ${filter.value}`}</p>
          ) : null}

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginTop: 10 }}>
            <div>
              <strong style={{ fontSize: 13.5 }}>Available fields</strong>
              <p className="muted" style={{ margin: '2px 0 6px', fontSize: 11.5 }}>Click a relation to drill in — including "multiple" ones (e.g. a server's hosted environments), which join into one cell per record.</p>
              <input className="input" style={{ fontSize: 12.5, marginBottom: 6 }} placeholder="Filter fields…" value={fieldQ} onChange={(e) => setFieldQ(e.target.value)} />
              <div style={{ border: '1px solid var(--border)', borderRadius: 6, maxHeight: 'min(48vh, 440px)', overflowY: 'auto', padding: 4 }}>
                {!rootMeta ? <div className="muted" style={{ padding: 8, fontSize: 13 }}>Loading fields…</div> : (
                  <FieldTreeNode resource={resource} path="" q={fieldQ.trim().toLowerCase()} pickedPaths={pickedPaths} onAdd={add} onAddAll={addAll} depth={0} />
                )}
              </div>
            </div>

            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <strong style={{ fontSize: 13.5 }}>Fields to export</strong>
                {Object.keys(templates).length > 0 && (
                  <select className="input" style={{ marginLeft: 'auto', width: 160, padding: '4px 6px', fontSize: 12.5 }}
                    defaultValue="" onChange={(e) => { applyTemplate(e.target.value); e.target.value = ''; }}>
                    <option value="" disabled>Load template…</option>
                    {Object.keys(templates).map((n) => <option key={n} value={n}>{n}</option>)}
                  </select>
                )}
              </div>
              <div style={{ marginTop: 6, marginBottom: 6, display: 'flex', gap: 8 }}>
                <span className="muted" style={{ fontSize: 12.5, alignSelf: 'center' }}>{picked.length} field{picked.length === 1 ? '' : 's'}</span>
              </div>
              <div style={{ border: '1px solid var(--border)', borderRadius: 6, maxHeight: 'min(48vh, 440px)', overflowY: 'auto', padding: 4 }}>
                {picked.length === 0 && <div className="muted" style={{ padding: 8, fontSize: 13 }}>Add fields from the left.</div>}
                {picked.map((p, i) => (
                  <div key={p.path} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '4px 6px', fontSize: 13 }}>
                    <span style={{ flex: 1 }}>
                      {p.label}
                      {p.linked && <span className="badge badge-green" style={{ fontSize: 9.5, marginLeft: 6 }} title="Matched by name on import — pick an existing name, or a new one blocks the row">editable</span>}
                      {p.path.includes('.') && !p.linked && <span className="muted" style={{ fontSize: 10.5, marginLeft: 6 }} title="From a related record — shown for reference, never written back when you re-import this file">reference only</span>}
                    </span>
                    <button type="button" className="btn btn-ghost btn-sm" style={{ padding: '0 6px' }} disabled={i === 0} onClick={() => move(i, -1)} title="Move up">▲</button>
                    <button type="button" className="btn btn-ghost btn-sm" style={{ padding: '0 6px' }} disabled={i === picked.length - 1} onClick={() => move(i, 1)} title="Move down">▼</button>
                    <button type="button" className="btn btn-ghost btn-sm" style={{ padding: '0 6px' }} onClick={() => remove(p.path)} title="Remove">🗑</button>
                  </div>
                ))}
              </div>

              <div style={{ display: 'flex', gap: 6, marginTop: 8 }}>
                <input className="input" style={{ fontSize: 12.5 }} placeholder="Save current fields as a template…" value={templateName} onChange={(e) => setTemplateName(e.target.value)} />
                <button type="button" className="btn btn-ghost btn-sm" onClick={saveTemplate} disabled={!templateName.trim() || !picked.length}>Save</button>
              </div>
              {Object.keys(templates).length > 0 && (
                <div style={{ marginTop: 4, display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                  {Object.keys(templates).map((n) => (
                    <span key={n} className="badge badge-gray" style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                      {n}
                      <button type="button" onClick={() => deleteTemplate(n)} title="Delete template" style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'inherit', padding: 0, fontSize: 11 }}>✕</button>
                    </span>
                  ))}
                </div>
              )}

              {rootMeta?.hasImportUid ? (
                <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10, marginTop: 12 }}>
                  <Toggle checked={importCompatible} onChange={(v) => { setImportCompatible(v); if (v) setFormat('xlsx'); }} />
                  <div>
                    <div style={{ fontSize: 13 }}>Import-friendly</div>
                    <div className="muted" style={{ fontSize: 11.5, marginTop: 1 }}>
                      For re-importing: adds an ID column and uses the technical column headings the Import button matches on,
                      so the file updates these records instead of duplicating them. "Reference only" fields are never written back.
                      Leave it off for a readable report with plain headings.
                    </div>
                  </div>
                </div>
              ) : rootMeta ? (
                <p className="muted" style={{ marginTop: 12, fontSize: 11.5 }}>This resource doesn't support import-friendly re-matching.</p>
              ) : null}
            </div>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginTop: 16 }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontWeight: 'normal' }}>
              <input type="radio" checked={format === 'xlsx'} onChange={() => setFormat('xlsx')} /> XLSX
            </label>
            <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontWeight: 'normal', opacity: importCompatible ? 0.4 : 1 }} title={importCompatible ? 'The Import button only reads .xlsx files — CSV isn\'t re-importable' : undefined}>
              <input type="radio" checked={format === 'csv'} disabled={importCompatible} onChange={() => setFormat('csv')} /> CSV
            </label>
            <div style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
              <button type="button" className="btn btn-ghost" onClick={onClose}>Cancel</button>
              <button type="button" className="btn btn-primary" disabled={!picked.length || busy} onClick={doExport}>
                {busy ? 'Exporting…' : `Export ${picked.length} field${picked.length === 1 ? '' : 's'}`}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
