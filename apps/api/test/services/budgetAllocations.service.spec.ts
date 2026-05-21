/**
 * Budget Allocations service integration tests (Iter 9, FVM-1).
 *
 * Test scope:
 *   1. AM admin CRUD happy path
 *   2. Permission gate: org user gauna 403 prie write endpoint'ų
 *   3. Verslo invariantai:
 *      - `categoryClassifierItemId` privalo būti iš `budget_category` grupės
 *      - `specProgTipas` leidžiamas TIK kai kategorija = `spec_programa`
 *      - `planuotaSuma` > 0
 *   4. `summary` endpoint grąžina planuota/faktinė/likutis;
 *      `faktine` = 0 kol expenses lentelė nesukurta (Iter 12)
 */
import type { ServiceBroker } from 'moleculer';
import type {
  FundingSource as FundingSourceDTO,
  BudgetAllocation as BudgetAllocationDTO,
  BudgetAllocationSummary,
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

describe('budgetAllocations service', () => {
  let broker: ServiceBroker;
  let base: BaseFixtures;
  let org: OrgTenantFixtures;
  let cls: FvmClassifierFixtures;
  let sourceId: number;

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
    // Sukurti vieną default funding_source, kuriam priklauso testuojami allocations.
    const fs = (await broker.call(
      'fundingSources.create',
      {
        tenantId: base.amTenantId,
        pavadinimas: 'Valstybės biudžetas 2026',
        kodas: 'VB-2026',
        tipasClassifierItemId: cls.fundingSourceTypeItemIds.biudzetas,
        metai: 2026,
        metineSuma: '1500000.00',
      },
      { meta: { user: amAdmin() } },
    )) as FundingSourceDTO;
    sourceId = fs.id;
  });

  // Tarpinis user helper'is — perdavimas iš beforeEach į helper'į neįmanomas,
  // tad rekonstruojam objektą.
  function amAdmin() {
    return mockAuthUser({
      id: base?.amAdminUserId ?? 1,
      tenantId: base?.amTenantId ?? 1,
      tenantIsApprover: true,
      role: 'admin',
    });
  }

  function orgAdmin() {
    return mockOrgAdmin({
      id: org.orgAdminUserId,
      tenantId: org.orgTenantId,
      tenantCode: 'AAD',
      tenantName: 'Aplinkos apsaugos departamentas',
    });
  }

  async function createAllocation(
    overrides: Partial<{
      fundingSourceId: number;
      categoryClassifierItemId: number;
      pavadinimas: string;
      specProgTipas: 'atskiras' | 'biudzeto_dalis' | null;
      planuotaSuma: string;
      metai: number;
      pastabos: string | null;
    }> = {},
    user = amAdmin(),
  ): Promise<BudgetAllocationDTO> {
    return (await broker.call(
      'budgetAllocations.create',
      {
        fundingSourceId: overrides.fundingSourceId ?? sourceId,
        categoryClassifierItemId:
          overrides.categoryClassifierItemId ?? cls.budgetCategoryItemIds.du,
        pavadinimas: overrides.pavadinimas ?? 'DU 2026',
        ...(overrides.specProgTipas !== undefined && {
          specProgTipas: overrides.specProgTipas,
        }),
        planuotaSuma: overrides.planuotaSuma ?? '500000.00',
        metai: overrides.metai ?? 2026,
        ...(overrides.pastabos !== undefined && {
          pastabos: overrides.pastabos,
        }),
      },
      { meta: { user } },
    )) as BudgetAllocationDTO;
  }

  describe('create', () => {
    it('AM admin gali CREATE su default kategorija (du)', async () => {
      const alloc = await createAllocation();
      expect(alloc.id).toBeDefined();
      expect(alloc.fundingSourceId).toBe(sourceId);
      expect(alloc.pavadinimas).toBe('DU 2026');
      expect(alloc.categoryCode).toBe('du');
      expect(alloc.specProgTipas).toBeNull();
      expect(alloc.planuotaSuma).toBe('500000.00');
      expect(alloc.metai).toBe(2026);
      expect(alloc.fundingSourceCode).toBe('VB-2026');
    });

    it('Org user (ne-admin) gauna 403 prie POST', async () => {
      await expect(
        createAllocation(
          {},
          mockOrgUser({
            id: org.orgUserId,
            tenantId: org.orgTenantId,
          }),
        ),
      ).rejects.toMatchObject({ code: 403, type: 'FORBIDDEN' });
    });

    it('Org admin (ne-AM) gauna 403 prie POST', async () => {
      await expect(createAllocation({}, orgAdmin())).rejects.toMatchObject({
        code: 403,
        type: 'FORBIDDEN',
      });
    });

    it('Klaidingas categoryClassifierItemId (iš kitos grupės) → 400', async () => {
      // funding_source_type.biudzetas — bandom panaudoti kaip budget_category
      await expect(
        createAllocation({
          categoryClassifierItemId: cls.fundingSourceTypeItemIds.biudzetas,
        }),
      ).rejects.toMatchObject({
        code: 400,
        type: 'INVALID_CATEGORY_GROUP',
      });
    });

    it('Neegzistuojantis fundingSourceId → 400 INVALID_FUNDING_SOURCE', async () => {
      await expect(
        createAllocation({ fundingSourceId: 99999 }),
      ).rejects.toMatchObject({
        code: 400,
        type: 'INVALID_FUNDING_SOURCE',
      });
    });

    it('planuotaSuma = 0 → 400 INVALID_AMOUNT', async () => {
      await expect(
        createAllocation({ planuotaSuma: '0' }),
      ).rejects.toMatchObject({
        code: 400,
        type: 'INVALID_AMOUNT',
      });
    });

    describe('specProgTipas validacija', () => {
      it('specProgTipas leidžiamas kai kategorija = spec_programa', async () => {
        const alloc = await createAllocation({
          categoryClassifierItemId: cls.budgetCategoryItemIds.spec_programa,
          pavadinimas: 'Spec.programa A',
          specProgTipas: 'atskiras',
        });
        expect(alloc.specProgTipas).toBe('atskiras');
        expect(alloc.categoryCode).toBe('spec_programa');
      });

      it('specProgTipas = biudzeto_dalis kai spec_programa → ok', async () => {
        const alloc = await createAllocation({
          categoryClassifierItemId: cls.budgetCategoryItemIds.spec_programa,
          pavadinimas: 'Spec.programa B',
          specProgTipas: 'biudzeto_dalis',
        });
        expect(alloc.specProgTipas).toBe('biudzeto_dalis');
      });

      it('specProgTipas su NE-spec_programa kategorija → 400', async () => {
        await expect(
          createAllocation({
            categoryClassifierItemId: cls.budgetCategoryItemIds.du,
            specProgTipas: 'atskiras',
          }),
        ).rejects.toMatchObject({
          code: 400,
          type: 'SPEC_PROG_TIPAS_NOT_ALLOWED',
        });
      });

      it('Be specProgTipas spec_programa kategorijoje — leidžiama (null)', async () => {
        const alloc = await createAllocation({
          categoryClassifierItemId: cls.budgetCategoryItemIds.spec_programa,
          pavadinimas: 'Spec.programa be tipo',
        });
        expect(alloc.specProgTipas).toBeNull();
      });
    });
  });

  describe('update', () => {
    it('AM admin gali PATCH', async () => {
      const created = await createAllocation();
      const updated = (await broker.call(
        'budgetAllocations.update',
        {
          id: created.id,
          pavadinimas: 'DU 2026 (atnaujinta)',
          planuotaSuma: '550000.00',
          pastabos: 'Pridėtos pastabos',
        },
        { meta: { user: amAdmin() } },
      )) as BudgetAllocationDTO;
      expect(updated.pavadinimas).toBe('DU 2026 (atnaujinta)');
      expect(updated.planuotaSuma).toBe('550000.00');
      expect(updated.pastabos).toBe('Pridėtos pastabos');
    });

    it('Update: kategoriją keisti į spec_programa palieka spec_prog_tipas null jei nenurodyta', async () => {
      const created = await createAllocation();
      const updated = (await broker.call(
        'budgetAllocations.update',
        {
          id: created.id,
          categoryClassifierItemId: cls.budgetCategoryItemIds.spec_programa,
        },
        { meta: { user: amAdmin() } },
      )) as BudgetAllocationDTO;
      expect(updated.categoryCode).toBe('spec_programa');
      expect(updated.specProgTipas).toBeNull();
    });

    it('Update: kai keičiama kategorija iš spec_programa į kitą, specProgTipas null\'inamas', async () => {
      const created = await createAllocation({
        categoryClassifierItemId: cls.budgetCategoryItemIds.spec_programa,
        specProgTipas: 'atskiras',
      });
      expect(created.specProgTipas).toBe('atskiras');

      const updated = (await broker.call(
        'budgetAllocations.update',
        {
          id: created.id,
          categoryClassifierItemId: cls.budgetCategoryItemIds.du,
        },
        { meta: { user: amAdmin() } },
      )) as BudgetAllocationDTO;
      expect(updated.categoryCode).toBe('du');
      expect(updated.specProgTipas).toBeNull();
    });

    it('Org admin gauna 403 prie PATCH', async () => {
      const created = await createAllocation();
      await expect(
        broker.call(
          'budgetAllocations.update',
          { id: created.id, pavadinimas: 'Hack' },
          { meta: { user: orgAdmin() } },
        ),
      ).rejects.toMatchObject({ code: 403, type: 'FORBIDDEN' });
    });
  });

  describe('list and filter', () => {
    it('list + filter by fundingSourceId, year, categoryItemId', async () => {
      await createAllocation({ pavadinimas: 'DU', planuotaSuma: '500000.00' });
      await createAllocation({
        categoryClassifierItemId: cls.budgetCategoryItemIds.investicijos,
        pavadinimas: 'Investicijos',
        planuotaSuma: '300000.00',
      });
      await createAllocation({
        pavadinimas: 'DU 2027',
        metai: 2027,
        // Kitas funding source 2027 metams (kurkime per service).
        fundingSourceId: (
          (await broker.call(
            'fundingSources.create',
            {
              tenantId: base.amTenantId,
              pavadinimas: 'VB 2027',
              kodas: 'VB-2027',
              tipasClassifierItemId: cls.fundingSourceTypeItemIds.biudzetas,
              metai: 2027,
              metineSuma: '2000000.00',
            },
            { meta: { user: amAdmin() } },
          )) as FundingSourceDTO
        ).id,
      });

      const all = (await broker.call(
        'budgetAllocations.list',
        {},
        { meta: { user: amAdmin() } },
      )) as BudgetAllocationDTO[];
      expect(all).toHaveLength(3);

      const onlyDu = (await broker.call(
        'budgetAllocations.list',
        { categoryItemId: cls.budgetCategoryItemIds.du },
        { meta: { user: amAdmin() } },
      )) as BudgetAllocationDTO[];
      expect(onlyDu).toHaveLength(2);
      expect(onlyDu.every((a) => a.categoryCode === 'du')).toBe(true);

      const y2026 = (await broker.call(
        'budgetAllocations.list',
        { year: 2026 },
        { meta: { user: amAdmin() } },
      )) as BudgetAllocationDTO[];
      expect(y2026).toHaveLength(2);

      const onlyFirstSource = (await broker.call(
        'budgetAllocations.list',
        { fundingSourceId: sourceId },
        { meta: { user: amAdmin() } },
      )) as BudgetAllocationDTO[];
      expect(onlyFirstSource).toHaveLength(2);
    });
  });

  describe('summary endpoint', () => {
    it('summary grąžina planuota = createInput, faktinė = 0, likutis = planuota', async () => {
      const created = await createAllocation({ planuotaSuma: '500000.00' });
      const summary = (await broker.call(
        'budgetAllocations.summary',
        { id: created.id },
        { meta: { user: amAdmin() } },
      )) as BudgetAllocationSummary;
      expect(summary.planuota).toBe('500000.00');
      expect(summary.faktine).toBe('0.00');
      expect(summary.likutis).toBe('500000.00');
    });

    it('summary su decimal suma laikomas tikslus (be float drift)', async () => {
      const created = await createAllocation({ planuotaSuma: '12345.67' });
      const summary = (await broker.call(
        'budgetAllocations.summary',
        { id: created.id },
        { meta: { user: amAdmin() } },
      )) as BudgetAllocationSummary;
      expect(summary.planuota).toBe('12345.67');
      expect(summary.faktine).toBe('0.00');
      expect(summary.likutis).toBe('12345.67');
    });

    it('summary neegzistuojančio → 404', async () => {
      await expect(
        broker.call(
          'budgetAllocations.summary',
          { id: 99999 },
          { meta: { user: amAdmin() } },
        ),
      ).rejects.toMatchObject({
        code: 404,
        type: 'BUDGET_ALLOCATION_NOT_FOUND',
      });
    });
  });

  describe('delete', () => {
    it('AM admin gali DELETE', async () => {
      const created = await createAllocation();
      const result = await broker.call(
        'budgetAllocations.delete',
        { id: created.id },
        { meta: { user: amAdmin() } },
      );
      expect(result).toEqual({ ok: true });
    });

    it('Org user gauna 403 prie DELETE', async () => {
      const created = await createAllocation();
      await expect(
        broker.call(
          'budgetAllocations.delete',
          { id: created.id },
          {
            meta: {
              user: mockOrgUser({
                id: org.orgUserId,
                tenantId: org.orgTenantId,
              }),
            },
          },
        ),
      ).rejects.toMatchObject({ code: 403, type: 'FORBIDDEN' });
    });
  });
});
