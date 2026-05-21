/**
 * Iter 16 E2E Journey #3: Expense tracking.
 *
 * Flow:
 *  1. Login kaip AM admin
 *  2. Per API: užtikrint AM funding_source + spec_programa budget_allocation
 *  3. Per API: sukurti naują projektą („projektas" tipo) AM tenant'e su 30k biudžetu
 *  4. UI: navigate į /projektai/:id — patikrinti budget summary (planuota=30k, faktinė=0)
 *  5. UI: paspausti „Pridėti išlaidą" → ExpenseDialog
 *  6. Užpildyti dialog'ą (single source, 5000 EUR, type=darbo_uzmokestis... ne, kita kažkokia)
 *     - PASTABA: DU expense'as susijęs su payroll_profile, todėl naudoju
 *       'irengimai_licencijos' arba 'prekes_paslaugos'.
 *  7. Submit → row matomas lentelėje
 *  8. Verify: biudžetas likutis sumažėjo (per API budget summary call'as)
 */
import { test, expect } from '@playwright/test';
import { ACCOUNTS, loginViaApi } from './helpers/auth';
import { apiGet, apiPost, uniqueSuffix } from './helpers/api';

interface Tenant {
  id: number;
  code: string;
  name: string;
}

interface ClassifierItem {
  id: number;
  code: string;
  name: string;
  active: boolean;
}

interface FundingSource {
  id: number;
}

interface BudgetAllocation {
  id: number;
  fundingSourceId: number;
  categoryClassifierItemId: number;
  planuotaSuma: string;
}

interface Project {
  id: number;
  pavadinimas: string;
  biudzetas: string;
  budgetAllocationId: number | null;
}

interface ProjectSummary {
  biudzetas: string;
  panaudota: string;
  likutis: string;
  percentUsed: number;
  isWarning: boolean;
  isOver: boolean;
}

test.describe('Iter 16 Journey #3: Expense tracking', () => {
  test('AM admin sukuria projektą, prideda išlaidą ir mato budget likučio sumažėjimą', async ({
    page,
  }) => {
    const request = page.context().request;
    const suffix = uniqueSuffix();
    const projectName = `E2E projektas ${suffix}`;
    const currentYear = new Date().getFullYear();

    // 1. Login kaip AM admin
    await loginViaApi(request, ACCOUNTS.amAdmin.username);

    // 2. Resolvinam tenant'us, klasifikatorius
    const tenants = await apiGet<Tenant[]>(request, '/tenants');
    const amTenant = tenants.find((t) => t.code === 'AM');
    if (!amTenant) throw new Error('AM tenant missing');

    const categories = await apiGet<ClassifierItem[]>(
      request,
      '/classifiers/items?groupCode=budget_category',
    );
    const ppCat = categories.find((c) => c.code === 'prekes_paslaugos');
    if (!ppCat) throw new Error('prekes_paslaugos category missing');

    const fundingTypes = await apiGet<ClassifierItem[]>(
      request,
      '/classifiers/items?groupCode=funding_source_type',
    );
    const biudzetasType = fundingTypes.find((t) => t.code === 'biudzetas');
    if (!biudzetasType) throw new Error('biudzetas funding type missing');

    // 3. Sukurti AM funding_source + budget_allocation (idempotent prie skirtingų kodų)
    const fsKodas = `E2E-PP-${suffix}`;
    const source = await apiPost<FundingSource>(request, '/funding-sources', {
      tenantId: amTenant.id,
      pavadinimas: `E2E šaltinis ${suffix}`,
      kodas: fsKodas,
      tipasClassifierItemId: biudzetasType.id,
      metai: currentYear,
      metineSuma: '100000.00',
      aprasymas: 'E2E expense tracking šaltinis',
      aktyvus: true,
    });
    const allocation = await apiPost<BudgetAllocation>(
      request,
      '/budget-allocations',
      {
        fundingSourceId: source.id,
        categoryClassifierItemId: ppCat.id,
        pavadinimas: `E2E PP allocation ${suffix}`,
        specProgTipas: null,
        planuotaSuma: '30000.00',
        metai: currentYear,
        pastabos: null,
      },
    );

    // 4. Sukurti projektą
    const project = await apiPost<Project>(request, '/projects', {
      tenantId: amTenant.id,
      budgetAllocationId: allocation.id,
      pavadinimas: projectName,
      tipas: 'projektas',
      biudzetas: '30000.00',
      statusas: 'vykdoma',
    });
    expect(project.id).toBeGreaterThan(0);

    // 5. UI: navigate į projekto detail puslapį
    await page.goto(`/projektai/${project.id}`);
    await expect(
      page.getByRole('heading', { level: 1, name: new RegExp(projectName) }),
    ).toBeVisible({ timeout: 10_000 });

    // 6. Patikrinti pradinį biudžeto state'ą — likutis = biudžetas (panaudota=0)
    const initialSummary = await apiGet<ProjectSummary>(
      request,
      `/projects/${project.id}/summary`,
    );
    expect(Number.parseFloat(initialSummary.biudzetas)).toBeCloseTo(30000, 2);
    expect(Number.parseFloat(initialSummary.panaudota)).toBe(0);
    expect(Number.parseFloat(initialSummary.likutis)).toBeCloseTo(30000, 2);

    // 7. UI: paspausti „Pridėti išlaidą"
    await page.getByTestId('open-new-expense').click();

    // 8. Užpildyti dialog'ą — single source, 5000 EUR
    //    Expense type'ai: DU / Sutartis / Sąskaita / Tiesioginė. Naudosim
    //    'Sąskaita' (apmokėta sąskaita-faktūra). DU vengiam — reikalauja payroll.
    await page.locator('input[type="radio"][value="saskaita"]').check();

    // Biudžeto paskirstymas — Select (shadcn) → click trigger, pasirinkti option
    await page.getByTestId('expense-allocation-trigger').click();
    await page
      .getByRole('option', { name: new RegExp(`E2E PP allocation ${suffix}`) })
      .first()
      .click();

    // Suma + data
    await page.getByTestId('expense-suma-input').fill('5000');
    await page.getByTestId('expense-data-input').fill(`${currentYear}-06-15`);

    // Aprašymas (optional — skipping; jei reikia, pridėti per locator('#e-aprasymas').fill)

    // Submit per „Sukurti" mygtuką (Save in dialog)
    await page.getByRole('button', { name: /Sukurti|Išsaugoti/, exact: false }).click();

    // 9. Verify: row matomas lentelėje (timeout duodam 10s, nes mutation + invalidate)
    await expect(page.getByTestId('expenses-table')).toBeVisible({
      timeout: 10_000,
    });

    // Per API patvirtinam, kad expense egzistuoja ir budget summary atnaujintas
    const finalSummary = await apiGet<ProjectSummary>(
      request,
      `/projects/${project.id}/summary`,
    );
    expect(Number.parseFloat(finalSummary.panaudota)).toBeCloseTo(5000, 2);
    expect(Number.parseFloat(finalSummary.likutis)).toBeCloseTo(25000, 2);
  });
});
