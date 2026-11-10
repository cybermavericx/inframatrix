import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api';
import type { FieldDef } from '../modules/resources';
import { useToast } from './Toast';

// Mass edit (phase 4): set one field to one value on the selected records. Preview first (the API's
// dry run: how many change, which can't take the value), then confirm; the API writes every record
// in ONE transaction through the resource's own update rules — any failure changes nothing.

type Report = {
  field: string; total: number; changing: number; unchanged: number;
  missing: number[]; invalid: { id: number; message: string }[]; sample: { id: number; from: unknown; to: unknown }[];
  updated?: number;
};
type Special = { path: string; label: string; kind: string; options?: string[] };

const apiMsg = (e: unknown) => {
  const d = (e as { response?: { data?: { message?: string | string[] } & Partial<Report> } }).response?.data;
  return { msg: [d?.message ?? 'Request failed'].flat().join(', '), report: d && 'total' in d ? (d as Report) : null };
};
const show = (v: unknown) => (v === null || v === undefined || v === '' ? '(empty)' : typeof v === 'boolean' ? (v ? 'Yes' : 'No') : String(v));

export function MassEditModal({ resource, ids, fields, invalidate, onClose, onDone }: {
  resource: string;
  ids: number[];
  /** the list's own form fields — what a user can edit one record at a time */
  fields: FieldDef[];
  /** query keys to refresh after a successful write */
  invalidate: unknown[][];
  onClose: () => void;
  onDone: () => void;
}) {
  const qc = useQueryClient();
  const toast = useToast();
  const editable = fields.filter((f) => f.type !== 'file' && !f.showWhen && !/Ids$/.test(f.name));
  // technology fields (environments): from the same /fields endpoint the Filter panel uses
  const meta = useQuery({
    queryKey: ['data-fields', resource, ''],
    staleTime: 60_000,
    queryFn: async () => (await api.get(`/data/${resource}/fields`)).data as { special?: Special[]; massEdit?: boolean },
  });
  const special = (meta.data?.special ?? []).filter((s) => s.path.startsWith('cf:'));
  const [path, setPath] = useState('');
  const [value, setValue] = useState<unknown>('');
  const [report, setReport] = useState<Report | null>(null);
  const [error, setError] = useState('');

  const field = editable.find((f) => f.name === path);
  const sp = special.find((s) => s.path === path);
  const refs = useQuery({
    queryKey: [field?.refEndpoint ?? 'none'],
    enabled: !!field?.refEndpoint,
    queryFn: async () => (await api.get(field!.refEndpoint!)).data as Record<string, unknown>[],
  });

  const body = (dryRun: boolean) => ({ ids, path, value: field?.type === 'checkbox' ? value === true : value === '' ? null : value, dryRun });
  const preview = useMutation({
    mutationFn: async () => (await api.post(`/data/${resource}/mass-edit`, body(true))).data as Report,
    onSuccess: (r) => { setReport(r); setError(''); },
    onError: (e) => { const x = apiMsg(e); setError(x.msg); setReport(x.report); },
  });
  const apply = useMutation({
    mutationFn: async () => (await api.post(`/data/${resource}/mass-edit`, body(false))).data as Report,
    onSuccess: (r) => {
      for (const k of invalidate) qc.invalidateQueries({ queryKey: k });
      qc.invalidateQueries({ queryKey: ['search-ids'] });
      toast.notify(`${r.updated ?? 0} record(s) updated`);
      onDone();
    },
    onError: (e) => { const x = apiMsg(e); setError(x.msg); if (x.report) setReport(x.report); },
  });

  const pick = (p: string) => { setPath(p); setValue(''); setReport(null); setError(''); };
  const blocked = !!report && (report.missing.length > 0 || report.invalid.length > 0);

  const input = () => {
    if (!path) return null;
    const set = (v: unknown) => { setValue(v); setReport(null); setError(''); };
    if (sp) {
      if (sp.options?.length) return (
        <select className="input" value={String(value)} onChange={(e) => set(e.target.value)}>
          <option value="">(empty — clear the value)</option>{sp.options.map((o) => <option key={o} value={o}>{o}</option>)}
        </select>
      );
      return <input className="input" value={String(value)} placeholder={sp.kind === 'version' ? 'e.g. 8.3.36' : ''} onChange={(e) => set(e.target.value)} />;
    }
    if (!field) return null;
    if (field.type === 'checkbox') return <label style={{ display: 'flex', gap: 6 }}><input type="checkbox" checked={value === true} onChange={(e) => set(e.target.checked)} /> {field.label}</label>;
    if (field.type === 'select') return (
      <select className="input" value={String(value)} onChange={(e) => set(e.target.value)}>
        <option value="">(empty)</option>{(field.options ?? []).map((o) => <option key={o} value={o}>{o}</option>)}
      </select>
    );
    if (field.type === 'ref') return (
      <select className="input" value={String(value)} onChange={(e) => set(e.target.value === '' ? '' : Number(e.target.value))}>
        <option value="">(none)</option>
        {(refs.data ?? []).map((r) => <option key={String(r.id)} value={String(r.id)}>{String(r[field.refLabel ?? 'name'] ?? r.id)}</option>)}
      </select>
    );
    if (field.type === 'textarea') return <textarea className="input" rows={3} value={String(value)} onChange={(e) => set(e.target.value)} />;
    const type = field.type === 'date' ? 'date' : field.type === 'number' ? 'number' : 'text';
    return <input className="input" type={type} value={String(value)} onChange={(e) => set(type === 'number' && e.target.value !== '' ? Number(e.target.value) : e.target.value)} />;
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 640 }}>
        <div className="card-body">
          <h3 style={{ marginTop: 0 }}>Mass edit {ids.length} record(s)</h3>
          <div className="field">
            <label>Field</label>
            <select className="input" value={path} onChange={(e) => pick(e.target.value)}>
              <option value="">Choose a field…</option>
              {editable.map((f) => <option key={f.name} value={f.name}>{f.label}</option>)}
              {special.length > 0 && <optgroup label="Technology">{special.map((s) => <option key={s.path} value={s.path}>{s.label}</option>)}</optgroup>}
            </select>
          </div>
          {path && <div className="field" style={{ marginTop: 8 }}><label>New value</label>{input()}</div>}

          {report && (
            <div className="card" style={{ padding: 10, marginTop: 12, fontSize: 13.5 }}>
              <div><strong>{report.changing}</strong> will change · {report.unchanged} already have this value
                {report.missing.length > 0 && <> · <span className="error-text">{report.missing.length} not found</span></>}
                {report.invalid.length > 0 && <> · <span className="error-text">{report.invalid.length} can't take it</span></>}
              </div>
              {report.invalid.slice(0, 8).map((x) => <div key={x.id} className="error-text" style={{ fontSize: 12.5 }}>#{x.id}: {x.message}</div>)}
              {report.sample.length > 0 && (
                <div className="muted" style={{ fontSize: 12.5, marginTop: 4 }}>
                  e.g. {report.sample.slice(0, 5).map((s) => `#${s.id}: ${show(s.from)} → ${show(s.to)}`).join(' · ')}
                </div>
              )}
              {blocked && <div className="error-text" style={{ marginTop: 4 }}>Nothing will be changed until every selected record can take the value — unselect the ones listed.</div>}
            </div>
          )}
          {error && !report && <div className="error-text" style={{ marginTop: 10 }}>{error}</div>}
          {error && report && !blocked && <div className="error-text" style={{ marginTop: 10 }}>{error}</div>}

          <div style={{ marginTop: 16, display: 'flex', gap: 8 }}>
            <button className="btn btn-ghost" disabled={!path || preview.isPending} onClick={() => preview.mutate()}>Preview</button>
            <button className="btn btn-primary" disabled={!report || blocked || report.changing === 0 || apply.isPending}
              onClick={() => { if (confirm(`Set ${report!.field} on ${report!.changing} record(s)? This is one change — all or nothing.`)) apply.mutate(); }}>
              {apply.isPending ? 'Saving…' : `Apply to ${report?.changing ?? 0}`}
            </button>
            <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
          </div>
        </div>
      </div>
    </div>
  );
}
