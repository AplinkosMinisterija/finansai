/**
 * Globalus Playwright setup — paleidžia vieną kartą prieš visus testus.
 *
 * Atsakomybės:
 *  1. Užtikrinti FVM klasifikatorių egzistavimą (žr. db-setup.ts paaiškinimą).
 *  2. Patikrinti, kad dev API ir Web serveriai veikia (fail fast).
 *
 * Run'inant testus pirmiausia turi būti paleisti:
 *   yarn dev:db  &&  yarn dev:api  &  yarn dev:web  &
 */
import { request, type FullConfig } from '@playwright/test';
import { ensureFvmClassifiers } from './helpers/db-setup';

const BASE_URL = process.env.E2E_BASE_URL ?? 'http://localhost:5173';

export default async function globalSetup(_config: FullConfig): Promise<void> {
  console.log('[e2e setup] Tikrinamas Web serveris ir API...');

  const ctx = await request.newContext({ baseURL: BASE_URL });
  try {
    // 1) Login kaip demo (AM admin) — taip pat fail-fast jei API neveikia.
    const loginResp = await ctx.post('/api/auth/login', {
      data: { username: 'demo', password: 'demo' },
      headers: { 'Content-Type': 'application/json' },
    });
    if (!loginResp.ok()) {
      throw new Error(
        `[e2e setup] Negalim prisijungti kaip demo: ${loginResp.status()} ${await loginResp
          .text()
          .catch(() => '')}.\n` +
          'Įsitikink kad: yarn dev:db && yarn dev:api && yarn dev:web yra paleisti.\n' +
          'Ir kad seed yra įvykdytas: cd apps/api && yarn db:seed',
      );
    }

    // 2) Užtikrint FVM klasifikatorius
    console.log('[e2e setup] Užtikrinami FVM klasifikatoriai...');
    await ensureFvmClassifiers(ctx);

    console.log('[e2e setup] Setup OK.');
  } finally {
    await ctx.dispose();
  }
}
