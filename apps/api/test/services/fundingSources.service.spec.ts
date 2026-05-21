/**
 * Funding Sources service integration tests (Iter 9, FVM-1).
 *
 * Test scope:
 *   1. AM admin CRUD happy path (create/get/list/update/delete)
 *   2. Permission gates: org admin (ne-AM) gauna 403 prie write endpoint'ų
 *   3. Verslo invariantai:
 *      - DELETE su priklausančiais allocations → 409 Conflict
 *      - `tipasClassifierItemId` validacija (iš `funding_source_type` grupės)
 *      - Unique (tenant_id, kodas, metai) duplicate handling
 *      - List filter by year
 *
 * Šis spec'as testuoja per `broker.call('fundingSources.<action>', ...)`,
 * t.y. eina pro Moleculer param validation + service handler. HTTP gateway
 * (api.service) nedalyvauja — testuojam pačios servico logiką.
 */
import type { ServiceBroker } from 'moleculer';
import type {
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

describe('fundingSources service', () => {
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

  // Helper'is — autentifikuotas AM admin mock'as su pasiektais ID'ais.
  const amAdmin = () =>
    mockAuthUser({
      id: base.amAdminUserId,
      tenantId: base.amTenantId,
      tenantIsApprover: true,
      role: 'admin',
    });

  // Helper'is — organizacijos admin (NE-AM, tenantIsApprover=false).
  const orgAdmin = () =>
    mockOrgAdmin({
      id: org.orgAdminUserId,
      tenantId: org.orgTenantId,
      tenantCode: 'AAD',
      tenantName: 'Aplinkos apsaugos departamentas',
    });

  // Helper — typed wrapper'is fundingSources.create kvietimui.
  async function createSource(opts: {
    user?: ReturnType<typeof amAdmin>;
    pavadinimas?: string;
    kodas?: string;
    tipasItemId?: number;
    metai?: number;
    metineSuma?: string;
    tenantId?: number;
  } = {}): Promise<FundingSourceDTO> {
    return (await broker.call(
      'fundingSources.create',
      {
        tenantId: opts.tenantId ?? base.amTenantId,
        pavadinimas: opts.pavadinimas ?? 'Valstybės biudžetas 2026',
        kodas: opts.kodas ?? 'VB-2026',
        tipasClassifierItemId:
          opts.tipasItemId ?? cls.fundingSourceTypeItemIds.biudzetas,
        metai: opts.metai ?? 2026,
        metineSuma: opts.metineSuma ?? '1500000.00',
      },
      { meta: { user: opts.user ?? amAdmin() } },
    )) as FundingSourceDTO;
  }

  describe('create', () => {
    it('AM admin gali sukurti funding source su validžiais duomenimis', async () => {
      const fs = await createSource();
      expect(fs.id).toBeDefined();
      expect(fs.pavadinimas).toBe('Valstybės biudžetas 2026');
      expect(fs.kodas).toBe('VB-2026');
      expect(fs.metai).toBe(2026);
      expect(fs.metineSuma).toBe('1500000.00');
      expect(fs.aktyvus).toBe(true);
      expect(fs.tipasCode).toBe('biudzetas');
      expect(fs.tipasName).toBe('Valstybės biudžetas');
      expect(fs.tenantCode).toBe('AM');
      expect(fs.allocationsCount).toBe(0);
      expect(fs.allocatedAmount).toBe('0.00');
    });

    it('Org admin (ne-AM) gauna 403 bandant POST', async () => {
      await expect(
        createSource({ user: orgAdmin(), tenantId: org.orgTenantId }),
      ).rejects.toMatchObject({ code: 403, type: 'FORBIDDEN' });
    });

    it('Org user (ne-AM) gauna 403 bandant POST', async () => {
      await expect(
        createSource({
          user: mockOrgUser({
            id: org.orgUserId,
            tenantId: org.orgTenantId,
          }),
          tenantId: org.orgTenantId,
        }),
      ).rejects.toMatchObject({ code: 403, type: 'FORBIDDEN' });
    });

    it('Klaidingas tipasClassifierItemId (iš kitos grupės) → 400', async () => {
      // budget_category.du item — bandom panaudoti kaip funding_source_type
      await expect(
        createSource({
          tipasItemId: cls.budgetCategoryItemIds.du,
        }),
      ).rejects.toMatchObject({
        code: 400,
        type: 'INVALID_TYPE_GROUP',
      });
    });

    it('Neegzistuojantis tipasClassifierItemId → 400 INVALID_TYPE_ITEM', async () => {
      await expect(
        createSource({ tipasItemId: 99999 }),
      ).rejects.toMatchObject({
        code: 400,
        type: 'INVALID_TYPE_ITEM',
      });
    });

    it('Duplicate (tenant, kodas, metai) → 409 FUNDING_SOURCE_DUPLICATE', async () => {
      await createSource({ kodas: 'VB-2026', metai: 2026 });
      await expect(
        createSource({ kodas: 'VB-2026', metai: 2026 }),
      ).rejects.toMatchObject({
        code: 409,
        type: 'FUNDING_SOURCE_DUPLICATE',
      });
    });

    it('Tas pats kodas skirtingiems metams — leidžiama', async () => {
      const a = await createSource({ kodas: 'VB', metai: 2026 });
      const b = await createSource({ kodas: 'VB', metai: 2027 });
      expect(a.id).not.toBe(b.id);
      expect(a.metai).toBe(2026);
      expect(b.metai).toBe(2027);
    });

    it('metineSuma = 0 → 400 INVALID_AMOUNT', async () => {
      await expect(createSource({ metineSuma: '0' })).rejects.toMatchObject({
        code: 400,
        type: 'INVALID_AMOUNT',
      });
    });

    it('Negali kurti su neegzistuojančiu tenant_id → 400', async () => {
      await expect(createSource({ tenantId: 99999 })).rejects.toMatchObject({
        code: 400,
        type: 'INVALID_TENANT',
      });
    });
  });

  describe('update', () => {
    it('AM admin gali PATCH atnaujinti pavadinimą ir sumą', async () => {
      const created = await createSource({
        pavadinimas: 'Pradinis',
        metineSuma: '1000000.00',
      });
      const updated = (await broker.call(
        'fundingSources.update',
        {
          id: created.id,
          pavadinimas: 'Atnaujintas',
          metineSuma: '2000000.00',
          aprasymas: 'Pridėtas aprašymas',
        },
        { meta: { user: amAdmin() } },
      )) as FundingSourceDTO;
      expect(updated.id).toBe(created.id);
      expect(updated.pavadinimas).toBe('Atnaujintas');
      expect(updated.metineSuma).toBe('2000000.00');
      expect(updated.aprasymas).toBe('Pridėtas aprašymas');
    });

    it('Org admin gauna 403 prie PATCH', async () => {
      const created = await createSource();
      await expect(
        broker.call(
          'fundingSources.update',
          { id: created.id, pavadinimas: 'Hack' },
          { meta: { user: orgAdmin() } },
        ),
      ).rejects.toMatchObject({ code: 403, type: 'FORBIDDEN' });
    });

    it('Update neegzistuojančio id → 404', async () => {
      await expect(
        broker.call(
          'fundingSources.update',
          { id: 99999, pavadinimas: 'X' },
          { meta: { user: amAdmin() } },
        ),
      ).rejects.toMatchObject({
        code: 404,
        type: 'FUNDING_SOURCE_NOT_FOUND',
      });
    });
  });

  describe('list and filter', () => {
    it('list grąžina visus + filter by year veikia', async () => {
      await createSource({ kodas: 'VB-2026', metai: 2026 });
      await createSource({ kodas: 'VB-2027', metai: 2027 });
      await createSource({
        kodas: 'ES-2026',
        metai: 2026,
        tipasItemId: cls.fundingSourceTypeItemIds.es,
      });

      const all = (await broker.call(
        'fundingSources.list',
        {},
        { meta: { user: amAdmin() } },
      )) as FundingSourceDTO[];
      expect(all).toHaveLength(3);

      const y2026 = (await broker.call(
        'fundingSources.list',
        { year: 2026 },
        { meta: { user: amAdmin() } },
      )) as FundingSourceDTO[];
      expect(y2026).toHaveLength(2);
      expect(y2026.every((s) => s.metai === 2026)).toBe(true);

      const onlyEs = (await broker.call(
        'fundingSources.list',
        { typeItemId: cls.fundingSourceTypeItemIds.es },
        { meta: { user: amAdmin() } },
      )) as FundingSourceDTO[];
      expect(onlyEs).toHaveLength(1);
      expect(onlyEs[0]?.tipasCode).toBe('es');
    });

    it('list rodo allocationsCount ir allocatedAmount', async () => {
      const created = await createSource({ metineSuma: '1500000.00' });
      // Insert 2 allocations į newly created source.
      await broker.call(
        'budgetAllocations.create',
        {
          fundingSourceId: created.id,
          categoryClassifierItemId: cls.budgetCategoryItemIds.du,
          pavadinimas: 'DU 2026',
          planuotaSuma: '500000.00',
          metai: 2026,
        },
        { meta: { user: amAdmin() } },
      );
      await broker.call(
        'budgetAllocations.create',
        {
          fundingSourceId: created.id,
          categoryClassifierItemId: cls.budgetCategoryItemIds.investicijos,
          pavadinimas: 'Investicijos 2026',
          planuotaSuma: '300000.00',
          metai: 2026,
        },
        { meta: { user: amAdmin() } },
      );

      const list = (await broker.call(
        'fundingSources.list',
        {},
        { meta: { user: amAdmin() } },
      )) as FundingSourceDTO[];
      expect(list).toHaveLength(1);
      expect(list[0]?.allocationsCount).toBe(2);
      expect(list[0]?.allocatedAmount).toBe('800000.00');
    });

    it('Org user gali READ (list) tik savo tenant\'o sources (S15.C tenant scope)', async () => {
      // AM tenant'o source — org_user NETURI matyti
      await createSource({ tenantId: base.amTenantId });
      // Org tenant'o source — org_user TURI matyti
      await createSource({
        tenantId: org.orgTenantId,
        kodas: 'AAD-VB-2026',
        pavadinimas: 'AAD biudžetas 2026',
      });
      const list = (await broker.call(
        'fundingSources.list',
        {},
        {
          meta: {
            user: mockOrgUser({
              id: org.orgUserId,
              tenantId: org.orgTenantId,
            }),
          },
        },
      )) as FundingSourceDTO[];
      // Po S15.C tenant scope patch'o — org_user mato tik savo tenant'ą.
      expect(list).toHaveLength(1);
      expect(list[0]?.tenantId).toBe(org.orgTenantId);
      expect(list[0]?.kodas).toBe('AAD-VB-2026');
    });
  });

  describe('delete', () => {
    it('AM admin gali DELETE jei nėra allocations', async () => {
      const created = await createSource();
      const result = await broker.call(
        'fundingSources.delete',
        { id: created.id },
        { meta: { user: amAdmin() } },
      );
      expect(result).toEqual({ ok: true });

      await expect(
        broker.call(
          'fundingSources.get',
          { id: created.id },
          { meta: { user: amAdmin() } },
        ),
      ).rejects.toMatchObject({
        code: 404,
        type: 'FUNDING_SOURCE_NOT_FOUND',
      });
    });

    it('DELETE su priklausančiais allocations → 409 Conflict', async () => {
      const created = await createSource();
      await broker.call(
        'budgetAllocations.create',
        {
          fundingSourceId: created.id,
          categoryClassifierItemId: cls.budgetCategoryItemIds.du,
          pavadinimas: 'DU 2026',
          planuotaSuma: '500000.00',
          metai: 2026,
        },
        { meta: { user: amAdmin() } },
      );

      await expect(
        broker.call(
          'fundingSources.delete',
          { id: created.id },
          { meta: { user: amAdmin() } },
        ),
      ).rejects.toMatchObject({
        code: 409,
        type: 'FUNDING_SOURCE_HAS_ALLOCATIONS',
      });
    });

    it('Org admin gauna 403 prie DELETE', async () => {
      const created = await createSource();
      await expect(
        broker.call(
          'fundingSources.delete',
          { id: created.id },
          { meta: { user: orgAdmin() } },
        ),
      ).rejects.toMatchObject({ code: 403, type: 'FORBIDDEN' });
    });
  });

  describe('get', () => {
    it('AM admin gali GET su tipas info denormalized', async () => {
      const created = await createSource();
      const fetched = (await broker.call(
        'fundingSources.get',
        { id: created.id },
        { meta: { user: amAdmin() } },
      )) as FundingSourceDTO;
      expect(fetched.id).toBe(created.id);
      expect(fetched.tipasCode).toBe('biudzetas');
      expect(fetched.tenantCode).toBe('AM');
    });

    it('GET neegzistuojančio → 404', async () => {
      await expect(
        broker.call(
          'fundingSources.get',
          { id: 99999 },
          { meta: { user: amAdmin() } },
        ),
      ).rejects.toMatchObject({
        code: 404,
        type: 'FUNDING_SOURCE_NOT_FOUND',
      });
    });
  });
});
