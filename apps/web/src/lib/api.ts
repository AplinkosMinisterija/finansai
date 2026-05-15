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
  PaginatedResponse,
  Tenant,
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

export async function authLogin(
  body: AuthLoginRequest,
): Promise<AuthLoginResponse> {
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

export async function tenantsList(): Promise<Tenant[]> {
  const { data } = await api.get<Tenant[]>('/tenants');
  return data;
}

// ---------- Users ----------

export async function usersList(
  query: UserListQuery = {},
): Promise<PaginatedResponse<User>> {
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

export async function userUpdate(
  id: number,
  patch: UserUpdateRequest,
): Promise<User> {
  const { data } = await api.patch<User>(`/users/${id}`, patch);
  return data;
}

export async function userDelete(id: number): Promise<{ ok: true }> {
  const { data } = await api.delete<{ ok: true }>(`/users/${id}`);
  return data;
}
