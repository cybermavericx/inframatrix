export interface PermissionClaim {
  action: string;
  resource: string;
}

export interface AuthUser {
  id: number;
  name: string;
  email: string;
  modules: string[];
  permissions: PermissionClaim[];
}

// RBAC structure (from GET /rbac/structure)
export interface RbacGroup {
  id: number;
  key: string;
  label: string;
  kind: 'level' | 'standalone';
  level: number | null;
  appId: number | null;
}

export interface RbacApp {
  id: number;
  key: string;
  label: string;
  sort: number;
  groups: RbacGroup[];
}

export interface RbacModule {
  id: number;
  key: string;
  label: string;
  sort: number;
  apps: RbacApp[];
}
