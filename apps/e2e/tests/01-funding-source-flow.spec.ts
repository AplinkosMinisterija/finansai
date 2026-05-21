/**
 * Iter 16 E2E Journey #1: AM admin sukuria finansavimo šaltinį.
 *
 * Flow:
 *  1. Prisijungti kaip `demo` (AM admin)
 *  2. Naviguoti į /finansavimo-saltiniai
 *  3. Paspausti „Naujas šaltinis" → atsidaro FundingSourceDialog
 *  4. Užpildyti formą (unikalus kodas + pavadinimas, AM tenant, type, year, suma)
 *  5. Submit'inti → kortelė turi pasirodyti sąraše
 *  6. Verify: kortelė matoma su teisingu pavadinimu ir suma
 *
 * Selektoriai per `data-testid` kur įmanoma. LT UI tekstas role/text per Playwright
 * locator semantic API kur stabilesnis.
 */
import { test, expect } from '@playwright/test';
import { ACCOUNTS, loginViaApi } from './helpers/auth';
import { apiGet, uniqueSuffix } from './helpers/api';

interface ClassifierItem {
  id: number;
  code: string;
  name: string;
  active: boolean;
  groupCode: string;
}

test.describe('Iter 16 Journey #1: Funding source flow', () => {
  test('AM admin sukuria funding_source ir mato kortelę sąraše', async ({
    page,
  }) => {
    // 1. Login per API naudojant page context'ą — cookie'is share'inasi su navigation'u.
    const request = page.context().request;
    await loginViaApi(request, ACCOUNTS.amAdmin.username);

    // 2. Naviguoti į finansavimo šaltinius
    await page.goto('/finansavimo-saltiniai');
    await expect(
      page.getByRole('heading', { name: 'Finansavimo šaltiniai' }),
    ).toBeVisible();

    // 3. Paspausti „Naujas šaltinis"
    await page.getByTestId('open-new-funding-source').click();

    // Atsidaro dialog'as su antrašte „Naujas finansavimo šaltinis"
    await expect(
      page.getByRole('heading', { name: 'Naujas finansavimo šaltinis' }),
    ).toBeVisible();

    // 4. Užpildyti formą — unikalus kodas
    const suffix = uniqueSuffix();
    const kodas = `E2E-${suffix}`;
    const pavadinimas = `E2E testas — ${suffix}`;

    await page.locator('#fs-kodas').fill(kodas);
    await page.locator('#fs-pavadinimas').fill(pavadinimas);

    // Organizacija — pasirinkti AM (jau default per defaultTenantId, bet užtikrinam).
    // shadcn/ui Select — open trigger + parinkti option
    await page.locator('#fs-tenant').click();
    await page
      .getByRole('option', { name: /Aplinkos ministerija/ })
      .first()
      .click();

    // Tipas — paimti pirmą active funding_source_type iš API ir pasirinkti pagal pavadinimą
    const types = await apiGet<ClassifierItem[]>(
      request,
      '/classifiers/items?groupCode=funding_source_type',
    );
    const activeType = types.find((t) => t.active);
    expect(activeType, 'No active funding_source_type classifier item').toBeDefined();
    if (!activeType) throw new Error('No funding_source_type');

    await page.locator('#fs-tipas').click();
    // Option text formatas: `Name (code)`
    await page
      .getByRole('option', { name: new RegExp(activeType.name, 'i') })
      .first()
      .click();

    // Metai — paliekam default (current year), tik patikrinam
    const currentYear = new Date().getFullYear();
    await expect(page.locator('#fs-metai')).toHaveValue(String(currentYear));

    // Metinė suma
    await page.locator('#fs-suma').fill('250000');

    // 5. Submit — paspausti „Sukurti"
    await page.getByRole('button', { name: 'Sukurti', exact: true }).click();

    // 6. Verify: dialog'as turi užsidaryti ir kortelė matoma
    // Dialog uždaromas — laukiam, kol pranyks antraštė
    await expect(
      page.getByRole('heading', { name: 'Naujas finansavimo šaltinis' }),
    ).toBeHidden({ timeout: 10_000 });

    // Verify: per API išmatuojam, kad source iš tiesų sukurta (defensive — jei UI
    // cache'as su delay, perregistruojame query'į pasitelkdami DB tiesa).
    interface FundingSource {
      id: number;
      kodas: string;
      pavadinimas: string;
      metineSuma: string;
    }
    const sources = await apiGet<FundingSource[]>(
      request,
      `/funding-sources?year=${currentYear}`,
    );
    const created = sources.find((s) => s.kodas === kodas);
    expect(created, `Funding source su kodu ${kodas} turėtų egzistuoti`).toBeDefined();
    if (created) {
      expect(created.pavadinimas).toBe(pavadinimas);
      // Suma store'inama kaip string per Postgres numeric → '250000.00'
      expect(Number.parseFloat(created.metineSuma)).toBeCloseTo(250000, 0);
    }

    // UI verify: kortelė pavadinimas matomas
    await expect(page.getByText(pavadinimas).first()).toBeVisible({
      timeout: 10_000,
    });
  });
});
