import { useNavigate } from 'react-router-dom';
import { API_ORIGIN } from '../lib/api';
import { fmtDate } from '../lib/dates';
import type { FieldDef } from '../modules/resources';
import { RelatedPanel, type RelatedPanelDef } from './RelatedPanel';
import { TagPanel } from './TagPanel';
import { ActivityPanel } from './ActivityPanel';

type Row = Record<string, unknown>;

// ── The reusable read-only "View" of one record (extracted from CrudPage so EVERY screen —
//    config-driven OR custom, e.g. Projects → Environments, Users — opens the SAME detail view).
//    Renders: a field grid (refs resolve to their relation label, files link, html renders, dates
//    show dd mmm yyyy), an optional list of FK child records, any "+ Add"-able reminder/note/FK
//    panels, related links, and Edit/Close. Pair it with a `viewing` state + a "View" button. ──

/** A read-only list of FK child records shown under the fields (e.g. a vendor's services). */
export interface DetailChild {
  title: string;     // heading, e.g. 'Services'
  rows: Row[];       // children already filtered to this record
  label: string;     // child field used as the link text, e.g. 'serviceName'
  meta?: string[];   // extra child fields shown inline
  linkPath?: string; // click a child → navigate(`${linkPath}?view=<childId>`)
  onClick?: (row: Row) => void; // custom click handler (wins over linkPath); e.g. open an in-page editor
}

// dates render in the house style "dd mmm yyyy"; fmtDate leaves non-dates unchanged.
const fmt = (v: unknown) =>
  typeof v === 'boolean' ? (v ? 'Yes' : 'No') : v == null || typeof v === 'object' ? '' : fmtDate(String(v));

export function RecordDetail({
  title, fields, record, child, relatedPanels, parentType, parentLabel, relatedLinks, canEdit, onEdit, onClose,
}: {
  /** Singular noun for the heading, e.g. 'Environment' → "Environment details". */
  title: string;
  fields: FieldDef[];
  record: Row;
  child?: DetailChild;
  relatedPanels?: RelatedPanelDef[];
  /** Polymorphic parent key for the reminder/note panels (e.g. 'environment', 'client'). */
  parentType?: string;
  parentLabel?: string;
  relatedLinks?: { label: string; to: (row: Row) => string }[];
  canEdit: boolean;
  /** When omitted, the Edit button is hidden (e.g. a purely read-only view). */
  onEdit?: () => void;
  onClose: () => void;
}) {
  const navigate = useNavigate();
  const showEdit = canEdit && !!onEdit;
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="card-body">
          <h3 style={{ marginTop: 0, display: 'flex', alignItems: 'center', gap: 10 }}>
            {title} details
            <span className="badge badge-gray" title="record id (also in the URL)">#{String(record.id)}</span>
          </h3>
          <div className="grid-2">
            {fields
              .filter((f) => !f.showWhen || f.showWhen.in.includes(String(record[f.showWhen.field] ?? '')))
              .map((f) => {
                let val: unknown;
                if (f.type === 'ref') {
                  const rel = record[f.refRelKey ?? f.name.replace(/Id$/, '')] as Record<string, unknown> | undefined;
                  val = rel ? rel[f.refLabel ?? 'name'] : record[f.name];
                } else if (f.type === 'multiref') {
                  // many-to-many: show the related records' names, comma-separated
                  const rels = record[f.refRelKey ?? f.name.replace(/Ids$/, 's')] as Record<string, unknown>[] | undefined;
                  val = Array.isArray(rels) ? rels.map((r) => String(r[f.refLabel ?? 'name'] ?? `#${r.id}`)).join(', ') : '';
                } else val = record[f.name];
                const isWide = f.type === 'textarea' || f.type === 'file' || f.type === 'html';
                return (
                  <div key={f.name} className={'field' + (isWide ? ' col-span' : '')}>
                    <label>{f.label}</label>
                    {f.type === 'file' && val ? (
                      <a href={API_ORIGIN + String(val)} target="_blank" rel="noreferrer" style={{ color: 'var(--primary-2)' }}>{String(val).split('/').pop()}</a>
                    ) : f.type === 'html' ? (
                      <div className="view-value" style={{ padding: '8px 11px', background: '#fff', color: '#1f2933', border: '1px solid var(--border)', borderRadius: 8, maxHeight: 380, overflow: 'auto' }} dangerouslySetInnerHTML={{ __html: String(val ?? '') || '—' }} />
                    ) : (
                      <div className="view-value" style={{ padding: '8px 11px', background: 'var(--bg-2)', border: '1px solid var(--border)', borderRadius: 8, minHeight: 18, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
                        {fmt(val) || '—'}
                      </div>
                    )}
                  </div>
                );
              })}
          </div>

          {child && (
            <div style={{ marginTop: 14 }}>
              <label style={{ display: 'block', marginBottom: 6 }}>{child.title}</label>
              {child.rows.length === 0 ? (
                <span className="muted" style={{ fontSize: 13 }}>No {child.title.toLowerCase()} yet.</span>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                  {child.rows.map((s) => (
                    <button key={String(s.id)} type="button" className="kid-link"
                      onClick={() => { if (child.onClick) child.onClick(s); else if (child.linkPath) navigate(`${child.linkPath}?view=${s.id}`); }}
                      style={{ display: 'flex', gap: 10, textAlign: 'left', background: 'var(--bg-2)', border: '1px solid var(--border)', padding: '6px 10px', borderRadius: 6, cursor: 'pointer', color: 'var(--text)' }}>
                      <span style={{ color: 'var(--primary-2)', fontWeight: 600 }}>{fmt(s[child.label]) || `#${s.id}`}</span>
                      {(child.meta ?? []).filter((m) => s[m] != null && s[m] !== '').map((m) => (
                        <span key={m} className="muted" style={{ fontSize: 12.5 }}>· {m}: {fmt(s[m])}</span>
                      ))}
                      <span className="muted" style={{ marginLeft: 'auto', fontSize: 12 }}>open ↗</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Generic related panels: reminders / notes (with "+ Add"), FK-filtered lists, and the
              reusable tags + activity (change-log) panels. */}
          {(relatedPanels ?? []).map((p) =>
            p.kind === 'tags' ? (
              <TagPanel key={p.title} parentType={parentType ?? ''} parentId={record.id as number} canEdit={canEdit} />
            ) : p.kind === 'activity' ? (
              <ActivityPanel key={p.title} parentType={parentType ?? ''} parentId={record.id as number} canEdit={canEdit} />
            ) : (
              <RelatedPanel key={p.title} panel={p}
                parentType={parentType ?? ''}
                parentId={record.id as number}
                parentLabel={parentLabel}
                canEdit={canEdit} />
            ),
          )}

          <div style={{ marginTop: 16 }}>
            {(relatedLinks ?? []).map((rl) => (
              <button key={rl.label} className="btn btn-ghost" style={{ marginRight: 8 }} onClick={() => navigate(rl.to(record))}>{rl.label} ↗</button>
            ))}
            {showEdit && <button className="btn btn-primary" onClick={onEdit}>Edit</button>}
            <button className="btn btn-ghost" style={{ marginLeft: showEdit ? 8 : 0 }} onClick={onClose}>Close</button>
          </div>
        </div>
      </div>
    </div>
  );
}
