import type {
  AuthUser,
  FinancingRequest,
  RequestStatus,
} from '@biip-finansai/shared';

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
  return (
    Number(r.q1Amount) +
    Number(r.q2Amount) +
    Number(r.q3Amount) +
    Number(r.q4Amount)
  );
}

/** Submitter (org_admin/org_user) gali kurti naują prašymą. */
export function canCreate(user: AuthUser | null): boolean {
  if (!user) return false;
  return user.role === 'org_admin' || user.role === 'org_user';
}

/** Submitter gali redaguoti DRAFT/RETURNED, jei jis savininkas (org_user) ar org_admin. */
export function canEdit(user: AuthUser | null, r: FinancingRequest): boolean {
  if (!user) return false;
  if (r.status !== 'DRAFT' && r.status !== 'RETURNED') return false;
  if (r.tenantId !== user.tenantId) return false;
  if (user.role === 'org_admin') return true;
  if (user.role === 'org_user') return r.createdByUserId === user.id;
  return false;
}

/** Org_user/org_admin gali submitinti savo prašymą jei DRAFT/RETURNED. */
export function canSubmit(user: AuthUser | null, r: FinancingRequest): boolean {
  return canEdit(user, r);
}

/** AM rolės gali decide jei SUBMITTED ir tenant scope leidžia. */
export function canDecide(user: AuthUser | null, r: FinancingRequest): boolean {
  if (!user) return false;
  if (r.status !== 'SUBMITTED') return false;
  if (user.role === 'am_admin') return true;
  if (user.role === 'am_user') {
    if (user.amScopeOrgIds === null) return true;
    return user.amScopeOrgIds.includes(r.tenantId);
  }
  return false;
}

/** Submitter gali ištrinti DRAFT. */
export function canDelete(user: AuthUser | null, r: FinancingRequest): boolean {
  if (!user) return false;
  if (r.status !== 'DRAFT') return false;
  if (r.tenantId !== user.tenantId) return false;
  if (user.role === 'org_admin') return true;
  if (user.role === 'org_user') return r.createdByUserId === user.id;
  return false;
}
