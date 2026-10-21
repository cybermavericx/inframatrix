import { useState, type ChangeEvent } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { api, API_ORIGIN } from '../lib/api';
import { useAuth } from '../auth/AuthContext';
import { useToast } from './Toast';

function errMsg(e: unknown) {
  const m = (e as { response?: { data?: { message?: string | string[] } } }).response?.data?.message;
  return Array.isArray(m) ? m.join(', ') : (m ?? 'Request failed');
}

/** Attach a file (+ optional invoice no / note) against ANY record — the generic "+ Attach" flow.
 *  Reuses the existing POST /uploads endpoint for the file, then saves the polymorphic attachment. */
export function AttachmentModal({
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
  const [filePath, setFilePath] = useState<string | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [invoiceNumber, setInvoiceNumber] = useState('');
  const [description, setDescription] = useState('');
  const [busy, setBusy] = useState(false);

  const onPick = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setBusy(true);
    const fd = new FormData();
    fd.append('file', file);
    try {
      const r = await api.post('/uploads', fd);
      setFilePath(r.data.path);
      setFileName(r.data.name);
    } catch {
      toast.error('Upload failed — the file was not attached. Please try again.');
    } finally {
      setBusy(false);
      e.target.value = '';
    }
  };

  const save = useMutation({
    mutationFn: () =>
      api.post('/jobbag/attachments', {
        parentType, parentId, filePath, fileName,
        invoiceNumber: invoiceNumber.trim() || null,
        description: description.trim() || null,
        authorName: user?.name ?? null,
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['/jobbag/attachments'] });
      onSaved?.();
      onClose();
      toast.notify('Attachment added');
    },
    onError: (e) => toast.error(errMsg(e)),
  });

  const niceParent = parentType.replace(/_/g, ' ');

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="card-body">
          <h3 style={{ marginTop: 0 }}>
            Attach file
            <span className="muted" style={{ fontWeight: 400, fontSize: 13 }}>
              {' '}· {niceParent} #{parentId}{parentLabel ? ` — ${parentLabel}` : ''}
            </span>
          </h3>

          <div className="field">
            <label>File</label>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
              {filePath ? (
                <a href={API_ORIGIN + filePath} target="_blank" rel="noreferrer" style={{ color: 'var(--primary-2)' }}>{fileName ?? filePath.split('/').pop()}</a>
              ) : null}
              <input type="file" onChange={onPick} />
              {busy && <span className="muted">uploading…</span>}
              {filePath ? <button type="button" className="btn btn-ghost btn-sm" onClick={() => { setFilePath(null); setFileName(null); }}>clear</button> : null}
            </div>
          </div>

          <div className="field">
            <label>Invoice no (optional)</label>
            <input className="input" value={invoiceNumber} onChange={(e) => setInvoiceNumber(e.target.value)} placeholder="e.g. INV-2026-0042" />
          </div>

          <div className="field">
            <label>Note (optional)</label>
            <input className="input" value={description} onChange={(e) => setDescription(e.target.value)} placeholder="short description" />
          </div>

          <div style={{ marginTop: 16 }}>
            <button className="btn btn-primary" disabled={!filePath || busy || save.isPending} onClick={() => save.mutate()}>
              {save.isPending ? 'Saving…' : 'Attach'}
            </button>
            <button className="btn btn-ghost" style={{ marginLeft: 8 }} onClick={onClose}>Cancel</button>
          </div>
        </div>
      </div>
    </div>
  );
}
