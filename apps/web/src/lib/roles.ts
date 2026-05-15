/**
 * Role'ių helper'iai.
 *
 * Sistema turi tik DVI role'es — `admin` ir `user`. Semantika priklauso nuo
 * vartotojo tenant'o `isApprover` lauko:
 *
 *  - tenantIsApprover === true (AM):
 *      admin → visapusis administratorius (CRUD tenants/users, mato + tvirtina visus prašymus)
 *      user  → AM specialistas (mato + tvirtina tik priskirto scope prašymus)
 *  - tenantIsApprover === false (pavaldi institucija):
 *      admin → org. administratorius (valdo savo vartotojus + mato/teikia visus org prašymus)
 *      user  → org. specialistas (teikia savo prašymus)
 */
import type { AuthUser, UserRole } from '@biip-finansai/shared';

export const ROLE_LABELS: Record<UserRole, string> = {
  admin: 'Administratorius',
  user: 'Specialistas',
};

/** Sukombinuota etiketė: „AM administratorius", „LGT specialistas" ir t.t. */
export function roleLabel(user: Pick<AuthUser, 'role' | 'tenantIsApprover' | 'tenantCode'>): string {
  const label = ROLE_LABELS[user.role] ?? String(user.role ?? 'vartotojas');
  const role = label.toLowerCase();
  const prefix = user.tenantIsApprover ? 'AM' : user.tenantCode;
  return `${prefix} ${role}`;
}

/** Šis vartotojas iš tvirtintojų (AM). */
export function isApprover(user: AuthUser | null): boolean {
  return user?.tenantIsApprover === true;
}

/** Šis vartotojas yra teikėjas (pavaldžios institucijos). */
export function isSubmitter(user: AuthUser | null): boolean {
  return user !== null && user.tenantIsApprover === false;
}

/** Ar vartotojas gali valdyti vartotojus (admin role + tinkamas scope). */
export function canManageUsers(user: AuthUser | null): boolean {
  if (!user) return false;
  return user.role === 'admin';
}

/** AM administratoriai gali valdyti organizacijas. */
export function canManageTenants(user: AuthUser | null): boolean {
  if (!user) return false;
  return user.tenantIsApprover && user.role === 'admin';
}
