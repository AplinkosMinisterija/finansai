/**
 * FVM (Finansų valdymo modelio) API klientas — Iter 9 (FVM-1) + Iter 11 (FVM-3) +
 * Iter 12 (FVM-4).
 *
 * Apima 1, 2 ir 3 FVM lygius bei faktines išlaidas:
 *  - `fundingSourcesApi` — finansavimo šaltiniai („Iš kur pinigai?")
 *  - `budgetAllocationsApi` — biudžeto paskirstymai („Kam skiriama?")
 *  - `projectsApi` — projektai / spec.programos / veiklos („Kas konkrečiai išleidžia?")
 *  - `expensesApi` — faktinės išlaidos su multi-source split (Iter 12)
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
 *
 * Tipai — `@biip-finansai/shared` (`fvm.ts`).
 */
import type {
  BudgetAllocation,
  BudgetAllocationCreateDTO,
  BudgetAllocationListQuery,
  BudgetAllocationSummary,
  BudgetAllocationUpdateDTO,
  BudgetWarningsResponse,
  Expense,
  ExpenseCreateDTO,
  ExpenseListQuery,
  ExpenseUpdateDTO,
  FundingSource,
  FundingSourceCreateDTO,
  FundingSourceListQuery,
  FundingSourceUpdateDTO,
  Project,
  ProjectChangeStatusDTO,
  ProjectCreateDTO,
  ProjectListQuery,
  ProjectSummary,
  ProjectUpdateDTO,
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

export const fundingSourcesApi = {
  list: fundingSourcesList,
  get: fundingSourceGet,
  create: fundingSourceCreate,
  update: fundingSourceUpdate,
  remove: fundingSourceRemove,
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
