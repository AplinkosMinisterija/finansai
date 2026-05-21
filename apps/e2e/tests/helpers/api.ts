/**
 * Generic API helper'iai — wrap'inina Playwright `request` ir grąžina parsed
 * JSON. Visi `/finansai/*` endpoint'ai eina per Vite proxy `/api/*`.
 */
import type { APIRequestContext } from '@playwright/test';
import { expect } from '@playwright/test';

export async function apiPost<T = unknown>(
  request: APIRequestContext,
  path: string,
  body: unknown,
): Promise<T> {
  const resp = await request.post(`/api${path}`, {
    data: body,
    headers: { 'Content-Type': 'application/json' },
  });
  expect(
    resp.status(),
    `POST ${path} -> ${resp.status()}: ${await resp.text().catch(() => '?')}`,
  ).toBeLessThan(400);
  return (await resp.json()) as T;
}

export async function apiGet<T = unknown>(
  request: APIRequestContext,
  path: string,
): Promise<T> {
  const resp = await request.get(`/api${path}`);
  expect(
    resp.status(),
    `GET ${path} -> ${resp.status()}: ${await resp.text().catch(() => '?')}`,
  ).toBeLessThan(400);
  return (await resp.json()) as T;
}

export async function apiPut<T = unknown>(
  request: APIRequestContext,
  path: string,
  body: unknown,
): Promise<T> {
  const resp = await request.put(`/api${path}`, {
    data: body,
    headers: { 'Content-Type': 'application/json' },
  });
  expect(
    resp.status(),
    `PUT ${path} -> ${resp.status()}: ${await resp.text().catch(() => '?')}`,
  ).toBeLessThan(400);
  return (await resp.json()) as T;
}

export async function apiPatch<T = unknown>(
  request: APIRequestContext,
  path: string,
  body: unknown,
): Promise<T> {
  const resp = await request.patch(`/api${path}`, {
    data: body,
    headers: { 'Content-Type': 'application/json' },
  });
  expect(
    resp.status(),
    `PATCH ${path} -> ${resp.status()}: ${await resp.text().catch(() => '?')}`,
  ).toBeLessThan(400);
  return (await resp.json()) as T;
}

export async function apiDelete(
  request: APIRequestContext,
  path: string,
): Promise<void> {
  const resp = await request.delete(`/api${path}`);
  expect(
    resp.status(),
    `DELETE ${path} -> ${resp.status()}`,
  ).toBeLessThan(400);
}

/**
 * Sukuria unikalų suffix'ą test'o duomenims kad nesusilietų su kitais runs.
 */
export function uniqueSuffix(): string {
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}
