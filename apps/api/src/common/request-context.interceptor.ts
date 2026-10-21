import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { Observable } from 'rxjs';
import { runWithContext } from './request-context';
import type { JwtPayload } from '../auth/auth.types';

/** Establishes the per-request user context (see request-context.ts) so the change-log can record
 *  who edited a record. Wraps the downstream subscription inside AsyncLocalStorage.run so the
 *  context survives the controller/service await chain. Registered globally via APP_INTERCEPTOR. */
@Injectable()
export class RequestContextInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const req = context.switchToHttp().getRequest<{ user?: JwtPayload }>();
    const u = req?.user;
    const ctx = { userId: u?.sub ?? null, userName: u?.email ?? null };
    return new Observable((subscriber) => {
      runWithContext(ctx, () =>
        next.handle().subscribe({
          next: (v) => subscriber.next(v),
          error: (e) => subscriber.error(e),
          complete: () => subscriber.complete(),
        }),
      );
    });
  }
}
