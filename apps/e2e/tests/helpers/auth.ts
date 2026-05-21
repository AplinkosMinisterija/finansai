/**
 * Auth helper'iai — prisijungimas per `/api/auth/login` (Vite proxy).
 *
 * Naudoja `request.post` su `Content-Type: application/json` — atsako cookie
 * (`finansai_session`) Playwright automatiškai persists per `context.request`
 * ir per page navigation'us (`context.cookies()` share'ina su page).
 */
import type { Page, APIRequestContext, BrowserContext } from '@playwright/test';
import { expect } from '@playwright/test';

export interface DemoAccount {
  username: string;
  description: string;
}

export const ACCOUNTS = {
  amAdmin: { username: 'demo', description: 'AM administratorius (alias demo)' },
  amAdminAlt: { username: 'am-admin', description: 'AM administratorius' },
  amUser: { username: 'am-user', description: 'AM specialistas (visos org.)' },
  aadAdmin: { username: 'aad-admin', description: 'AAD administratorius' },
  aadUser: { username: 'aad-user', description: 'AAD specialistas (org_user)' },
  vsttAdmin: { username: 'vstt-admin', description: 'VSTT administratorius' },
  lgtAdmin: { username: 'lgt-admin', description: 'LGT administratorius' },
} satisfies Record<string, DemoAccount>;

/**
 * Prisijungia per UI (LoginPage forma). Naudoti tada, kai testas turi
 * patikrinti UI auth flow'ą.
 */
export async function loginViaUi(
  page: Page,
  username: string,
  password = 'demo',
): Promise<void> {
  await page.goto('/login');
  await page.getByLabel('Vartotojo vardas').fill(username);
  await page.getByLabel('Slaptažodis').fill(password);
  await page.getByRole('button', { name: 'Prisijungti' }).click();
  // Po sėkmės — redirect į / (HomePage).
  await page.waitForURL((url) => !url.pathname.startsWith('/login'), {
    timeout: 15_000,
  });
}

/**
 * Prisijungia per API naudojant Playwright `request` kontekstą. SVARBU:
 * jei nori kad cookie'is share'intusi su `page`, perduok `page.context().request`,
 * o ne testo top-level `request` (kuris turi atskirą session storage'ą).
 *
 * Žr. https://playwright.dev/docs/api-testing#sending-api-requests-from-ui-tests
 */
export async function loginViaApi(
  request: APIRequestContext,
  username: string,
  password = 'demo',
): Promise<void> {
  const resp = await request.post('/api/auth/login', {
    data: { username, password },
    headers: { 'Content-Type': 'application/json' },
  });
  expect(resp.status(), `Login API ${resp.status()} for ${username}`).toBe(200);
}

/**
 * Prisijungia per API ir cookie'į priskiria `page` context'ui. Tai užtikrina,
 * kad sekantis `page.goto(...)` jau bus autorizuotas.
 */
export async function loginAndAttach(
  context: BrowserContext,
  username: string,
  password = 'demo',
): Promise<void> {
  await loginViaApi(context.request, username, password);
}

/**
 * Logout helper'is — naudingas kai testas keičia user'į vienos sesijos metu.
 */
export async function logout(request: APIRequestContext): Promise<void> {
  await request.post('/api/auth/logout');
}
