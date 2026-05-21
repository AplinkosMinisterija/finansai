/**
 * FVM (Finansų valdymo modelio) API klientas — Iter 9 (FVM-1) + Iter 11 (FVM-3) +
 * Iter 12 (FVM-4) + Iter 13 (FVM-5).
 *
 * Apima 1, 2 ir 3 FVM lygius, faktines išlaidas ir DU:
 *  - `fundingSourcesApi` — finansavimo šaltiniai („Iš kur pinigai?")
 *  - `budgetAllocationsApi` — biudžeto paskirstymai („Kam skiriama?")
 *  - `projectsApi` — projektai / spec.programos / veiklos („Kas konkrečiai išleidžia?")
 *  - `expensesApi` — faktinės išlaidos su multi-source split (Iter 12)
 *  - `payrollApi` — DU profiliai + paskirstymai + mėnesio compute (Iter 13)
 *
 * Backend route'ai (žr. `apps/api/src/services/api.service.ts`):
 *  - /api/funding-sources
 *  - /api/budget-allocations
 *  - /api/budget-allocations/:id/summary
 *  - /api/projects
 *  - /api/projects/:id/status
 *  - /api/projects/:id/summary
 *  - /api/expenses
 *  - /api/expenses/:id
 *  - /api/expenses/budget-summary
 *  - /api/payroll-profiles[/:id]
 *  - /api/payroll-distributions[/:id]
 *  - /api/payroll/compute?month=YYYY-MM
 *
 * Tipai — `@biip-finansai/shared` (`fvm.ts`).
 *
 * SAUGUMAS (payroll): backend per `requireDuAccess` 403'ina specialistų užklausas.
 * Frontend papildomai blokuoja UI (route guard + sidebar + helpers iš `roles.ts`).
 */
import type {
  BudgetAllocation,
  BudgetAllocationCreateDTO,
  BudgetAllocationListQuery,
  BudgetAllocationSummary,
  BudgetAllocationUpdateDTO,
  BudgetExecutionReport,
  BudgetWarningsResponse,
  ComputeMonthResponse,
  CopyBudgetResponse,
  Expense,
  ExpenseCreateDTO,
  ExpenseListQuery,
  ExpenseUpdateDTO,
  FundingSource,
  FundingSourceCreateDTO,
  FundingSourceListQuery,
  FundingSourceUpdateDTO,
  FvmSummaryResponse,
  PayrollDistribution,
  PayrollDistributionCreateDTO,
  PayrollDistributionListQuery,
  PayrollDistributionReport,
  PayrollDistributionUpdateDTO,
  PayrollProfile,
  PayrollProfileCreateDTO,
  PayrollProfileListQuery,
  PayrollProfileUpdateDTO,
  Project,
  ProjectChangeStatusDTO,
  ProjectCreateDTO,
  ProjectListQuery,
  ProjectSummary,
  ProjectUpdateDTO,
  SpecProgramReport,
} from '@biip-finansai/shared';
import { api } from '@/lib/api';

// ---------- Finansavimo šaltiniai ----------

async function fundingSourcesList(query: FundingSourceListQuery = {}): Promise<FundingSource[]> {
  const params: Record<string, string | number> = {};
  if (query.year !== undefined) params.year = query.year;
  if (query.tenantId !== undefined) params.tenantId = query.tenantId;
  if (query.typeItemId !== undefined) params.typeItemId = query.typeItemId;
  const { data } = await api.get<FundingSource[]>('/funding-sources', { params });
  return data;
}

async function fundingSourceGet(id: number): Promise<FundingSource> {
  const { data } = await api.get<FundingSource>(`/funding-sources/${id}`);
  return data;
}

async function fundingSourceCreate(body: FundingSourceCreateDTO): Promise<FundingSource> {
  const { data } = await api.post<FundingSource>('/funding-sources', body);
  return data;
}

async function fundingSourceUpdate(
  id: number,
  patch: FundingSourceUpdateDTO,
): Promise<FundingSource> {
  const { data } = await api.patch<FundingSource>(`/funding-sources/${id}`, patch);
  return data;
}

async function fundingSourceRemove(id: number): Promise<{ ok: true }> {
  const { data } = await api.delete<{ ok: true }>(`/funding-sources/${id}`);
  return data;
}

/**
 * Multi-year planning (Iter 15, F16) — kopijuoja visus tenant scope funding
 * sources + budget allocations iš `sourceYear` į `targetYear`. Visa
 * transakcijoje. AM admin only.
 *
 * Backend errors:
 *  - 400 COPY_SAME_YEAR — kai sourceYear === targetYear
 *  - 400 COPY_SOURCE_EMPTY — kai šaltinio metai tušti
 *  - 409 COPY_TARGET_NOT_EMPTY — kai tikslo metai jau turi įrašų
 *  - 403 — kai vartotojas ne AM admin
 */
async function fundingSourcesCopyFromYear(body: {
  sourceYear: number;
  targetYear: number;
  tenantId?: number;
}): Promise<CopyBudgetResponse> {
  const payload: Record<string, number> = {
    sourceYear: body.sourceYear,
    targetYear: body.targetYear,
  };
  if (body.tenantId !== undefined) payload.tenantId = body.tenantId;
  const { data } = await api.post<CopyBudgetResponse>(
    '/funding-sources/copy-year',
    payload,
  );
  return data;
}

export const fundingSourcesApi = {
  list: fundingSourcesList,
  get: fundingSourceGet,
  create: fundingSourceCreate,
  update: fundingSourceUpdate,
  remove: fundingSourceRemove,
  copyFromYear: fundingSourcesCopyFromYear,
};

// ---------- Dashboard (Iter 15, F15) ----------

/**
 * FVM dashboard suvestinė nurodytiems metams (Iter 15, F15).
 *
 * Grąžina:
 *  - bendrus biudžeto totals (planuota / faktinė / likutis / percentUsed)
 *  - top 5 warning'us (vykdomi allocations su isWarning arba isOver)
 *  - artėjančius terminus (30 d horizontas)
 *  - projektų / šaltinių / paskirstymų skaičius
 *
 * Tenant scope per ADR-005 — backend forsuoja:
 *  - AM admin: visi tenant'ai (su optional `tenantId` filtru)
 *  - AM user su scope: scope tenant'ai
 *  - Org admin / user: tik savo tenant
 *  - !canViewPayroll: DU expense'ai / allocations exclude'inami
 */
async function dashboardFvmSummary(query: {
  year: number;
  tenantId?: number;
}): Promise<FvmSummaryResponse> {
  const params: Record<string, string | number> = { year: query.year };
  if (query.tenantId !== undefined) params.tenantId = query.tenantId;
  const { data } = await api.get<FvmSummaryResponse>(
    '/dashboard/fvm-summary',
    { params },
  );
  return data;
}

export const dashboardApi = {
  fvmSummary: dashboardFvmSummary,
};

// ---------- Biudžeto paskirstymai ----------

async function budgetAllocationsList(
  query: BudgetAllocationListQuery = {},
): Promise<BudgetAllocation[]> {
  const params: Record<string, string | number> = {};
  if (query.fundingSourceId !== undefined) params.fundingSourceId = query.fundingSourceId;
  if (query.year !== undefined) params.year = query.year;
  if (query.categoryItemId !== undefined) params.categoryItemId = query.categoryItemId;
  const { data } = await api.get<BudgetAllocation[]>('/budget-allocations', { params });
  return data;
}

async function budgetAllocationGet(id: number): Promise<BudgetAllocation> {
  const { data } = await api.get<BudgetAllocation>(`/budget-allocations/${id}`);
  return data;
}

async function budgetAllocationSummary(id: number): Promise<BudgetAllocationSummary> {
  const { data } = await api.get<BudgetAllocationSummary>(
    `/budget-allocations/${id}/summary`,
  );
  return data;
}

async function budgetAllocationCreate(
  body: BudgetAllocationCreateDTO,
): Promise<BudgetAllocation> {
  const { data } = await api.post<BudgetAllocation>('/budget-allocations', body);
  return data;
}

async function budgetAllocationUpdate(
  id: number,
  patch: BudgetAllocationUpdateDTO,
): Promise<BudgetAllocation> {
  const { data } = await api.patch<BudgetAllocation>(`/budget-allocations/${id}`, patch);
  return data;
}

async function budgetAllocationRemove(id: number): Promise<{ ok: true }> {
  const { data } = await api.delete<{ ok: true }>(`/budget-allocations/${id}`);
  return data;
}

export const budgetAllocationsApi = {
  list: budgetAllocationsList,
  get: budgetAllocationGet,
  summary: budgetAllocationSummary,
  create: budgetAllocationCreate,
  update: budgetAllocationUpdate,
  remove: budgetAllocationRemove,
};

// ---------- Projektai (3 FVM lygis, Iter 11) ----------

async function projectsList(query: ProjectListQuery = {}): Promise<Project[]> {
  const params: Record<string, string | number> = {};
  if (query.tenantId !== undefined) params.tenantId = query.tenantId;
  if (query.status !== undefined) params.status = query.status;
  if (query.type !== undefined) params.type = query.type;
  if (query.allocationId !== undefined) params.allocationId = query.allocationId;
  if (query.requestId !== undefined) params.requestId = query.requestId;
  if (query.year !== undefined) params.year = query.year;
  const { data } = await api.get<Project[]>('/projects', { params });
  return data;
}

async function projectGet(id: number): Promise<Project> {
  const { data } = await api.get<Project>(`/projects/${id}`);
  return data;
}

async function projectSummary(id: number): Promise<ProjectSummary> {
  const { data } = await api.get<ProjectSummary>(`/projects/${id}/summary`);
  return data;
}

async function projectCreate(body: ProjectCreateDTO): Promise<Project> {
  const { data } = await api.post<Project>('/projects', body);
  return data;
}

async function projectUpdate(
  id: number,
  patch: ProjectUpdateDTO,
): Promise<Project> {
  const { data } = await api.patch<Project>(`/projects/${id}`, patch);
  return data;
}

async function projectRemove(id: number): Promise<{ ok: true }> {
  const { data } = await api.delete<{ ok: true }>(`/projects/${id}`);
  return data;
}

async function projectChangeStatus(
  id: number,
  body: ProjectChangeStatusDTO,
): Promise<Project> {
  const { data } = await api.patch<Project>(`/projects/${id}/status`, body);
  return data;
}

export const projectsApi = {
  list: projectsList,
  get: projectGet,
  summary: projectSummary,
  create: projectCreate,
  update: projectUpdate,
  remove: projectRemove,
  changeStatus: projectChangeStatus,
};

// ---------- Išlaidos (Iter 12, FVM-4) ----------

async function expensesList(query: ExpenseListQuery = {}): Promise<Expense[]> {
  const params: Record<string, string | number> = {};
  if (query.projectId !== undefined) params.projectId = query.projectId;
  if (query.allocationId !== undefined) params.allocationId = query.allocationId;
  if (query.year !== undefined) params.year = query.year;
  if (query.type !== undefined) params.type = query.type;
  if (query.dateFrom !== undefined && query.dateFrom !== '')
    params.dateFrom = query.dateFrom;
  if (query.dateTo !== undefined && query.dateTo !== '')
    params.dateTo = query.dateTo;
  if (query.fundingSourceId !== undefined)
    params.fundingSourceId = query.fundingSourceId;
  const { data } = await api.get<Expense[]>('/expenses', { params });
  return data;
}

async function expenseGet(id: number): Promise<Expense> {
  const { data } = await api.get<Expense>(`/expenses/${id}`);
  return data;
}

async function expenseCreate(body: ExpenseCreateDTO): Promise<Expense> {
  const { data } = await api.post<Expense>('/expenses', body);
  return data;
}

async function expenseUpdate(
  id: number,
  patch: ExpenseUpdateDTO,
): Promise<Expense> {
  const { data } = await api.patch<Expense>(`/expenses/${id}`, patch);
  return data;
}

async function expenseRemove(id: number): Promise<{ ok: true }> {
  const { data } = await api.delete<{ ok: true }>(`/expenses/${id}`);
  return data;
}

async function expensesBudgetSummary(query: {
  year: number;
  projectId?: number;
}): Promise<BudgetWarningsResponse> {
  const params: Record<string, string | number> = { year: query.year };
  if (query.projectId !== undefined) params.projectId = query.projectId;
  const { data } = await api.get<BudgetWarningsResponse>(
    '/expenses/budget-summary',
    { params },
  );
  return data;
}

export const expensesApi = {
  list: expensesList,
  get: expenseGet,
  create: expenseCreate,
  update: expenseUpdate,
  remove: expenseRemove,
  budgetSummary: expensesBudgetSummary,
};

// ---------- DU (Iter 13, FVM-5) ----------

async function payrollProfilesList(
  query: PayrollProfileListQuery = {},
): Promise<PayrollProfile[]> {
  const params: Record<string, string | number | boolean> = {};
  if (query.tenantId !== undefined) params.tenantId = query.tenantId;
  if (query.userId !== undefined) params.userId = query.userId;
  if (query.active !== undefined) params.active = query.active;
  const { data } = await api.get<PayrollProfile[]>('/payroll-profiles', { params });
  return data;
}

async function payrollProfileGet(id: number): Promise<PayrollProfile> {
  const { data } = await api.get<PayrollProfile>(`/payroll-profiles/${id}`);
  return data;
}

async function payrollProfileCreate(
  body: PayrollProfileCreateDTO,
): Promise<PayrollProfile> {
  const { data } = await api.post<PayrollProfile>('/payroll-profiles', body);
  return data;
}

async function payrollProfileUpdate(
  id: number,
  patch: PayrollProfileUpdateDTO,
): Promise<PayrollProfile> {
  const { data } = await api.patch<PayrollProfile>(`/payroll-profiles/${id}`, patch);
  return data;
}

async function payrollProfileRemove(id: number): Promise<{ ok: true }> {
  const { data } = await api.delete<{ ok: true }>(`/payroll-profiles/${id}`);
  return data;
}

async function payrollDistributionsList(
  query: PayrollDistributionListQuery = {},
): Promise<PayrollDistribution[]> {
  const params: Record<string, string | number> = {};
  if (query.profileId !== undefined) params.profileId = query.profileId;
  if (query.sourceId !== undefined) params.sourceId = query.sourceId;
  const { data } = await api.get<PayrollDistribution[]>('/payroll-distributions', {
    params,
  });
  return data;
}

async function payrollDistributionGet(id: number): Promise<PayrollDistribution> {
  const { data } = await api.get<PayrollDistribution>(`/payroll-distributions/${id}`);
  return data;
}

async function payrollDistributionCreate(
  body: PayrollDistributionCreateDTO,
): Promise<PayrollDistribution> {
  const { data } = await api.post<PayrollDistribution>('/payroll-distributions', body);
  return data;
}

async function payrollDistributionUpdate(
  id: number,
  patch: PayrollDistributionUpdateDTO,
): Promise<PayrollDistribution> {
  const { data } = await api.patch<PayrollDistribution>(
    `/payroll-distributions/${id}`,
    patch,
  );
  return data;
}

async function payrollDistributionRemove(id: number): Promise<{ ok: true }> {
  const { data } = await api.delete<{ ok: true }>(`/payroll-distributions/${id}`);
  return data;
}

/**
 * Mėnesio DU compute (POST /payroll/compute?month=YYYY-MM).
 *
 * Idempotentiškas — pakartotinis to paties mėnesio kvietimas ištrina senesnius
 * DU expense'us prieš sukuriant naujus (backend transakcijoje).
 *
 * Tik AM admin'as (backend forsuoja per `requireDuAccess`; UI gating'as papildomai
 * paslepia mygtuką per `canComputePayroll`).
 */
async function payrollComputeMonth(month: string): Promise<ComputeMonthResponse> {
  const { data } = await api.post<ComputeMonthResponse>('/payroll/compute', null, {
    params: { month },
  });
  return data;
}

export const payrollApi = {
  listProfiles: payrollProfilesList,
  getProfile: payrollProfileGet,
  createProfile: payrollProfileCreate,
  updateProfile: payrollProfileUpdate,
  removeProfile: payrollProfileRemove,
  listDistributions: payrollDistributionsList,
  getDistribution: payrollDistributionGet,
  createDistribution: payrollDistributionCreate,
  updateDistribution: payrollDistributionUpdate,
  removeDistribution: payrollDistributionRemove,
  computeMonth: payrollComputeMonth,
};

// ---------- Ataskaitos (Iter 14, FVM-6) ----------
//
// 3 ataskaitos su 3 eksporto formatais:
//  - JSON: struktūruoti duomenys lentelės renderavimui (BudgetExecutionReport etc.)
//  - xlsx | pdf: binary Buffer per server → klientui pasiūlome failo download'ą
//
// SAUGUMAS: backend per `requireDuAccess` 403'ina specialistų payroll distribution
// užklausas; UI papildomai paslepia DU tab'ą per `canViewPayroll`.

/** Biudžeto vykdymo ataskaita JSON formatu (F12). */
async function reportsBudgetExecution(query: {
  year: number;
  tenantId?: number;
}): Promise<BudgetExecutionReport> {
  const params: Record<string, string | number> = { year: query.year };
  if (query.tenantId !== undefined) params.tenantId = query.tenantId;
  const { data } = await api.get<BudgetExecutionReport>(
    '/reports/budget-execution',
    { params },
  );
  return data;
}

/** Spec. programų ataskaita JSON formatu (F13). */
async function reportsSpecProgramExecution(query: {
  year: number;
  tenantId?: number;
}): Promise<SpecProgramReport> {
  const params: Record<string, string | number> = { year: query.year };
  if (query.tenantId !== undefined) params.tenantId = query.tenantId;
  const { data } = await api.get<SpecProgramReport>(
    '/reports/spec-program-execution',
    { params },
  );
  return data;
}

/** DU paskirstymo ataskaita JSON formatu (F14, permission-gated). */
async function reportsPayrollDistribution(query: {
  from: string;
  to: string;
  tenantId?: number;
}): Promise<PayrollDistributionReport> {
  const params: Record<string, string | number> = {
    from: query.from,
    to: query.to,
  };
  if (query.tenantId !== undefined) params.tenantId = query.tenantId;
  const { data } = await api.get<PayrollDistributionReport>(
    '/reports/payroll-distribution',
    { params },
  );
  return data;
}

/**
 * Binary blob atsisiuntimas — naudoja browser native fetch
 * (axios serializuoja binarius keistai per JSON Content-Type interceptor'ą,
 * todėl čia einame tiesiai į `fetch` su `credentials: 'include'`, kad
 * session cookie eitų į /api).
 *
 * Backend prie xlsx/pdf prideda `Content-Disposition: attachment; filename=...`
 * header'į; client'as parsina jį `Content-Disposition` parser'iu, jei `fallback'as`
 * niekur kitur nepateiktas.
 */
async function downloadBlob(url: string, fallbackFileName: string): Promise<void> {
  const response = await fetch(url, { credentials: 'include' });
  if (!response.ok) {
    throw new Error(
      `Nepavyko parsisiųsti failo (HTTP ${response.status}).`,
    );
  }
  const disposition = response.headers.get('content-disposition') ?? '';
  const fileName = extractFileName(disposition) ?? fallbackFileName;
  const blob = await response.blob();
  const objUrl = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = objUrl;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(objUrl);
}

/**
 * Parsina filename iš `Content-Disposition` header'io
 * (palaiko RFC 5987 `filename*=UTF-8''encoded` formą — backend taip kuria).
 */
function extractFileName(disposition: string): string | null {
  // filename*=UTF-8''encoded
  const utf8Match = disposition.match(
    /filename\*=UTF-8''([^;]+)/i,
  );
  if (utf8Match?.[1]) {
    try {
      return decodeURIComponent(utf8Match[1]);
    } catch {
      // ignoruoti
    }
  }
  // filename="..."
  const plainMatch = disposition.match(/filename="([^"]+)"/i);
  if (plainMatch?.[1]) return plainMatch[1];
  return null;
}

function buildExportUrl(
  path: string,
  params: Record<string, string | number>,
): string {
  const search = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    search.append(k, String(v));
  }
  return `/api${path}?${search.toString()}`;
}

/** F12 — Biudžeto vykdymo Excel/PDF eksportas (Blob → file download). */
async function reportsBudgetExecutionDownload(args: {
  year: number;
  tenantId?: number;
  format: 'xlsx' | 'pdf';
}): Promise<void> {
  const params: Record<string, string | number> = {
    year: args.year,
    format: args.format,
  };
  if (args.tenantId !== undefined) params.tenantId = args.tenantId;
  const url = buildExportUrl('/reports/budget-execution', params);
  const fallback = `biudzeto-vykdymas-${args.year}.${args.format}`;
  await downloadBlob(url, fallback);
}

/** F13 — Spec. programų ataskaitos Excel/PDF eksportas. */
async function reportsSpecProgramExecutionDownload(args: {
  year: number;
  tenantId?: number;
  format: 'xlsx' | 'pdf';
}): Promise<void> {
  const params: Record<string, string | number> = {
    year: args.year,
    format: args.format,
  };
  if (args.tenantId !== undefined) params.tenantId = args.tenantId;
  const url = buildExportUrl('/reports/spec-program-execution', params);
  const fallback = `spec-programos-${args.year}.${args.format}`;
  await downloadBlob(url, fallback);
}

/** F14 — DU paskirstymo Excel/PDF eksportas (permission-gated). */
async function reportsPayrollDistributionDownload(args: {
  from: string;
  to: string;
  tenantId?: number;
  format: 'xlsx' | 'pdf';
}): Promise<void> {
  const params: Record<string, string | number> = {
    from: args.from,
    to: args.to,
    format: args.format,
  };
  if (args.tenantId !== undefined) params.tenantId = args.tenantId;
  const url = buildExportUrl('/reports/payroll-distribution', params);
  const fallback = `du-paskirstymas-${args.from}-${args.to}.${args.format}`;
  await downloadBlob(url, fallback);
}

export const reportsApi = {
  budgetExecution: reportsBudgetExecution,
  budgetExecutionDownload: reportsBudgetExecutionDownload,
  specProgramExecution: reportsSpecProgramExecution,
  specProgramExecutionDownload: reportsSpecProgramExecutionDownload,
  payrollDistribution: reportsPayrollDistribution,
  payrollDistributionDownload: reportsPayrollDistributionDownload,
};
