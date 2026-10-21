import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api';
import { fmtDate } from '../lib/dates';
import { useAuth } from '../auth/AuthContext';
import { useToast } from './Toast';
import { ActivityHistoryModal } from './ActivityLogView';

interface AuditEntry {
  id: number; createdAt: string; action: string;
  field?: string | null; fieldLabel?: string | null;
  oldValue?: string | null; newValue?: string | null; message?: string | null;
  authorName?: string | null; authorEmail?: string | null;
}
interface NoteRow { id: number; createdAt: string; body?: string | null; authorName?: string | null; parentType?: string; parentId?: number }

/** A unified timeline item — either an internal log note or an automatic change-log entry. */
type Item =
  | { kind: 'note'; id: string; at: string; author: string; body: string }
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
 * when. Notes come from the existing /jobbag/notes store; changes from /audit. */
export function ActivityPanel({ parentType, parentId, canEdit }: { parentType: string; parentId: number; canEdit: boolean }) {
  const qc = useQueryClient();
  const toast = useToast();
  const { user } = useAuth();
  const [note, setNote] = useState('');
  const [fullHistory, setFullHistory] = useState(false);

  const { data: audit = [] } = useQuery({
    queryKey: ['/audit', parentType, parentId],
    queryFn: async () => (await api.get('/audit', { params: { entityType: parentType, entityId: parentId } })).data as AuditEntry[],
    staleTime: 0,
    refetchOnMount: 'always', // a timeline is only useful if it's current
  });
  // Notes are stored once for all records; fetch and filter (same approach as RelatedPanel).
  const { data: allNotes = [] } = useQuery({
    queryKey: ['/jobbag/notes'],
    queryFn: async () => (await api.get('/jobbag/notes')).data as NoteRow[],
    staleTime: 10_000,
  });
  const notes = allNotes.filter((n) => n.parentType === parentType && Number(n.parentId) === Number(parentId));

  const add = useMutation({
    mutationFn: () => api.post('/jobbag/notes', { parentType, parentId, body: note.trim(), authorName: user?.email ?? null }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['/jobbag/notes'] });
      setNote('');
      toast.notify('Note logged');
    },
    onError: () => toast.error('Could not log note'),
  });

  const items: Item[] = [
    ...notes.map((n): Item => ({ kind: 'note', id: `n${n.id}`, at: n.createdAt, author: n.authorName ?? 'Someone', body: n.body ?? '' })),
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
          <textarea className="input" rows={2} value={note} placeholder="Log an internal note…"
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
                </div>
                {it.kind === 'note'
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
