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

/** AM administratoriai gali valdyti klasifikatorius. */
export function canManageClassifiers(user: AuthUser | null): boolean {
  if (!user) return false;
  return user.tenantIsApprover && user.role === 'admin';
}

/** AM administratoriai gali valdyti biudžetą. */
export function canManageBudget(user: AuthUser | null): boolean {
  if (!user) return false;
  return user.tenantIsApprover && user.role === 'admin';
}

/**
 * Ar vartotojas gali matyti DU duomenis (Iter 13, FVM-5, docx §4.4).
 *
 * SAUGUMO REIKALAVIMAS (docx §4.4 explicit): „Specialistas savo duomenų NEmato".
 *  - AM administratorius (tenantIsApprover + admin) → TAIP (visi tenant'ai)
 *  - Org administratorius (admin, ne AM) → TAIP (tik savo tenant'as; tenant scope
 *    forsuojamas backende per `requireDuAccess`)
 *  - Org specialistas (user role) → NIEKADA (net savo profilį)
 *  - Neprisijungęs → NIEKADA
 *
 * Naudojama 3 lygmenyse: route guard `/du`, sidebar punktas, dialog'ų vidus.
 */
export function canViewPayroll(user: AuthUser | null): boolean {
  if (!user) return false;
  if (user.role !== 'admin') return false;
  // AM admin — visi tenant'ai.
  if (user.tenantIsApprover) return true;
  // Org admin — savo tenant'as (server forsuoja tenant scope).
  return true;
}

/**
 * Ar vartotojas gali kviesti mėnesio DU apskaičiavimą.
 *
 * Tik AM administratorius (tenantIsApprover + admin). Org admin'as gali matyti
 * profilius/paskirstymus, bet mėnesio compute yra cross-tenant operacija, kuri
 * sukuria expense'us — todėl tik AM.
 */
export function canComputePayroll(user: AuthUser | null): boolean {
  if (!user) return false;
  return user.tenantIsApprover && user.role === 'admin';
}
