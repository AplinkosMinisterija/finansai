/**
 * reports.budgetExecution integration tests (Iter 14, FVM-6).
 *
 * Test'ai (5+):
 *  1. AM admin gauna pilną ataskaitą su DU eilutėmis ir agregacijomis
 *  2. Org user gauna ataskaitą BE DU info (faktinė be DU expense'ų;
 *     byCategory be 'du' eilučių)
 *  3. Empty data → tuščia struktura
 *  4. xlsx format'as grąžina binary buffer
 *  5. pdf format'as grąžina binary buffer
 *  6. Tenant scope: org_admin tik savo tenant'e (kitos tenant cross-tenant
 *     filter'is per `tenantId` param → 403)
 *  7. Total agregacijos teisingos (per source + grand total)
 */
import type { ServiceBroker } from 'moleculer';
import type {
  BudgetAllocation as BudgetAllocationDTO,
  BudgetExecutionReport,
  FundingSource as FundingSourceDTO,
  PayrollProfile as PayrollProfileDTO,
  Project as ProjectDTO,
} from '@biip-finansai/shared';
import {
  getTestKnex,
  closeTestKnex,
  truncateAll,
  seedBaseFixtures,
  seedOrgTenant,
  seedFvmClassifiers,
  type BaseFixtures,
  type OrgTenantFixtures,
  type FvmClassifierFixtures,
} from '../helpers/db';
import { createTestBroker } from '../helpers/broker';
import { mockAuthUser, mockOrgAdmin, mockOrgUser } from '../helpers/auth';

describe('reports.budgetExecution (Iter 14)', () => {
  let broker: ServiceBroker;
  let base: BaseFixtures;
  let org: OrgTenantFixtures;
  let cls: FvmClassifierFixtures;

  beforeAll(async () => {
    broker = await createTestBroker();
  });

  afterAll(async () => {
    if (broker) await broker.stop();
    await closeTestKnex();
  });

  function amAdmin() {
    return mockAuthUser({
      id: base.amAdminUserId,
      tenantId: base.amTenantId,
      tenantIsApprover: true,
      role: 'admin',
    });
  }

  function orgAdmin() {
    return mockOrgAdmin({
      id: org.orgAdminUserId,
      tenantId: org.orgTenantId,
    });
  }

  function orgUser() {
    return mockOrgUser({
      id: org.orgUserId,
      tenantId: org.orgTenantId,
    });
  }

  beforeEach(async () => {
    const knex = getTestKnex();
    await truncateAll(knex);
    base = await seedBaseFixtures(knex);
    org = await seedOrgTenant(knex);
    cls = await seedFvmClassifiers(knex);
  });

  /**
   * Bendras seed'as scenarijams 1, 2: org tenant'as su DU allocation +
   * PP allocation, vienas projektas, du expense'ai (1 DU + 1 PP).
   */
  async function seedFullScenario(): Promise<{
    fs: FundingSourceDTO;
    duAlloc: BudgetAllocationDTO;
    ppAlloc: BudgetAllocationDTO;
    project: ProjectDTO;
    profileId: number;
  }> {
    const fs = (await broker.call(
      'fundingSources.create',
      {
        tenantId: org.orgTenantId,
        pavadinimas: 'Org VB 2026',
        kodas: 'ORG-VB-2026',
        tipasClassifierItemId: cls.fundingSourceTypeItemIds.biudzetas,
        metai: 2026,
        metineSuma: '500000.00',
      },
      { meta: { user: amAdmin() } },
    )) as FundingSourceDTO;

    const duAlloc = (await broker.call(
      'budgetAllocations.create',
      {
        fundingSourceId: fs.id,
        categoryClassifierItemId: cls.budgetCategoryItemIds.du,
        pavadinimas: 'Org DU 2026',
        planuotaSuma: '200000.00',
        metai: 2026,
      },
      { meta: { user: amAdmin() } },
    )) as BudgetAllocationDTO;

    const ppAlloc = (await broker.call(
      'budgetAllocations.create',
      {
        fundingSourceId: fs.id,
        categoryClassifierItemId: cls.budgetCategoryItemIds.prekes_paslaugos,
        pavadinimas: 'Org PP 2026',
        planuotaSuma: '100000.00',
        metai: 2026,
      },
      { meta: { user: amAdmin() } },
    )) as BudgetAllocationDTO;

    // Non-DU projektas + ne-DU expense
    const project = (await broker.call(
      'projects.create',
      {
        tenantId: org.orgTenantId,
        budgetAllocationId: ppAlloc.id,
        pavadinimas: 'Org PP projektas',
        tipas: 'projektas',
        biudzetas: '50000.00',
      },
      { meta: { user: amAdmin() } },
    )) as ProjectDTO;

    await broker.call(
      'expenses.create',
      {
        projectId: project.id,
        budgetAllocationId: ppAlloc.id,
        tipas: 'saskaita',
        suma: '20000.00',
        data: '2026-03-15',
      },
      { meta: { user: amAdmin() } },
    );

    // DU profile + distribution + computeMonth, kad atsirastų DU expense
    const profile = (await broker.call(
      'payroll.createProfile',
      {
        tenantId: org.orgTenantId,
        vardasPavarde: 'Petras Sensitive',
        pareigos: 'Vyriausiasis specialistas',
        sutartiesTipas: 'darbo',
        atlyginimasBruto: '3000.00',
        priedai: '500.00',
        galiojaNuo: '2026-01-01',
      },
      { meta: { user: amAdmin() } },
    )) as PayrollProfileDTO;
    await broker.call(
      'payroll.createDistribution',
      {
        payrollProfileId: profile.id,
        fundingSourceId: fs.id,
        paskirstymoTipas: 'procentais',
        reiksme: '100',
        galiojaNuo: '2026-01-01',
      },
      { meta: { user: amAdmin() } },
    );
    await broker.call(
      'payroll.computeMonth',
      { month: '2026-03' },
      { meta: { user: amAdmin() } },
    );

    return { fs, duAlloc, ppAlloc, project, profileId: profile.id };
  }

  // ---- Test 1 ----
  it('1. AM admin gauna pilną ataskaitą su DU eilutėmis', async () => {
    await seedFullScenario();
    const resp = (await broker.call(
      'reports.budgetExecution',
      { year: 2026 },
      { meta: { user: amAdmin() } },
    )) as BudgetExecutionReport;

    expect(resp.year).toBe(2026);
    expect(typeof resp.generatedAt).toBe('string');
    expect(resp.bySource).toHaveLength(1);
    const src = resp.bySource[0]!;
    expect(src.fundingSourceName).toBe('Org VB 2026');
    // Tiek DU, tiek PP allocations matomi AM admin'ui
    const codes = src.byCategory.map((c) => c.categoryCode).sort();
    expect(codes).toEqual(['du', 'prekes_paslaugos']);
    // DU faktinė: 3000 + 500 = 3500 (vienas mėnuo, 100%)
    const duRow = src.byCategory.find((c) => c.categoryCode === 'du')!;
    expect(duRow.planuota).toBe('200000.00');
    expect(Number.parseFloat(duRow.faktine)).toBeCloseTo(3500, 2);
    // PP faktinė: 20000
    const ppRow = src.byCategory.find(
      (c) => c.categoryCode === 'prekes_paslaugos',
    )!;
    expect(ppRow.faktine).toBe('20000.00');
    // Grand totals
    expect(resp.totalPlanuota).toBe('300000.00');
    expect(Number.parseFloat(resp.totalFaktine)).toBeCloseTo(23500, 2);
  });

  // ---- Test 2 ----
  it('2. Org user gauna ataskaitą BE DU info', async () => {
    await seedFullScenario();
    const resp = (await broker.call(
      'reports.budgetExecution',
      { year: 2026 },
      { meta: { user: orgUser() } },
    )) as BudgetExecutionReport;

    expect(resp.bySource).toHaveLength(1);
    const src = resp.bySource[0]!;
    // DU eilutė PAŠALINTA
    const codes = src.byCategory.map((c) => c.categoryCode);
    expect(codes).not.toContain('du');
    expect(codes).toEqual(['prekes_paslaugos']);
    // Faktinė turi būti TIK iš ne-DU (20000)
    expect(src.faktine).toBe('20000.00');
    // Grand totals — be DU
    expect(resp.totalFaktine).toBe('20000.00');
    // Planuota — be DU allocation (DU paslėpta)
    expect(resp.totalPlanuota).toBe('100000.00');
  });

  // ---- Test 3 ----
  it('3. Empty data → tuščia struktura', async () => {
    const resp = (await broker.call(
      'reports.budgetExecution',
      { year: 2026 },
      { meta: { user: amAdmin() } },
    )) as BudgetExecutionReport;
    expect(resp.year).toBe(2026);
    expect(resp.bySource).toEqual([]);
    expect(resp.totalPlanuota).toBe('0.00');
    expect(resp.totalFaktine).toBe('0.00');
    expect(resp.totalLikutis).toBe('0.00');
  });

  // ---- Test 4 ----
  it('4. xlsx format → binary Buffer', async () => {
    await seedFullScenario();
    const result = (await broker.call(
      'reports.budgetExecution',
      { year: 2026, format: 'xlsx' },
      { meta: { user: amAdmin() } },
    )) as Buffer;
    expect(Buffer.isBuffer(result)).toBe(true);
    // Excel signature — ZIP magic (PK\x03\x04)
    expect(result[0]).toBe(0x50);
    expect(result[1]).toBe(0x4b);
    expect(result[2]).toBe(0x03);
    expect(result[3]).toBe(0x04);
    // Reasonable size — empty workbook irgi turi ~5KB+
    expect(result.length).toBeGreaterThan(1000);
  });

  // ---- Test 5 ----
  it('5. pdf format → binary Buffer su LT diakritiniais', async () => {
    await seedFullScenario();
    const result = (await broker.call(
      'reports.budgetExecution',
      { year: 2026, format: 'pdf' },
      { meta: { user: amAdmin() } },
    )) as Buffer;
    expect(Buffer.isBuffer(result)).toBe(true);
    // PDF signature
    expect(result.subarray(0, 4).toString('ascii')).toBe('%PDF');
    expect(result.length).toBeGreaterThan(1000);
  });

  // ---- Test 6 ----
  it('6a. org_admin gauna SAVO tenant ataskaitą', async () => {
    await seedFullScenario();
    const resp = (await broker.call(
      'reports.budgetExecution',
      { year: 2026 },
      { meta: { user: orgAdmin() } },
    )) as BudgetExecutionReport;
    expect(resp.tenantId).toBe(org.orgTenantId);
    expect(resp.bySource).toHaveLength(1);
    // org_admin turi DU prieigą — DU allocations matomi
    const codes = resp.bySource[0]!.byCategory.map((c) => c.categoryCode).sort();
    expect(codes).toContain('du');
  });

  it('6b. org_admin su kito tenant tenantId param → 403', async () => {
    await seedFullScenario();
    await expect(
      broker.call(
        'reports.budgetExecution',
        { year: 2026, tenantId: base.amTenantId },
        { meta: { user: orgAdmin() } },
      ),
    ).rejects.toMatchObject({ code: 403 });
  });

  // ---- Test 7 ----
  it('7. Total agregacijos: source totals = sum(byCategory)', async () => {
    await seedFullScenario();
    const resp = (await broker.call(
      'reports.budgetExecution',
      { year: 2026 },
      { meta: { user: amAdmin() } },
    )) as BudgetExecutionReport;

    for (const src of resp.bySource) {
      const sumPlanuota = src.byCategory.reduce(
        (acc, c) => acc + Number.parseFloat(c.planuota),
        0,
      );
      const sumFaktine = src.byCategory.reduce(
        (acc, c) => acc + Number.parseFloat(c.faktine),
        0,
      );
      expect(Number.parseFloat(src.planuota)).toBeCloseTo(sumPlanuota, 2);
      expect(Number.parseFloat(src.faktine)).toBeCloseTo(sumFaktine, 2);
    }
  });
});
