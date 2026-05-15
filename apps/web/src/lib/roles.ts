import type { AuthUser, UserRole } from '@biip-finansai/shared';

export const ROLE_LABELS: Record<UserRole, string> = {
  am_admin: 'AM administratorius',
  am_user: 'AM specialistas',
  org_admin: 'Org. administratorius',
  org_user: 'Org. specialistas',
};

export function isAmRole(role: UserRole): boolean {
  return role === 'am_admin' || role === 'am_user';
}

export function isAdmin(role: UserRole): boolean {
  return role === 'am_admin' || role === 'org_admin';
}

export function canManageUsers(user: AuthUser | null): boolean {
  if (!user) return false;
  return user.role === 'am_admin' || user.role === 'org_admin';
}
