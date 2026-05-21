/**
 * Iter 16 E2E Journey #4: Payroll permission (DU access control).
 *
 * Tikrinami trys saugumo sluoksniai (docx §4.4, Iter 13 saugumo audito output):
 *  1. Route guard (`DuPage.tsx`): org_user atvėręs /du yra redirect'inamas į /.
 *  2. Sidebar: DU punktas paslepiamas org_user'iui.
 *  3. Ataskaitų puslapyje (`AtaskaitosPage.tsx`): „DU paskirstymas" tab'as
 *     paslepiamas org_user'iui (`canViewPayroll`).
 *
 * Naudojam aad-user (org specialistas — role=user, tenantIsApprover=false).
 *
 * Backend taip pat forsuoja 403 per `requireDuAccess` payroll service'e, bet
 * UI gating'as papildomas defense-in-depth.
 */
import { test, expect } from '@playwright/test';
import { ACCOUNTS, loginViaApi } from './helpers/auth';

test.describe('Iter 16 Journey #4: Payroll permission gating', () => {
  test('Org specialistas (aad-user) negali pasiekti /du ir nemato DU ataskaitų tab\'o', async ({
    page,
  }) => {
    const request = page.context().request;

    // 1. Login kaip aad-user (org_user / specialistas)
    await loginViaApi(request, ACCOUNTS.aadUser.username);

    // 2. Bandymas pasiekti /du — DuPage route guard'as turi redirect'inti į /
    await page.goto('/du');

    // Laukiam, kol URL atsidengs (redirect'as gali užtrukti dėl auth bootstrap'o).
    // Po redirect'o URL turi NEbūti /du — laukiam /, /home arba kt.
    await page.waitForURL((url) => !url.pathname.startsWith('/du'), {
      timeout: 10_000,
    });
    expect(page.url(), 'Po redirect\'o URL neturi būti /du').not.toMatch(/\/du\b/);

    // 3. Sidebar gating'as — DU punkto neturi būti
    // Sidebar Link'as su tekstu „Darbo užmokestis" arba „DU"
    const sidebarDuLink = page.locator('aside a[href="/du"]');
    await expect(sidebarDuLink).toHaveCount(0);

    // 4. Ataskaitų puslapyje — „DU paskirstymas" tab'o neturi būti
    await page.goto('/ataskaitos');
    await expect(
      page.getByRole('heading', { name: 'Ataskaitos' }),
    ).toBeVisible({ timeout: 10_000 });

    // Tab'ų list'as matomas, bet payroll tab'as paslėptas
    await expect(page.getByTestId('reports-tabs')).toBeVisible();
    await expect(
      page.getByTestId('reports-tab-budget-execution'),
    ).toBeVisible();
    await expect(
      page.getByTestId('reports-tab-spec-program'),
    ).toBeVisible();
    // DU tab'as NEturi būti DOM'e (`canViewPayroll(user) === false` → ne-render'as)
    await expect(
      page.getByTestId('reports-tab-payroll-distribution'),
    ).toHaveCount(0);
  });
});
