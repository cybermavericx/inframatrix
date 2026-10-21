import { SetMetadata } from '@nestjs/common';

export const MODULE_KEY = 'require_module';

/** Require access to a module, e.g. @RequireModule('infra'). */
export const RequireModule = (moduleKey: string) =>
  SetMetadata(MODULE_KEY, moduleKey);
