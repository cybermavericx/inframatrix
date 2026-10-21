import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api';
import { useToast } from './Toast';

function errMsg(e: unknown) {
  const m = (e as { response?: { data?: { message?: string | string[] } } }).response?.data?.message;
  return Array.isArray(m) ? m.join(', ') : (m ?? 'Request failed');
}

/**
 * Resolve a reminder with a note. "Resolve" finalises it (and, if recurring, spawns the next
 * occurrence). "Mark pending" parks it as PENDING_RESOLVED (handled, awaiting confirmation).
 */
export function ResolveModal({
  reminderId, title, recurring, onClose, onSaved,
}: {
  reminderId: number;
  title?: string;
  recurring?: boolean;
  onClose: () => void;
  onSaved?: () => void;
}) {
  const qc = useQueryClient();
  const toast = useToast();
  const [note, setNote] = useState('');

  const act = useMutation({
    mutationFn: (status: 'RESOLVED' | 'PENDING_RESOLVED') =>
      api.post(`/jobbag/reminders/${reminderId}/resolve`, { note: note.trim() || null, status }),
    onSuccess: (_r, status) => {
      qc.invalidateQueries({ queryKey: ['/jobbag/reminders'] });
      onSaved?.();
      onClose();
      toast.notify(status === 'RESOLVED' ? 'Reminder resolved' : 'Marked pending');
    },
    onError: (e) => toast.error(errMsg(e)),
  });

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="card-body">
          <h3 style={{ marginTop: 0 }}>
            Resolve reminder
            {title ? <span className="muted" style={{ fontWeight: 400, fontSize: 13 }}> · {title}</span> : null}
          </h3>
          <div className="field">
            <label>Resolution note</label>
            <textarea className="input" rows={4} value={note} onChange={(e) => setNote(e.target.value)} autoFocus placeholder="What was done…" />
          </div>
          {recurring && (
            <div className="muted" style={{ fontSize: 12.5, marginTop: 4 }}>
              This reminder repeats — resolving it will create the next occurrence automatically.
            </div>
          )}
          <div style={{ marginTop: 16 }}>
            <button className="btn btn-primary" disabled={act.isPending} onClick={() => act.mutate('RESOLVED')}>
              {act.isPending ? 'Saving…' : 'Resolve'}
            </button>
            <button className="btn btn-ghost" style={{ marginLeft: 8 }} disabled={act.isPending} onClick={() => act.mutate('PENDING_RESOLVED')}>
              Mark pending
            </button>
            <button className="btn btn-ghost" style={{ marginLeft: 8 }} onClick={onClose}>Cancel</button>
          </div>
        </div>
      </div>
    </div>
  );
}
