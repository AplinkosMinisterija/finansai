/**
 * Playwright E2E konfigūracija FVM testams (Iter 16).
 *
 * Pasirinkimai:
 *  - chromium browser (vieno engine pakanka demo/UAT režimui)
 *  - baseURL = lokalus Vite dev server (`yarn dev:web` → 5173) su proxy į
 *    `yarn dev:api` (3000). PRIEŠ paleidžiant — `yarn dev:db && yarn dev:api &
 *    yarn dev:web &`. Webserver `reuseExistingServer` ON, nes serveriai
 *    paleidžiami atskirai (Iter 16 brief'as).
 *  - storage state grobimas — kiekviename test'e per `login()` helper'į, nes
 *    skirtingi user'ai per skirtingus journey'us (demo / am-admin / aad-admin /
 *    aad-user).
 *  - traceOnFailure: kad mažintume debug laiką lokaliai.
 */
import { defineConfig, devices } from '@playwright/test';

const PORT = Number(process.env.WEB_PORT ?? 5173);
const BASE_URL = process.env.E2E_BASE_URL ?? `http://localhost:${PORT}`;

export default defineConfig({
  testDir: './tests',
  testIgnore: ['**/helpers/**', '**/global-setup.ts'],
  globalSetup: require.resolve('./tests/global-setup'),
  timeout: 60_000,
  expect: {
    timeout: 10_000,
  },
  fullyParallel: false, // testai share'inasi DB — nepamesti race'ų
  retries: 0,
  workers: 1,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: BASE_URL,
    headless: true,
    viewport: { width: 1280, height: 800 },
    actionTimeout: 10_000,
    navigationTimeout: 30_000,
    locale: 'lt-LT',
    timezoneId: 'Europe/Vilnius',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'off',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
});
