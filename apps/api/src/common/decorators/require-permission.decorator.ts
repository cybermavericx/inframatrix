import { SetMetadata } from '@nestjs/common';

export const PERMISSION_KEY = 'require_permission';

export interface RequiredPermission {
  action: string;
  resource: string;
}

/** Require a model-CRUD permission, e.g. @RequirePermission('update', 'jobbag.jobs'). */
export const RequirePermission = (action: string, resource: string) =>
  SetMetadata(PERMISSION_KEY, { action, resource } as RequiredPermission);
