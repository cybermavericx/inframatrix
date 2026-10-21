import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api, API_ORIGIN } from '../lib/api';
import { fmtDate } from '../lib/dates';
import { AttachmentModal } from './AttachmentModal';
import { useToast } from './Toast';

type Row = Record<string, unknown>;

/** The Odoo-chatter-style Attachments panel shown on EVERY record's detail view: a list of files
 *  attached to this record (with invoice no / note) and a "+ Attach" button. Polymorphic via
 *  parentType+parentId, exactly like the Notes panel. If the current user lacks the
 *  jobbag.attachments read permission the list 403s → the panel hides itself. */
export function AttachmentPanel({
  parentType, parentId, parentLabel, canEdit,
}: {
  parentType: string;
  parentId: number;
  parentLabel?: string;
  canEdit: boolean;
}) {
  const qc = useQueryClient();
  const toast = useToast();
  const { data = [], refetch, isError } = useQuery({
    queryKey: ['/jobbag/attachments'],
    queryFn: async () => (await api.get('/jobbag/attachments')).data as Row[],
    staleTime: 10_000,
    retry: false,
  });
  const [adding, setAdding] = useState(false);

  // No permission / endpoint unavailable → don't show the panel at all (keeps non-permitted users clean).
  if (isError) return null;

  const rows = data.filter((r) => r.parentType === parentType && Number(r.parentId) === Number(parentId));

  const del = async (id: number) => {
    if (!confirm('Remove this attachment? (The record link is removed; this does not affect the payment itself.)')) return;
    try {
      await api.delete(`/jobbag/attachments/${id}`);
      qc.invalidateQueries({ queryKey: ['/jobbag/attachments'] });
      refetch();
    } catch {
      toast.error('Could not remove the attachment.');
    }
  };

  return (
    <div style={{ marginTop: 14 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6 }}>
        <label style={{ margin: 0 }}>Attachments</label>
        <span className="muted" style={{ fontSize: 12 }}>· {rows.length}</span>
        {canEdit && (
          <button type="button" className="btn btn-ghost btn-sm" style={{ marginLeft: 'auto' }} onClick={() => setAdding(true)}>
            + Attach
          </button>
        )}
      </div>

      {rows.length === 0 ? (
        <span className="muted" style={{ fontSize: 13 }}>None yet.</span>
      ) : (
        <table className="table" style={{ fontSize: 13 }}>
          <thead><tr><th>file</th><th>invoice no</th><th>note</th><th>by</th><th>added</th><th style={{ width: 80 }}></th></tr></thead>
          <tbody>
            {rows.map((r) => (
              <tr key={String(r.id)}>
                <td>
                  {r.filePath
                    ? <a href={API_ORIGIN + String(r.filePath)} target="_blank" rel="noreferrer" style={{ color: 'var(--primary-2)' }}>{String(r.fileName || r.filePath).split('/').pop()}</a>
                    : ''}
                </td>
                <td>{r.invoiceNumber ? String(r.invoiceNumber) : ''}</td>
                <td>{r.description ? String(r.description) : ''}</td>
                <td>{r.authorName ? String(r.authorName) : ''}</td>
                <td>{r.createdAt ? fmtDate(r.createdAt) : ''}</td>
                <td style={{ textAlign: 'right' }}>
                  {canEdit && <button type="button" className="btn btn-ghost btn-sm" onClick={() => del(r.id as number)}>remove</button>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {adding && (
        <AttachmentModal parentType={parentType} parentId={parentId} parentLabel={parentLabel} onClose={() => setAdding(false)} onSaved={() => refetch()} />
      )}
    </div>
  );
}
