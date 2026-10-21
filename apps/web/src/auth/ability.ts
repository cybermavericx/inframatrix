import { AbilityBuilder, createMongoAbility, type MongoAbility } from '@casl/ability';
import type { PermissionClaim } from './types';

export type AppAbility = MongoAbility<[string, string]>;

export function buildAbility(permissions: PermissionClaim[]): AppAbility {
  const { can, build } = new AbilityBuilder<AppAbility>(createMongoAbility);
  for (const p of permissions ?? []) {
    can(p.action, p.resource);
  }
  return build();
}
