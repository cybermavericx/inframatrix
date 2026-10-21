import { Fragment, useEffect, useRef, useState, type ChangeEvent } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api';
import { useAuth } from '../auth/AuthContext';
import { RecordForm, cleanPayload } from '../components/RecordForm';
import { useListView, getPath } from '../hooks/useListView';
import { ListToolbar } from '../components/ListToolbar';
import { RecordDetail } from '../components/RecordDetail';
import { ExportPicker } from '../components/ExportPicker';
import { useToast } from '../components/Toast';
import type { RelatedPanelDef } from '../components/RelatedPanel';
import type { FieldDef } from '../modules/resources';
import { computeFieldFlags, computeIntegrationFlags, type IntegrationTypeField } from '../lib/integrationFlags';

type Row = Record<string, unknown>;

function apiErr(e: unknown) {
  const ax = e as { response?: { data?: { message?: string | string[]; reasons?: string[] } } };
  const d = ax.response?.data;
  if (d?.reasons?.length) return `${d.message ?? 'Not allowed'}\n• ${d.reasons.join('\n• ')}`;
  const m = d?.message;
  return Array.isArray(m) ? m.join(', ') : (m ?? 'Request failed');
}

const projectFields: FieldDef[] = [
  { name: 'name', label: 'Name' },
  { name: 'status', label: 'Status', type: 'select', options: ['active', 'on_hold', 'archived'] },
  { name: 'pocUserId', label: 'Point of Contact', type: 'ref', refEndpoint: '/users/lookup', refLabel: 'name', refRelKey: 'poc' },
  // any number of developers, picked from the Users list (the API keeps them in a join table)
  { name: 'developerIds', label: 'Developers', type: 'multiref', refEndpoint: '/users/lookup', refLabel: 'name', refRelKey: 'developers' },
  { name: 'amcStatus', label: 'AMC status', type: 'select', options: ['active', 'inactive', 'internal'] },
  { name: 'amcFrom', label: 'AMC from', type: 'date' },
  { name: 'amcTo', label: 'AMC to', type: 'date' },
  { name: 'notes', label: 'Notes', type: 'textarea' },
];
// Columns shown in the Projects list (key = dot-path into the row; label = header text).
const PROJECT_COLS = [
  { key: 'name', label: 'Name' },
  { key: 'status', label: 'Status' },
  { key: 'poc.name', label: 'POC' },
  { key: 'publishState', label: 'State' },
] as const;
// Per-environment hosting summary the list API now attaches to each project (server name + IP),
// so "where / how is this hosted" is answerable from the list without drilling into each server.
type HostingItem = { envId: number; type: string; url: string | null; server: string | null; serverIp: string | null; provider: string | null };
// Filter-only fields that reach into the project's environments + integrations (their OWN tables,
// aggregated by the list API into arrays). The Filter matches a project if ANY child matches — so
// you can ask "projects whose environment URL contains example.com", "projects having SendGrid",
// or "projects with Technology = php 8.3" from the Projects list itself.
const PROJECT_FILTER_EXTRAS: FieldDef[] = [
  // grouped under drill-in "relations" in the Odoo-style filter picker (Environments ▸ / Integrations ▸)
  { name: 'envUrls', label: 'URL', group: 'Environments' },
  { name: 'envTypes', label: 'Type', group: 'Environments' },
  { name: 'envServers', label: 'Server', group: 'Environments' },
  { name: 'integrationTypes', label: 'Type', group: 'Integrations' },
  { name: 'integrationKeys', label: 'Key', group: 'Integrations' },
  { name: 'integrationValues', label: 'Value', group: 'Integrations' },
  // Combined "<type> <key> <value>" per integration — use one "contains" rule for a precise
  // same-integration match (e.g. all PHP 8.x hostings → contains "php 8").
  { name: 'integrationDetails', label: 'Type · key · value', group: 'Integrations' },
  // array of the project's developer names → "projects where a developer is X"
  { name: 'developerNames', label: 'Developers' },
];
const PROJECT_COLSPAN = 8; // checkbox + 4 cols + Developers + Hosting + actions
const envFields: FieldDef[] = [
  { name: 'type', label: 'Type', type: 'select', options: ['staging', 'uat', 'live'] },
  { name: 'url', label: 'URL' },
  { name: 'serverId', label: 'Server', type: 'ref', refEndpoint: '/infra/servers', refLabel: 'serverName' },
  { name: 'gitProviderId', label: 'Git provider', type: 'ref', refEndpoint: '/infra/git-providers', refLabel: 'name' },
  { name: 'repoUrl', label: 'Repo URL' },
  { name: 'repoBranch', label: 'Repo branch' },
  { name: 'cicdStatus', label: 'CI/CD', type: 'select', options: ['auto', 'manual', 'disabled'] },
  { name: 'cicdNotConfiguredReason', label: 'CI/CD reason (no repo connected)', type: 'textarea', showWhen: { field: 'cicdStatus', in: ['disabled'] } },
  { name: 'checklistCompleted', label: 'Go-live checklist completed', type: 'checkbox' },
  { name: 'checklistAttachment', label: 'Checklist document', type: 'file' },
  { name: 'checklistNotCompletedReason', label: 'Checklist not-completed reason', type: 'textarea' },
  { name: 'checklistSubmittedById', label: 'Checklist submitted by', type: 'ref', refEndpoint: '/users/lookup', refLabel: 'name' },
  { name: 'checklistSubmittedDate', label: 'Checklist submitted date', type: 'date' },
  { name: 'checklistSubmittedVersion', label: 'Checklist version' },
];
// Reminders/notes can be attached to a project / environment (the "+ Add anything" pattern) — shown
// in their read-only View. The parentType matches the polymorphic reminder/note records.
const ENV_PANELS: RelatedPanelDef[] = [
  { title: 'Tags', kind: 'tags' },
  { title: 'Reminders', kind: 'reminders' },
  { title: 'Notes', kind: 'notes' },
  { title: 'Activity', kind: 'activity' },
];
const PROJECT_PANELS: RelatedPanelDef[] = ENV_PANELS;
const intFields: FieldDef[] = [
  { name: 'integrationTypeId', label: 'Integration type', type: 'ref', refEndpoint: '/infra/integration-types', refLabel: 'name' },
  { name: 'accountId', label: 'Account', type: 'ref', refEndpoint: '/infra/accounts', refLabel: 'accountName' },
  { name: 'value', label: 'Identifier / Config ID' },
  { name: 'keyName', label: 'Key name' },
];

const stateBadge = (s: string) => (s === 'published' ? 'badge badge-green' : s === 'ready' ? 'badge badge-blue' : 'badge badge-amber');

/* ---------------- Integrations (inside an environment) ---------------- */
function IntegrationsManager({ environmentId, canEdit }: { environmentId: number; canEdit: boolean }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [editing, setEditing] = useState<Row | null>(null);
  const { data: all = [] } = useQuery({ queryKey: ['/infra/integrations'], queryFn: async () => (await api.get('/infra/integrations')).data as Row[] });
  const { data: types = [] } = useQuery({ queryKey: ['/infra/integration-types'], queryFn: async () => (await api.get('/infra/integration-types')).data as Row[], staleTime: 60_000 });
  const rows = all.filter((r) => r.environmentId === environmentId);

  // The integration type's `behavior` decides which field(s) apply:
  //   generic_value           → a single free-text Identifier / Config ID
  //   key_value               → a Key name + a Value
  //   account_select_optional → pick an Account
  //   custom_fields           → one input per the type's own field defs (e.g. CMS Access's Login URL/Name),
  //                             each validated against its possible/avoidable value lists (warn-only)
  const behaviorOf = (typeId: unknown) => String(types.find((t) => t.id === typeId)?.behavior ?? '');
  const fieldsOf = (typeId: unknown): IntegrationTypeField[] => (types.find((t) => t.id === typeId)?.fields as IntegrationTypeField[] | undefined) ?? [];
  const behavior = editing ? behaviorOf(editing.integrationTypeId) : '';
  const customFields = editing ? fieldsOf(editing.integrationTypeId) : [];
  // Distinct prior entries for this integration type (across all projects/environments) so the
  // same key/identifier is reused instead of re-typed differently ("server location" vs "ServerLocation").
  const distinctFor = (field: string) => editing
    ? [...new Set(all
        .filter((r) => r.integrationTypeId === editing.integrationTypeId && r[field] != null && String(r[field]).trim() !== '')
        .map((r) => String(r[field])))].sort()
    : [];
  const keyField: FieldDef = { ...intFields[3], suggestions: distinctFor('keyName') };
  const valueField: FieldDef = { ...intFields[2], suggestions: distinctFor('value') };
  const intFormFields: FieldDef[] = [intFields[0]];
  if (behavior === 'account_select_optional') intFormFields.push(intFields[1]);
  else if (behavior === 'key_value') intFormFields.push(keyField, intFields[2]);
  else if (behavior === 'generic_value') intFormFields.push(valueField);

  const save = useMutation({
    mutationFn: (row: Row) => {
      // null out fields that do not apply to this behavior so stale values are not saved
      const b = behaviorOf(row.integrationTypeId);
      const clear = b === 'account_select_optional' ? { value: null, keyName: null, fieldValues: null }
        : b === 'key_value' ? { accountId: null, fieldValues: null }
        : b === 'custom_fields' ? { accountId: null, keyName: null, value: null }
        : { accountId: null, keyName: null, fieldValues: null }; // generic_value
      const norm = { ...row, environmentId, ...clear };
      const p = cleanPayload(norm, intFields);
      return row.id ? api.patch(`/infra/integrations/${row.id}`, p) : api.post('/infra/integrations', p);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['/infra/integrations'] });
      qc.invalidateQueries({ queryKey: ['readiness'] });
      qc.invalidateQueries({ queryKey: ['/infra/projects'] });
      setEditing(null);
      toast.notify('Integration saved');
    },
    onError: (e) => toast.error(apiErr(e)),
  });
  const del = useMutation({ mutationFn: (id: unknown) => api.delete(`/infra/integrations/${id}`), onSuccess: () => {
    qc.invalidateQueries({ queryKey: ['/infra/integrations'] });
    qc.invalidateQueries({ queryKey: ['readiness'] });
    qc.invalidateQueries({ queryKey: ['/infra/projects'] });
    toast.notify('Integration deleted');
  }, onError: (e) => toast.error(apiErr(e)) });

  return (
    <div style={{ marginTop: 10, paddingLeft: 12, borderLeft: '2px solid var(--border)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <strong style={{ fontSize: 12.5 }}>Integrations</strong>
        {canEdit && <button type="button" className="btn btn-ghost btn-sm" onClick={() => setEditing({})}>+ Add</button>}
      </div>
      {rows.map((r) => {
        const rType = r.integrationType as Row | undefined;
        const isCustom = rType?.behavior === 'custom_fields';
        const rFields = (rType?.fields as IntegrationTypeField[] | undefined) ?? [];
        const rValues = (r.fieldValues as Record<string, string> | undefined) ?? {};
        const summary = isCustom
          ? rFields.map((f) => `${f.label}: ${rValues[f.key] ?? ''}`).filter((s) => !s.endsWith(': ')).join(', ')
          : String(r.keyName ? `${r.keyName}: ${r.value ?? ''}` : (r.value ?? (r.account as Row)?.accountName ?? ''));
        const flags = isCustom ? computeIntegrationFlags(rFields, rValues) : [];
        return (
          <div key={String(r.id)} style={{ fontSize: 13, margin: '4px 0', display: 'flex', gap: 8, alignItems: 'center' }}>
            <span>{String(rType?.name ?? '—')} — {summary}</span>
            {flags.length > 0 && <span title={flags.join('\n')} className="error-text" style={{ cursor: 'help' }}>⚠ {flags.length}</span>}
            {canEdit && <button type="button" className="btn btn-ghost btn-sm" onClick={() => setEditing({ ...r })}>edit</button>}
            {canEdit && <button type="button" className="btn btn-danger btn-sm" disabled={del.isPending} onClick={() => { if (confirm('Delete this integration?')) del.mutate(r.id); }}>del</button>}
          </div>
        );
      })}
      {editing && (
        <div className="card" style={{ marginTop: 8 }}>
          <div className="card-body">
            <RecordForm fields={intFormFields} value={editing} onChange={(n, v) => setEditing((p) => ({ ...(p ?? {}), [n]: v }))} />
            {behavior === 'custom_fields' && customFields.map((cf) => {
              const val = (editing.fieldValues as Record<string, string> | undefined)?.[cf.key] ?? '';
              const flags = computeFieldFlags(cf, val);
              const listId = `cf-${cf.key}`;
              return (
                <div key={cf.key} className="field" style={{ marginTop: 8 }}>
                  <label>{cf.label}</label>
                  <input
                    className="input"
                    list={cf.possibleValues?.length ? listId : undefined}
                    value={val}
                    onChange={(e) => setEditing((p) => ({ ...(p ?? {}), fieldValues: { ...((p?.fieldValues as Row) ?? {}), [cf.key]: e.target.value } }))}
                  />
                  {cf.possibleValues?.length ? <datalist id={listId}>{cf.possibleValues.map((s) => <option key={s} value={s} />)}</datalist> : null}
                  {flags.map((msg) => <div key={msg} className="error-text" style={{ fontSize: 12, marginTop: 2 }}>⚠ {msg}</div>)}
                </div>
              );
            })}
            <button type="button" className="btn btn-primary btn-sm" style={{ marginTop: 8 }} onClick={() => save.mutate(editing)}>Save</button>
            <button type="button" className="btn btn-ghost btn-sm" style={{ marginLeft: 6 }} onClick={() => setEditing(null)}>Cancel</button>
          </div>
        </div>
      )}
    </div>
  );
}

/* ---------------- Environments (inside a project) ---------------- */
function EnvironmentsManager({ projectId, canEdit }: { projectId: number; canEdit: boolean }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [editing, setEditing] = useState<Row | null>(null);
  const [viewing, setViewing] = useState<Row | null>(null);
  const { data: all = [] } = useQuery({ queryKey: ['/infra/environments'], queryFn: async () => (await api.get('/infra/environments')).data as Row[] });
  const rows = all.filter((r) => r.projectId === projectId);

  const save = useMutation({
    mutationFn: (row: Row) => {
      const p = cleanPayload({ ...row, projectId }, envFields);
      return row.id ? api.patch(`/infra/environments/${row.id}`, p) : api.post('/infra/environments', p);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['/infra/environments'] });
      qc.invalidateQueries({ queryKey: ['readiness'] });
      qc.invalidateQueries({ queryKey: ['/infra/projects'] });
      setEditing(null);
      toast.notify('Environment saved');
    },
    onError: (e) => toast.error(apiErr(e)),
  });
  const del = useMutation({ mutationFn: (id: unknown) => api.delete(`/infra/environments/${id}`), onSuccess: () => {
    qc.invalidateQueries({ queryKey: ['/infra/environments'] });
    qc.invalidateQueries({ queryKey: ['readiness'] });
    qc.invalidateQueries({ queryKey: ['/infra/projects'] });
    toast.notify('Environment deleted');
  }, onError: (e) => toast.error(apiErr(e)) });

  // Block save when the go-live checklist is marked completed but its details are incomplete.
  const trySave = (row: Row) => {
    if (row.checklistCompleted) {
      const missing: string[] = [];
      if (!row.checklistAttachment) missing.push('document');
      if (!row.checklistSubmittedById) missing.push('submitted by');
      if (!row.checklistSubmittedDate) missing.push('submitted date');
      if (!row.checklistSubmittedVersion) missing.push('version');
      if (missing.length) {
        alert(`The go-live checklist is marked as completed but is missing: ${missing.join(', ')}.\n\nPlease fill these before saving (or untick "checklist completed").`);
        return;
      }
    }
    save.mutate(row);
  };

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', marginBottom: 10 }}>
        <h3 style={{ margin: 0 }}>Environments</h3>
        {canEdit && <button type="button" className="btn btn-primary btn-sm" style={{ marginLeft: 'auto' }} onClick={() => setEditing({})}>+ Add environment</button>}
      </div>

      {rows.length === 0 && !editing && <p className="muted">No environments yet.</p>}

      {rows.map((env) => (
        <div key={String(env.id)} className="card" style={{ marginBottom: 12 }}>
          <div className="card-body">
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8, flexWrap: 'wrap' }}>
              <span className="badge badge-blue">{String(env.type ?? 'env')}</span>
              <strong>{String(env.url ?? '(no url)')}</strong>
              {env.server ? <span className="muted" style={{ fontSize: 12.5 }}>{String((env.server as Row).serverName ?? '')}</span> : null}
              {(env.server as Row | undefined)?.publicIp ? (
                <>
                  <span style={{ fontFamily: 'monospace', color: 'var(--primary-2)', fontSize: 12.5 }}>{String((env.server as Row).publicIp)}</span>
                  <button type="button" className="btn btn-ghost btn-sm" style={{ padding: '0 6px', fontSize: 11.5 }} title="Copy server IP"
                    onClick={() => navigator.clipboard?.writeText(String((env.server as Row).publicIp))}>Copy IP</button>
                </>
              ) : null}
              <span style={{ marginLeft: 'auto' }} />
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => setViewing({ ...env })}>View</button>
              {canEdit && <button type="button" className="btn btn-ghost btn-sm" onClick={() => setEditing(editing && editing.id === env.id ? null : { ...env })}>{editing && editing.id === env.id ? 'Close' : 'Edit'}</button>}
              {canEdit && <button type="button" className="btn btn-danger btn-sm" onClick={() => { if (confirm('Delete this environment?')) del.mutate(env.id); }}>Delete</button>}
            </div>
            {editing && editing.id === env.id && (
              <>
                <RecordForm fields={envFields} value={editing} onChange={(n, v) => setEditing((p) => ({ ...(p ?? {}), [n]: v }))} />
                <button type="button" className="btn btn-primary btn-sm" onClick={() => trySave(editing)}>Save environment</button>
              </>
            )}
            <IntegrationsManager environmentId={env.id as number} canEdit={canEdit} />
          </div>
        </div>
      ))}

      {editing && !editing.id && (
        <div className="card" style={{ marginBottom: 12 }}>
          <div className="card-body">
            <h3 style={{ marginTop: 0 }}>New environment</h3>
            <RecordForm fields={envFields} value={editing} onChange={(n, v) => setEditing((p) => ({ ...(p ?? {}), [n]: v }))} />
            <button type="button" className="btn btn-primary btn-sm" onClick={() => trySave(editing)}>Add environment</button>
            <button type="button" className="btn btn-ghost btn-sm" style={{ marginLeft: 6 }} onClick={() => setEditing(null)}>Cancel</button>
          </div>
        </div>
      )}

      {viewing && (
        <RecordDetail
          title="Environment"
          fields={envFields}
          record={viewing}
          relatedPanels={ENV_PANELS}
          parentType="environment"
          parentLabel={String(viewing.url ?? viewing.type ?? `#${viewing.id}`)}
          canEdit={canEdit}
          onEdit={() => { setEditing({ ...viewing }); setViewing(null); }}
          onClose={() => setViewing(null)}
        />
      )}
    </div>
  );
}

/* ---------------- Project editor (tabs) ---------------- */
function ProjectEditor({ initial, canEdit, onClose, initialTab = 'overview' }: { initial: Row; canEdit: boolean; onClose: () => void; initialTab?: 'overview' | 'environments' }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [proj, setProj] = useState<Row>(initial);
  const [tab, setTab] = useState<'overview' | 'environments'>(initialTab);
  const [err, setErr] = useState('');
  const id = proj.id as number | undefined;

  const { data: reasons = [], isSuccess: readinessLoaded } = useQuery({
    queryKey: ['readiness', id],
    queryFn: async () => (await api.get(`/infra/projects/${id}/readiness`)).data as string[],
    enabled: !!id,
  });
  const isPublished = !!proj.isPublished;
  // Only treat a project as "ready" once the readiness check has actually returned with
  // zero blocking reasons. While it is loading or has errored we default to "draft" so the
  // Publish button stays disabled (never enable Publish on an unknown/incomplete project).
  const isReady = readinessLoaded && reasons.length === 0;
  const state = isPublished ? 'published' : isReady ? 'ready' : 'draft';

  const save = useMutation({
    mutationFn: () => {
      const p = cleanPayload(proj, projectFields);
      return id ? api.patch(`/infra/projects/${id}`, p) : api.post('/infra/projects', p);
    },
    onSuccess: (r) => { setProj(r.data); setErr(''); qc.invalidateQueries({ queryKey: ['/infra/projects'] }); toast.notify('Project saved'); },
    onError: (e) => { setErr(apiErr(e)); toast.error('Could not save project'); },
  });
  const publish = useMutation({
    mutationFn: () => api.post(`/infra/projects/${id}/publish`, {}),
    onSuccess: (r) => { setProj(r.data); qc.invalidateQueries({ queryKey: ['/infra/projects'] }); qc.invalidateQueries({ queryKey: ['readiness', id] }); toast.notify('Project published'); },
    onError: (e) => toast.error(apiErr(e)),
  });
  const revert = useMutation({
    mutationFn: () => api.post(`/infra/projects/${id}/revert`, {}),
    onSuccess: (r) => { setProj(r.data); qc.invalidateQueries({ queryKey: ['/infra/projects'] }); qc.invalidateQueries({ queryKey: ['readiness', id] }); toast.notify('Reverted to draft'); },
    onError: (e) => toast.error(apiErr(e)),
  });

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()} style={{ width: 'min(920px, 100%)' }}>
      <div className="card-body">
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <h3 style={{ margin: 0 }}>{id ? 'Edit project' : 'New project'}</h3>
          {id && <span className={stateBadge(state)}>{state}</span>}
          <div style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
            {id && canEdit && !isPublished && <button className="btn btn-primary btn-sm" disabled={state !== 'ready' || publish.isPending} title={state !== 'ready' ? 'Complete required fields to publish' : ''} onClick={() => publish.mutate()}>{publish.isPending ? 'Publishing…' : 'Publish'}</button>}
            {id && canEdit && isPublished && <button className="btn btn-ghost btn-sm" disabled={revert.isPending} onClick={() => { if (confirm('Revert to draft?')) revert.mutate(); }}>Revert to Draft</button>}
            <button className="btn btn-ghost btn-sm" onClick={onClose}>Close</button>
          </div>
        </div>

        {id && state === 'draft' && reasons.length > 0 && (
          <div className="error-text" style={{ whiteSpace: 'pre-line', marginTop: 8 }}>{`Draft — incomplete:\n• ${reasons.join('\n• ')}`}</div>
        )}

        <div className="tabs" style={{ margin: '14px 0' }}>
          <button type="button" className={'tab' + (tab === 'overview' ? ' active' : '')} onClick={() => setTab('overview')}>Overview</button>
          <button type="button" className={'tab' + (tab === 'environments' ? ' active' : '')} onClick={() => setTab('environments')}>Environments</button>
        </div>

        {tab === 'overview' ? (
          <>
            <RecordForm fields={projectFields} value={proj} onChange={(n, v) => setProj((p) => ({ ...p, [n]: v }))} />
            {err && <div className="error-text">{err}</div>}
            {canEdit && <button className="btn btn-primary" onClick={() => save.mutate()} disabled={save.isPending}>{save.isPending ? 'Saving…' : 'Save project'}</button>}
          </>
        ) : id ? (
          <EnvironmentsManager projectId={id} canEdit={canEdit} />
        ) : (
          <p className="muted">Save the project first, then add its environments here.</p>
        )}
      </div>
      </div>
    </div>
  );
}

/* ---------------- Page (list) ---------------- */
export default function ProjectsPage() {
  const { ability } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();
  const qc = useQueryClient();
  const toast = useToast();
  const canRead = ability.can('read', 'infra.projects');
  const canCreate = ability.can('create', 'infra.projects');
  const canUpdate = ability.can('update', 'infra.projects');
  const canDelete = ability.can('delete', 'infra.projects');
  const [editing, setEditing] = useState<Row | null>(null);
  const [editorTab, setEditorTab] = useState<'overview' | 'environments'>('overview');
  const [viewing, setViewing] = useState<Row | null>(null);
  // Open the project editor (closing any open View), optionally straight on the Environments tab.
  const openProject = (row: Row, tab: 'overview' | 'environments' = 'overview') => { setEditorTab(tab); setEditing(row); setViewing(null); };

  const { data: rows = [] } = useQuery({
    queryKey: ['/infra/projects'],
    queryFn: async () => (await api.get('/infra/projects')).data as Row[],
    enabled: canRead,
  });
  // Deep-link support (?view=<id>, e.g. from a Dashboard drill-down row) — opens straight into that
  // project's Environments tab, then drops the param so a refresh doesn't re-open it.
  const viewId = searchParams.get('view');
  useEffect(() => {
    if (!viewId || !rows.length) return;
    const row = rows.find((r) => String(r.id) === viewId);
    if (row) {
      openProject(row, 'environments');
      setSearchParams((p) => { const n = new URLSearchParams(p); n.delete('view'); return n; }, { replace: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [viewId, rows]);
  const del = useMutation({ mutationFn: (id: unknown) => api.delete(`/infra/projects/${id}`), onSuccess: () => { qc.invalidateQueries({ queryKey: ['/infra/projects'] }); toast.notify('Project deleted'); }, onError: (e) => toast.error(apiErr(e)) });
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [exporting, setExporting] = useState(false);
  const bulk = useMutation({
    mutationFn: async ({ ids, kind }: { ids: string[]; kind: 'delete' | 'publish' | 'revert' }) => {
      const errs: string[] = [];
      for (const id of ids) {
        try {
          if (kind === 'delete') await api.delete(`/infra/projects/${id}`);
          else await api.post(`/infra/projects/${id}/${kind}`, {});
        } catch (e) { errs.push(`#${id}: ${apiErr(e)}`); }
      }
      if (errs.length) throw new Error(errs.join('\n'));
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['/infra/projects'] }); setSelected(new Set()); toast.notify('Done'); },
    onError: (e) => { qc.invalidateQueries({ queryKey: ['/infra/projects'] }); setSelected(new Set()); toast.error((e as Error).message); },
  });

  // Import still reads the Projects+Environments bundle shape when present (env rows link to the
  // project by name) but degrades gracefully to a plain single-sheet file otherwise -- see
  // importProjectsBundle's `wb.getWorksheet('Projects') ?? wb.worksheets[0]` fallback. That's what
  // makes it safe for Export to be just the one field-picker now: there's no separate bundle-export
  // button to keep in sync with it.
  const fileRef = useRef<HTMLInputElement>(null);
  const importBundle = async (e: ChangeEvent<HTMLInputElement>) => {
    const input = e.target;
    const f = input.files?.[0];
    if (!f) return;
    const fd = new FormData();
    fd.append('file', f);
    try {
      const r = await api.post('/data/bundle/projects/import', fd);
      const d = r.data;
      let m = `Imported — projects: ${d.detail?.projects?.created ?? 0} new / ${d.detail?.projects?.updated ?? 0} updated; environments: ${d.detail?.environments?.created ?? 0} new / ${d.detail?.environments?.updated ?? 0} updated`;
      if (d.skipped) m += `\n${d.skipped} row(s) skipped`;
      if (d.errors?.length) m += `\n\n${d.errors.join('\n')}`;
      toast.notify(m);
      qc.invalidateQueries({ queryKey: ['/infra/projects'] });
      qc.invalidateQueries({ queryKey: ['/infra/environments'] });
      qc.invalidateQueries({ queryKey: ['readiness'] });
    } catch (er) {
      toast.error('Import failed: ' + apiErr(er));
    }
    input.value = '';
  };

  if (!canRead) return <div className="card"><div className="card-body">You do not have access to Projects.</div></div>;

  // Same shared list control panel as every other screen — only the columns/fields differ.
  // publishState defaults to 'draft' (some rows have none) so filter/sort/group match what's shown.
  const listRows = rows.map((r) => ({ ...r, publishState: r.publishState ?? 'draft' }));

  // Optional column filters from the URL (e.g. /infra/projects?publishState=ready) — used by dashboard
  // drill-downs. Mirrors CrudPage's same mechanism, but array-aware (envTypes etc. are arrays per project).
  const filterEntries = [...searchParams.entries()].filter(([k]) => k !== 'view');
  const matchesFilter = (val: unknown, want: string) => Array.isArray(val)
    ? val.some((x) => String(x).toLowerCase() === want.toLowerCase())
    : String(val ?? '').toLowerCase() === want.toLowerCase();
  const urlFiltered = filterEntries.length
    ? listRows.filter((r) => filterEntries.every(([k, v]) => matchesFilter(getPath(r, k), v)))
    : listRows;

  const view = useListView({ rows: urlFiltered, columns: PROJECT_COLS.map((c) => c.key), fields: projectFields.filter((f) => f.name !== 'developerIds'), extraFilterFields: PROJECT_FILTER_EXTRAS });
  const { sort, onSort, groups, collapsedGroups, toggleGroup } = view;
  const filtered = view.rows;

  const allIds = filtered.map((r) => String(r.id));
  const allSel = allIds.length > 0 && allIds.every((id) => selected.has(id));
  const toggleAll = () => setSelected(allSel ? new Set() : new Set(allIds));
  const toggleOne = (id: string) => setSelected((p) => { const n = new Set(p); if (n.has(id)) n.delete(id); else n.add(id); return n; });

  // One project row — reused for the plain and the grouped (group-by) table bodies. The whole row
  // opens the project (any cell that isn't its own control does it too, via the tr's onClick) — the
  // Hosting cell keeps its own click as a shortcut straight into the Environments tab specifically;
  // every other interactive cell (checkbox, View/Open/Del) stops propagation so it doesn't also fire
  // the row-level open.
  const renderProjectRow = (p: Row) => {
    const hosting = (p.hosting as HostingItem[] | undefined) ?? [];
    return (
    <tr key={String(p.id)} onClick={() => openProject({ ...p })} style={{ cursor: 'pointer' }}>
      <td onClick={(e) => e.stopPropagation()}><input type="checkbox" checked={selected.has(String(p.id))} onChange={() => toggleOne(String(p.id))} /></td>
      <td>{String(p.name ?? '')}</td>
      <td>{String(p.status ?? '')}</td>
      <td>{String((p.poc as Row)?.name ?? '—')}</td>
      <td><span style={{ fontSize: 12.5 }}>{((p.developerNames as string[] | undefined) ?? []).join(', ') || '—'}</span></td>
      <td><span className={stateBadge(String(p.publishState ?? 'draft'))}>{String(p.publishState ?? 'draft')}</span></td>
      <td onClick={(e) => e.stopPropagation()}>
        {hosting.length === 0 ? <span className="muted" style={{ fontSize: 12.5 }}>—</span> : (
          <div title="Click to open the Environments tab" onClick={() => openProject({ ...p }, 'environments')}
            style={{ display: 'flex', flexDirection: 'column', gap: 4, cursor: 'pointer' }}>
            {hosting.map((h) => (
              <div key={h.envId} style={{ fontSize: 12.5, lineHeight: 1.5 }}>
                <span className="badge badge-blue" style={{ marginRight: 6 }}>{h.type}</span>
                {h.server ? <strong>{h.server}</strong> : <span className="muted">no server</span>}
                {h.serverIp ? <span style={{ marginLeft: 6, fontFamily: 'monospace', color: 'var(--primary-2)' }}>{h.serverIp}</span> : null}
                {h.url ? (
                  <>
                    <br />
                    <a href={h.url.startsWith('http') ? h.url : `https://${h.url}`} target="_blank" rel="noopener noreferrer"
                      onClick={(e) => e.stopPropagation()} style={{ color: 'var(--primary-2)' }}>{h.url}</a>
                  </>
                ) : null}
              </div>
            ))}
          </div>
        )}
      </td>
      <td onClick={(e) => e.stopPropagation()}>
        <button className="btn btn-ghost btn-sm" onClick={() => setViewing({ ...p })}>View</button>
        <button className="btn btn-ghost btn-sm" style={{ marginLeft: 6 }} onClick={() => openProject({ ...p })}>Open</button>
        {canDelete && <button className="btn btn-danger btn-sm" style={{ marginLeft: 6 }} onClick={() => { if (confirm('Delete this project?')) del.mutate(p.id); }}>Del</button>}
      </td>
    </tr>
    );
  };

  return (
    <div>
      <div className="page-head">
        <h1>Projects</h1>
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
          <button className="btn btn-ghost" onClick={() => setExporting(true)}>Export</button>
          {canCreate && <button className="btn btn-ghost" onClick={() => fileRef.current?.click()}>Import</button>}
          <input ref={fileRef} type="file" accept=".xlsx" hidden onChange={importBundle} />
          {canCreate && <button className="btn btn-primary" onClick={() => openProject({ status: 'active' })}>+ New project</button>}
        </div>
      </div>

      {exporting && (
        <ExportPicker resource="infra.projects" title="Projects"
          defaultFields={['name', 'status', 'poc.name', 'publishState']}
          ids={selected.size > 0 ? [...selected] : undefined}
          onClose={() => setExporting(false)} />
      )}

      {filterEntries.length > 0 && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, margin: '0 0 10px', flexWrap: 'wrap' }}>
          {filterEntries.map(([k, v]) => (
            <span key={k} className="badge badge-blue">{k}: {v || '(none)'}</span>
          ))}
          <span className="muted" style={{ fontSize: 12.5 }}>· {urlFiltered.length} of {rows.length}</span>
          <button className="btn btn-ghost btn-sm" onClick={() => setSearchParams({})}>Clear filter</button>
        </div>
      )}

      <ListToolbar view={view} placeholder="Search projects… (name, POC, server, IP, URL)" />

      {editing && <ProjectEditor initial={editing} canEdit={canUpdate || canCreate} onClose={() => setEditing(null)} initialTab={editorTab} />}

      {viewing && (
        <RecordDetail
          title="Project"
          fields={projectFields}
          record={viewing}
          child={{
            title: 'Environments',
            // The list API already attaches one hosting summary per environment (type/url/server/IP).
            rows: ((viewing.hosting as HostingItem[] | undefined) ?? []).map((h) => ({ id: h.envId, type: h.type, url: h.url, server: h.server, serverIp: h.serverIp })),
            label: 'type',
            meta: ['url', 'server', 'serverIp'],
            onClick: () => openProject({ ...viewing }, 'environments'),
          }}
          relatedPanels={PROJECT_PANELS}
          parentType="project"
          parentLabel={String(viewing.name ?? `#${viewing.id}`)}
          canEdit={canUpdate || canCreate}
          onEdit={() => openProject({ ...viewing })}
          onClose={() => setViewing(null)}
        />
      )}

      {selected.size > 0 && (
        <div className="card" style={{ marginBottom: 12 }}>
          <div className="card-body" style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '12px 16px' }}>
            <strong>{selected.size} selected</strong>
            <button className="btn btn-ghost btn-sm" onClick={() => setExporting(true)}>Export selected</button>
            {canUpdate && <button className="btn btn-ghost btn-sm" disabled={bulk.isPending} onClick={() => bulk.mutate({ ids: [...selected], kind: 'publish' })}>Publish selected</button>}
            {canUpdate && <button className="btn btn-ghost btn-sm" disabled={bulk.isPending} onClick={() => bulk.mutate({ ids: [...selected], kind: 'revert' })}>Revert to Draft</button>}
            {canDelete && <button className="btn btn-danger btn-sm" disabled={bulk.isPending} onClick={() => { if (confirm(`Delete ${selected.size} project(s)?`)) bulk.mutate({ ids: [...selected], kind: 'delete' }); }}>Delete selected</button>}
            <button className="btn btn-ghost btn-sm" onClick={() => setSelected(new Set())}>Clear</button>
          </div>
        </div>
      )}

      <div className="card">
        <table className="table">
          <thead><tr><th style={{ width: 36 }}><input type="checkbox" checked={allSel} onChange={toggleAll} /></th>
            {PROJECT_COLS.map((c) => (
              <Fragment key={c.key}>
                <th onClick={() => onSort(c.key)} style={{ cursor: 'pointer', userSelect: 'none' }} title="Click to sort">
                  {c.label}{sort?.col === c.key ? (sort.dir === 'asc' ? ' ▲' : ' ▼') : ''}
                </th>
                {c.key === 'poc.name' && <th>Developers</th>}
              </Fragment>
            ))}
            <th>Hosting</th>
            <th style={{ width: 90 }}></th></tr></thead>
          <tbody>
            {rows.length === 0 && <tr><td colSpan={PROJECT_COLSPAN} className="empty">No projects yet.</td></tr>}
            {rows.length > 0 && filtered.length === 0 && <tr><td colSpan={PROJECT_COLSPAN} className="empty">No projects match this filter.</td></tr>}
            {groups
              ? groups.map(([key, gRows]) => (
                  <Fragment key={'grp-' + key}>
                    <tr onClick={() => toggleGroup(key)} style={{ cursor: 'pointer', background: 'var(--bg-2)' }}>
                      <td colSpan={PROJECT_COLSPAN} style={{ fontWeight: 600, padding: '7px 12px' }}>
                        {collapsedGroups.has(key) ? '▸' : '▾'} {key} <span className="muted" style={{ fontWeight: 400 }}>({gRows.length})</span>
                      </td>
                    </tr>
                    {!collapsedGroups.has(key) && gRows.map(renderProjectRow)}
                  </Fragment>
                ))
              : filtered.map(renderProjectRow)}
          </tbody>
        </table>
      </div>
    </div>
  );
}
