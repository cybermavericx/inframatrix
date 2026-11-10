import { useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { api } from '../lib/api';
import { readServerView, SF_PARAM, type ServerView } from '../lib/serverFilter';

type IdsResult = { total: number; ids: number[]; keys?: unknown[][]; capped: boolean };

/**
 * The server-side Filter / Group-by of a list (phase 4). State lives in the URL (?sf=…); the API
 * returns the matching ids (+ each one's group-key values), and the page narrows and buckets the rows
 * it already has — so its own columns, badges and row actions stay exactly as they are.
 * `resource` undefined → the panel isn't offered on that page.
 */
export function useServerView(resource?: string) {
  const [params, setParams] = useSearchParams();
  const raw = params.get(SF_PARAM);
  const state = useMemo(() => readServerView(raw), [raw]);
  const enabled = !!resource && !!state;

  const q = useQuery({
    queryKey: ['search-ids', resource, raw],
    enabled,
    placeholderData: keepPreviousData,
    queryFn: async () => {
      const body: Record<string, unknown> = { output: 'ids' };
      if (state?.f) body.filter = state.f;
      if (state?.g?.length) body.groupBy = state.g;
      return (await api.post(`/data/${resource}/search`, body)).data as IdsResult;
    },
  });

  const set = (next: ServerView | null) => setParams((p) => {
    const n = new URLSearchParams(p);
    if (next && ((next.f && next.f.items.length) || next.g?.length)) n.set(SF_PARAM, JSON.stringify(next)); else n.delete(SF_PARAM);
    return n;
  });

  const data = enabled ? q.data : undefined;
  const ids = useMemo(() => (data && state?.f ? new Set(data.ids) : null), [data, state?.f]);
  const keysById = useMemo(() => {
    if (!data?.keys || !state?.g?.length) return null;
    const m = new Map<number, unknown[]>();
    data.ids.forEach((id, i) => m.set(id, data.keys![i]));
    return m;
  }, [data, state?.g?.length]);

  const err = q.error as { response?: { data?: { message?: string | string[] } } } | null;
  const errMsg = err ? [err.response?.data?.message ?? 'The filter could not be applied.'].flat().join(', ') : '';

  return {
    available: !!resource,
    state,
    set,
    clear: () => set(null),
    active: enabled,
    loading: enabled && q.isFetching,
    error: enabled ? errMsg : '',
    /** null = no server filter (every row passes) */
    ids,
    /** id → group-key values, when grouping on the server */
    keysById,
    capped: !!data?.capped,
    total: data?.total ?? 0,
  };
}

export type ServerViewHandle = ReturnType<typeof useServerView>;
