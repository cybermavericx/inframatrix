import { AsyncLocalStorage } from 'async_hooks';

/** The acting user for the current request, captured so non-request-scoped code (the CrudService
 *  change-log writer, the audit subscriber) can record *who* made a change without threading the
 *  request object through every service call. Populated by RequestContextInterceptor. */
export interface ReqCtx {
  userId?: number | null;
  userName?: string | null;
}

const storage = new AsyncLocalStorage<ReqCtx>();

/** Run `fn` with the given request context active (and propagated across its awaited async chain). */
export function runWithContext<T>(ctx: ReqCtx, fn: () => T): T {
  return storage.run(ctx, fn);
}

/** The acting user for the current async context, or an empty object outside any request. */
export function currentUser(): ReqCtx {
  return storage.getStore() ?? {};
}
