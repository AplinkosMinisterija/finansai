/**
 * dashboard.fvmSummary endpoint integration tests (Iter 15, F15).
 *
 * Tests (5+):
 *  1. AM admin gauna pilną summary su totals + warnings + deadlines
 *  2. Org user gauna su DU exclude'inta iš totals (ADR-005)
 *  3. Empty data → 0 visur
 *  4. Upcoming deadlines next 30d — projektai su pabaigos_data atfiltruojami
 *  5. Tenant scope: org admin tik savo tenant'e
 *  6. AM admin su tenantId param — filtruoja konkrečiu tenant
 *  7. Org user — tenantId param paslepiamas (403)
 *  8. topWarnings — surūšiuoti pagal percentUsed desc, max 5
 */
import type { ServiceBroker } from 'moleculer';
import type {
  BudgetAllocation as BudgetAllocationDTO,
  FundingSource as FundingSourceDTO,
  FvmSummaryResponse,
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

describe('dashboard.fvmSummary endpoint (Iter 15)', () => {
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

  function orgUser() {
    return mockOrgUser({
      id: org.orgUserId,
      tenantId: org.orgTenantId,
    });
  }

  /**
   * Helper'is — sukuria funding_source + 1 allocation. Nereikalaujam projekto
   * default'e — patys testai sukuria, jei reikia.
   */
  async function setupSourceAndAllocation(opts: {
    tenantId: number;
    year: number;
    sourceName?: string;
    sourceKodas?: string;
    allocationName?: string;
    allocationCategoryId: number;
    planuotaSuma: string;
    metineSuma?: string;
  }): Promise<{
    source: FundingSourceDTO;
    allocation: BudgetAllocationDTO;
  }> {
    const source = (await broker.call(
      'fundingSources.create',
      {
        tenantId: opts.tenantId,
        pavadinimas: opts.sourceName ?? `VB ${opts.year}`,
        kodas: opts.sourceKodas ?? `VB-${opts.tenantId}-${opts.year}`,
        tipasClassifierItemId: cls.fundingSourceTypeItemIds.biudzetas,
        metai: opts.year,
        metineSuma: opts.metineSuma ?? '1000000.00',
      },
      { meta: { user: amAdmin() } },
    )) as FundingSourceDTO;

    const allocation = (await broker.call(
      'budgetAllocations.create',
      {
        fundingSourceId: source.id,
        categoryClassifierItemId: opts.allocationCategoryId,
        pavadinimas: opts.allocationName ?? `Alloc ${opts.year}`,
        planuotaSuma: opts.planuotaSuma,
        metai: opts.year,
      },
      { meta: { user: amAdmin() } },
    )) as BudgetAllocationDTO;

    return { source, allocation };
  }

  async function createProject(opts: {
    tenantId: number;
    allocationId: number;
    pavadinimas: string;
    biudzetas: string;
    pabaigosData?: string | null;
    statusas?: 'planuojama' | 'vykdoma' | 'baigta' | 'uzdaryta';
    atsakingasUserId?: number;
  }): Promise<ProjectDTO> {
    const proj = (await broker.call(
      'projects.create',
      {
        tenantId: opts.tenantId,
        budgetAllocationId: opts.allocationId,
        atsakingasUserId: opts.atsakingasUserId ?? base.amAdminUserId,
        pavadinimas: opts.pavadinimas,
        tipas: 'projektas',
        biudzetas: opts.biudzetas,
        pabaigosData: opts.pabaigosData ?? null,
        statusas: opts.statusas ?? 'planuojama',
      },
      { meta: { user: amAdmin() } },
    )) as ProjectDTO;
    return proj;
  }

  it('1. AM admin gauna pilną summary su totals + warnings + deadlines', async () => {
    // 2 allocations 2026: prekes (1M, su 800k expense = 80% warning),
    // investicijos (500k, be expense)
    const { source: src1, allocation: alloc1 } = await setupSourceAndAllocation({
      tenantId: base.amTenantId,
      year: 2026,
      sourceName: 'AM VB',
      sourceKodas: 'AM-VB-2026',
      allocationCategoryId: cls.budgetCategoryItemIds.prekes_paslaugos,
      allocationName: 'Prekės 2026',
      planuotaSuma: '1000000.00',
      metineSuma: '2000000.00',
    });
    void src1;
    const { allocation: alloc2 } = await setupSourceAndAllocation({
      tenantId: base.amTenantId,
      year: 2026,
      sourceName: 'AM ES',
      sourceKodas: 'AM-ES-2026',
      allocationCategoryId: cls.budgetCategoryItemIds.investicijos,
      allocationName: 'Investicijos 2026',
      planuotaSuma: '500000.00',
      metineSuma: '500000.00',
    });

    // Aktyvus projektas
    const now = new Date();
    const in15days = new Date(now);
    in15days.setDate(in15days.getDate() + 15);
    const deadlineDate = in15days.toISOString().slice(0, 10);

    const proj1 = await createProject({
      tenantId: base.amTenantId,
      allocationId: alloc1.id,
      pavadinimas: 'Aktyvus projektas',
      biudzetas: '800000.00',
      pabaigosData: deadlineDate,
      statusas: 'vykdoma',
    });

    // 800k expense į alloc1 = 80% warning
    await broker.call(
      'expenses.create',
      {
        projectId: proj1.id,
        budgetAllocationId: alloc1.id,
        tipas: 'saskaita',
        suma: '800000.00',
        data: '2026-03-15',
      },
      { meta: { user: amAdmin() } },
    );

    // Baigtas projektas (į completedProjectsCount)
    const completedProj = await createProject({
      tenantId: base.amTenantId,
      allocationId: alloc2.id,
      pavadinimas: 'Baigtas projektas',
      biudzetas: '100000.00',
      statusas: 'planuojama',
    });
    // Pereinam: planuojama → vykdoma → baigta
    await broker.call(
      'projects.changeStatus',
      { id: completedProj.id, statusas: 'vykdoma' },
      { meta: { user: amAdmin() } },
    );
    await broker.call(
      'projects.changeStatus',
      { id: completedProj.id, statusas: 'baigta' },
      { meta: { user: amAdmin() } },
    );

    const resp = (await broker.call(
      'dashboard.fvmSummary',
      { year: 2026 },
      { meta: { user: amAdmin() } },
    )) as FvmSummaryResponse;

    expect(resp.year).toBe(2026);
    expect(typeof resp.generatedAt).toBe('string');

    // budgetTotals: 1.5M planuota, 800k faktinė
    expect(resp.budgetTotals.planuota).toBe('1500000.00');
    expect(resp.budgetTotals.faktine).toBe('800000.00');
    expect(resp.budgetTotals.likutis).toBe('700000.00');
    expect(resp.budgetTotals.percentUsed).toBeCloseTo(53.33, 1);
    expect(resp.budgetTotals.isWarning).toBe(false);
    expect(resp.budgetTotals.isOver).toBe(false);

    // topWarnings — tik vienas su isWarning=true
    expect(resp.topWarnings).toHaveLength(1);
    expect(resp.topWarnings[0]!.allocationId).toBe(alloc1.id);
    expect(resp.topWarnings[0]!.percentUsed).toBe(80);
    expect(resp.topWarnings[0]!.isWarning).toBe(true);

    // upcomingDeadlines — 1 projektas (15 d į priekį)
    expect(resp.upcomingDeadlines).toHaveLength(1);
    expect(resp.upcomingDeadlines[0]!.type).toBe('project_end');
    expect(resp.upcomingDeadlines[0]!.id).toBe(proj1.id);
    expect(resp.upcomingDeadlines[0]!.name).toBe('Aktyvus projektas');
    expect(resp.upcomingDeadlines[0]!.date).toBe(deadlineDate);
    expect(resp.upcomingDeadlines[0]!.daysUntil).toBeGreaterThanOrEqual(14);
    expect(resp.upcomingDeadlines[0]!.daysUntil).toBeLessThanOrEqual(15);

    // Projektų skaičius
    expect(resp.activeProjectsCount).toBe(1); // tik proj1
    expect(resp.completedProjectsCount).toBe(1); // completedProj

    // Sources + allocations count
    expect(resp.totalSourcesCount).toBe(2);
    expect(resp.totalAllocationsCount).toBe(2);
  });

  it('2. Org user gauna su DU exclude iš totals (ADR-005)', async () => {
    // AM ne-DU allocation: 500k planuota
    const { allocation: nonDuAlloc } = await setupSourceAndAllocation({
      tenantId: org.orgTenantId,
      year: 2026,
      sourceName: 'ORG VB',
      sourceKodas: 'ORG-VB-2026',
      allocationCategoryId: cls.budgetCategoryItemIds.prekes_paslaugos,
      allocationName: 'Org Prekės 2026',
      planuotaSuma: '500000.00',
    });

    // DU allocation tame pačiame tenant (200k planuota)
    await setupSourceAndAllocation({
      tenantId: org.orgTenantId,
      year: 2026,
      sourceName: 'ORG DU VB',
      sourceKodas: 'ORG-VB-DU-2026',
      allocationCategoryId: cls.budgetCategoryItemIds.du,
      allocationName: 'Org DU 2026',
      planuotaSuma: '200000.00',
    });

    // Pridėti 100k expense į ne-DU
    const proj = await createProject({
      tenantId: org.orgTenantId,
      allocationId: nonDuAlloc.id,
      pavadinimas: 'Org projektas',
      biudzetas: '500000.00',
      atsakingasUserId: org.orgAdminUserId,
    });
    await broker.call(
      'expenses.create',
      {
        projectId: proj.id,
        budgetAllocationId: nonDuAlloc.id,
        tipas: 'saskaita',
        suma: '100000.00',
        data: '2026-03-15',
      },
      { meta: { user: orgAdmin() } },
    );

    // Org user — DU allocation paslepta
    const respUser = (await broker.call(
      'dashboard.fvmSummary',
      { year: 2026 },
      { meta: { user: orgUser() } },
    )) as FvmSummaryResponse;

    // Tik 1 allocation matoma (ne-DU)
    expect(respUser.totalAllocationsCount).toBe(1);
    expect(respUser.budgetTotals.planuota).toBe('500000.00');
    expect(respUser.budgetTotals.faktine).toBe('100000.00');

    // Org admin — turi DU access, mato pilnai
    const respAdmin = (await broker.call(
      'dashboard.fvmSummary',
      { year: 2026 },
      { meta: { user: orgAdmin() } },
    )) as FvmSummaryResponse;
    expect(respAdmin.totalAllocationsCount).toBe(2);
    // planuota 500k + 200k = 700k
    expect(respAdmin.budgetTotals.planuota).toBe('700000.00');
  });

  it('3. Empty data → 0 visur', async () => {
    const resp = (await broker.call(
      'dashboard.fvmSummary',
      { year: 2026 },
      { meta: { user: amAdmin() } },
    )) as FvmSummaryResponse;

    expect(resp.year).toBe(2026);
    expect(resp.budgetTotals.planuota).toBe('0.00');
    expect(resp.budgetTotals.faktine).toBe('0.00');
    expect(resp.budgetTotals.likutis).toBe('0.00');
    expect(resp.budgetTotals.percentUsed).toBe(0);
    expect(resp.topWarnings).toEqual([]);
    expect(resp.upcomingDeadlines).toEqual([]);
    expect(resp.activeProjectsCount).toBe(0);
    expect(resp.completedProjectsCount).toBe(0);
    expect(resp.totalSourcesCount).toBe(0);
    expect(resp.totalAllocationsCount).toBe(0);
  });

  it('4. Upcoming deadlines: tik next 30d, statusas != baigta/uzdaryta', async () => {
    const { allocation } = await setupSourceAndAllocation({
      tenantId: base.amTenantId,
      year: 2026,
      sourceName: 'AM VB',
      sourceKodas: 'AM-VB-2026',
      allocationCategoryId: cls.budgetCategoryItemIds.prekes_paslaugos,
      planuotaSuma: '1000000.00',
    });

    const now = new Date();

    // 1) Projektas: pabaigos data 15 d į priekį, status vykdoma → ĮTRAUKIAMAS
    const in15 = new Date(now);
    in15.setDate(in15.getDate() + 15);
    const p1 = await createProject({
      tenantId: base.amTenantId,
      allocationId: allocation.id,
      pavadinimas: 'P1 — 15 d',
      biudzetas: '100000.00',
      pabaigosData: in15.toISOString().slice(0, 10),
      statusas: 'planuojama',
    });
    await broker.call(
      'projects.changeStatus',
      { id: p1.id, statusas: 'vykdoma' },
      { meta: { user: amAdmin() } },
    );

    // 2) Projektas: 45 d į priekį → NEĮTRAUKIAMAS (per horizon'ą)
    const in45 = new Date(now);
    in45.setDate(in45.getDate() + 45);
    await createProject({
      tenantId: base.amTenantId,
      allocationId: allocation.id,
      pavadinimas: 'P2 — 45 d',
      biudzetas: '100000.00',
      pabaigosData: in45.toISOString().slice(0, 10),
      statusas: 'vykdoma',
    });

    // 3) Projektas: 10 d į priekį, bet baigtas → NEĮTRAUKIAMAS
    const in10 = new Date(now);
    in10.setDate(in10.getDate() + 10);
    const p3 = await createProject({
      tenantId: base.amTenantId,
      allocationId: allocation.id,
      pavadinimas: 'P3 — 10 d (baigtas)',
      biudzetas: '100000.00',
      pabaigosData: in10.toISOString().slice(0, 10),
      statusas: 'planuojama',
    });
    await broker.call(
      'projects.changeStatus',
      { id: p3.id, statusas: 'vykdoma' },
      { meta: { user: amAdmin() } },
    );
    await broker.call(
      'projects.changeStatus',
      { id: p3.id, statusas: 'baigta' },
      { meta: { user: amAdmin() } },
    );

    // 4) Projektas: 5 d praeityje → NEĮTRAUKIAMAS
    const ago5 = new Date(now);
    ago5.setDate(ago5.getDate() - 5);
    await createProject({
      tenantId: base.amTenantId,
      allocationId: allocation.id,
      pavadinimas: 'P4 — praeityje',
      biudzetas: '100000.00',
      pabaigosData: ago5.toISOString().slice(0, 10),
      statusas: 'vykdoma',
    });

    const resp = (await broker.call(
      'dashboard.fvmSummary',
      { year: 2026 },
      { meta: { user: amAdmin() } },
    )) as FvmSummaryResponse;

    // Tik P1 turi būti grąžintas
    expect(resp.upcomingDeadlines).toHaveLength(1);
    expect(resp.upcomingDeadlines[0]!.name).toBe('P1 — 15 d');
  });

  it('5. Tenant scope: org admin tik savo tenant', async () => {
    // AM allocation
    await setupSourceAndAllocation({
      tenantId: base.amTenantId,
      year: 2026,
      sourceKodas: 'AM-VB-2026',
      allocationCategoryId: cls.budgetCategoryItemIds.prekes_paslaugos,
      allocationName: 'AM Prekės',
      planuotaSuma: '1000000.00',
    });

    // Org allocation
    await setupSourceAndAllocation({
      tenantId: org.orgTenantId,
      year: 2026,
      sourceKodas: 'ORG-VB-2026',
      allocationCategoryId: cls.budgetCategoryItemIds.prekes_paslaugos,
      allocationName: 'Org Prekės',
      planuotaSuma: '300000.00',
    });

    const amResp = (await broker.call(
      'dashboard.fvmSummary',
      { year: 2026 },
      { meta: { user: amAdmin() } },
    )) as FvmSummaryResponse;
    expect(amResp.totalAllocationsCount).toBe(2);
    expect(amResp.totalSourcesCount).toBe(2);
    expect(amResp.budgetTotals.planuota).toBe('1300000.00');

    // Org admin mato TIK savo tenant
    const orgResp = (await broker.call(
      'dashboard.fvmSummary',
      { year: 2026 },
      { meta: { user: orgAdmin() } },
    )) as FvmSummaryResponse;
    expect(orgResp.totalAllocationsCount).toBe(1);
    expect(orgResp.totalSourcesCount).toBe(1);
    expect(orgResp.budgetTotals.planuota).toBe('300000.00');
  });

  it('6. AM admin su tenantId param — filtruoja konkrečiu tenant', async () => {
    // AM 2 allocations + Org 1
    await setupSourceAndAllocation({
      tenantId: base.amTenantId,
      year: 2026,
      sourceKodas: 'AM-VB-2026',
      allocationCategoryId: cls.budgetCategoryItemIds.prekes_paslaugos,
      planuotaSuma: '1000000.00',
    });
    await setupSourceAndAllocation({
      tenantId: base.amTenantId,
      year: 2026,
      sourceName: 'AM ES',
      sourceKodas: 'AM-ES-2026',
      allocationCategoryId: cls.budgetCategoryItemIds.investicijos,
      planuotaSuma: '500000.00',
    });
    await setupSourceAndAllocation({
      tenantId: org.orgTenantId,
      year: 2026,
      sourceKodas: 'ORG-VB-2026',
      allocationCategoryId: cls.budgetCategoryItemIds.prekes_paslaugos,
      planuotaSuma: '300000.00',
    });

    // AM admin — tenantId filter to org
    const orgFiltered = (await broker.call(
      'dashboard.fvmSummary',
      { year: 2026, tenantId: org.orgTenantId },
      { meta: { user: amAdmin() } },
    )) as FvmSummaryResponse;
    expect(orgFiltered.totalAllocationsCount).toBe(1);
    expect(orgFiltered.budgetTotals.planuota).toBe('300000.00');

    // AM admin — tenantId filter to AM
    const amFiltered = (await broker.call(
      'dashboard.fvmSummary',
      { year: 2026, tenantId: base.amTenantId },
      { meta: { user: amAdmin() } },
    )) as FvmSummaryResponse;
    expect(amFiltered.totalAllocationsCount).toBe(2);
    expect(amFiltered.budgetTotals.planuota).toBe('1500000.00');
  });

  it('7. Org user — tenantId param paslepiamas (403)', async () => {
    await expect(
      broker.call(
        'dashboard.fvmSummary',
        { year: 2026, tenantId: base.amTenantId },
        { meta: { user: orgUser() } },
      ),
    ).rejects.toMatchObject({
      code: 403,
      type: 'TENANT_FILTER_FORBIDDEN',
    });
  });

  it('8. topWarnings — max 5, surūšiuoti pagal percentUsed desc', async () => {
    const { source } = await setupSourceAndAllocation({
      tenantId: base.amTenantId,
      year: 2026,
      sourceKodas: 'AM-VB-2026',
      allocationCategoryId: cls.budgetCategoryItemIds.prekes_paslaugos,
      allocationName: 'P0',
      planuotaSuma: '100.00',
    });

    // Sukuriam dar 6 allocations + 6 projektus + 6 expense'us su skirtingais
    // percentUsed
    const percents = [85, 90, 95, 110, 99, 88, 82];
    const allocs: BudgetAllocationDTO[] = [];
    for (let i = 0; i < percents.length; i++) {
      const alloc = (await broker.call(
        'budgetAllocations.create',
        {
          fundingSourceId: source.id,
          categoryClassifierItemId: cls.budgetCategoryItemIds.prekes_paslaugos,
          pavadinimas: `Alloc-${i}`,
          planuotaSuma: '100.00',
          metai: 2026,
        },
        { meta: { user: amAdmin() } },
      )) as BudgetAllocationDTO;
      allocs.push(alloc);

      const proj = await createProject({
        tenantId: base.amTenantId,
        allocationId: alloc.id,
        pavadinimas: `Proj-${i}`,
        biudzetas: '100.00',
      });
      await broker.call(
        'expenses.create',
        {
          projectId: proj.id,
          budgetAllocationId: alloc.id,
          tipas: 'saskaita',
          suma: percents[i]!.toFixed(2),
          data: '2026-03-15',
        },
        { meta: { user: amAdmin() } },
      );
    }

    const resp = (await broker.call(
      'dashboard.fvmSummary',
      { year: 2026 },
      { meta: { user: amAdmin() } },
    )) as FvmSummaryResponse;

    // Iš 7 warning'ų (visi >=80%) — grąžinami top 5
    expect(resp.topWarnings).toHaveLength(5);
    // Sorted desc
    for (let i = 0; i < resp.topWarnings.length - 1; i++) {
      expect(resp.topWarnings[i]!.percentUsed).toBeGreaterThanOrEqual(
        resp.topWarnings[i + 1]!.percentUsed,
      );
    }
    // Top — 110% (isOver=true)
    expect(resp.topWarnings[0]!.percentUsed).toBe(110);
    expect(resp.topWarnings[0]!.isOver).toBe(true);
  });
});
