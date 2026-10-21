import { useRef, type ChangeEvent } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api';

// ── The reusable Excel import for a single resource, hitting the generic /data/:resource engine
//    (registry-driven, de-duped by import_uid). Every list screen that imports one resource
//    (CrudPage, Users, …) uses this same hook — only the resource and the queries to refetch differ.
//    (Export now goes through <ExportPicker> — the field-picker — not this hook; the Projects
//    *bundle* import/export pair is separate again, its own multi-sheet endpoint.)
//    Returns a file-input ref + the import handler; wire them to a hidden <input type="file">. ──

function apiErr(e: unknown): string {
  const d = (e as { response?: { data?: { message?: string | string[]; reasons?: string[] } } }).response?.data;
  if (d?.reasons?.length) return `${d.message ?? 'Not allowed'}\n• ${d.reasons.join('\n• ')}`;
  const m = d?.message;
  return Array.isArray(m) ? m.join(', ') : (m ?? 'Request failed');
}

export interface UseImportExportOptions {
  /** Registry key, e.g. 'infra.servers' or 'core.users'. */
  resource: string;
  /** Query keys to refetch after a successful import. */
  invalidate: unknown[][];
  /** How to surface a success message (default: window.alert). */
  onSuccess?: (message: string) => void;
  /** How to surface a failure message (default: window.alert). */
  onError?: (message: string) => void;
}

export function useImportExport({ resource, invalidate, onSuccess, onError }: UseImportExportOptions) {
  const qc = useQueryClient();
  const fileRef = useRef<HTMLInputElement>(null);
  const ok = onSuccess ?? ((m: string) => alert(m));
  const fail = onError ?? ((m: string) => alert(m));

  const importXlsx = async (e: ChangeEvent<HTMLInputElement>) => {
    const input = e.target;
    const f = input.files?.[0];
    if (!f) return;
    const fd = new FormData();
    fd.append('file', f);
    try {
      const r = await api.post(`/data/${resource}/import`, fd);
      const d = r.data;
      let m = `Imported: ${d.created} created, ${d.updated} updated`;
      if (d.skipped) m += `, ${d.skipped} skipped`;
      if (d.errors?.length) m += `\n\n${d.errors.join('\n')}`;
      ok(m);
      invalidate.forEach((key) => qc.invalidateQueries({ queryKey: key }));
    } catch (er) {
      fail('Import failed: ' + apiErr(er));
    }
    input.value = '';
  };

  return { fileRef, importXlsx };
}
