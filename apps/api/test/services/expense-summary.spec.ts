/**
 * Expense + summary integration tests (Iter 12, F08 + F11).
 *
 * Verifies that `budgetAllocations.summary` ir `projects.summary` realiai
 * agreguoja faktines išlaidas iš `expenses` lentelės, ne tik grąžina
 * '0.00' placeholder'ius (kaip Iter 9-11).
 *
 * Tests (6+):
 *  1. budgetAllocations.summary su 0 expenses → faktine=0, likutis=planuota
 *  2. su expense 50% → percentUsed=50, isWarning=false
 *  3. su expense 80% → isWarning=true, isOver=false (boundary)
 *  4. su expense 100% → isWarning=true, isOver=false (boundary)
 *  5. su expense 110% → isWarning=true, isOver=true
 *  6. projects.summary su keliais expenses agreguoja teisingai
 *  7. Multi-source expense — visa suma įskaitoma per allocation (single point)
 */
import type { ServiceBroker } from 'moleculer';
import type {
  BudgetAllocation as BudgetAllocationDTO,
  BudgetAllocationSummary,
  FundingSource as FundingSourceDTO,
  Project as ProjectDTO,
  ProjectSummary,
} from '@biip-finansai/shared';
import {
  getTestKnex,
  closeTestKnex,
  truncateAll,
  seedBaseFixtures,
  seedFvmClassifiers,
  type BaseFixtures,
  type FvmClassifierFixtures,
} from '../helpers/db';
import { createTestBroker } from '../helpers/broker';
import { mockAuthUser } from '../helpers/auth';

describe('expense + summary aggregation (Iter 12)', () => {
  let broker: ServiceBroker;
  let base: BaseFixtures;
  let cls: FvmClassifierFixtures;
  let fundingSourceId: number;
  let secondFundingSourceId: number;
  let allocationId: number;
  let projectId: number;

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

  beforeEach(async () => {
    const knex = getTestKnex();
    await truncateAll(knex);
    base = await seedBaseFixtures(knex);
    cls = await seedFvmClassifiers(knex);

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
    fundingSourceId = fs1.id;

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
    secondFundingSourceId = fs2.id;

    const alloc = (await broker.call(
      'budgetAllocations.create',
      {
        fundingSourceId,
        categoryClassifierItemId: cls.budgetCategoryItemIds.prekes_paslaugos,
        pavadinimas: 'Prekės/paslaugos 2026',
        planuotaSuma: '1000.00',
        metai: 2026,
      },
      { meta: { user: amAdmin() } },
    )) as BudgetAllocationDTO;
    allocationId = alloc.id;

    const project = (await broker.call(
      'projects.create',
      {
        tenantId: base.amTenantId,
        budgetAllocationId: allocationId,
        pavadinimas: 'Test projektas',
        tipas: 'projektas',
        biudzetas: '1000.00',
        pradziosData: '2026-01-01',
        pabaigosData: '2026-12-31',
      },
      { meta: { user: amAdmin() } },
    )) as ProjectDTO;
    projectId = project.id;
  });

  async function createExpense(suma: string, opts: { saltinioDalis?: Array<{ fundingSourceId: number; suma: string }> } = {}): Promise<void> {
    await broker.call(
      'expenses.create',
      {
        projectId,
        budgetAllocationId: allocationId,
        tipas: 'saskaita',
        suma,
        data: '2026-03-15',
        ...(opts.saltinioDalis !== undefined && { saltinioDalis: opts.saltinioDalis }),
      },
      { meta: { user: amAdmin() } },
    );
  }

  async function fetchAllocSummary(): Promise<BudgetAllocationSummary> {
    return (await broker.call(
      'budgetAllocations.summary',
      { id: allocationId },
      { meta: { user: amAdmin() } },
    )) as BudgetAllocationSummary;
  }

  async function fetchProjSummary(): Promise<ProjectSummary> {
    return (await broker.call(
      'projects.summary',
      { id: projectId },
      { meta: { user: amAdmin() } },
    )) as ProjectSummary;
  }

  describe('budgetAllocations.summary', () => {
    it('1. su 0 expenses → faktine=0, likutis=planuota, percentUsed=0', async () => {
      const s = await fetchAllocSummary();
      expect(s.planuota).toBe('1000.00');
      expect(s.faktine).toBe('0.00');
      expect(s.likutis).toBe('1000.00');
      expect(s.percentUsed).toBe(0);
      expect(s.isWarning).toBe(false);
      expect(s.isOver).toBe(false);
    });

    it('2. su expense 50% → percentUsed=50, isWarning=false', async () => {
      await createExpense('500.00');
      const s = await fetchAllocSummary();
      expect(s.planuota).toBe('1000.00');
      expect(s.faktine).toBe('500.00');
      expect(s.likutis).toBe('500.00');
      expect(s.percentUsed).toBe(50);
      expect(s.isWarning).toBe(false);
      expect(s.isOver).toBe(false);
    });

    it('3. su expense 80% → isWarning=true (boundary), isOver=false', async () => {
      await createExpense('800.00');
      const s = await fetchAllocSummary();
      expect(s.faktine).toBe('800.00');
      expect(s.likutis).toBe('200.00');
      expect(s.percentUsed).toBe(80);
      expect(s.isWarning).toBe(true);
      expect(s.isOver).toBe(false);
    });

    it('4. su expense 100% → isWarning=true, isOver=false (boundary)', async () => {
      await createExpense('1000.00');
      const s = await fetchAllocSummary();
      expect(s.faktine).toBe('1000.00');
      expect(s.likutis).toBe('0.00');
      expect(s.percentUsed).toBe(100);
      expect(s.isWarning).toBe(true);
      expect(s.isOver).toBe(false);
    });

    it('5. su expense 110% → isWarning=true, isOver=true', async () => {
      await createExpense('1100.00');
      const s = await fetchAllocSummary();
      expect(s.faktine).toBe('1100.00');
      expect(s.likutis).toBe('-100.00');
      expect(s.percentUsed).toBe(110);
      expect(s.isWarning).toBe(true);
      expect(s.isOver).toBe(true);
    });

    it('7. Multi-source expense — pilna suma įskaitoma allocation faktinei', async () => {
      // Multi-source split: 600 + 400 = 1000. Visa suma įskaitoma allocation faktinei,
      // nes saltinio_dalis paskirsto tik finansavimo šaltinius, ne allocation pasirinkimą.
      await createExpense('1000.00', {
        saltinioDalis: [
          { fundingSourceId, suma: '600.00' },
          { fundingSourceId: secondFundingSourceId, suma: '400.00' },
        ],
      });
      const s = await fetchAllocSummary();
      expect(s.faktine).toBe('1000.00');
      expect(s.percentUsed).toBe(100);
      expect(s.isWarning).toBe(true);
    });
  });

  describe('projects.summary', () => {
    it('6. projects.summary su keliais expenses agreguoja teisingai', async () => {
      await createExpense('100.00');
      await createExpense('250.50');
      await createExpense('149.50');
      const s = await fetchProjSummary();
      expect(s.biudzetas).toBe('1000.00');
      expect(s.panaudota).toBe('500.00'); // 100 + 250.50 + 149.50
      expect(s.likutis).toBe('500.00');
      expect(s.percentUsed).toBe(50);
      expect(s.isWarning).toBe(false);
      expect(s.isOver).toBe(false);
    });

    it('projects.summary su over-budget — isOver=true', async () => {
      await createExpense('800.00');
      await createExpense('400.00');
      const s = await fetchProjSummary();
      expect(s.panaudota).toBe('1200.00');
      expect(s.likutis).toBe('-200.00');
      expect(s.percentUsed).toBe(120);
      expect(s.isWarning).toBe(true);
      expect(s.isOver).toBe(true);
    });
  });
});
