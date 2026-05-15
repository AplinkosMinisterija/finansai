/**
 * Bendri TS tipai tarp API ir Web aplikacijų.
 *
 * Konvencijos:
 *  - camelCase laukai (snake_case tik DB-internal)
 *  - Datos kaip ISO 8601 stringai
 *  - Pinigų sumos perduodamos kaip `string` (decimal preservation), UI parseina į number
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
  isApprover: boolean;
  active: boolean;
};

// ---------- Auth ----------

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

/**
 * Finansavimo prašymo objektas. Pinigų sumos — string (decimal preservation).
 */
export type FinancingRequest = {
  id: number;
  tenantId: number;
  tenantCode: string;
  tenantName: string;
  createdByUserId: number;
  createdByName: string;
  status: RequestStatus;

  // Step 1
  projectName: string;
  systemCode: string | null;
  projectType: string | null;
  description: string | null;
  plannedWorks: string | null;
  priority: number | null;
  procurementStage: string | null;

  // Step 2
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

  // Step 3
  q1Amount: string;
  q2Amount: string;
  q3Amount: string;
  q4Amount: string;

  // Step 4
  responsibleInstitution: string | null;
  executorName: string | null;
  executorEmail: string | null;
  implementationDeadline: string | null;
  submitterNotes: string | null;

  // Step 5 (AM)
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

/**
 * Visi laukai, kuriuos submitter gali pildyti (be sprendimo).
 * Naudojamas tiek create, tiek update PATCH (visi optional).
 */
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
  year: number;
  stats: DashboardStats;
  actionable: FinancingRequest[];
  pendingReview: FinancingRequest[];
  recentActivity: DashboardActivityItem[];
  perTenantBreakdown?: DashboardPerTenantStats[];
};
