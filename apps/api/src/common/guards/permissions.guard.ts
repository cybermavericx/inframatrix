import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PERMISSION_KEY, RequiredPermission } from '../decorators/require-permission.decorator';
import { buildAbility } from '../casl/ability.factory';
import { AuthUser } from '../../auth/auth.types';

@Injectable()
export class PermissionsGuard implements CanActivate {
  constructor(private reflector: Reflector) {}

  canActivate(ctx: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<RequiredPermission>(PERMISSION_KEY, [
      ctx.getHandler(),
      ctx.getClass(),
    ]);
    if (!required) return true;

    const user = ctx.switchToHttp().getRequest().user as AuthUser | undefined;
    const ability = buildAbility(user?.permissions ?? []);
    if (!ability.can(required.action, required.resource)) {
      throw new ForbiddenException(
        `Missing permission: ${required.action} ${required.resource}`,
      );
    }
    return true;
  }
}
