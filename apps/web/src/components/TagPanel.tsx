import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api';
import { fmtDate } from '../lib/dates';
import { useToast } from './Toast';

type Row = Record<string, unknown>;

/** A tag attached to a record, as returned by /infra/tag-assignments (tag joined, inherited flag). */
interface Assignment {
  id: number;
  tagId: number;
  parentType: string;
  parentId: number;
  removedAt: string | null;
  createdAt: string;
  inherited?: boolean;
  inheritedFrom?: string;
  tag?: { id: number; name: string; color?: string | null } | null;
}

const COLORS = ['gray', 'green', 'blue', 'amber', 'red'] as const;
const chipClass = (color?: string | null) => `badge badge-${COLORS.includes(color as never) ? color : 'gray'}`;

/**
 * Reusable tag/flag panel for ANY record's detail view (kind 'tags' in RelatedPanel). Shows the
 * record's current flags as colored chips, a "+ Tag" box that suggests existing tags (so the same
 * flag is reused, never duplicated) or creates a new one, an × to clear a flag, and a history toggle
 * (removing keeps the flag in history rather than deleting it). Environments also show the flags
 * inherited from their server (read-only here — managed on the server). */
export function TagPanel({ parentType, parentId, canEdit }: { parentType: string; parentId: number; canEdit: boolean }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [showHistory, setShowHistory] = useState(false);
  const [adding, setAdding] = useState(false);
  const [text, setText] = useState('');

  const assignKey = ['/infra/tag-assignments', parentType, parentId, showHistory] as const;
  const { data: assignments = [] } = useQuery({
    queryKey: assignKey,
    queryFn: async () =>
      (await api.get('/infra/tag-assignments', { params: { parentType, parentId, history: showHistory ? 1 : 0 } })).data as Assignment[],
  });
  // master list powers the suggestions (reuse existing tags instead of re-typing)
  const { data: allTags = [] } = useQuery({
    queryKey: ['/infra/tags'],
    queryFn: async () => (await api.get('/infra/tags')).data as Row[],
    staleTime: 60_000,
    enabled: adding,
  });

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ['/infra/tag-assignments', parentType, parentId] });
    qc.invalidateQueries({ queryKey: ['/infra/tags'] });
    qc.invalidateQueries({ queryKey: ['/audit', parentType, parentId] }); // tag events show in the timeline
  };

  const assign = useMutation({
    mutationFn: (body: { tagId?: number; name?: string }) =>
      api.post('/infra/tag-assignments', { ...body, parentType, parentId }),
    onSuccess: () => { refresh(); setText(''); setAdding(false); toast.notify('Tag added'); },
    onError: () => toast.error('Could not add tag'),
  });
  const remove = useMutation({
    mutationFn: (id: number) => api.post(`/infra/tag-assignments/${id}/remove`, {}),
    onSuccess: () => { refresh(); toast.notify('Tag removed'); },
    onError: () => toast.error('Could not remove tag'),
  });

  const active = assignments.filter((a) => !a.removedAt);
  const history = assignments.filter((a) => a.removedAt);
  const typed = text.trim().toLowerCase();
  const suggestions = (allTags as { id: number; name: string; color?: string | null }[])
    .filter((t) => !typed || t.name.toLowerCase().includes(typed))
    .filter((t) => !active.some((a) => a.tagId === t.id)) // hide already-attached
    .slice(0, 8);
  const exactExists = (allTags as { name: string }[]).some((t) => t.name.toLowerCase() === typed);

  return (
    <div style={{ marginTop: 14 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6 }}>
        <label style={{ margin: 0 }}>Tags / Flags</label>
        <span className="muted" style={{ fontSize: 12 }}>· {active.length}</span>
        {canEdit && (
          <button type="button" className="btn btn-ghost btn-sm" style={{ marginLeft: 'auto' }} onClick={() => setAdding((v) => !v)}>
            {adding ? 'Cancel' : '+ Tag'}
          </button>
        )}
      </div>

      {active.length === 0 ? (
        <span className="muted" style={{ fontSize: 13 }}>No tags yet.</span>
      ) : (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
          {active.map((a) => (
            <span key={a.id} className={chipClass(a.tag?.color)} style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
              {a.tag?.name ?? `#${a.tagId}`}
              {a.inherited ? (
                <span className="muted" style={{ fontSize: 10.5 }} title={`Inherited from ${a.inheritedFrom ?? 'server'}`}>· {a.inheritedFrom ?? 'server'}</span>
              ) : canEdit ? (
                <button type="button" title="Remove tag" disabled={remove.isPending}
                  onClick={() => remove.mutate(a.id)}
                  style={{ background: 'transparent', border: 'none', color: 'inherit', cursor: 'pointer', padding: 0, fontSize: 13, lineHeight: 1 }}>×</button>
              ) : null}
            </span>
          ))}
        </div>
      )}

      {adding && canEdit && (
        <div className="card" style={{ marginTop: 8 }}>
          <div className="card-body" style={{ padding: 12 }}>
            <input className="input" autoFocus value={text} placeholder="Search or create a tag…"
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter' && typed && !exactExists) assign.mutate({ name: text.trim() }); }} />
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 8 }}>
              {suggestions.map((t) => (
                <button key={t.id} type="button" className={chipClass(t.color)} style={{ cursor: 'pointer' }}
                  onClick={() => assign.mutate({ tagId: t.id })}>{t.name}</button>
              ))}
              {typed && !exactExists && (
                <button type="button" className="btn btn-primary btn-sm" disabled={assign.isPending} onClick={() => assign.mutate({ name: text.trim() })}>
                  + Create “{text.trim()}”
                </button>
              )}
              {!typed && suggestions.length === 0 && <span className="muted" style={{ fontSize: 12.5 }}>Type to search existing tags or create a new one.</span>}
            </div>
          </div>
        </div>
      )}

      {(history.length > 0 || showHistory) && (
        <button type="button" className="btn btn-ghost btn-sm" style={{ marginTop: 8 }} onClick={() => setShowHistory((v) => !v)}>
          {showHistory ? 'Hide history' : 'Show history'}
        </button>
      )}
      {showHistory && history.length > 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 8 }}>
          {history.map((a) => (
            <span key={a.id} className="badge badge-gray" style={{ textDecoration: 'line-through', opacity: 0.7 }}
              title={`Removed ${fmtDate(a.removedAt)}`}>{a.tag?.name ?? `#${a.tagId}`}</span>
          ))}
        </div>
      )}
    </div>
  );
}
