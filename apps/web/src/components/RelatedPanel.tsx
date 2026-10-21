import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { api } from '../lib/api';
import { fmtDate, isDateField } from '../lib/dates';
import { ReminderModal } from './ReminderModal';
import { NoteModal } from './NoteModal';
import { ResolveModal } from './ResolveModal';
import { ExportPicker } from './ExportPicker';

type Row = Record<string, unknown>;

/** A panel shown inside a record's detail view: a list of related rows (reminders, notes, or any
 *  FK-filtered resource) with an optional "+ Add" button and per-row click-through / actions. This is
 *  the generic "add anything against anything + see it listed underneath" mechanism. */
export interface RelatedPanelDef {
  title: string;
  /** 'reminders' / 'notes' use the polymorphic parentType+parentId match; 'filter' matches an FK.
   *  'tags' renders the reusable tag/flag chips; 'activity' renders the Odoo-style change-log + notes
   *  timeline. (tags/activity are dispatched by RecordDetail to their own components.) */
  kind: 'reminders' | 'notes' | 'filter' | 'tags' | 'activity';
  endpoint?: string;        // for kind 'filter'
  filterKey?: string;       // for kind 'filter': child field equal to the parent row id
  columns?: { name: string; label: string }[]; // for kind 'filter'
  linkPath?: string;        // click a row → navigate(`${linkPath}?view=<id>`)
  linkIdField?: string;     // which field supplies that id (default 'id'); e.g. 'vendorServiceId'
  badgeCols?: string[];
  /** kind 'filter' only: the /data registry resource key (e.g. 'infra.environments') this panel's
   *  rows come from — when set, an "Export" button opens the field-picker pre-scoped to filterKey=parentId. */
  exportResource?: string;
}

function get(o: unknown, path: string): unknown {
  return path.split('.').reduce<unknown>((a, k) => (a == null ? undefined : (a as Row)[k]), o);
}
function badgeClass(v: string): string {
  const s = v.toLowerCase();
  if (['paid', 'active', 'resolved', 'sent', 'started', 'y', 'yes'].includes(s)) return 'badge badge-green';
  if (['due', 'waiting', 'queued', 'created'].includes(s)) return 'badge badge-amber';
  if (['overdue', 'failed', 'cancelled', 'pending_resolved', 'expired', 'dropped', 'n', 'no'].includes(s)) return 'badge badge-red';
  return 'badge badge-gray';
}
const REMINDER_COLS = [
  { name: 'title', label: 'title' }, { name: 'scheduledDateTime', label: 'when' },
  { name: 'recurrence', label: 'repeat' }, { name: 'status', label: 'status' },
];
const NOTE_COLS = [{ name: 'body', label: 'note' }, { name: 'authorName', label: 'by' }, { name: 'createdAt', label: 'added' }];

export function RelatedPanel({
  panel, parentType, parentId, parentLabel, canEdit,
}: {
  panel: RelatedPanelDef;
  parentType: string;
  parentId: number;
  parentLabel?: string;
  canEdit: boolean;
}) {
  const navigate = useNavigate();
  const endpoint = panel.kind === 'reminders' ? '/jobbag/reminders' : panel.kind === 'notes' ? '/jobbag/notes' : panel.endpoint!;
  const { data = [], refetch } = useQuery({
    queryKey: [endpoint],
    queryFn: async () => (await api.get(endpoint)).data as Row[],
    staleTime: 10_000,
  });
  const [adding, setAdding] = useState(false);
  const [resolving, setResolving] = useState<Row | null>(null);
  const [exporting, setExporting] = useState(false);

  const rows = data.filter((r) =>
    panel.kind === 'filter'
      ? String(get(r, panel.filterKey!) ?? '') === String(parentId)
      : r.parentType === parentType && Number(r.parentId) === Number(parentId),
  );
  const cols = panel.kind === 'reminders' ? REMINDER_COLS : panel.kind === 'notes' ? NOTE_COLS : (panel.columns ?? []);
  const badges = new Set(panel.kind === 'reminders' ? ['status'] : (panel.badgeCols ?? []));
  const cell = (r: Row, name: string) => {
    const v = get(r, name);
    if (v == null || v === '') return '';
    const s = isDateField(name) ? fmtDate(v) : String(v);
    return name === 'body' && s.length > 80 ? s.slice(0, 80) + '…' : s;
  };

  return (
    <div style={{ marginTop: 14 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6 }}>
        <label style={{ margin: 0 }}>{panel.title}</label>
        <span className="muted" style={{ fontSize: 12 }}>· {rows.length}</span>
        {panel.kind === 'filter' && panel.exportResource && rows.length > 0 && (
          <button type="button" className="btn btn-ghost btn-sm" style={{ marginLeft: 'auto' }} onClick={() => setExporting(true)}>
            Export
          </button>
        )}
        {canEdit && (panel.kind === 'reminders' || panel.kind === 'notes') && (
          <button type="button" className="btn btn-ghost btn-sm" style={{ marginLeft: 'auto' }} onClick={() => setAdding(true)}>
            + Add {panel.kind === 'reminders' ? 'reminder' : 'note'}
          </button>
        )}
      </div>

      {rows.length === 0 ? (
        <span className="muted" style={{ fontSize: 13 }}>None yet.</span>
      ) : (
        <table className="table" style={{ fontSize: 13 }}>
          <thead><tr>{cols.map((c) => <th key={c.name}>{c.label}</th>)}<th style={{ width: 90 }}></th></tr></thead>
          <tbody>
            {rows.map((r) => (
              <tr key={String(r.id)}>
                {cols.map((c) => (
                  <td key={c.name}>
                    {badges.has(c.name) && get(r, c.name) != null
                      ? <span className={badgeClass(String(get(r, c.name)))}>{cell(r, c.name)}</span>
                      : cell(r, c.name)}
                  </td>
                ))}
                <td style={{ textAlign: 'right' }}>
                  {panel.kind === 'reminders' && canEdit && ['WAITING', 'DUE', 'PENDING_RESOLVED'].includes(String(r.status)) && (
                    <button type="button" className="btn btn-ghost btn-sm" onClick={() => setResolving(r)}>Resolve</button>
                  )}
                  {panel.linkPath && get(r, panel.linkIdField ?? 'id') != null && (
                    <button type="button" className="btn btn-ghost btn-sm" onClick={() => navigate(`${panel.linkPath}?view=${get(r, panel.linkIdField ?? 'id')}`)}>open ↗</button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {adding && panel.kind === 'reminders' && (
        <ReminderModal parentType={parentType} parentId={parentId} parentLabel={parentLabel} onClose={() => setAdding(false)} onSaved={() => refetch()} />
      )}
      {adding && panel.kind === 'notes' && (
        <NoteModal parentType={parentType} parentId={parentId} parentLabel={parentLabel} onClose={() => setAdding(false)} onSaved={() => refetch()} />
      )}
      {resolving && (
        <ResolveModal reminderId={resolving.id as number} title={(resolving.title as string) ?? undefined}
          recurring={!!resolving.recurrence && resolving.recurrence !== 'NONE'}
          onClose={() => setResolving(null)} onSaved={() => refetch()} />
      )}
      {exporting && panel.exportResource && (
        <ExportPicker
          resource={panel.exportResource}
          title={panel.title}
          filter={{ key: panel.filterKey!, value: parentId, label: parentLabel ? `${panel.title} — ${parentLabel}` : undefined }}
          defaultFields={panel.columns?.map((c) => c.name)}
          onClose={() => setExporting(false)}
        />
      )}
    </div>
  );
}
