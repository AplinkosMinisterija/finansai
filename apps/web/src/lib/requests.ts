import type { AuthUser, FinancingRequest, RequestStatus } from '@biip-finansai/shared';

export const STATUS_LABELS: Record<RequestStatus, string> = {
  DRAFT: 'Juodraštis',
  SUBMITTED: 'Pateiktas',
  RETURNED: 'Grąžintas pataisymui',
  APPROVED: 'Patvirtintas',
  REJECTED: 'Atmestas',
};

export const STATUS_VARIANTS: Record<
  RequestStatus,
  'default' | 'outline' | 'success' | 'warning' | 'destructive'
> = {
  DRAFT: 'outline',
  SUBMITTED: 'default',
  RETURNED: 'warning',
  APPROVED: 'success',
  REJECTED: 'destructive',
};

export function fmtEur(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return '—';
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n)) return '—';
  return n.toLocaleString('lt-LT', {
    style: 'currency',
    currency: 'EUR',
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  });
}

export function fmtDate(value: string | null | undefined): string {
  if (!value) return '—';
  try {
    return new Date(value).toLocaleDateString('lt-LT');
  } catch {
    return '—';
  }
}

export function fmtDateTime(value: string | null | undefined): string {
  if (!value) return '—';
  try {
    const d = new Date(value);
    return `${d.toLocaleDateString('lt-LT')} ${d.toLocaleTimeString('lt-LT', { hour: '2-digit', minute: '2-digit' })}`;
  } catch {
    return '—';
  }
}

export function totalRequested(r: FinancingRequest): number {
  return (
    Number(r.costEquipment) +
    Number(r.costCreation) +
    Number(r.costAnalysis) +
    Number(r.costDevelopment) +
    Number(r.costMaintenance) +
    Number(r.costModernization) +
    Number(r.costDecommissioning)
  );
}

export function totalQuarterly(r: FinancingRequest): number {
  return Number(r.q1Amount) + Number(r.q2Amount) + Number(r.q3Amount) + Number(r.q4Amount);
}

/**
 * Kas gali kurti naują prašymą:
 *  - Visi pavaldžių institucijų vartotojai (admin/user) — savo organizacijai
 *  - AM administratoriai — kitos organizacijos vardu (su tenant picker)
 */
export function canCreate(user: AuthUser | null): boolean {
  if (!user) return false;
  if (!user.tenantIsApprover) return true;
  return user.role === 'admin';
}

/** Ar AM admin'as kuria prašymą kitos organizacijos vardu. */
export function isCreateOnBehalf(user: AuthUser | null): boolean {
  return user !== null && user.tenantIsApprover && user.role === 'admin';
}

/** Edit'inti gali tik teikėjas (DRAFT/RETURNED). AM admin'as — savo „on behalf" prašymus. */
export function canEdit(user: AuthUser | null, r: FinancingRequest): boolean {
  if (!user) return false;
  if (r.status !== 'DRAFT' && r.status !== 'RETURNED') return false;
  if (user.tenantIsApprover) {
    return user.role === 'admin' && r.createdByUserId === user.id;
  }
  if (r.tenantId !== user.tenantId) return false;
  if (user.role === 'admin') return true;
  return r.createdByUserId === user.id;
}

export function canSubmit(user: AuthUser | null, r: FinancingRequest): boolean {
  return canEdit(user, r);
}

/** Tvirtinti gali tik aprover'iai (AM) SUBMITTED prašymus, pagal scope. */
export function canDecide(user: AuthUser | null, r: FinancingRequest): boolean {
  if (!user) return false;
  if (!user.tenantIsApprover) return false;
  if (r.status !== 'SUBMITTED') return false;
  if (user.role === 'admin') return true;
  if (user.amScopeOrgIds === null) return true;
  return user.amScopeOrgIds.includes(r.tenantId);
}

export function canDelete(user: AuthUser | null, r: FinancingRequest): boolean {
  if (!user) return false;
  if (r.status !== 'DRAFT') return false;
  return canEdit(user, r);
}

/**
 * UAT #42 (PA-010): ar prašymo įgyvendinimo terminas praėjęs.
 *
 * `true` tik kai:
 *  - terminas nustatytas (`implementationDeadline` ne null/tuščias),
 *  - data praeityje (< šiandien),
 *  - prašymas NE galutinės būsenos (ne REJECTED) — atmesto termino nebeflag'inam.
 *
 * Patvirtinti (APPROVED) ir aktyvūs (SUBMITTED/RETURNED/DRAFT) — flag'inami,
 * nes įgyvendinimo terminas vis dar prasmingas.
 */
export function isDeadlineOverdue(r: FinancingRequest, now: Date = new Date()): boolean {
  if (!r.implementationDeadline) return false;
  if (r.status === 'REJECTED') return false;
  const deadline = new Date(r.implementationDeadline);
  if (Number.isNaN(deadline.getTime())) return false;
  // Lyginam tik datą (be laiko) — šiandien terminas dar NEpraėjęs.
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const dl = new Date(deadline.getFullYear(), deadline.getMonth(), deadline.getDate());
  return dl < today;
}
