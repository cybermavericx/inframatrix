import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api';
import { fmtDate } from '../lib/dates';
import { useToast } from './Toast';
import { ActivityHistoryModal } from './ActivityLogView';

interface AuditEntry {
  id: number; createdAt: string; action: string;
  field?: string | null; fieldLabel?: string | null;
  oldValue?: string | null; newValue?: string | null; message?: string | null;
  authorName?: string | null; authorEmail?: string | null;
}
interface NoteRow { id: number; createdAt: string; body?: string | null; authorName?: string | null; canEdit?: boolean; canDelete?: boolean }

function errText(e: unknown, fallback: string): string {
  const m = (e as { response?: { data?: { message?: string | string[] } } }).response?.data?.message;
  return Array.isArray(m) ? m.join(', ') : (m ?? fallback);
}

/** A unified timeline item — either an internal log note or an automatic change-log entry. */
type Item =
  | { kind: 'note'; id: string; at: string; author: string; body: string; note: NoteRow }
  | { kind: 'audit'; id: string; at: string; author: string; entries: AuditEntry[] };

/** One save writes one log row per changed field, all stamped the same second by the same author —
 *  fold those into a single timeline entry (Odoo-style) instead of N separate lines. Input is newest
 *  first; the oldest row of a group is shown first inside it so the bullets read in field order. */
function groupAudit(rows: AuditEntry[]): Extract<Item, { kind: 'audit' }>[] {
  const out: Extract<Item, { kind: 'audit' }>[] = [];
  for (const a of rows) {
    const author = a.authorName ?? 'System';
    const t = new Date(a.createdAt).getTime();
    // the rows of one save are written within the same moment (not always the identical timestamp), so
    // group by author + a 3-second window rather than an exact match
    const hit = out.find((g) => g.author === author && Math.abs(new Date(g.at).getTime() - t) <= 3000);
    if (hit) { hit.entries.unshift(a); continue; }
    out.push({ kind: 'audit', id: `a${a.id}`, at: a.createdAt, author, entries: [a] });
  }
  return out;
}

const initial = (name: string) => (name.trim()[0] ?? '?').toUpperCase();

/**
 * Odoo-style "chatter" for a record's detail view (kind 'activity' in RelatedPanel): a "Log note" box
 * plus a merged timeline of internal notes and the automatic change-log (field edits show
 * `old → new`, tag add/remove show as messages, create/delete as events) — newest first, with who &
 * when. Notes come from /notes (only this record's, guarded by the record's own permissions); changes
 * from /audit. Authors can edit/delete their own notes; edits and deletes show up in the change-log. */
export function ActivityPanel({ parentType, parentId, canEdit }: { parentType: string; parentId: number; canEdit: boolean }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [note, setNote] = useState('');
  const [editingNote, setEditingNote] = useState<{ id: number; body: string } | null>(null);
  const [fullHistory, setFullHistory] = useState(false);

  const { data: audit = [] } = useQuery({
    queryKey: ['/audit', parentType, parentId],
    queryFn: async () => (await api.get('/audit', { params: { entityType: parentType, entityId: parentId } })).data as AuditEntry[],
    staleTime: 0,
    refetchOnMount: 'always', // a timeline is only useful if it's current
  });
  const { data: notes = [] } = useQuery({
    queryKey: ['/notes', parentType, parentId],
    queryFn: async () => (await api.get('/notes', { params: { parentType, parentId } })).data as NoteRow[],
    staleTime: 0,
  });
  const refresh = () => {
    qc.invalidateQueries({ queryKey: ['/notes', parentType, parentId] });
    qc.invalidateQueries({ queryKey: ['/audit', parentType, parentId] });
  };

  const add = useMutation({
    mutationFn: () => api.post('/notes', { parentType, parentId, body: note.trim() }),
    onSuccess: () => { refresh(); setNote(''); toast.notify('Note logged'); },
    onError: (e) => toast.error(errText(e, 'Could not log note')),
  });
  const edit = useMutation({
    mutationFn: (n: { id: number; body: string }) => api.patch(`/notes/${n.id}`, { body: n.body.trim() }),
    onSuccess: () => { refresh(); setEditingNote(null); toast.notify('Note updated'); },
    onError: (e) => toast.error(errText(e, 'Could not update note')),
  });
  const del = useMutation({
    mutationFn: (id: number) => api.delete(`/notes/${id}`),
    onSuccess: () => { refresh(); toast.notify('Note deleted'); },
    onError: (e) => toast.error(errText(e, 'Could not delete note')),
  });

  const items: Item[] = [
    ...notes.map((n): Item => ({ kind: 'note', id: `n${n.id}`, at: n.createdAt, author: n.authorName ?? 'Someone', body: n.body ?? '', note: n })),
    ...groupAudit(audit),
  ].sort((x, y) => (x.at < y.at ? 1 : -1));

  const describe = (e: AuditEntry) => {
    if (e.message) return e.message;
    if (e.action === 'created') return 'Created';
    if (e.action === 'deleted') return 'Deleted';
    const from = e.oldValue && e.oldValue.length ? e.oldValue : '—';
    const to = e.newValue && e.newValue.length ? e.newValue : '—';
    return (
      <>
        <strong style={{ fontWeight: 600 }}>{e.fieldLabel ?? e.field ?? 'Field'}</strong>: {from} → {to}
      </>
    );
  };

  return (
    <div style={{ marginTop: 14 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6 }}>
        <label style={{ margin: 0 }}>Activity</label>
        <span className="muted" style={{ fontSize: 12 }}>· {items.length}</span>
        <button type="button" className="btn btn-ghost btn-sm" style={{ marginLeft: 'auto' }} onClick={() => setFullHistory(true)}
          title="Open the complete change history as a table, with filters">Full history</button>
      </div>
      {fullHistory && (
        <ActivityHistoryModal title="Full history" entityType={parentType} entityId={parentId} onClose={() => setFullHistory(false)} />
      )}

      {canEdit && (
        <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start', marginBottom: 12 }}>
          <textarea className="input" rows={2} value={note} maxLength={5000}
            placeholder="Log an internal note… (never paste passwords or keys here)" aria-label="New note"
            onChange={(e) => setNote(e.target.value)} style={{ flex: 1 }} />
          <button type="button" className="btn btn-primary btn-sm" disabled={!note.trim() || add.isPending} onClick={() => add.mutate()}>
            {add.isPending ? 'Logging…' : 'Log'}
          </button>
        </div>
      )}

      {items.length === 0 ? (
        <span className="muted" style={{ fontSize: 13 }}>No activity yet.</span>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {items.map((it) => (
            <div key={it.id} style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
              <span style={{ flex: 'none', width: 26, height: 26, borderRadius: '50%', background: 'var(--surface-2)', border: '1px solid var(--border)', display: 'grid', placeItems: 'center', fontSize: 12, fontWeight: 700 }}>
                {initial(it.author)}
              </span>
              <div style={{ flex: 1, fontSize: 13 }}>
                <div style={{ display: 'flex', gap: 8, alignItems: 'baseline' }}>
                  <strong>{it.author}</strong>
                  <span className="muted" style={{ fontSize: 11.5 }}>{fmtDate(it.at)}</span>
                  {it.kind === 'note' && editingNote?.id !== it.note.id && (
                    <span style={{ marginLeft: 'auto', display: 'flex', gap: 4 }}>
                      {it.note.canEdit && <button type="button" className="btn btn-ghost btn-sm" onClick={() => setEditingNote({ id: it.note.id, body: it.body })}>Edit</button>}
                      {it.note.canDelete && <button type="button" className="btn btn-ghost btn-sm" disabled={del.isPending}
                        onClick={() => { if (confirm('Delete this note? Its text stays in the change history.')) del.mutate(it.note.id); }}>Delete</button>}
                    </span>
                  )}
                </div>
                {it.kind === 'note' && editingNote?.id === it.note.id ? (
                  <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start', marginTop: 4 }}>
                    <textarea className="input" rows={2} value={editingNote.body} maxLength={5000} aria-label="Edit note"
                      onChange={(e) => setEditingNote({ id: it.note.id, body: e.target.value })} style={{ flex: 1 }} />
                    <button type="button" className="btn btn-primary btn-sm" disabled={!editingNote.body.trim() || edit.isPending} onClick={() => edit.mutate(editingNote)}>Save</button>
                    <button type="button" className="btn btn-ghost btn-sm" onClick={() => setEditingNote(null)}>Cancel</button>
                  </div>
                ) : it.kind === 'note'
                  ? <div style={{ whiteSpace: 'pre-wrap' }}>{it.body}</div>
                  : (
                    <ul className="muted" style={{ margin: '2px 0 0', paddingLeft: 16 }}>
                      {it.entries.map((e) => <li key={e.id}>{describe(e)}</li>)}
                    </ul>
                  )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
