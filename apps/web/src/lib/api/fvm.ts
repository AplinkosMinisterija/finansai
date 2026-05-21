/**
 * FVM (Finansų valdymo modelio) API klientas — Iter 9 (FVM-1).
 *
 * Apima 1 ir 2 FVM lygius:
 *  - `fundingSourcesApi` — finansavimo šaltiniai („Iš kur pinigai?")
 *  - `budgetAllocationsApi` — biudžeto paskirstymai („Kam skiriama?")
 *
 * Backend route'ai (žr. `apps/api/src/services/api.service.ts`):
 *  - /api/funding-sources
 *  - /api/budget-allocations
 *  - /api/budget-allocations/:id/summary
 *
 * Tipai — `@biip-finansai/shared` (`fvm.ts`).
 */
import type {
  BudgetAllocation,
  BudgetAllocationCreateDTO,
  BudgetAllocationListQuery,
  BudgetAllocationSummary,
  BudgetAllocationUpdateDTO,
  FundingSource,
  FundingSourceCreateDTO,
  FundingSourceListQuery,
  FundingSourceUpdateDTO,
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
