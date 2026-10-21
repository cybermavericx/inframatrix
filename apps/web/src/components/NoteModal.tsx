import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api';
import { useAuth } from '../auth/AuthContext';
import { useToast } from './Toast';

function errMsg(e: unknown) {
  const m = (e as { response?: { data?: { message?: string | string[] } } }).response?.data?.message;
  return Array.isArray(m) ? m.join(', ') : (m ?? 'Request failed');
}

/** Add a free-text note against ANY record (the generic "+ Add note" flow). */
export function NoteModal({
  parentType, parentId, parentLabel, onClose, onSaved,
}: {
  parentType: string;
  parentId: number;
  parentLabel?: string;
  onClose: () => void;
  onSaved?: () => void;
}) {
  const qc = useQueryClient();
  const { user } = useAuth();
  const toast = useToast();
  const [body, setBody] = useState('');

  const save = useMutation({
    mutationFn: () =>
      api.post('/jobbag/notes', { parentType, parentId, body, authorName: user?.name ?? null }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['/jobbag/notes'] });
      onSaved?.();
      onClose();
      toast.notify('Note added');
    },
    onError: (e) => toast.error(errMsg(e)),
  });

  const niceParent = parentType.replace(/_/g, ' ');

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="card-body">
          <h3 style={{ marginTop: 0 }}>
            Add note
            <span className="muted" style={{ fontWeight: 400, fontSize: 13 }}>
              {' '}· {niceParent} #{parentId}{parentLabel ? ` — ${parentLabel}` : ''}
            </span>
          </h3>
          <div className="field">
            <label>Note</label>
            <textarea className="input" rows={4} value={body} onChange={(e) => setBody(e.target.value)} autoFocus placeholder="Write a note…" />
          </div>
          <div style={{ marginTop: 16 }}>
            <button className="btn btn-primary" disabled={!body.trim() || save.isPending} onClick={() => save.mutate()}>
              {save.isPending ? 'Saving…' : 'Add note'}
            </button>
            <button className="btn btn-ghost" style={{ marginLeft: 8 }} onClick={onClose}>Cancel</button>
          </div>
        </div>
      </div>
    </div>
  );
}
