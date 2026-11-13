import { useEffect, useId, useState, type KeyboardEvent } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '../lib/api';

// Text input with suggestions from the field's existing values. Two sources:
// - server (resource + path): GET /data/:resource/values, for the Filter & group value box. Asks
//   200 ms after typing stops and caches per text, so typing doesn't flood the server.
// - local (values): a list the page already has (the Quick filter's values from the loaded rows),
//   matched here the same way: contains the text, case-insensitive, values starting with it first, ≤ 20.
// ↑/↓ move, Enter picks, Esc closes. In list mode ("value1, value2") it completes the value after
// the last comma.

const MAX_SUGGESTIONS = 20;

function matchLocal(values: string[], q: string): string[] {
  const t = q.trim().toLowerCase();
  if (!t) return values.slice(0, MAX_SUGGESTIONS);
  const starts: string[] = [], contains: string[] = [];
  for (const v of values) {
    const l = v.toLowerCase();
    if (l.startsWith(t)) starts.push(v);
    else if (l.includes(t)) contains.push(v);
    if (starts.length >= MAX_SUGGESTIONS) break;
  }
  return [...starts, ...contains].slice(0, MAX_SUGGESTIONS);
}

export function ValueSuggest({ resource, path, values, value, onChange, list = false, placeholder, type = 'text' }: {
  resource?: string; path?: string; values?: string[]; value: string; onChange: (v: string) => void; list?: boolean; placeholder?: string; type?: string;
}) {
  const id = useId();
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const token = list ? value.slice(value.lastIndexOf(',') + 1).trim() : value;
  const [q, setQ] = useState(token);
  useEffect(() => { const t = window.setTimeout(() => setQ(token), 200); return () => window.clearTimeout(t); }, [token]);

  const { data } = useQuery({
    queryKey: ['field-values', resource, path, q],
    queryFn: async () => (await api.get(`/data/${resource}/values`, { params: { path, q } })).data as { values: string[] },
    enabled: open && !values && !!resource && !!path,
    staleTime: 60_000,
  });
  const options = (values ? matchLocal(values, token) : (data?.values ?? [])).filter((v) => v !== token);

  const pick = (v: string) => {
    if (list) {
      const head = value.slice(0, value.lastIndexOf(',') + 1);
      onChange(`${head}${head ? ' ' : ''}${v}, `);
    } else onChange(v);
    setActive(-1);
    if (!list) setOpen(false);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (!open || !options.length) return;
    if (e.key === 'ArrowDown') { e.preventDefault(); setActive((a) => (a + 1) % options.length); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive((a) => (a <= 0 ? options.length - 1 : a - 1)); }
    else if (e.key === 'Enter' && active >= 0) { e.preventDefault(); pick(options[active]); }
    else if (e.key === 'Escape') { e.preventDefault(); setOpen(false); }
  };

  return (
    <div className="suggest" style={{ flex: 1 }}>
      <input
        className="input" type={type} value={value} placeholder={placeholder}
        role="combobox" aria-autocomplete="list" aria-expanded={open && options.length > 0} aria-controls={id}
        aria-activedescendant={active >= 0 ? `${id}-${active}` : undefined}
        onChange={(e) => { onChange(e.target.value); setOpen(true); setActive(-1); }}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        onKeyDown={onKeyDown}
      />
      {open && options.length > 0 && (
        <ul className="suggest-list" id={id} role="listbox">
          {options.map((o, i) => (
            <li key={o} id={`${id}-${i}`} role="option" aria-selected={i === active}
              className={'suggest-item' + (i === active ? ' active' : '')}
              // mousedown (not click) so the pick lands before the input's blur closes the list
              onMouseDown={(e) => { e.preventDefault(); pick(o); }}>
              {o}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
