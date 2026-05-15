/**
 * Bendri TS tipai tarp API ir Web aplikacijų.
 *
 * Konvencijos:
 *  - camelCase laukai (snake_case tik DB-internal)
 *  - Datos kaip ISO 8601 stringai
 *  - ID'ai kaip number (PostgreSQL serial)
 */

// ---------- Bendri ----------

export type HealthResponse = {
  status: 'ok' | 'degraded' | 'down';
  node: string;
  uptime: number;
  version: string;
};

export type PingResponse = {
  ok: true;
  ts: string;
};

export type ApiError = {
  code: string;
  message: string;
  data?: Record<string, unknown>;
};

export type PaginatedResponse<T> = {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
};

// ---------- Tenants ----------

export type Tenant = {
  id: number;
  code: string; // 'AM', 'AAD', 'VSTT', 'LGT'
  name: string;
  isApprover: boolean; // tik AM
  active: boolean;
};

// ---------- Auth ----------

/**
 * Role'ės:
 * - `am_admin` — AM administratorius: visi vartotojai + visos paraiškos
 * - `am_user`  — AM darbuotojas: scope org'ų paraiškos
 * - `org_admin` — pavaldžios institucijos administratorius: savo org vartotojai + visos savo org paraiškos
 * - `org_user`  — pavaldžios institucijos vartotojas: tik savo (=user) paraiškos
 */
export type UserRole = 'am_admin' | 'am_user' | 'org_admin' | 'org_user';

export type AuthUser = {
  id: number;
  username: string;
  fullName: string;
  email: string | null;
  role: UserRole;
  tenantId: number;
  tenantCode: string;
  tenantName: string;
  /** AM userio scope — kuriose org'uose mato paraiškas. NULL = visos. */
  amScopeOrgIds: number[] | null;
};

export type AuthLoginRequest = {
  username: string;
  password: string;
};

export type AuthLoginResponse = {
  user: AuthUser;
};

export type AuthMeResponse = {
  user: AuthUser;
};

// ---------- Users ----------

export type User = {
  id: number;
  username: string;
  fullName: string;
  email: string | null;
  role: UserRole;
  tenantId: number;
  tenantCode: string;
  tenantName: string;
  amScopeOrgIds: number[] | null;
  active: boolean;
  createdAt: string;
  updatedAt: string;
};

export type UserCreateRequest = {
  username: string;
  password: string;
  fullName: string;
  email?: string | null;
  role: UserRole;
  tenantId: number;
  amScopeOrgIds?: number[] | null;
  active?: boolean;
};

export type UserUpdateRequest = {
  username?: string;
  password?: string;
  fullName?: string;
  email?: string | null;
  role?: UserRole;
  tenantId?: number;
  amScopeOrgIds?: number[] | null;
  active?: boolean;
};

export type UserListQuery = {
  q?: string;
  tenantId?: number;
  page?: number;
  pageSize?: number;
};
