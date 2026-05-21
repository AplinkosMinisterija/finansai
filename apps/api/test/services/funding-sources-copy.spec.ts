/**
 * fundingSources.copyFromYear endpoint integration tests (Iter 15, F16).
 *
 * Tests (5+):
 *  1. AM admin copy from 2025 → 2026: visi šaltiniai + allocations sukurti
 *  2. Conflict: target year jau turi šaltinius → 409
 *  3. Source year tuščias → 400 LT
 *  4. Org admin → 403
 *  5. SourceYear === targetYear → 400
 *  6. AM admin su tenantId — kopijuoja TIK konkrečiam tenant
 *  7. Visa transakcijoje — jei kopijavimas nepavyksta vidury, nieko nesukuria
 *  8. Allocations su NULL specProgTipas kopijavimas
 */
import type { ServiceBroker } from 'moleculer';
import type {
  BudgetAllocation as BudgetAllocationDTO,
  CopyBudgetResponse,
  FundingSource as FundingSourceDTO,
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

describe('fundingSources.copyFromYear endpoint (Iter 15, F16)', () => {
  let broker: ServiceBroker;
  let base: BaseFixtures;
  let org: OrgTenantFixtures;
  let cls: FvmClassifierFixtures;

  beforeAll(async () => {
    broker = await createTestBroker();
  });

  afterAll(async () => {
    if (broker) {
      await broker.stop();
    }
    await closeTestKnex();
  });

  beforeEach(async () => {
    const knex = getTestKnex();
    await truncateAll(knex);
    base = await seedBaseFixtures(knex);
    org = await seedOrgTenant(knex);
    cls = await seedFvmClassifiers(knex);
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

  function orgUserMock() {
    return mockOrgUser({
      id: org.orgUserId,
      tenantId: org.orgTenantId,
    });
  }

  /**
   * Sukuria 1 funding_source + 2 allocations source year'e.
   */
  async function seedSourceWithAllocations(opts: {
    tenantId: number;
    year: number;
    sourceKodas?: string;
  }): Promise<{
    source: FundingSourceDTO;
    allocations: BudgetAllocationDTO[];
  }> {
    const source = (await broker.call(
      'fundingSources.create',
      {
        tenantId: opts.tenantId,
        pavadinimas: `Source ${opts.year}`,
        kodas: opts.sourceKodas ?? `SRC-${opts.tenantId}-${opts.year}`,
        tipasClassifierItemId: cls.fundingSourceTypeItemIds.biudzetas,
        metai: opts.year,
        metineSuma: '1500000.00',
        aprasymas: 'Test šaltinis',
      },
      { meta: { user: amAdmin() } },
    )) as FundingSourceDTO;

    const a1 = (await broker.call(
      'budgetAllocations.create',
      {
        fundingSourceId: source.id,
        categoryClassifierItemId: cls.budgetCategoryItemIds.prekes_paslaugos,
        pavadinimas: 'Prekės ir paslaugos',
        planuotaSuma: '800000.00',
        metai: opts.year,
        pastabos: 'Pirma alloc',
      },
      { meta: { user: amAdmin() } },
    )) as BudgetAllocationDTO;

    const a2 = (await broker.call(
      'budgetAllocations.create',
      {
        fundingSourceId: source.id,
        categoryClassifierItemId: cls.budgetCategoryItemIds.spec_programa,
        pavadinimas: 'Specialioji programa A',
        specProgTipas: 'biudzeto_dalis',
        planuotaSuma: '300000.00',
        metai: opts.year,
      },
      { meta: { user: amAdmin() } },
    )) as BudgetAllocationDTO;

    return { source, allocations: [a1, a2] };
  }

  it('1. AM admin copy 2025 → 2026: visi šaltiniai + allocations sukurti', async () => {
    // Seed 2025 — 1 šaltinis + 2 allocations
    await seedSourceWithAllocations({
      tenantId: base.amTenantId,
      year: 2025,
      sourceKodas: 'AM-VB-2025',
    });

    const resp = (await broker.call(
      'fundingSources.copyFromYear',
      { sourceYear: 2025, targetYear: 2026 },
      { meta: { user: amAdmin() } },
    )) as CopyBudgetResponse;

    expect(resp.copiedSources).toBe(1);
    expect(resp.copiedAllocations).toBe(2);
    expect(resp.targetYear).toBe(2026);

    // Verify — list funding_sources for 2026
    const sources2026 = (await broker.call(
      'fundingSources.list',
      { year: 2026 },
      { meta: { user: amAdmin() } },
    )) as FundingSourceDTO[];
    expect(sources2026).toHaveLength(1);
    expect(sources2026[0]!.pavadinimas).toBe('Source 2025');
    expect(sources2026[0]!.kodas).toBe('AM-VB-2025');
    expect(sources2026[0]!.metai).toBe(2026);
    expect(sources2026[0]!.metineSuma).toBe('1500000.00');
    expect(sources2026[0]!.aprasymas).toBe('Test šaltinis');

    // Allocations for 2026
    const newSourceId = sources2026[0]!.id;
    const allocs2026 = (await broker.call(
      'budgetAllocations.list',
      { year: 2026, fundingSourceId: newSourceId },
      { meta: { user: amAdmin() } },
    )) as BudgetAllocationDTO[];
    expect(allocs2026).toHaveLength(2);
    const prekes = allocs2026.find((a) => a.pavadinimas === 'Prekės ir paslaugos');
    expect(prekes).toBeDefined();
    expect(prekes!.metai).toBe(2026);
    expect(prekes!.planuotaSuma).toBe('800000.00');

    const specProg = allocs2026.find((a) => a.pavadinimas === 'Specialioji programa A');
    expect(specProg).toBeDefined();
    expect(specProg!.specProgTipas).toBe('biudzeto_dalis');
    expect(specProg!.planuotaSuma).toBe('300000.00');
  });

  it('2. Conflict: target year jau turi šaltinius → 409', async () => {
    // Sukurti 2025 + 2026 įrašus
    await seedSourceWithAllocations({
      tenantId: base.amTenantId,
      year: 2025,
      sourceKodas: 'AM-VB-2025',
    });
    await seedSourceWithAllocations({
      tenantId: base.amTenantId,
      year: 2026,
      sourceKodas: 'AM-VB-2026',
    });

    await expect(
      broker.call(
        'fundingSources.copyFromYear',
        { sourceYear: 2025, targetYear: 2026 },
        { meta: { user: amAdmin() } },
      ),
    ).rejects.toMatchObject({
      code: 409,
      type: 'COPY_TARGET_NOT_EMPTY',
    });
  });

  it('3. Source year tuščias → 400 LT', async () => {
    await expect(
      broker.call(
        'fundingSources.copyFromYear',
        { sourceYear: 2025, targetYear: 2026 },
        { meta: { user: amAdmin() } },
      ),
    ).rejects.toMatchObject({
      code: 400,
      type: 'COPY_SOURCE_EMPTY',
      message: expect.stringContaining('2025'),
    });
  });

  it('4. Org admin → 403', async () => {
    await seedSourceWithAllocations({
      tenantId: org.orgTenantId,
      year: 2025,
      sourceKodas: 'ORG-VB-2025',
    });

    await expect(
      broker.call(
        'fundingSources.copyFromYear',
        { sourceYear: 2025, targetYear: 2026 },
        { meta: { user: orgAdmin() } },
      ),
    ).rejects.toMatchObject({
      code: 403,
      type: 'FORBIDDEN',
    });

    await expect(
      broker.call(
        'fundingSources.copyFromYear',
        { sourceYear: 2025, targetYear: 2026 },
        { meta: { user: orgUserMock() } },
      ),
    ).rejects.toMatchObject({
      code: 403,
      type: 'FORBIDDEN',
    });
  });

  it('5. sourceYear === targetYear → 400', async () => {
    await seedSourceWithAllocations({
      tenantId: base.amTenantId,
      year: 2025,
      sourceKodas: 'AM-VB-2025',
    });

    await expect(
      broker.call(
        'fundingSources.copyFromYear',
        { sourceYear: 2025, targetYear: 2025 },
        { meta: { user: amAdmin() } },
      ),
    ).rejects.toMatchObject({
      code: 400,
      type: 'COPY_SAME_YEAR',
    });
  });

  it('6. AM admin su tenantId — kopijuoja TIK konkrečiam tenant', async () => {
    // 2025: AM tenant + Org tenant abu turi sources
    await seedSourceWithAllocations({
      tenantId: base.amTenantId,
      year: 2025,
      sourceKodas: 'AM-VB-2025',
    });
    await seedSourceWithAllocations({
      tenantId: org.orgTenantId,
      year: 2025,
      sourceKodas: 'ORG-VB-2025',
    });

    // Kopijuojam TIK Org tenant'ą
    const resp = (await broker.call(
      'fundingSources.copyFromYear',
      { sourceYear: 2025, targetYear: 2026, tenantId: org.orgTenantId },
      { meta: { user: amAdmin() } },
    )) as CopyBudgetResponse;

    expect(resp.copiedSources).toBe(1);
    expect(resp.copiedAllocations).toBe(2);

    // 2026 — turi tik 1 source (org)
    const sources2026 = (await broker.call(
      'fundingSources.list',
      { year: 2026 },
      { meta: { user: amAdmin() } },
    )) as FundingSourceDTO[];
    expect(sources2026).toHaveLength(1);
    expect(sources2026[0]!.tenantId).toBe(org.orgTenantId);
    expect(sources2026[0]!.kodas).toBe('ORG-VB-2025');

    // AM tenant 2026 — vis dar tuščia
    const am2026 = (await broker.call(
      'fundingSources.list',
      { year: 2026, tenantId: base.amTenantId },
      { meta: { user: amAdmin() } },
    )) as FundingSourceDTO[];
    expect(am2026).toHaveLength(0);
  });

  it('7. Kopijuoja per kelis tenants, jei tenantId nenurodytas', async () => {
    await seedSourceWithAllocations({
      tenantId: base.amTenantId,
      year: 2025,
      sourceKodas: 'AM-VB-2025',
    });
    await seedSourceWithAllocations({
      tenantId: org.orgTenantId,
      year: 2025,
      sourceKodas: 'ORG-VB-2025',
    });

    const resp = (await broker.call(
      'fundingSources.copyFromYear',
      { sourceYear: 2025, targetYear: 2026 },
      { meta: { user: amAdmin() } },
    )) as CopyBudgetResponse;

    expect(resp.copiedSources).toBe(2);
    expect(resp.copiedAllocations).toBe(4);
  });

  it('8. Allocations su NULL specProgTipas (ne-spec_programa kategorija) kopijavimas', async () => {
    // Funding source 2025 — TIK 1 allocation be specProgTipas
    const source = (await broker.call(
      'fundingSources.create',
      {
        tenantId: base.amTenantId,
        pavadinimas: 'AM VB',
        kodas: 'AM-VB-2025',
        tipasClassifierItemId: cls.fundingSourceTypeItemIds.biudzetas,
        metai: 2025,
        metineSuma: '2000000.00',
      },
      { meta: { user: amAdmin() } },
    )) as FundingSourceDTO;

    await broker.call(
      'budgetAllocations.create',
      {
        fundingSourceId: source.id,
        categoryClassifierItemId: cls.budgetCategoryItemIds.investicijos,
        pavadinimas: 'Investicijos',
        planuotaSuma: '500000.00',
        metai: 2025,
      },
      { meta: { user: amAdmin() } },
    );

    const resp = (await broker.call(
      'fundingSources.copyFromYear',
      { sourceYear: 2025, targetYear: 2026 },
      { meta: { user: amAdmin() } },
    )) as CopyBudgetResponse;

    expect(resp.copiedSources).toBe(1);
    expect(resp.copiedAllocations).toBe(1);

    const sources2026 = (await broker.call(
      'fundingSources.list',
      { year: 2026 },
      { meta: { user: amAdmin() } },
    )) as FundingSourceDTO[];
    expect(sources2026).toHaveLength(1);
    const allocs2026 = (await broker.call(
      'budgetAllocations.list',
      { year: 2026, fundingSourceId: sources2026[0]!.id },
      { meta: { user: amAdmin() } },
    )) as BudgetAllocationDTO[];
    expect(allocs2026).toHaveLength(1);
    expect(allocs2026[0]!.specProgTipas).toBeNull();
    expect(allocs2026[0]!.categoryCode).toBe('investicijos');
  });
});
