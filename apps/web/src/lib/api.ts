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
