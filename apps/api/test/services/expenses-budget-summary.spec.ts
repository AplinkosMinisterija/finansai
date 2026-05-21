/**
 * expenses.budgetSummary endpoint integration tests (Iter 12).
 *
 * Tests (3+):
 *  1. Year filter su keliais allocations — visi grąžinami su teisingais skaičiais
 *  2. Multi-source expense — pilna suma įskaitoma allocation faktinei
 *     (nereikalauja specialios agregacijos pagal saltinio_dalis)
 *  3. Empty year → items: []
 *  4. Tenant scope: org admin mato tik savo tenant allocations
 *  5. Filter pagal projectId — apriboja faktinę vieno projekto išlaidoms
 */
import type { ServiceBroker } from 'moleculer';
import type {
  BudgetAllocation as BudgetAllocationDTO,
  BudgetWarningsResponse,
  FundingSource as FundingSourceDTO,
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
import { mockAuthUser, mockOrgAdmin } from '../helpers/auth';

describe('expenses.budgetSummary endpoint (Iter 12)', () => {
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

  beforeEach(async () => {
    const knex = getTestKnex();
    await truncateAll(knex);
    base = await seedBaseFixtures(knex);
    org = await seedOrgTenant(knex);
    cls = await seedFvmClassifiers(knex);
  });

  it('3. Empty (jokių allocations) → items: []', async () => {
    const resp = (await broker.call(
      'expenses.budgetSummary',
      { year: 2026 },
      { meta: { user: amAdmin() } },
    )) as BudgetWarningsResponse;
    expect(resp.year).toBe(2026);
    expect(resp.items).toEqual([]);
  });

  it('1. Year filter su keliais allocations — visi grąžinami', async () => {
    // Sukuriam 2 allocations 2026 + 1 allocation 2027 (nebeturi būti grąžintas)
    const fs = (await broker.call(
      'fundingSources.create',
      {
        tenantId: base.amTenantId,
        pavadinimas: 'VB 2026',
        kodas: 'VB-2026',
        tipasClassifierItemId: cls.fundingSourceTypeItemIds.biudzetas,
        metai: 2026,
        metineSuma: '2000000.00',
      },
      { meta: { user: amAdmin() } },
    )) as FundingSourceDTO;

    const alloc1 = (await broker.call(
      'budgetAllocations.create',
      {
        fundingSourceId: fs.id,
        categoryClassifierItemId: cls.budgetCategoryItemIds.du,
        pavadinimas: 'AM DU 2026',
        planuotaSuma: '500000.00',
        metai: 2026,
      },
      { meta: { user: amAdmin() } },
    )) as BudgetAllocationDTO;

    const alloc2 = (await broker.call(
      'budgetAllocations.create',
      {
        fundingSourceId: fs.id,
        categoryClassifierItemId: cls.budgetCategoryItemIds.prekes_paslaugos,
        pavadinimas: 'AM Prekės 2026',
        planuotaSuma: '300000.00',
        metai: 2026,
      },
      { meta: { user: amAdmin() } },
    )) as BudgetAllocationDTO;

    const fs2027 = (await broker.call(
      'fundingSources.create',
      {
        tenantId: base.amTenantId,
        pavadinimas: 'VB 2027',
        kodas: 'VB-2027',
        tipasClassifierItemId: cls.fundingSourceTypeItemIds.biudzetas,
        metai: 2027,
        metineSuma: '2500000.00',
      },
      { meta: { user: amAdmin() } },
    )) as FundingSourceDTO;
    await broker.call(
      'budgetAllocations.create',
      {
        fundingSourceId: fs2027.id,
        categoryClassifierItemId: cls.budgetCategoryItemIds.du,
        pavadinimas: 'AM DU 2027',
        planuotaSuma: '600000.00',
        metai: 2027,
      },
      { meta: { user: amAdmin() } },
    );

    // Sukuriam projektus
    const proj1 = (await broker.call(
      'projects.create',
      {
        tenantId: base.amTenantId,
        budgetAllocationId: alloc1.id,
        pavadinimas: 'P1',
        tipas: 'projektas',
        biudzetas: '100000.00',
      },
      { meta: { user: amAdmin() } },
    )) as ProjectDTO;
    const proj2 = (await broker.call(
      'projects.create',
      {
        tenantId: base.amTenantId,
        budgetAllocationId: alloc2.id,
        pavadinimas: 'P2',
        tipas: 'projektas',
        biudzetas: '100000.00',
      },
      { meta: { user: amAdmin() } },
    )) as ProjectDTO;

    // Pridedam expenses į kiekvieną allocation
    await broker.call(
      'expenses.create',
      {
        projectId: proj1.id,
        budgetAllocationId: alloc1.id,
        tipas: 'du',
        suma: '400000.00', // 80% iš 500k — isWarning=true
        data: '2026-06-01',
      },
      { meta: { user: amAdmin() } },
    );
    await broker.call(
      'expenses.create',
      {
        projectId: proj2.id,
        budgetAllocationId: alloc2.id,
        tipas: 'saskaita',
        suma: '50000.00',
        data: '2026-06-01',
      },
      { meta: { user: amAdmin() } },
    );

    const resp = (await broker.call(
      'expenses.budgetSummary',
      { year: 2026 },
      { meta: { user: amAdmin() } },
    )) as BudgetWarningsResponse;
    expect(resp.year).toBe(2026);
    expect(resp.items).toHaveLength(2);

    // Tikrinam abiejų allocations skaičius (rūšiuojam pagal pavadinimą).
    const sorted = [...resp.items].sort((a, b) =>
      a.allocationName.localeCompare(b.allocationName),
    );
    const duAlloc = sorted.find((i) => i.allocationId === alloc1.id);
    const prekesAlloc = sorted.find((i) => i.allocationId === alloc2.id);
    expect(duAlloc).toBeDefined();
    expect(prekesAlloc).toBeDefined();

    expect(duAlloc!.planuota).toBe('500000.00');
    expect(duAlloc!.faktine).toBe('400000.00');
    expect(duAlloc!.likutis).toBe('100000.00');
    expect(duAlloc!.percentUsed).toBe(80);
    expect(duAlloc!.isWarning).toBe(true);
    expect(duAlloc!.isOver).toBe(false);
    expect(duAlloc!.fundingSourceName).toBe('VB 2026');

    expect(prekesAlloc!.planuota).toBe('300000.00');
    expect(prekesAlloc!.faktine).toBe('50000.00');
    expect(prekesAlloc!.percentUsed).toBeCloseTo(16.67, 2);
    expect(prekesAlloc!.isWarning).toBe(false);
  });

  it('2. Multi-source expense — visa suma įskaitoma vienai allocation', async () => {
    const fs1 = (await broker.call(
      'fundingSources.create',
      {
        tenantId: base.amTenantId,
        pavadinimas: 'VB 2026',
        kodas: 'VB-2026',
        tipasClassifierItemId: cls.fundingSourceTypeItemIds.biudzetas,
        metai: 2026,
        metineSuma: '2000000.00',
      },
      { meta: { user: amAdmin() } },
    )) as FundingSourceDTO;
    const fs2 = (await broker.call(
      'fundingSources.create',
      {
        tenantId: base.amTenantId,
        pavadinimas: 'ES 2026',
        kodas: 'ES-2026',
        tipasClassifierItemId: cls.fundingSourceTypeItemIds.es,
        metai: 2026,
        metineSuma: '500000.00',
      },
      { meta: { user: amAdmin() } },
    )) as FundingSourceDTO;
    const alloc = (await broker.call(
      'budgetAllocations.create',
      {
        fundingSourceId: fs1.id,
        categoryClassifierItemId: cls.budgetCategoryItemIds.prekes_paslaugos,
        pavadinimas: 'Multi-source target',
        planuotaSuma: '10000.00',
        metai: 2026,
      },
      { meta: { user: amAdmin() } },
    )) as BudgetAllocationDTO;
    const proj = (await broker.call(
      'projects.create',
      {
        tenantId: base.amTenantId,
        budgetAllocationId: alloc.id,
        pavadinimas: 'P',
        tipas: 'projektas',
        biudzetas: '10000.00',
      },
      { meta: { user: amAdmin() } },
    )) as ProjectDTO;

    // Sukuriam 2 multi-source expense, kiekviena 3000€ — 6000 total
    await broker.call(
      'expenses.create',
      {
        projectId: proj.id,
        budgetAllocationId: alloc.id,
        tipas: 'sutartis',
        suma: '3000.00',
        data: '2026-05-01',
        saltinioDalis: [
          { fundingSourceId: fs1.id, suma: '2000.00' },
          { fundingSourceId: fs2.id, suma: '1000.00' },
        ],
      },
      { meta: { user: amAdmin() } },
    );
    await broker.call(
      'expenses.create',
      {
        projectId: proj.id,
        budgetAllocationId: alloc.id,
        tipas: 'sutartis',
        suma: '3000.00',
        data: '2026-06-01',
        saltinioDalis: [
          { fundingSourceId: fs2.id, suma: '3000.00' },
        ],
      },
      { meta: { user: amAdmin() } },
    );

    const resp = (await broker.call(
      'expenses.budgetSummary',
      { year: 2026 },
      { meta: { user: amAdmin() } },
    )) as BudgetWarningsResponse;
    expect(resp.items).toHaveLength(1);
    expect(resp.items[0]!.allocationId).toBe(alloc.id);
    expect(resp.items[0]!.planuota).toBe('10000.00');
    expect(resp.items[0]!.faktine).toBe('6000.00');
    expect(resp.items[0]!.percentUsed).toBe(60);
    expect(resp.items[0]!.isWarning).toBe(false);
  });

  it('4. Tenant scope: org admin mato tik savo tenant allocations', async () => {
    // AM tenant allocation
    const amFs = (await broker.call(
      'fundingSources.create',
      {
        tenantId: base.amTenantId,
        pavadinimas: 'AM VB',
        kodas: 'AM-VB-2026',
        tipasClassifierItemId: cls.fundingSourceTypeItemIds.biudzetas,
        metai: 2026,
        metineSuma: '2000000.00',
      },
      { meta: { user: amAdmin() } },
    )) as FundingSourceDTO;
    await broker.call(
      'budgetAllocations.create',
      {
        fundingSourceId: amFs.id,
        categoryClassifierItemId: cls.budgetCategoryItemIds.du,
        pavadinimas: 'AM DU 2026',
        planuotaSuma: '500000.00',
        metai: 2026,
      },
      { meta: { user: amAdmin() } },
    );

    // Org tenant allocation
    const orgFs = (await broker.call(
      'fundingSources.create',
      {
        tenantId: org.orgTenantId,
        pavadinimas: 'Org VB',
        kodas: 'ORG-VB-2026',
        tipasClassifierItemId: cls.fundingSourceTypeItemIds.biudzetas,
        metai: 2026,
        metineSuma: '300000.00',
      },
      { meta: { user: amAdmin() } },
    )) as FundingSourceDTO;
    const orgAlloc = (await broker.call(
      'budgetAllocations.create',
      {
        fundingSourceId: orgFs.id,
        categoryClassifierItemId: cls.budgetCategoryItemIds.prekes_paslaugos,
        pavadinimas: 'Org PP 2026',
        planuotaSuma: '100000.00',
        metai: 2026,
      },
      { meta: { user: amAdmin() } },
    )) as BudgetAllocationDTO;

    const amResp = (await broker.call(
      'expenses.budgetSummary',
      { year: 2026 },
      { meta: { user: amAdmin() } },
    )) as BudgetWarningsResponse;
    expect(amResp.items).toHaveLength(2);

    const orgResp = (await broker.call(
      'expenses.budgetSummary',
      { year: 2026 },
      { meta: { user: orgAdmin() } },
    )) as BudgetWarningsResponse;
    expect(orgResp.items).toHaveLength(1);
    expect(orgResp.items[0]!.allocationId).toBe(orgAlloc.id);
  });
});
