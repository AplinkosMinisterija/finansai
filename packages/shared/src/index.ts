/**
 * Bendri TS tipai tarp API ir Web aplikacijų.
 *
 * Konvencijos:
 *  - camelCase laukai (snake_case tik DB-internal)
 *  - Datos kaip ISO 8601 stringai
 *  - Pinigų sumos perduodamos kaip `string` (decimal preservation)
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
  code: string;
  name: string;
  /** Aprašymas — pvz. „Pavaldi įstaiga, vykdanti aplinkos apsaugos kontrolę". */
  description: string | null;
  /**
   * Ar tenant'as gali tvirtinti prašymus. AM = true; pavaldžios institucijos = false.
   * Šis flag'as nustato role'es teisės (admin/user) tikslią reikšmę.
   */
  isApprover: boolean;
  active: boolean;
  /** Naudotojų skaičius (užkrautas serveryje, kai prašoma). */
  usersCount?: number;
  /** Prašymų skaičius (užkrautas serveryje, kai prašoma). */
  requestsCount?: number;
};

export type TenantCreateRequest = {
  code: string;
  name: string;
  description?: string | null;
  isApprover?: boolean;
  active?: boolean;
};

export type TenantUpdateRequest = {
  code?: string;
  name?: string;
  description?: string | null;
  isApprover?: boolean;
  active?: boolean;
};

// ---------- Auth ----------

/**
 * Dvi rolės — `admin` ir `user`.
 *
 * Ką role'ė reiškia, priklauso nuo vartotojo tenant'o:
 * - Jei tenant.is_approver = true (AM):
 *   - admin → mato + tvirtina VISŲ organizacijų prašymus; valdo AM vartotojus
 *   - user  → mato + tvirtina tik scope organizacijų prašymus
 * - Jei tenant.is_approver = false (pavaldi institucija):
 *   - admin → valdo savo org vartotojus + mato/teikia visus org prašymus
 *   - user  → mato/teikia tik savo (=user) prašymus
 *
 * `amScopeOrgIds` aktualus tik užvirš `user` rolei aprover tenant'e.
 */
export type UserRole = 'admin' | 'user';

export type AuthUser = {
  id: number;
  username: string;
  fullName: string;
  email: string | null;
  role: UserRole;
  tenantId: number;
  tenantCode: string;
  tenantName: string;
  /** Ar šis vartotojas iš tvirtintojų tenant'o (AM). */
  tenantIsApprover: boolean;
  /** Kuriose org'ose AM specialistas mato prašymus. NULL = visos (arba neaktualu). */
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
  tenantIsApprover: boolean;
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

// ---------- Requests ----------

export type RequestStatus =
  | 'DRAFT'
  | 'SUBMITTED'
  | 'RETURNED'
  | 'APPROVED'
  | 'REJECTED';

export type RequestCommentKind =
  | 'comment'
  | 'status_change'
  | 'submitted'
  | 'returned'
  | 'approved'
  | 'rejected';

export type RequestComment = {
  id: number;
  requestId: number;
  authorUserId: number;
  authorName: string;
  authorRole: UserRole;
  kind: RequestCommentKind;
  body: string | null;
  metadata: Record<string, unknown> | null;
  createdAt: string;
};

export type FinancingRequest = {
  id: number;
  tenantId: number;
  tenantCode: string;
  tenantName: string;
  createdByUserId: number;
  createdByName: string;
  status: RequestStatus;

  projectName: string;
  systemCode: string | null;
  projectType: string | null;
  description: string | null;
  plannedWorks: string | null;
  priority: number | null;
  procurementStage: string | null;

  costDu: string;
  costEquipment: string;
  costCreation: string;
  costAnalysis: string;
  costDevelopment: string;
  costMaintenance: string;
  costModernization: string;
  costDecommissioning: string;
  fundingFromIt: string;
  otherFunds: string;
  otherFundsSource: string | null;

  q1Amount: string;
  q2Amount: string;
  q3Amount: string;
  q4Amount: string;

  responsibleInstitution: string | null;
  executorName: string | null;
  executorEmail: string | null;
  implementationDeadline: string | null;
  submitterNotes: string | null;

  decisionGrantedAmount: string | null;
  decisionFundingSource: string | null;
  decisionProtocol: string | null;
  decisionOrder: string | null;
  decidedAt: string | null;
  decidedByUserId: number | null;
  decidedByName: string | null;

  submittedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type FinancingRequestDetail = FinancingRequest & {
  comments: RequestComment[];
};

export type RequestPayload = {
  projectName?: string;
  systemCode?: string | null;
  projectType?: string | null;
  description?: string | null;
  plannedWorks?: string | null;
  priority?: number | null;
  procurementStage?: string | null;

  costDu?: number | string;
  costEquipment?: number | string;
  costCreation?: number | string;
  costAnalysis?: number | string;
  costDevelopment?: number | string;
  costMaintenance?: number | string;
  costModernization?: number | string;
  costDecommissioning?: number | string;
  fundingFromIt?: number | string;
  otherFunds?: number | string;
  otherFundsSource?: string | null;

  q1Amount?: number | string;
  q2Amount?: number | string;
  q3Amount?: number | string;
  q4Amount?: number | string;

  responsibleInstitution?: string | null;
  executorName?: string | null;
  executorEmail?: string | null;
  implementationDeadline?: string | null;
  submitterNotes?: string | null;
};

export type RequestListQuery = {
  q?: string;
  status?: RequestStatus;
  tenantId?: number;
  page?: number;
  pageSize?: number;
};

export type RequestDecisionPayload = {
  decision: 'approve' | 'reject' | 'return';
  comment?: string;
  grantedAmount?: number | string;
  fundingSource?: string;
  protocol?: string;
  order?: string;
};

// ---------- Dashboard ----------

export type DashboardStats = {
  totalRequests: number;
  byStatus: {
    DRAFT: number;
    SUBMITTED: number;
    RETURNED: number;
    APPROVED: number;
    REJECTED: number;
  };
  totalRequestedThisYear: number;
  totalApprovedThisYear: number;
  usersCount: number;
};

export type DashboardActivityItem = {
  requestId: number;
  projectName: string;
  tenantCode: string;
  kind: RequestCommentKind;
  body: string | null;
  authorName: string;
  authorRole: UserRole;
  createdAt: string;
};

export type DashboardPerTenantStats = {
  tenantId: number;
  tenantCode: string;
  tenantName: string;
  total: number;
  byStatus: {
    DRAFT: number;
    SUBMITTED: number;
    RETURNED: number;
    APPROVED: number;
    REJECTED: number;
  };
  totalRequested: number;
  totalApproved: number;
};

export type DashboardData = {
  role: UserRole;
  tenantIsApprover: boolean;
  year: number;
  stats: DashboardStats;
  actionable: FinancingRequest[];
  pendingReview: FinancingRequest[];
  recentActivity: DashboardActivityItem[];
  perTenantBreakdown?: DashboardPerTenantStats[];
  /** Mėnesinis pateikimų ir patvirtinimų trendas (12 mėn). */
  monthlyTrend: Array<{
    month: string; // YYYY-MM
    submitted: number;
    approved: number;
  }>;
};
