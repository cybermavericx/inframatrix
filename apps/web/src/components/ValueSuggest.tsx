import { useEffect, useId, useState, type KeyboardEvent } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '../lib/api';

// Text input with suggestions from the field's existing values (GET /data/:resource/values), for the
// Filter & group value box. Asks 200 ms after typing stops and caches per text, so typing doesn't
// flood the server. ↑/↓ move, Enter picks, Esc closes. In list mode ("value1, value2") it completes
// the value after the last comma.

export function ValueSuggest({ resource, path, value, onChange, list = false, placeholder, type = 'text' }: {
  resource: string; path: string; value: string; onChange: (v: string) => void; list?: boolean; placeholder?: string; type?: string;
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
    enabled: open && !!path,
    staleTime: 60_000,
  });
  const options = (data?.values ?? []).filter((v) => v !== token);

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
