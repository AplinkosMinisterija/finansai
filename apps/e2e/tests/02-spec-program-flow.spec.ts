/**
 * Iter 16 E2E Journey #2: Spec. programos prašymo flow.
 *
 * Spec.programos prašymai (per docx §3 + ADR-005) keliauja iš pavaldžios
 * institucijos į AM (ping-pong). AM patvirtinus, sukuriamas FVM projektas
 * pavaldžios institucijos tenant'e — projekto biudžetas susiejamas su tos
 * institucijos spec_programa budget_allocation.
 *
 * Setup: pirma sukuriam AAD funding_source + spec_programa budget_allocation
 * (AM admin teisės) — be jų `createFvmProject` grąžintų 400 NO_MATCHING_ALLOCATION.
 *
 * Flow:
 *  1. Login kaip AM admin
 *  2. Užtikrint AAD funding_source + spec_programa budget_allocation (idempotent)
 *  3. Logout AM, login kaip AAD admin
 *  4. Sukurti DRAFT prašymą AAD vardu su budget_category=spec_programa
 *  5. Pateikti (submit) → status SUBMITTED
 *  6. Logout AAD, login AM admin
 *  7. Patvirtinti per API (decision=approve)
 *  8. UI: navigate į /prasymai/:id, paspausti „Sukurti FVM projektą" mygtuką
 *  9. Verify: po click'o atsiranda „Žiūrėti projektą →" link'as
 * 10. Naviguoti į /projektai — naujas projektas matomas sąraše
 */
import { test, expect } from '@playwright/test';
import { ACCOUNTS, loginViaApi, logout } from './helpers/auth';
import { apiGet, apiPatch, apiPost, uniqueSuffix } from './helpers/api';

interface ClassifierItem {
  id: number;
  code: string;
  name: string;
  active: boolean;
}

interface FinancingRequest {
  id: number;
  tenantId: number;
  tenantCode: string;
  status: string;
  projectName: string;
  budgetCategoryId: number | null;
  budgetCategoryCode: string | null;
  fvmProjectId: number | null;
}

interface Tenant {
  id: number;
  code: string;
  name: string;
  isApprover: boolean;
}

interface FundingSource {
  id: number;
  tenantId: number;
  kodas: string;
  metai: number;
}

interface BudgetAllocation {
  id: number;
  fundingSourceId: number;
  categoryClassifierItemId: number;
}

test.describe('Iter 16 Journey #2: Spec. programa flow', () => {
  test('Org admin pateikia spec.programa prašymą, AM patvirtina ir sukuria FVM projektą', async ({
    page,
  }) => {
    const request = page.context().request;
    const suffix = uniqueSuffix();
    const projectName = `E2E spec.programa ${suffix}`;
    const currentYear = new Date().getFullYear();

    // ── Setup faza (AM admin teisės) ────────────────────────────────────

    await loginViaApi(request, ACCOUNTS.amAdmin.username);

    // Resolvinam tenant'us ir klasifikatorius
    const tenants = await apiGet<Tenant[]>(request, '/tenants');
    const aadTenant = tenants.find((t) => t.code === 'AAD');
    expect(aadTenant, 'AAD tenant turi egzistuoti').toBeDefined();
    if (!aadTenant) throw new Error('AAD tenant missing');

    const categories = await apiGet<ClassifierItem[]>(
      request,
      '/classifiers/items?groupCode=budget_category',
    );
    const specCat = categories.find((c) => c.code === 'spec_programa');
    expect(specCat, 'spec_programa budget_category turi egzistuoti').toBeDefined();
    if (!specCat) throw new Error('spec_programa missing');

    const fundingTypes = await apiGet<ClassifierItem[]>(
      request,
      '/classifiers/items?groupCode=funding_source_type',
    );
    const biudzetasType = fundingTypes.find((t) => t.code === 'biudzetas');
    expect(biudzetasType, 'biudzetas funding_source_type turi egzistuoti').toBeDefined();
    if (!biudzetasType) throw new Error('biudzetas funding_source_type missing');

    // Užtikrint AAD funding_source šiems metams (idempotent)
    const aadKodas = `AAD-VB-E2E-${suffix}`;
    const aadSource = await apiPost<FundingSource>(request, '/funding-sources', {
      tenantId: aadTenant.id,
      pavadinimas: `AAD VB ${currentYear} (E2E ${suffix})`,
      kodas: aadKodas,
      tipasClassifierItemId: biudzetasType.id,
      metai: currentYear,
      metineSuma: '100000.00',
      aprasymas: 'AAD biudžeto šaltinis E2E testui',
      aktyvus: true,
    });
    expect(aadSource.id).toBeGreaterThan(0);

    // Užtikrint AAD spec_programa budget_allocation
    const aadSpecAllocation = await apiPost<BudgetAllocation>(
      request,
      '/budget-allocations',
      {
        fundingSourceId: aadSource.id,
        categoryClassifierItemId: specCat.id,
        pavadinimas: `AAD spec.programa ${currentYear} (E2E ${suffix})`,
        specProgTipas: 'atskiras',
        planuotaSuma: '50000.00',
        metai: currentYear,
      },
    );
    expect(aadSpecAllocation.id).toBeGreaterThan(0);

    // ── Submitter faza (AAD admin) ──────────────────────────────────────

    await logout(request);
    await loginViaApi(request, ACCOUNTS.aadAdmin.username);

    // Sukurti DRAFT prašymą AAD vardu
    const created = await apiPost<FinancingRequest>(request, '/requests', {
      year: currentYear,
    });
    const requestId = created.id;
    expect(requestId).toBeGreaterThan(0);

    // Užpildyti privalomus + FVM laukus
    await apiPatch(request, `/requests/${requestId}`, {
      projectName,
      systemCode: 'AADIS',
      projectType: 'IT_SYSTEM',
      description: 'E2E testas spec.programos flow patikrai',
      plannedWorks: 'Testavimo darbai',
      priority: 2,
      procurementStage: 'Pradėtas',
      costDevelopment: 25000,
      fundingFromIt: 25000,
      q1Amount: 0,
      q2Amount: 0,
      q3Amount: 12500,
      q4Amount: 12500,
      responsibleInstitution: 'AAD',
      executorName: 'E2E Testuotojas',
      executorEmail: 'e2e@aad.lt',
      implementationDeadline: `${currentYear}-12-31`,
      budgetCategoryId: specCat.id,
      specProgramFundingType: 'atskiras',
    });

    // Submit
    await apiPost(request, `/requests/${requestId}/submit`, {});
    const afterSubmit = await apiGet<FinancingRequest>(
      request,
      `/requests/${requestId}`,
    );
    expect(afterSubmit.status).toBe('SUBMITTED');

    // ── Approver faza (AM admin) ────────────────────────────────────────

    await logout(request);
    await loginViaApi(request, ACCOUNTS.amAdmin.username);

    // Patvirtinti per API
    await apiPost(request, `/requests/${requestId}/decision`, {
      decision: 'approve',
      grantedAmount: 25000,
      protocol: `E2E-${suffix}`,
      order: `E2E Įsakymas ${suffix}`,
      comment: 'E2E testas — patvirtinta',
      budgetCategoryId: specCat.id,
      specProgramFundingType: 'atskiras',
    });

    // UI: navigate į detail puslapį, paspausti „Sukurti FVM projektą"
    await page.goto(`/prasymai/${requestId}`);
    const createBtn = page.getByTestId('create-fvm-project-btn');
    await expect(createBtn).toBeVisible({ timeout: 10_000 });
    await createBtn.click();

    // Po sėkmingo create — UI automatiškai redirect'ina į /projektai/:id
    // (žr. PrasymoDetailPage.tsx → createFvmProjectMutation.onSuccess).
    await page.waitForURL(/\/projektai\/\d+/, { timeout: 15_000 });

    // Verify per API: request.fvmProjectId užpildytas, projektas egzistuoja
    const finalRequest = await apiGet<FinancingRequest>(
      request,
      `/requests/${requestId}`,
    );
    expect(
      finalRequest.fvmProjectId,
      'fvmProjectId turi būti užpildytas',
    ).not.toBeNull();
    const projectId = finalRequest.fvmProjectId;
    expect(projectId).toBeGreaterThan(0);

    // URL turi būti /projektai/:projectId
    expect(page.url()).toMatch(new RegExp(`/projektai/${projectId}$`));

    // Projekto detalė turi turėti projekto pavadinimą antraštėje
    await expect(page.getByRole('heading', { level: 1 })).toContainText(
      projectName,
      { timeout: 10_000 },
    );

    // Galiausiai — naviguoti į /projektai sąrašą ir patikrinti, kad row'as matomas
    await page.goto('/projektai');
    await expect(
      page.getByRole('heading', { name: 'Projektai' }),
    ).toBeVisible();
    await expect(
      page.locator(`[data-testid="project-row-${projectId}"]`),
    ).toBeVisible({ timeout: 10_000 });
  });
});
