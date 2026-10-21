import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { MODULE_KEY } from '../decorators/require-module.decorator';
import { AuthUser } from '../../auth/auth.types';

@Injectable()
export class ModuleGuard implements CanActivate {
  constructor(private reflector: Reflector) {}

  canActivate(ctx: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<string>(MODULE_KEY, [
      ctx.getHandler(),
      ctx.getClass(),
    ]);
    if (!required) return true;

    const user = ctx.switchToHttp().getRequest().user as AuthUser | undefined;
    if (!user?.modules?.includes(required)) {
      throw new ForbiddenException(`No access to module: ${required}`);
    }
    return true;
  }
}
