export interface PermissionClaim {
  action: string;
  resource: string;
}

/** Decoded JWT payload, attached to req.user */
export interface JwtPayload {
  sub: number;
  email: string;
  modules: string[];
  permissions: PermissionClaim[];
}

export type AuthUser = JwtPayload;
