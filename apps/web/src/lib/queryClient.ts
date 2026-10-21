import { MutationCache, QueryClient } from '@tanstack/react-query';

// staleTime keeps data "fresh" so revisiting a screen is instant (no loading buffer)
export const queryClient: QueryClient = new QueryClient({
  // Any successful save/delete/import/tag change may have written change-log rows — refresh every
  // open or cached Activity timeline, so it never lags behind what was just saved (the 30s staleTime
  // below would otherwise show a timeline that is missing the edit you just made).
  mutationCache: new MutationCache({
    onSuccess: () => { void queryClient.invalidateQueries({ queryKey: ['/audit'] }); },
  }),
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      gcTime: 5 * 60_000,
      refetchOnWindowFocus: false,
      retry: 1,
    },
  },
});
