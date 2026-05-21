/**
 * Requests service FVM integration tests (Iter 10, FVM-2).
 *
 * Padengia tai, kas pridėta per Iter 10 prie `requests.service.ts`:
 *  1. Create su naujais FVM laukais — visi išsaugomi, get grąžina.
 *  2. Create be naujų laukų — backward compat (visi nauji laukai NULL).
 *  3. Validation: `budgetCategoryId` iš kitos grupės (pvz. `funding_source_type`)
 *     → 400 LT žinute.
 *  4. Validation: `fundingSourceTypeId` iš kitos grupės → 400 LT žinute.
 *  5. Validation: `specProgramFundingType` nurodytas be `spec_programa`
 *     kategorijos → 400 LT žinute.
 *  6. AM approve flow: AM gali pakeisti `budgetCategoryId` per `decision`
 *     endpoint'ą.
 *  7. `createFvmProject` action — Iter 10 grąžina placeholder; tik AM gali
 *     iškviesti; tik patvirtintam prašymui.
 *
 * Test'ai kviečia broker'į tiesiogiai (be HTTP gateway'aus), todėl tikrina
 * service validation + handler logiką.
 */
import type { ServiceBroker } from 'moleculer';
import type {
  CreateFvmProjectResponse,
  FinancingRequest as RequestDTO,
  FinancingRequestDetail,
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

describe('requests service — FVM (Iter 10)', () => {
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

  // Helpers — auth užvedimai testams
  const amAdmin = () =>
    mockAuthUser({
      id: base.amAdminUserId,
      tenantId: base.amTenantId,
      tenantIsApprover: true,
      role: 'admin',
    });

  const orgAdmin = () =>
    mockOrgAdmin({
      id: org.orgAdminUserId,
      tenantId: org.orgTenantId,
      tenantCode: 'AAD',
      tenantName: 'Aplinkos apsaugos departamentas',
    });

  // Helper: kuria prašymą AM admin „on behalf" — paprasčiausias kelias gauti
  // valid DRAFT'ą su pasirinktais FVM laukais. AM admin gali per `create`
  // perduoti `tenantId` parametrą.
  async function createRequest(opts: {
    user?: ReturnType<typeof amAdmin>;
    projectName?: string;
    year?: number;
    budgetCategoryId?: number | null;
    fundingSourceTypeId?: number | null;
    specProgramFundingType?: 'atskiras' | 'biudzeto_dalis' | null;
  } = {}): Promise<RequestDTO> {
    const params: Record<string, unknown> = {
      tenantId: org.orgTenantId,
      projectName: opts.projectName ?? 'FVM test prašymas',
      year: opts.year ?? new Date().getFullYear(),
    };
    if (opts.budgetCategoryId !== undefined) {
      params['budgetCategoryId'] = opts.budgetCategoryId;
    }
    if (opts.fundingSourceTypeId !== undefined) {
      params['fundingSourceTypeId'] = opts.fundingSourceTypeId;
    }
    if (opts.specProgramFundingType !== undefined) {
      params['specProgramFundingType'] = opts.specProgramFundingType;
    }
    return (await broker.call('requests.create', params, {
      meta: { user: opts.user ?? amAdmin() },
    })) as RequestDTO;
  }

  describe('Test 1: Create su FVM laukais', () => {
    it('Visi 4 FVM laukai išsaugomi ir grąžinami get response\'e', async () => {
      const created = await createRequest({
        budgetCategoryId: cls.budgetCategoryItemIds.spec_programa,
        fundingSourceTypeId: cls.fundingSourceTypeItemIds.biudzetas,
        specProgramFundingType: 'atskiras',
      });
      expect(created.id).toBeGreaterThan(0);
      expect(created.budgetCategoryId).toBe(
        cls.budgetCategoryItemIds.spec_programa,
      );
      expect(created.budgetCategoryCode).toBe('spec_programa');
      expect(created.budgetCategoryName).toBe('Specialioji programa');
      expect(created.fundingSourceTypeId).toBe(
        cls.fundingSourceTypeItemIds.biudzetas,
      );
      expect(created.fundingSourceTypeCode).toBe('biudzetas');
      expect(created.fundingSourceTypeName).toBe('Valstybės biudžetas');
      expect(created.specProgramFundingType).toBe('atskiras');
      // fvmProjectId pildomas Iter 11 metu — Iter 10 lieka null
      expect(created.fvmProjectId).toBeNull();

      // Verify also `get` endpoint grąžina tą patį
      const fetched = (await broker.call(
        'requests.get',
        { id: created.id },
        { meta: { user: amAdmin() } },
      )) as FinancingRequestDetail;
      expect(fetched.budgetCategoryId).toBe(
        cls.budgetCategoryItemIds.spec_programa,
      );
      expect(fetched.specProgramFundingType).toBe('atskiras');
      expect(fetched.budgetCategoryCode).toBe('spec_programa');
    });

    it('Update gali keisti FVM laukus DRAFT prašymui', async () => {
      const created = await createRequest({
        budgetCategoryId: cls.budgetCategoryItemIds.du,
      });
      expect(created.budgetCategoryCode).toBe('du');

      const updated = (await broker.call(
        'requests.update',
        {
          id: created.id,
          budgetCategoryId: cls.budgetCategoryItemIds.investicijos,
          fundingSourceTypeId: cls.fundingSourceTypeItemIds.es,
        },
        { meta: { user: amAdmin() } },
      )) as RequestDTO;
      expect(updated.budgetCategoryId).toBe(
        cls.budgetCategoryItemIds.investicijos,
      );
      expect(updated.budgetCategoryCode).toBe('investicijos');
      expect(updated.fundingSourceTypeId).toBe(cls.fundingSourceTypeItemIds.es);
      expect(updated.fundingSourceTypeCode).toBe('es');
    });
  });

  describe('Test 2: Create be FVM laukų (backward compat)', () => {
    it('Sėkmingai kuriamas; visi FVM laukai grąžinami kaip null', async () => {
      const created = await createRequest({
        projectName: 'Legacy prašymas (be FVM)',
      });
      expect(created.id).toBeGreaterThan(0);
      expect(created.budgetCategoryId).toBeNull();
      expect(created.budgetCategoryCode).toBeNull();
      expect(created.budgetCategoryName).toBeNull();
      expect(created.fundingSourceTypeId).toBeNull();
      expect(created.fundingSourceTypeCode).toBeNull();
      expect(created.fundingSourceTypeName).toBeNull();
      expect(created.specProgramFundingType).toBeNull();
      expect(created.fvmProjectId).toBeNull();
    });
  });

  describe('Test 3: budgetCategoryId validacija — klaidinga grupė', () => {
    it('Item iš `funding_source_type` grupės kaip budgetCategoryId → 400 LT error', async () => {
      // `cls.fundingSourceTypeItemIds.biudzetas` priklauso `funding_source_type`
      // grupei, NE `budget_category`. Validation turi atmesti.
      await expect(
        createRequest({
          budgetCategoryId: cls.fundingSourceTypeItemIds.biudzetas,
        }),
      ).rejects.toMatchObject({
        code: 400,
        type: 'INVALID_BUDGET_CATEGORY_GROUP',
        message: expect.stringContaining('budget_category'),
      });
    });

    it('Neegzistuojantis budgetCategoryId → 400 INVALID_BUDGET_CATEGORY', async () => {
      await expect(
        createRequest({ budgetCategoryId: 999_999 }),
      ).rejects.toMatchObject({
        code: 400,
        type: 'INVALID_BUDGET_CATEGORY',
      });
    });
  });

  describe('Test 4: fundingSourceTypeId validacija — klaidinga grupė', () => {
    it('Item iš `budget_category` grupės kaip fundingSourceTypeId → 400 LT error', async () => {
      await expect(
        createRequest({
          fundingSourceTypeId: cls.budgetCategoryItemIds.du,
        }),
      ).rejects.toMatchObject({
        code: 400,
        type: 'INVALID_FUNDING_SOURCE_TYPE_GROUP',
        message: expect.stringContaining('funding_source_type'),
      });
    });
  });

  describe('Test 5: specProgramFundingType be spec_programa kategorijos', () => {
    it('specProgramFundingType nurodytas, bet budgetCategory = du → 400 LT error', async () => {
      await expect(
        createRequest({
          budgetCategoryId: cls.budgetCategoryItemIds.du,
          specProgramFundingType: 'atskiras',
        }),
      ).rejects.toMatchObject({
        code: 400,
        type: 'SPEC_PROGRAM_FUNDING_TYPE_REQUIRES_SPEC_PROGRAMA',
        message: expect.stringContaining('Specialioji programa'),
      });
    });

    it('specProgramFundingType nurodytas be jokios budgetCategory → 400 LT error', async () => {
      await expect(
        createRequest({
          specProgramFundingType: 'biudzeto_dalis',
        }),
      ).rejects.toMatchObject({
        code: 400,
        type: 'SPEC_PROGRAM_FUNDING_TYPE_REQUIRES_SPEC_PROGRAMA',
      });
    });

    it('specProgramFundingType + spec_programa kategorija → sėkmingai', async () => {
      const created = await createRequest({
        budgetCategoryId: cls.budgetCategoryItemIds.spec_programa,
        specProgramFundingType: 'biudzeto_dalis',
      });
      expect(created.specProgramFundingType).toBe('biudzeto_dalis');
      expect(created.budgetCategoryCode).toBe('spec_programa');
    });

    it('Update keičia kategoriją iš spec_programa į kitą — specProgramFundingType automatiškai null\'inasi', async () => {
      const created = await createRequest({
        budgetCategoryId: cls.budgetCategoryItemIds.spec_programa,
        specProgramFundingType: 'atskiras',
      });
      expect(created.specProgramFundingType).toBe('atskiras');

      // Keičiam kategoriją į ne-spec_programa
      const updated = (await broker.call(
        'requests.update',
        {
          id: created.id,
          budgetCategoryId: cls.budgetCategoryItemIds.du,
        },
        { meta: { user: amAdmin() } },
      )) as RequestDTO;
      expect(updated.budgetCategoryCode).toBe('du');
      // specProgramFundingType turi tapti null, kad nesusidarytų inconsistent state.
      expect(updated.specProgramFundingType).toBeNull();
    });
  });

  describe('Test 6: AM approve flow su FVM laukais', () => {
    it('AM gali pakeisti budgetCategoryId per decision approve', async () => {
      // 1. Org sukuria prašymą su viena kategorija ir submit'ina.
      const created = await createRequest({
        budgetCategoryId: cls.budgetCategoryItemIds.du,
        projectName: 'AM approve test',
      });
      await broker.call(
        'requests.submit',
        { id: created.id },
        { meta: { user: amAdmin() } },
      );

      // 2. AM patvirtina su pakeista kategorija.
      const approved = (await broker.call(
        'requests.decision',
        {
          id: created.id,
          decision: 'approve',
          grantedAmount: 50000,
          budgetCategoryId: cls.budgetCategoryItemIds.investicijos,
          fundingSourceTypeId: cls.fundingSourceTypeItemIds.es,
        },
        { meta: { user: amAdmin() } },
      )) as RequestDTO;

      expect(approved.status).toBe('APPROVED');
      expect(approved.budgetCategoryId).toBe(
        cls.budgetCategoryItemIds.investicijos,
      );
      expect(approved.budgetCategoryCode).toBe('investicijos');
      expect(approved.fundingSourceTypeId).toBe(cls.fundingSourceTypeItemIds.es);
      expect(approved.decisionGrantedAmount).toBe('50000.00');
    });

    it('AM approve be FVM laukų pakeitimo — kategorija lieka org pasirinkta', async () => {
      const created = await createRequest({
        budgetCategoryId: cls.budgetCategoryItemIds.spec_programa,
        specProgramFundingType: 'atskiras',
      });
      await broker.call(
        'requests.submit',
        { id: created.id },
        { meta: { user: amAdmin() } },
      );
      const approved = (await broker.call(
        'requests.decision',
        { id: created.id, decision: 'approve', grantedAmount: 100000 },
        { meta: { user: amAdmin() } },
      )) as RequestDTO;
      expect(approved.budgetCategoryId).toBe(
        cls.budgetCategoryItemIds.spec_programa,
      );
      expect(approved.specProgramFundingType).toBe('atskiras');
    });

    it('AM approve su klaidingos grupės budgetCategoryId → 400 (status NEPAKEISTAS)', async () => {
      const created = await createRequest({
        budgetCategoryId: cls.budgetCategoryItemIds.du,
      });
      await broker.call(
        'requests.submit',
        { id: created.id },
        { meta: { user: amAdmin() } },
      );
      await expect(
        broker.call(
          'requests.decision',
          {
            id: created.id,
            decision: 'approve',
            // funding_source_type item — klaidinga grupė
            budgetCategoryId: cls.fundingSourceTypeItemIds.biudzetas,
          },
          { meta: { user: amAdmin() } },
        ),
      ).rejects.toMatchObject({
        code: 400,
        type: 'INVALID_BUDGET_CATEGORY_GROUP',
      });

      // Status turi likti SUBMITTED — validation klaida prieš patch.
      const fetched = (await broker.call(
        'requests.get',
        { id: created.id },
        { meta: { user: amAdmin() } },
      )) as FinancingRequestDetail;
      expect(fetched.status).toBe('SUBMITTED');
      expect(fetched.budgetCategoryCode).toBe('du');
    });
  });

  describe('Test 7: createFvmProject placeholder action (Iter 10)', () => {
    it('AM gali iškviesti placeholder, gauna pending response', async () => {
      const created = await createRequest({
        budgetCategoryId: cls.budgetCategoryItemIds.spec_programa,
      });
      await broker.call(
        'requests.submit',
        { id: created.id },
        { meta: { user: amAdmin() } },
      );
      await broker.call(
        'requests.decision',
        { id: created.id, decision: 'approve', grantedAmount: 100000 },
        { meta: { user: amAdmin() } },
      );
      const res = (await broker.call(
        'requests.createFvmProject',
        { id: created.id },
        { meta: { user: amAdmin() } },
      )) as CreateFvmProjectResponse;
      expect(res.status).toBe('pending');
      expect(res.requestId).toBe(created.id);
      expect(res.message).toMatch(/Iter 11/);
    });

    it('Org admin negali iškviesti createFvmProject → 403', async () => {
      const created = await createRequest({});
      await expect(
        broker.call(
          'requests.createFvmProject',
          { id: created.id },
          { meta: { user: orgAdmin() } },
        ),
      ).rejects.toMatchObject({ code: 403, type: 'FORBIDDEN' });
    });

    it('Ne-APPROVED prašymui createFvmProject → 400 INVALID_STATUS', async () => {
      const created = await createRequest({});
      // DRAFT būsenoje — neturi būti leidžiama.
      await expect(
        broker.call(
          'requests.createFvmProject',
          { id: created.id },
          { meta: { user: amAdmin() } },
        ),
      ).rejects.toMatchObject({ code: 400, type: 'INVALID_STATUS' });
    });
  });
});
