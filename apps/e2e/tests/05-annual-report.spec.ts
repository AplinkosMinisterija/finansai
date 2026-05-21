/**
 * Iter 16 E2E Journey #5: Metinė biudžeto vykdymo ataskaita (Excel download).
 *
 * Flow:
 *  1. Login kaip AM admin
 *  2. Navigate į /ataskaitos
 *  3. Patvirtinti, kad „Biudžeto vykdymas" tab'as matomas
 *  4. Įvesti metus + paspausti „Atsisiųsti Excel"
 *  5. Verify: Buffer length > 0, MIME tipas atitinka Excel
 *
 * Playwright download API: `page.waitForEvent('download')` lygiagrečiai su
 * mygtuko paspaudimu. Galima patikrinti suggested filename + tikrai turi
 * atsiunčiamą Buffer'į.
 */
import { test, expect } from '@playwright/test';
import { ACCOUNTS, loginViaApi } from './helpers/auth';
import { readFileSync, statSync } from 'node:fs';

test.describe('Iter 16 Journey #5: Annual report Excel download', () => {
  test('AM admin atsisiunčia biudžeto vykdymo Excel — failas validus', async ({
    page,
  }) => {
    const request = page.context().request;
    const currentYear = new Date().getFullYear();

    // 1. Login kaip AM admin
    await loginViaApi(request, ACCOUNTS.amAdmin.username);

    // 2. Navigate į /ataskaitos
    await page.goto('/ataskaitos');
    await expect(
      page.getByRole('heading', { name: 'Ataskaitos' }),
    ).toBeVisible({ timeout: 10_000 });

    // 3. „Biudžeto vykdymas" tab'as default'as — patikrinam, kad matomas
    await expect(
      page.getByTestId('reports-tab-budget-execution'),
    ).toBeVisible();

    // 4. Įvesti metus (default'as = currentYear, bet užtikrinam)
    await page.getByTestId('be-year-input').fill(String(currentYear));

    // 5. Paspausti „Atsisiųsti Excel" — Playwright waitForEvent('download')
    const downloadPromise = page.waitForEvent('download', { timeout: 30_000 });
    await page.getByTestId('be-download-xlsx').click();
    const download = await downloadPromise;

    // 6. Patikrinti suggested filename — formatas pagal reports.service.ts:
    //    `biudzeto-vykdymas-{year}-{generatedAt-slug}.xlsx`
    const suggestedName = download.suggestedFilename();
    expect(suggestedName).toMatch(/^biudzeto-vykdymas-\d{4}/);
    expect(suggestedName).toMatch(/\.xlsx$/);

    // 7. Išsaugoti failą ir patikrinti dydį + magic bytes
    const tmpPath = await download.path();
    expect(tmpPath, 'Download turi turėti laikiną path\'ą').not.toBeNull();
    if (!tmpPath) throw new Error('Download path missing');

    const fileSize = statSync(tmpPath).size;
    expect(fileSize, 'Excel failo dydis > 0').toBeGreaterThan(0);

    // Excel/xlsx = ZIP (magic: 50 4B 03 04). Patikrinam pirmus 4 bytes.
    const buf = readFileSync(tmpPath);
    expect(buf.length).toBeGreaterThan(100); // sanity: xlsx be content'o ~> 1KB
    expect(buf[0]).toBe(0x50); // 'P'
    expect(buf[1]).toBe(0x4b); // 'K'
    expect(buf[2]).toBe(0x03);
    expect(buf[3]).toBe(0x04);
  });
});
