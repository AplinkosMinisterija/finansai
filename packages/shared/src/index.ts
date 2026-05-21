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

/**
 * Spec.programos finansavimo tipas (Iter 10 / docx §2.3, P02).
 *
 * - `atskiras` — Su atskiru finansavimu (rinkliavos, mokesčiai, spec.fondai).
 * - `biudzeto_dalis` — Iš bendrojo biudžeto (atskira eilutė VB sudėtyje).
 *
 * Naudojamas tik kai prašymo `budgetCategory` = `spec_programa`. Aliasas tas
 * pats kaip `SpecProgTipas` iš `./fvm` — vartojame skirtingus pavadinimus
 * prašymo (Iter 10) ir budget_allocation (Iter 9) kontekstuose.
 */
export type SpecProgramFundingType = 'atskiras' | 'biudzeto_dalis';

/**
 * Pagal `year` skiriama:
 *  - year === currentYear → įprastas einamųjų metų prašymas
 *  - year  >  currentYear → planas (issue #4); pateikiamas paprastai, atėjus
 *    jo metams gali būti perkeltas į einamųjų metų prašymą per atskirą veiksmą.
 */
export type FinancingRequest = {
  id: number;
  tenantId: number;
  tenantCode: string;
  tenantName: string;
  createdByUserId: number;
  createdByName: string;
  status: RequestStatus;
  /** Kuriai metams skirtas prašymas/planas. */
  year: number;

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

  // ---------- FVM laukai (Iter 10, P05 docx §3.1) ----------
  /** FK į classifier_items (grupė `budget_category`). Visiems nauji prašymai pildomi. */
  budgetCategoryId: number | null;
  /** Denormalizuotas budget_category klasifikatoriaus kodas (output only). */
  budgetCategoryCode?: string | null;
  /** Denormalizuotas budget_category klasifikatoriaus name (output only). */
  budgetCategoryName?: string | null;
  /** FK į classifier_items (grupė `funding_source_type`). */
  fundingSourceTypeId: number | null;
  /** Denormalizuotas funding_source_type klasifikatoriaus kodas (output only). */
  fundingSourceTypeCode?: string | null;
  /** Denormalizuotas funding_source_type klasifikatoriaus name (output only). */
  fundingSourceTypeName?: string | null;
  /**
   * Spec.programos finansavimo tipas. Naudojamas tik kai
   * `budgetCategory` = `spec_programa`.
   */
  specProgramFundingType: SpecProgramFundingType | null;
  /** FK į projects (Iter 11). Kol kas tik schema; populated bus Iter 11. */
  fvmProjectId: number | null;

  submittedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type FinancingRequestDetail = FinancingRequest & {
  comments: RequestComment[];
  /** Aprobacijos žingsniai (issue #9). AAD scope: 1 žingsnis; visa AM: N žingsnių. */
  approvalSteps: ApprovalStep[];
};

export type RequestPayload = {
  /** Metai, kuriems prašymas/planas (issue #4). Negali būti mažesnis nei current. */
  year?: number;
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

  // ---------- FVM laukai (Iter 10, P05 docx §3.1) ----------
  /** Visi opcionalūs — backward compatibility seniems prašymams. */
  budgetCategoryId?: number | null;
  fundingSourceTypeId?: number | null;
  specProgramFundingType?: SpecProgramFundingType | null;
};

export type RequestListQuery = {
  q?: string;
  status?: RequestStatus;
  tenantId?: number;
  /** Filtras pagal metus. Jei nenurodyta — visi metai. */
  year?: number;
  /** Filtruoti tik planus (year > currentYear). */
  plansOnly?: boolean;
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
  /**
   * AM patvirtinimo metu gali pakeisti biudžeto kategoriją (Iter 10, docx §3.3).
   * Jei nurodytas — overrides institucijos pasirinkimą; validation tokia pati
   * kaip per CRUD endpoint'us.
   */
  budgetCategoryId?: number | null;
  /** AM patvirtinimo metu galima pakeisti finansavimo šaltinio tipą. */
  fundingSourceTypeId?: number | null;
  /** AM patvirtinimo metu galima pakeisti spec.programos finansavimo tipą. */
  specProgramFundingType?: SpecProgramFundingType | null;
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
  /** Prašytos sumos pagal statusą (einamiems metams). */
  amountsByStatus: {
    SUBMITTED: number;
    RETURNED: number;
    APPROVED: number;
    REJECTED: number;
  };
  totalRequestedThisYear: number;
  totalApprovedThisYear: number;
  /** Atmestų prašymų suma einamais metais (pinigų prizmė, issue #6). */
  totalRejectedThisYear: number;
  usersCount: number;
};

/**
 * Pjūvis pagal biudžeto kategoriją (FVM Iter 10, docx §3.4 / P06).
 *
 * Agreguoja prašymus pagal `budget_category_id` (FK į classifier_items grupėje
 * `budget_category`). Prašymai be `budget_category_id` (NULL) į šitą stats'ą
 * neįtraukti — t.y. tik FVM-aware prašymai.
 *
 * Skiriasi nuo `CostCategoryStats`:
 *  - `BudgetCategoryStats` — FVM lygmens kategorija (du / spec_programa / ...).
 *  - `CostCategoryStats` — cost field-based (costDu / costEquipment / ...).
 */
export type BudgetCategoryStats = {
  /** classifier_items.id (budget_category grupėje). */
  categoryItemId: number;
  /** classifier_items.code, pvz. „spec_programa", „du", ... */
  categoryCode: string;
  /** classifier_items.name (LT label'as UI rodymui). */
  categoryName: string;
  /** Prašyta visose šios kategorijos užklausose (decimal string). */
  totalRequested: string;
  /** Patvirtinta APPROVED prašymuose (decimal string). */
  totalGranted: string;
  /** Prašymų skaičius su šia kategorija. */
  count: number;
};

/** Pjūvis pagal lėšų kategoriją (issue #6). */
export type CostCategoryStats = {
  /** Stabilus kodas, atitinkantis lėšų lauką. */
  key:
    | 'du'
    | 'equipment'
    | 'creation'
    | 'analysis'
    | 'development'
    | 'maintenance'
    | 'modernization'
    | 'decommissioning';
  label: string;
  /** Prašyta einamais metais (visi statusai). */
  requested: number;
  /** Patvirtinta einamais metais (proporcingai pagal patvirtintą sumą). */
  approved: number;
  /** Atmesta einamais metais (prašyta atmestose paraiškose). */
  rejected: number;
  count: number;
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

// ---------- Atsiskaitymai (issue #2) ----------

export type ReportStatus = 'DRAFT' | 'SUBMITTED';

export type RequestReport = {
  id: number;
  requestId: number;
  periodYear: number;
  /** 1-4 = ketvirtis; null = metinis. */
  periodQuarter: number | null;
  amountUsed: string;
  description: string | null;
  status: ReportStatus;
  submittedByUserId: number;
  submittedByName?: string;
  submittedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type RequestReportUpsertRequest = {
  periodYear: number;
  periodQuarter: number | null;
  amountUsed: string;
  description?: string | null;
};

// ---------- Aprobacijos workflow (issue #9) ----------

export type ApprovalStepStatus = 'PENDING' | 'APPROVED' | 'REJECTED' | 'RETURNED';

export type ApprovalStep = {
  id: number;
  requestId: number;
  sequence: number;
  /** Klasifikatoriaus item code iš grupės "approval_levels". */
  levelCode: string;
  /** Snapshot label'as (lieka net jei klasifikatorius keičiasi). */
  levelName: string;
  status: ApprovalStepStatus;
  decidedByUserId: number | null;
  decidedByName: string | null;
  decidedAt: string | null;
  comment: string | null;
  createdAt: string;
};

// ---------- Prašymo prikabinti dokumentai ----------

export type AttachmentKind = 'order_pdf' | 'invoice' | 'other';

export type RequestAttachment = {
  id: number;
  requestId: number;
  kind: AttachmentKind;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  uploadedByUserId: number;
  uploadedByName?: string;
  createdAt: string;
};

export type RequestAttachmentUploadRequest = {
  kind: AttachmentKind;
  fileName: string;
  mimeType: string;
  /** base64 enkoduotas turinys (be data: URI prefikso). */
  dataBase64: string;
};

// ---------- Klasifikatoriai ----------

export type ClassifierGroup = {
  id: number;
  code: string;
  name: string;
  description: string | null;
  active: boolean;
  itemsCount?: number;
};

export type ClassifierItem = {
  id: number;
  groupId: number;
  groupCode?: string;
  parentId: number | null;
  code: string;
  name: string;
  sortOrder: number;
  active: boolean;
};

export type ClassifierGroupCreateRequest = {
  code: string;
  name: string;
  description?: string | null;
  active?: boolean;
};

export type ClassifierGroupUpdateRequest = {
  code?: string;
  name?: string;
  description?: string | null;
  active?: boolean;
};

export type ClassifierItemCreateRequest = {
  groupId: number;
  parentId?: number | null;
  code: string;
  name: string;
  sortOrder?: number;
  active?: boolean;
};

export type ClassifierItemUpdateRequest = {
  parentId?: number | null;
  code?: string;
  name?: string;
  sortOrder?: number;
  active?: boolean;
};

// ---------- Biudžetas (LEGACY — iki Iter 16) ----------
//
// Šios `Budget` / `LegacyBudgetAllocation` / `BudgetUpsertRequest` tipos
// aprašo SENĄJĮ vieno-lygio biudžeto modelį (`budgets` + `budget_allocations`
// lentelės). Nuo Iter 9 (FVM-1) jas pakeičia 2-lygio FVM modelis
// (`FundingSource` + `BudgetAllocation` iš `./fvm`). Senasis modelis lieka
// read-only su deprecated marker'iais iki Iter 16 (žr. `02-migration-strategy.md`).
//
// `LegacyBudgetAllocation` pervardytas iš `BudgetAllocation` Iter 9 metu,
// kad nesidubliuotų su nauju FVM `BudgetAllocation` (`./fvm`).

/** @deprecated Naudoti `BudgetAllocation` iš `@biip-finansai/shared/fvm` (Iter 9+). */
export type LegacyBudgetAllocation = {
  id: number;
  budgetId: number;
  classifierItemId: number;
  classifierItemCode?: string;
  classifierItemName?: string;
  classifierItemParentId?: number | null;
  amount: string;
};

/** @deprecated Naudoti `FundingSource` + `BudgetAllocation` iš FVM modelio (Iter 9+). */
export type Budget = {
  id: number;
  year: number;
  totalAmount: string;
  notes: string | null;
  allocations: LegacyBudgetAllocation[];
  /** Sumažintas allocations.amount; jei < totalAmount — likutis nepaskirstytas. */
  allocatedAmount?: string;
  /** Patvirtinta suma šio metų prašymuose (status='APPROVED', decisionGrantedAmount). */
  approvedAmount?: string;
};

/** @deprecated Naudoti `FundingSource` / `BudgetAllocation` CRUD endpoint'us (Iter 9+). */
export type BudgetUpsertRequest = {
  year: number;
  totalAmount: string;
  notes?: string | null;
  allocations: Array<{ classifierItemId: number; amount: string }>;
};

// ---------- FVM (Iter 9+) ----------
// Naujasis 2-lygio FVM modelis: 1) funding_sources (Iš kur pinigai?),
// 2) budget_allocations (Kam skiriama?). Detali architektūra — `docs/fvm/01-architecture.md`.

export type {
  FundingSource,
  FundingSourceCreateDTO,
  FundingSourceUpdateDTO,
  FundingSourceListQuery,
  BudgetAllocation,
  BudgetAllocationCreateDTO,
  BudgetAllocationUpdateDTO,
  BudgetAllocationListQuery,
  BudgetAllocationSummary,
  SpecProgTipas,
} from './fvm';

// ---------- Dashboard ----------

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
  /** Pjūvis pagal lėšų kategoriją (issue #6). */
  costCategories: CostCategoryStats[];
  /**
   * Pjūvis pagal biudžeto kategoriją (FVM Iter 10, P06).
   *
   * Apima tik prašymus su nustatytu `budget_category_id`. Prašymai be FVM laukų
   * (legacy) į šitą agregaciją neįtraukti — `count`/`totalRequested`/`totalGranted`
   * skaičiuoja tik FVM-aware prašymus per scoped užklausą.
   */
  budgetCategoryStats: BudgetCategoryStats[];
};

// ---------- FVM project (Iter 10 placeholder, Iter 11 implementation) ----------

/**
 * `requests.createFvmProject` action response (Iter 10 placeholder).
 *
 * Iter 11 metu šitas endpoint'as kurs realų `projects` įrašą; Iter 10 grąžina
 * `status: 'pending'` placeholder'į, kad frontend mygtukas turėtų ką iškviesti.
 */
export type CreateFvmProjectResponse = {
  status: 'pending';
  message: string;
  requestId: number;
};
