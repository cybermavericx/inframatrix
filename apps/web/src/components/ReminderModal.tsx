import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api';
import { MultiRefSelect } from './MultiRefSelect';
import { useToast } from './Toast';

function errMsg(e: unknown) {
  const m = (e as { response?: { data?: { message?: string | string[] } } }).response?.data?.message;
  return Array.isArray(m) ? m.join(', ') : (m ?? 'Request failed');
}

/**
 * Create a reminder against ANY record (the generic "+ Add reminder" flow): a payment, vendor-service,
 * client, vendor, job, etc. Pick when to remind, an optional repeat, a message, and recipients
 * (users and/or reminder groups + extra emails). The scheduler fires it on its date → email + Outbox,
 * then it becomes DUE awaiting resolution.
 */
export function ReminderModal({
  parentType, parentId, parentLabel, onClose, onSaved,
}: {
  parentType: string;
  parentId: number;
  parentLabel?: string;
  onClose: () => void;
  onSaved?: () => void;
}) {
  const qc = useQueryClient();
  const toast = useToast();
  const [title, setTitle] = useState('');
  const [when, setWhen] = useState('');
  const [recurrence, setRecurrence] = useState('NONE');
  const [content, setContent] = useState('');
  const [userIds, setUserIds] = useState<number[]>([]);
  const [groupIds, setGroupIds] = useState<number[]>([]);
  const [emailTo, setEmailTo] = useState('');

  const save = useMutation({
    mutationFn: () =>
      api.post('/jobbag/reminders', {
        parentType,
        parentId,
        type: 'COMMON',
        status: 'WAITING',
        title: title.trim() || null,
        recurrence,
        content,
        scheduledDateTime: when ? when.replace('T', ' ') + ':00' : null,
        recipientUserIds: userIds,
        recipientGroupIds: groupIds,
        emailTo: emailTo.trim() || null,
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['/jobbag/reminders'] });
      onSaved?.();
      onClose();
      toast.notify('Reminder created');
    },
    onError: (e) => toast.error(errMsg(e)),
  });

  const hasRecipient = userIds.length > 0 || groupIds.length > 0 || emailTo.trim().length > 0;
  const niceParent = parentType.replace(/_/g, ' ');

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="card-body">
          <h3 style={{ marginTop: 0 }}>
            Add reminder
            <span className="muted" style={{ fontWeight: 400, fontSize: 13 }}>
              {' '}· {niceParent} #{parentId}{parentLabel ? ` — ${parentLabel}` : ''}
            </span>
          </h3>

          <div className="grid-2">
            <div className="field col-span">
              <label>Title</label>
              <input className="input" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Renew SSL certificate" />
            </div>
            <div className="field">
              <label>Remind on</label>
              <input className="input" type="datetime-local" value={when} onChange={(e) => setWhen(e.target.value)} />
            </div>
            <div className="field">
              <label>Repeat</label>
              <select className="input" value={recurrence} onChange={(e) => setRecurrence(e.target.value)}>
                {['NONE', 'WEEKLY', 'MONTHLY', 'YEARLY'].map((o) => <option key={o} value={o}>{o}</option>)}
              </select>
            </div>
            <div className="field col-span">
              <label>Message</label>
              <textarea className="input" rows={2} value={content} onChange={(e) => setContent(e.target.value)} placeholder="e.g. Pay the hosting invoice / bill the client this month" />
            </div>
            <div className="field">
              <label>Recipients — users</label>
              <MultiRefSelect endpoint="/users/lookup" labelKey="name" value={userIds} onChange={setUserIds} placeholder="search users…" />
            </div>
            <div className="field">
              <label>Recipients — groups</label>
              <MultiRefSelect endpoint="/jobbag/reminder-groups" labelKey="name" value={groupIds} onChange={setGroupIds} placeholder="search groups…" />
            </div>
            <div className="field col-span">
              <label>Extra emails (comma-separated, optional)</label>
              <input className="input" value={emailTo} onChange={(e) => setEmailTo(e.target.value)} placeholder="someone@example.com, other@example.com" />
            </div>
          </div>

          {!hasRecipient && <div className="muted" style={{ fontSize: 12.5, marginTop: 8 }}>Tip: pick at least one user, group, or email so the reminder can be sent.</div>}

          <div style={{ marginTop: 16 }}>
            <button className="btn btn-primary" disabled={!when || save.isPending} onClick={() => save.mutate()}>
              {save.isPending ? 'Saving…' : 'Create reminder'}
            </button>
            <button className="btn btn-ghost" style={{ marginLeft: 8 }} onClick={onClose}>Cancel</button>
          </div>
        </div>
      </div>
    </div>
  );
}
