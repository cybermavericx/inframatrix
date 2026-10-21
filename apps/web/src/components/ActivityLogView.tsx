import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { useQuery } from '@tanstack/react-query';
import { api } from '../lib/api';
import { fmtDate } from '../lib/dates';

export interface LogRow {
  id: number; createdAt: string; entityType: string; entityId: number; entityLabel?: string | null;
  action: string; field?: string | null; fieldLabel?: string | null;
  oldValue?: string | null; newValue?: string | null; message?: string | null; authorName?: string | null; authorEmail?: string | null;
}
interface LogPage { rows: LogRow[]; total: number; page: number; limit: number }

/** Friendly names for the entityType keys the change-log writes. */
export const ENTITY_TYPE_LABELS: Record<string, string> = {
  project: 'Project', server: 'Server', environment: 'Environment', integration: 'Integration',
  git_provider: 'Git provider', integration_type: 'Integration type', account: 'Account',
  client: 'Client', vendor: 'Vendor', vendor_service: 'Vendor service', payment: 'Payment', job: 'Job', user: 'User',
};
const typeLabel = (t: string) => ENTITY_TYPE_LABELS[t] ?? t;

const PAGE_SIZE = 50;
const EXPORT_PAGE = 500;
const EXPORT_MAX_PAGES = 10; // 5,000 rows is plenty for an export; beyond that, narrow the filters

/** What happened, as one readable cell: a message, or "Created"/"Deleted", or the changed field's label. */
const changeLabel = (r: LogRow) => {
  if (r.action === 'created') return 'Created';
  if (r.action === 'deleted') return 'Deleted';
  return r.fieldLabel ?? r.field ?? '';
};
const dash = (v?: string | null) => (v && v.length ? v : '—');

const csvCell = (v: unknown) => {
  const s = v == null ? '' : String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

/**
 * The full change history as a filterable, paged table — Odoo's "Audit log" in one component. Two uses:
 *  • a single record (pass entityType + entityId): its complete history, mirrored child changes included;
 *  • the whole system (omit them): every change by everyone, filterable by record type / person / date,
 *    exportable to CSV. The record columns only appear in this system-wide mode.
 */
export function ActivityLogView({ entityType, entityId }: { entityType?: string; entityId?: number }) {
  const global = entityId == null;
  const [q, setQ] = useState('');
  const [author, setAuthor] = useState('');
  const [type, setType] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [page, setPage] = useState(1);
  // text filters apply shortly after typing stops, so each keystroke doesn't fire a request
  const [applied, setApplied] = useState({ q: '', author: '' });
  useEffect(() => {
    const t = setTimeout(() => { setApplied({ q, author }); setPage(1); }, 350);
    return () => clearTimeout(t);
  }, [q, author]);

  const params = {
    entityType: global ? (type || undefined) : entityType,
    entityId: global ? undefined : entityId,
    q: applied.q || undefined, author: applied.author || undefined,
    from: from || undefined, to: to || undefined,
  };
  const { data, isFetching, isError } = useQuery({
    queryKey: ['/audit', 'log', params, page],
    queryFn: async () => (await api.get('/audit/log', { params: { ...params, page, limit: PAGE_SIZE } })).data as LogPage,
    staleTime: 0,
    refetchOnMount: 'always',
    placeholderData: (prev) => prev,
  });
  const rows = data?.rows ?? [];
  const total = data?.total ?? 0;
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const hasFilter = !!(q || author || type || from || to);

  const [exporting, setExporting] = useState(false);
  const exportCsv = async () => {
    setExporting(true);
    try {
      const all: LogRow[] = [];
      for (let p = 1; p <= EXPORT_MAX_PAGES; p++) {
        const r = (await api.get('/audit/log', { params: { ...params, page: p, limit: EXPORT_PAGE } })).data as LogPage;
        all.push(...r.rows);
        if (all.length >= r.total) break;
      }
      const head = ['When', 'Who', 'Record type', 'Record', 'Change', 'Old value', 'New value', 'Note'];
      const lines = [head, ...all.map((r) => [
        fmtDate(r.createdAt), r.authorEmail ? `${r.authorName} <${r.authorEmail}>` : (r.authorName ?? ''), typeLabel(r.entityType), r.entityLabel ?? `#${r.entityId}`,
        changeLabel(r), r.oldValue ?? '', r.newValue ?? '', r.message ?? '',
      ])].map((l) => l.map(csvCell).join(','));
      // BOM so Excel opens UTF-8 (names, arrows) correctly
      const blob = new Blob(['﻿' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `activity-log-${new Date().toISOString().slice(0, 10)}.csv`;
      a.click();
      URL.revokeObjectURL(a.href);
    } finally {
      setExporting(false);
    }
  };

  const cell: React.CSSProperties = { wordBreak: 'break-word', maxWidth: 280 };
  return (
    <div>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', marginBottom: 12 }}>
        <input className="input" style={{ flex: '1 1 200px', minWidth: 160 }} placeholder="Search record, field, value, person…"
          value={q} onChange={(e) => setQ(e.target.value)} />
        <input className="input" style={{ width: 160 }} placeholder="Changed by…" value={author} onChange={(e) => setAuthor(e.target.value)} />
        {global && (
          <select className="input" style={{ width: 160 }} value={type} onChange={(e) => { setType(e.target.value); setPage(1); }}>
            <option value="">All record types</option>
            {Object.entries(ENTITY_TYPE_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        )}
        <label className="muted" style={{ fontSize: 12, display: 'flex', alignItems: 'center', gap: 4, margin: 0 }}>
          From <input className="input" type="date" value={from} onChange={(e) => { setFrom(e.target.value); setPage(1); }} />
        </label>
        <label className="muted" style={{ fontSize: 12, display: 'flex', alignItems: 'center', gap: 4, margin: 0 }}>
          To <input className="input" type="date" value={to} onChange={(e) => { setTo(e.target.value); setPage(1); }} />
        </label>
        {hasFilter && (
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => { setQ(''); setAuthor(''); setType(''); setFrom(''); setTo(''); setPage(1); }}>Clear</button>
        )}
        <button type="button" className="btn btn-ghost btn-sm" style={{ marginLeft: 'auto' }} disabled={exporting || total === 0} onClick={exportCsv}>
          {exporting ? 'Exporting…' : 'Export CSV'}
        </button>
      </div>

      {isError ? (
        <div className="error-text">Could not load the activity log.</div>
      ) : (
        <div className="table-wrap" style={{ overflowX: 'auto' }}>
          <table className="table">
            <thead>
              <tr>
                <th>When</th><th>Who</th>
                {global && <><th>Record type</th><th>Record</th></>}
                <th>Change</th><th>Old value</th><th>New value</th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 && (
                <tr><td colSpan={global ? 7 : 5} className="empty">{isFetching ? 'Loading…' : 'No activity found.'}</td></tr>
              )}
              {rows.map((r) => (
                <tr key={r.id}>
                  <td style={{ whiteSpace: 'nowrap' }}>{fmtDate(r.createdAt)}</td>
                  <td style={cell} title={r.authorEmail ?? undefined}>{r.authorName ?? 'System'}</td>
                  {global && <>
                    <td>{typeLabel(r.entityType)}</td>
                    <td style={cell}>{r.entityLabel ?? `#${r.entityId}`}</td>
                  </>}
                  {r.action === 'updated' && r.field ? (
                    <>
                      <td style={cell}><strong style={{ fontWeight: 600 }}>{changeLabel(r)}</strong></td>
                      <td className="muted" style={cell}>{dash(r.oldValue)}</td>
                      <td style={cell}>{dash(r.newValue)}</td>
                    </>
                  ) : (
                    <td colSpan={3} style={cell}>{r.message || changeLabel(r)}</td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 10, fontSize: 13 }}>
        <span className="muted">
          {total === 0 ? '0 entries' : `${(page - 1) * PAGE_SIZE + 1}–${Math.min(page * PAGE_SIZE, total)} of ${total}`}
        </span>
        <span style={{ marginLeft: 'auto', display: 'flex', gap: 6, alignItems: 'center' }}>
          <button type="button" className="btn btn-ghost btn-sm" disabled={page <= 1} onClick={() => setPage(page - 1)}>‹ Prev</button>
          <span className="muted">Page {page} / {pages}</span>
          <button type="button" className="btn btn-ghost btn-sm" disabled={page >= pages} onClick={() => setPage(page + 1)}>Next ›</button>
        </span>
      </div>
    </div>
  );
}

/** A record's full history in a wide popup. Portaled to <body> so it opens correctly even from inside
 *  another popup (the record detail) instead of being clipped/offset by its container. */
export function ActivityHistoryModal({ title, entityType, entityId, onClose }: { title: string; entityType: string; entityId: number; onClose: () => void }) {
  return createPortal(
    <div className="modal-backdrop" style={{ zIndex: 80 }} onClick={onClose}>
      <div className="modal" style={{ width: 'min(1100px, 100%)' }} onClick={(e) => e.stopPropagation()}>
        <div className="card-body">
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
            <h3 style={{ margin: 0 }}>History — {title}</h3>
            <button type="button" className="btn btn-ghost btn-sm" style={{ marginLeft: 'auto' }} onClick={onClose}>Close</button>
          </div>
          <ActivityLogView entityType={entityType} entityId={entityId} />
        </div>
      </div>
    </div>,
    document.body,
  );
}
