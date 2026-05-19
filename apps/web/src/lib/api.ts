/**
 * API klientas — pakuoja axios su:
 *   - baseURL: '/api' (Vite proxina į localhost:3000/finansai)
 *   - withCredentials: true (cookies)
 *   - 401 interceptor → emituoja `auth:cleared` event (guards reaguoja)
 */
import axios, { type AxiosError, type AxiosInstance } from 'axios';
import type {
  AuthLoginRequest,
  AuthLoginResponse,
  AuthMeResponse,
  Budget,
  BudgetUpsertRequest,
  ClassifierGroup,
  ClassifierGroupCreateRequest,
  ClassifierGroupUpdateRequest,
  ClassifierItem,
  ClassifierItemCreateRequest,
  ClassifierItemUpdateRequest,
  DashboardData,
  FinancingRequest,
  FinancingRequestDetail,
  PaginatedResponse,
  RequestAttachment,
  RequestAttachmentUploadRequest,
  RequestComment,
  RequestDecisionPayload,
  RequestListQuery,
  RequestPayload,
  Tenant,
  TenantCreateRequest,
  TenantUpdateRequest,
  User,
  UserCreateRequest,
  UserListQuery,
  UserUpdateRequest,
} from '@biip-finansai/shared';

export const AUTH_CLEARED_EVENT = 'auth:cleared';

function emitAuthCleared(): void {
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent(AUTH_CLEARED_EVENT));
  }
}

export const api: AxiosInstance = axios.create({
  baseURL: '/api',
  withCredentials: true,
  headers: {
    'Content-Type': 'application/json',
  },
});

api.interceptors.response.use(
  (response) => response,
  (error: AxiosError) => {
    if (error.response?.status === 401) {
      const url = error.config?.url ?? '';
      if (!url.includes('/auth/login')) {
        emitAuthCleared();
      }
    }
    return Promise.reject(error);
  },
);

// ---------- Auth ----------

export async function authLogin(body: AuthLoginRequest): Promise<AuthLoginResponse> {
  const { data } = await api.post<AuthLoginResponse>('/auth/login', body);
  return data;
}

export async function authLogout(): Promise<{ ok: true }> {
  const { data } = await api.post<{ ok: true }>('/auth/logout');
  return data;
}

export async function authMe(): Promise<AuthMeResponse> {
  const { data } = await api.get<AuthMeResponse>('/auth/me');
  return data;
}

// ---------- Tenants ----------

export async function tenantsList(withCounts = false): Promise<Tenant[]> {
  const params: Record<string, string> = {};
  if (withCounts) params.withCounts = 'true';
  const { data } = await api.get<Tenant[]>('/tenants', { params });
  return data;
}

export async function tenantGet(id: number): Promise<Tenant> {
  const { data } = await api.get<Tenant>(`/tenants/${id}`);
  return data;
}

export async function tenantCreate(body: TenantCreateRequest): Promise<Tenant> {
  const { data } = await api.post<Tenant>('/tenants', body);
  return data;
}

export async function tenantUpdate(id: number, patch: TenantUpdateRequest): Promise<Tenant> {
  const { data } = await api.patch<Tenant>(`/tenants/${id}`, patch);
  return data;
}

export async function tenantDelete(id: number): Promise<{ ok: true }> {
  const { data } = await api.delete<{ ok: true }>(`/tenants/${id}`);
  return data;
}

// ---------- Users ----------

export async function usersList(query: UserListQuery = {}): Promise<PaginatedResponse<User>> {
  const params: Record<string, string | number> = {};
  if (query.q !== undefined && query.q !== '') params.q = query.q;
  if (query.tenantId !== undefined) params.tenantId = query.tenantId;
  if (query.page !== undefined) params.page = query.page;
  if (query.pageSize !== undefined) params.pageSize = query.pageSize;
  const { data } = await api.get<PaginatedResponse<User>>('/users', { params });
  return data;
}

export async function userGet(id: number): Promise<User> {
  const { data } = await api.get<User>(`/users/${id}`);
  return data;
}

export async function userCreate(body: UserCreateRequest): Promise<User> {
  const { data } = await api.post<User>('/users', body);
  return data;
}

export async function userUpdate(id: number, patch: UserUpdateRequest): Promise<User> {
  const { data } = await api.patch<User>(`/users/${id}`, patch);
  return data;
}

export async function userDelete(id: number): Promise<{ ok: true }> {
  const { data } = await api.delete<{ ok: true }>(`/users/${id}`);
  return data;
}

// ---------- Requests ----------

export async function requestsList(
  query: RequestListQuery = {},
): Promise<PaginatedResponse<FinancingRequest>> {
  const params: Record<string, string | number> = {};
  if (query.q !== undefined && query.q !== '') params.q = query.q;
  if (query.status !== undefined) params.status = query.status;
  if (query.tenantId !== undefined) params.tenantId = query.tenantId;
  if (query.year !== undefined) params.year = query.year;
  if (query.plansOnly !== undefined) params.plansOnly = query.plansOnly ? 'true' : 'false';
  if (query.page !== undefined) params.page = query.page;
  if (query.pageSize !== undefined) params.pageSize = query.pageSize;
  const { data } = await api.get<PaginatedResponse<FinancingRequest>>('/requests', { params });
  return data;
}

export async function requestGet(id: number): Promise<FinancingRequestDetail> {
  const { data } = await api.get<FinancingRequestDetail>(`/requests/${id}`);
  return data;
}

export async function requestCreate(
  body: RequestPayload & { tenantId?: number } = {},
): Promise<FinancingRequest> {
  const { data } = await api.post<FinancingRequest>('/requests', body);
  return data;
}

export async function requestUpdate(
  id: number,
  patch: RequestPayload,
): Promise<FinancingRequest> {
  const { data } = await api.patch<FinancingRequest>(`/requests/${id}`, patch);
  return data;
}

export async function requestConvertToCurrentYear(id: number): Promise<FinancingRequest> {
  const { data } = await api.post<FinancingRequest>(
    `/requests/${id}/convert-to-current-year`,
  );
  return data;
}

export async function requestSubmit(id: number): Promise<FinancingRequest> {
  const { data } = await api.post<FinancingRequest>(`/requests/${id}/submit`);
  return data;
}

export async function requestDelete(id: number): Promise<{ ok: true }> {
  const { data } = await api.delete<{ ok: true }>(`/requests/${id}`);
  return data;
}

export async function requestDecision(
  id: number,
  body: RequestDecisionPayload,
): Promise<FinancingRequest> {
  const { data } = await api.post<FinancingRequest>(`/requests/${id}/decision`, body);
  return data;
}

export async function requestAddComment(
  id: number,
  body: string,
): Promise<RequestComment> {
  const { data } = await api.post<RequestComment>(`/requests/${id}/comments`, { body });
  return data;
}

// ---------- Dashboard ----------

export async function dashboardGet(): Promise<DashboardData> {
  const { data } = await api.get<DashboardData>('/dashboard');
  return data;
}

// ---------- Prikabinti dokumentai ----------

export async function attachmentsList(requestId: number): Promise<RequestAttachment[]> {
  const { data } = await api.get<RequestAttachment[]>(
    `/requests/${requestId}/attachments`,
  );
  return data;
}

export async function attachmentUpload(
  requestId: number,
  body: RequestAttachmentUploadRequest,
): Promise<RequestAttachment> {
  const { data } = await api.post<RequestAttachment>(
    `/requests/${requestId}/attachments`,
    body,
  );
  return data;
}

export async function attachmentDownload(
  id: number,
): Promise<{ fileName: string; mimeType: string; dataBase64: string }> {
  const { data } = await api.get<{ fileName: string; mimeType: string; dataBase64: string }>(
    `/attachments/${id}/download`,
  );
  return data;
}

export async function attachmentDelete(id: number): Promise<{ ok: true }> {
  const { data } = await api.delete<{ ok: true }>(`/attachments/${id}`);
  return data;
}

// ---------- Klasifikatoriai ----------

export async function classifierGroupsList(withCounts = false): Promise<ClassifierGroup[]> {
  const params = withCounts ? { withCounts: 'true' } : undefined;
  const { data } = await api.get<ClassifierGroup[]>('/classifiers/groups', { params });
  return data;
}

export async function classifierGroupCreate(
  body: ClassifierGroupCreateRequest,
): Promise<ClassifierGroup> {
  const { data } = await api.post<ClassifierGroup>('/classifiers/groups', body);
  return data;
}

export async function classifierGroupUpdate(
  id: number,
  patch: ClassifierGroupUpdateRequest,
): Promise<ClassifierGroup> {
  const { data } = await api.patch<ClassifierGroup>(`/classifiers/groups/${id}`, patch);
  return data;
}

export async function classifierGroupDelete(id: number): Promise<{ ok: true }> {
  const { data } = await api.delete<{ ok: true }>(`/classifiers/groups/${id}`);
  return data;
}

export async function classifierItemsList(
  query: { groupId?: number; groupCode?: string; includeInactive?: boolean } = {},
): Promise<ClassifierItem[]> {
  const params: Record<string, string> = {};
  if (query.groupId !== undefined) params['groupId'] = String(query.groupId);
  if (query.groupCode !== undefined) params['groupCode'] = query.groupCode;
  if (query.includeInactive) params['includeInactive'] = 'true';
  const { data } = await api.get<ClassifierItem[]>('/classifiers/items', { params });
  return data;
}

export async function classifierItemCreate(
  body: ClassifierItemCreateRequest,
): Promise<ClassifierItem> {
  const { data } = await api.post<ClassifierItem>('/classifiers/items', body);
  return data;
}

export async function classifierItemUpdate(
  id: number,
  patch: ClassifierItemUpdateRequest,
): Promise<ClassifierItem> {
  const { data } = await api.patch<ClassifierItem>(`/classifiers/items/${id}`, patch);
  return data;
}

export async function classifierItemDelete(id: number): Promise<{ ok: true }> {
  const { data } = await api.delete<{ ok: true }>(`/classifiers/items/${id}`);
  return data;
}

// ---------- Biudžetas ----------

export async function budgetsList(): Promise<Budget[]> {
  const { data } = await api.get<Budget[]>('/budgets');
  return data;
}

export async function budgetGetByYear(year: number): Promise<Budget | null> {
  const { data } = await api.get<Budget | null>(`/budgets/year/${year}`);
  return data;
}

export async function budgetUpsert(body: BudgetUpsertRequest): Promise<Budget> {
  const { data } = await api.post<Budget>('/budgets', body);
  return data;
}

export async function budgetDelete(id: number): Promise<{ ok: true }> {
  const { data } = await api.delete<{ ok: true }>(`/budgets/${id}`);
  return data;
}
