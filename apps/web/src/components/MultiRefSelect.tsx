import { useEffect, useMemo, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '../lib/api';

type Row = Record<string, unknown>;

/**
 * Pick many records from an endpoint. Value is an array of ids. A compact dropdown: the closed control
 * shows the chosen records as chips; clicking it opens a type-to-filter checklist, which closes again
 * on a click outside / Escape (so a long list of people never takes over the form).
 * Reused for project developers, reminder-group members and reminder recipients.
 */
export function MultiRefSelect({
  endpoint, labelKey = 'name', value, onChange, placeholder = 'search…',
}: {
  endpoint: string;
  labelKey?: string;
  value: number[];
  onChange: (ids: number[]) => void;
  placeholder?: string;
}) {
  const { data = [] } = useQuery({
    queryKey: [endpoint],
    queryFn: async () => (await api.get(endpoint)).data as Row[],
    staleTime: 60_000,
  });
  const [q, setQ] = useState('');
  const selected = new Set(value);
  const labelOf = (o: Row) => String(o[labelKey] ?? `#${o.id}`);
  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase();
    return s ? data.filter((o) => labelOf(o).toLowerCase().includes(s)) : data;
  }, [data, q]);
  const toggle = (id: number) => {
    const n = new Set(selected);
    if (n.has(id)) n.delete(id); else n.add(id);
    onChange([...n]);
  };
  const chosen = data.filter((o) => selected.has(o.id as number));

  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => { if (box.current && !box.current.contains(e.target as Node)) setOpen(false); };
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', away);
    document.addEventListener('keydown', esc);
    return () => { document.removeEventListener('mousedown', away); document.removeEventListener('keydown', esc); };
  }, [open]);

  return (
    <div ref={box} style={{ border: '1px solid var(--border)', borderRadius: 8, background: 'var(--bg-2)' }}>
      {/* the closed control — click anywhere on it to open/close */}
      <div role="button" tabIndex={0} aria-expanded={open} onClick={() => setOpen((o) => !o)}
        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setOpen((o) => !o); } }}
        style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '6px 10px', minHeight: 38, cursor: 'pointer', flexWrap: 'wrap' }}>
        <div style={{ flex: 1, display: 'flex', flexWrap: 'wrap', gap: 4 }}>
          {chosen.length === 0 && <span className="muted" style={{ fontSize: 13.5 }}>— select —</span>}
          {chosen.map((o) => (
            <span key={String(o.id)} className="badge badge-blue" style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
              {labelOf(o)}
              <button type="button" aria-label={`Remove ${labelOf(o)}`} onClick={(e) => { e.stopPropagation(); toggle(o.id as number); }}
                style={{ background: 'none', border: 'none', color: 'inherit', cursor: 'pointer', padding: 0, lineHeight: 1 }}>×</button>
            </span>
          ))}
        </div>
        <span className="muted" aria-hidden style={{ fontSize: 11 }}>{open ? '▲' : '▼'}</span>
      </div>

      {open && (
        <div style={{ borderTop: '1px solid var(--border)', padding: 6 }}>
          <input className="input" autoFocus style={{ marginBottom: 4 }} placeholder={placeholder} value={q} onChange={(e) => setQ(e.target.value)} />
          <div style={{ maxHeight: 180, overflow: 'auto' }}>
            {filtered.length === 0 && <div className="muted" style={{ fontSize: 12.5, padding: 6 }}>No matches.</div>}
            {filtered.map((o) => (
              <label key={String(o.id)} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '4px 6px', cursor: 'pointer', fontSize: 13.5 }}>
                <input type="checkbox" checked={selected.has(o.id as number)} onChange={() => toggle(o.id as number)} />
                {labelOf(o)}
              </label>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
