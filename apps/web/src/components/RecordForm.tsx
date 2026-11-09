import { useState, type ChangeEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, API_ORIGIN } from '../lib/api';
import { useToast } from './Toast';

function apiErr(e: unknown) {
  const m = (e as { response?: { data?: { message?: string | string[] } } }).response?.data?.message;
  return Array.isArray(m) ? m.join(', ') : (m ?? 'Request failed');
}
import type { FieldDef } from '../modules/resources';
import { MultiRefSelect } from './MultiRefSelect';
import { fixedList, inferMode, isForbiddenFieldName, type IntegrationTypeField } from '../lib/integrationFlags';

type V = Record<string, unknown>;
// Relation objects + server-computed extras echoed onto list rows (publishState, and the projects
// hosting summary) — stripped from the save payload so TypeORM never sees a non-column property.
const REL_KEYS = ['project', 'server', 'gitProvider', 'integrationType', 'account', 'environment', 'poc', 'checklistSubmittedBy', 'publishState', 'hosting', 'hostingText', 'developers', 'developerNames', 'fieldStatus'];
const AUDIT = ['id', 'createdAt', 'updatedAt', 'deletedAt', 'createdBy', 'updatedBy'];

/** strip audit/relation keys, convert datetime-local, '' -> null */
export function cleanPayload(obj: V, fields: FieldDef[]): V {
  const p: V = { ...obj };
  [...AUDIT, ...REL_KEYS].forEach((k) => delete p[k]);
  fields.forEach((f) => {
    if (f.type === 'datetime-local' && typeof p[f.name] === 'string' && p[f.name]) {
      p[f.name] = (p[f.name] as string).replace('T', ' ') + ':00';
    }
    // a field hidden by its showWhen condition is cleared (e.g. the CI/CD reason when status isn't
    // Disabled) — same convention CrudPage's own inline form already uses.
    if (f.showWhen && !f.showWhen.in.includes(String(p[f.showWhen.field] ?? ''))) p[f.name] = null;
  });
  Object.keys(p).forEach((k) => { if (p[k] === '') p[k] = null; });
  return p;
}

function RefSelect({ field, value, onChange }: { field: FieldDef; value: unknown; onChange: (v: number | null) => void }) {
  const { data = [] } = useQuery({
    queryKey: [field.refEndpoint],
    queryFn: async () => (await api.get(field.refEndpoint as string)).data as V[],
    staleTime: 60_000,
  });
  return (
    <select className="input" value={(value as number) ?? ''} onChange={(e) => onChange(e.target.value ? Number(e.target.value) : null)}>
      <option value="">—</option>
      {data.map((o) => <option key={String(o.id)} value={String(o.id)}>{String(o[field.refLabel as string] ?? `#${o.id}`)}</option>)}
    </select>
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
      e.target.value = ''; // allow re-picking the same file after a failure
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

const linesToArr = (s: string) => s.split('\n').map((x) => x.trim()).filter(Boolean);
const arrToLines = (a: string[] | undefined) => (a ?? []).join('\n');

/** A "one value per line" textarea backed by a string[]. Keeps its own local text buffer (seeded once
 *  from `value`) instead of re-deriving the displayed text from the cleaned array on every keystroke —
 *  otherwise pressing Enter to start a new line gets immediately undone: the blank line it creates is
 *  stripped by linesToArr, and the rebuilt string fed back into the controlled textarea has no newline
 *  to show, so the cursor snaps back before the next value can be typed. Paste "worked" because a paste
 *  never passes through that intermediate blank-line state. Only the cleaned array is ever emitted. */
function LinesTextarea({ value, onChange }: { value: string[] | undefined; onChange: (arr: string[]) => void }) {
  const [text, setText] = useState(() => arrToLines(value));
  return (
    <textarea
      className="input"
      rows={3}
      value={text}
      onChange={(e) => { setText(e.target.value); onChange(linesToArr(e.target.value)); }}
    />
  );
}

/** Editor for an Integration Type's custom field definitions (behavior = 'custom_fields'). Each field
 *  has a key/label plus two optional validation lists — possible (suggested/approved) and avoidable
 *  (known-bad) values. Never allows a field meant to hold a password/secret (mirrors the API guard). */
export function FieldDefsEditor({ value, onChange, typeId }: { value: unknown; onChange: (v: unknown) => void; typeId?: number }) {
  const rows = (value as IntegrationTypeField[] | null | undefined) ?? [];
  const update = (i: number, patch: Partial<IntegrationTypeField>) => {
    const next = rows.map((r, idx) => (idx === i ? { ...r, ...patch } : r));
    onChange(next);
  };
  const remove = (i: number) => onChange(rows.filter((_, idx) => idx !== i));
  const add = () => onChange([...rows, { key: '', label: '', possibleValues: [], avoidableValues: [], mode: 'possible' as const }]);
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      {rows.map((r, i) => {
        const forbidden = isForbiddenFieldName(r.key, r.label);
        const mode = inferMode(r);
        // Switching mode clears the list that's no longer shown, so a hidden stale list can't still flag values.
        const setMode = (m: 'possible' | 'avoidable') => update(i, m === 'possible' ? { mode: m, avoidableValues: [] } : { mode: m, possibleValues: [] });
        const enforced = fixedList(r).length > 0;
        return (
          <div key={i} className="card" style={{ padding: 10 }}>
            <div className="grid-2">
              <div className="field">
                <label>Field key</label>
                <input className="input" value={r.key} placeholder="login_url" onChange={(e) => update(i, { key: e.target.value })} />
              </div>
              <div className="field">
                <label>Field label</label>
                <input className="input" value={r.label} placeholder="CMS Login URL" onChange={(e) => update(i, { label: e.target.value })} />
              </div>
            </div>
            <div className="field" style={{ marginTop: 8 }}>
              <label>Kind</label>
              <select className="input" value={r.kind ?? 'text'} onChange={(e) => update(i, { kind: e.target.value === 'version' ? 'version' : undefined })}>
                <option value="text">Text</option>
                <option value="version">Version number (sortable, e.g. 8.3 or 8.3.35)</option>
              </select>
            </div>
            <div className="field" style={{ marginTop: 8 }}>
              <label>Validation</label>
              <div style={{ display: 'flex', gap: 16 }}>
                <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontWeight: 'normal' }}>
                  <input type="radio" checked={mode === 'possible'} onChange={() => setMode('possible')} />
                  Mandatory — must be one of a fixed list
                </label>
                <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontWeight: 'normal' }}>
                  <input type="radio" checked={mode === 'avoidable'} onChange={() => setMode('avoidable')} />
                  Avoid patterns — flag if it matches a known-bad value
                </label>
              </div>
            </div>
            {mode === 'possible' ? (
              <div className="field" style={{ marginTop: 8 }}>
                <label>Allowed values (one per line — a new or changed value must be one of these)</label>
                <LinesTextarea value={r.possibleValues} onChange={(arr) => update(i, { possibleValues: arr })} />
                <div className="muted" style={{ fontSize: 12, marginTop: 2 }}>
                  {enforced ? 'Enforced: saving any other value is refused. Existing values are kept as they are.' : 'Empty list: free text, not enforced.'}
                  {r.kind === 'version' ? ' For versions, enter the detail you track: an exact patch (8.3.35) or a line (8.3 = patch unknown).' : ''}
                </div>
              </div>
            ) : (
              <div className="field" style={{ marginTop: 8 }}>
                <label>Avoidable values (one per line — flagged if the entered value contains one)</label>
                <LinesTextarea value={r.avoidableValues} onChange={(arr) => update(i, { avoidableValues: arr })} />
              </div>
            )}
            {forbidden && (
              <div className="error-text" style={{ marginTop: 6 }}>
                This field looks like it stores a password/secret — those must never be saved here. Rename it or remove it.
              </div>
            )}
            <button type="button" className="btn btn-danger btn-sm" style={{ marginTop: 6 }} onClick={() => remove(i)}>Remove field</button>
          </div>
        );
      })}
      <button type="button" className="btn btn-ghost btn-sm" onClick={add}>+ Add field</button>
      {typeId !== undefined && <OptionStatusPanel typeId={typeId} fields={rows} />}
    </div>
  );
}

type OptionRow = { id: number; fieldKey: string; value: string; status: string; usage: number };
const STATUS_BADGE: Record<string, string> = { current: 'badge badge-green', outdated: 'badge badge-amber', eol: 'badge badge-red' };

/** Status (current / outdated / EOL) and usage of each SAVED fixed-list option. A status change is
 *  saved at once and changes "outdated technology" results immediately — no site needs editing.
 *  An option still in use can't be removed from the list (the API answers 409). */
function OptionStatusPanel({ typeId, fields }: { typeId: number; fields: IntegrationTypeField[] }) {
  const qc = useQueryClient();
  const toast = useToast();
  const key = ['integration-type-options', typeId];
  const { data = [] } = useQuery({ queryKey: key, queryFn: async () => (await api.get(`/infra/integration-types/${typeId}/options`)).data as OptionRow[] });
  const set = useMutation({
    mutationFn: (o: { id: number; status: string }) => api.patch(`/infra/integration-types/${typeId}/options/${o.id}`, { status: o.status }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: key }); qc.invalidateQueries({ queryKey: ['/infra/integrations'] }); toast.notify('Status saved'); },
    onError: (e) => toast.error(apiErr(e)),
  });
  if (!data.length) return null;
  const labelOf = (k: string) => fields.find((f) => f.key === k)?.label || k;
  const byField = new Map<string, OptionRow[]>();
  for (const o of data) byField.set(o.fieldKey, [...(byField.get(o.fieldKey) ?? []), o]);
  return (
    <div className="card" style={{ padding: 10 }}>
      <strong style={{ fontSize: 13 }}>Option status</strong>
      <div className="muted" style={{ fontSize: 12, margin: '2px 0 6px' }}>Saved options only — save the type to add new ones. Outdated / EOL values make an environment show up under "outdated technology".</div>
      {[...byField.entries()].map(([fieldKey, opts]) => (
        <div key={fieldKey} style={{ marginTop: 6 }}>
          <div style={{ fontSize: 12.5, fontWeight: 600 }}>{labelOf(fieldKey)}</div>
          {opts.map((o) => (
            <div key={o.id} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, margin: '3px 0' }}>
              <span style={{ minWidth: 110 }}>{o.value}</span>
              <span className={STATUS_BADGE[o.status] ?? 'badge badge-gray'}>{o.status}</span>
              <select className="input" style={{ width: 130 }} value={o.status} disabled={set.isPending}
                onChange={(e) => set.mutate({ id: o.id, status: e.target.value })} aria-label={`Status of ${o.value}`}>
                <option value="current">current</option>
                <option value="outdated">outdated</option>
                <option value="eol">EOL</option>
              </select>
              <span className="muted" style={{ fontSize: 12 }}>{o.usage ? `in use by ${o.usage}` : 'not used'}</span>
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}

export function FieldInput({ field: f, value, onChange }: { field: FieldDef; value: unknown; onChange: (v: unknown) => void }) {
  const t = (x?: string) => (x === 'email' ? 'email' : x === 'datetime-local' ? 'datetime-local' : x === 'date' ? 'date' : x === 'number' ? 'number' : 'text');
  if (f.type === 'textarea') return <textarea className="input" rows={3} value={(value as string) ?? ''} onChange={(e) => onChange(e.target.value)} />;
  if (f.type === 'select') return (
    <select className="input" value={(value as string) ?? ''} onChange={(e) => onChange(e.target.value)}>
      <option value="">—</option>
      {f.options?.map((o) => <option key={o} value={o}>{o}</option>)}
    </select>
  );
  if (f.type === 'ref') return <RefSelect field={f} value={value} onChange={onChange} />;
  if (f.type === 'multiref') {
    return <MultiRefSelect endpoint={f.refEndpoint as string} labelKey={f.refLabel ?? 'name'} value={Array.isArray(value) ? (value as number[]) : []} onChange={onChange} placeholder="search…" />;
  }
  if (f.type === 'file') return <FileField value={value} onChange={onChange} />;
  if (f.type === 'field-defs') return <FieldDefsEditor value={value} onChange={onChange} />;
  if (f.type === 'checkbox') return <div style={{ paddingTop: 6 }}><input type="checkbox" checked={!!value} onChange={(e) => onChange(e.target.checked)} /></div>;
  // text input — with an optional autocomplete list of previously-used values (avoids duplicate keys)
  const listId = f.suggestions && f.suggestions.length ? `dl-${f.name}` : undefined;
  return (
    <>
      <input
        className="input"
        type={t(f.type)}
        list={listId}
        value={(value as string | number) ?? ''}
        onChange={(e) => onChange(f.type === 'number' ? Number(e.target.value) : e.target.value)}
      />
      {listId && <datalist id={listId}>{f.suggestions!.map((s) => <option key={s} value={s} />)}</datalist>}
    </>
  );
}

export function RecordForm({ fields, value, onChange }: { fields: FieldDef[]; value: V; onChange: (name: string, v: unknown) => void }) {
  const visible = fields.filter((f) => !f.showWhen || f.showWhen.in.includes(String(value[f.showWhen.field] ?? '')));
  return (
    <div className="grid-2">
      {visible.map((f) => (
        <div key={f.name} className={'field' + (f.type === 'textarea' || f.type === 'file' || f.type === 'field-defs' || f.type === 'multiref' ? ' col-span' : '')}>
          <label>{f.label}</label>
          <FieldInput field={f} value={value[f.name]} onChange={(v) => onChange(f.name, v)} />
        </div>
      ))}
    </div>
  );
}
