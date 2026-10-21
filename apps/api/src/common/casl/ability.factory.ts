import { AbilityBuilder, createMongoAbility, MongoAbility } from '@casl/ability';
import { PermissionClaim } from '../../auth/auth.types';

/** Ability over [action, subject] pairs, e.g. can('update', 'jobbag.jobs'). */
export type AppAbility = MongoAbility<[string, string]>;

export function buildAbility(permissions: PermissionClaim[]): AppAbility {
  const { can, build } = new AbilityBuilder<AppAbility>(createMongoAbility);
  for (const p of permissions ?? []) {
    can(p.action, p.resource);
  }
  return build();
}
