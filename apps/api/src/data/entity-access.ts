import { ModuleEntity } from '../rbac/entities/module.entity';
import { AppEntity } from '../rbac/entities/app.entity';
import { GroupEntity } from '../rbac/entities/group.entity';
import { PermissionEntity } from '../rbac/entities/permission.entity';
import type { AppAbility } from '../common/casl/ability.factory';
import { RESOURCE_ENTITIES } from './registry';

/** The RBAC tables have no permission of their own — they're only reachable through a user, so
 *  following a relation into them is governed by read on core.users. */
const RBAC_ENTITIES: unknown[] = [ModuleEntity, AppEntity, GroupEntity, PermissionEntity];

/** Whether this user may read the entity a relation leads to. Fails closed: an entity no permission
 *  maps to can't be followed by anyone, so a newly added relation is hidden until it's mapped.
 *  Shared by the export field tree and the search engine so both enforce the same rule. */
export function canReadEntity(ability: AppAbility, target: unknown): boolean {
  const resource = RBAC_ENTITIES.includes(target)
    ? 'core.users'
    : Object.keys(RESOURCE_ENTITIES).find((k) => RESOURCE_ENTITIES[k] === target);
  return !!resource && ability.can('read', resource);
}
