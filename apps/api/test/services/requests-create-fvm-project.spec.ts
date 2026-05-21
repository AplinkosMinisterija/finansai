/**
 * `requests.createFvmProject` integration tests (Iter 11, FVM-3).
 *
 * Real implementation (vs Iter 10 placeholder) test'ai:
 *  1. AM admin + APPROVED spec.programa + esama allocation → sėkmingai sukuriama
 *  2. Po sukūrimo: request.fvmProjectId užpildomas, project.requestId teisingas
 *  3. SUBMITTED request → 400 INVALID_STATUS
 *  4. Request su fvmProjectId != null (dukart bandant) → 400 REQUEST_ALREADY_HAS_PROJECT
 *  5. Spec_programa be allocation match → 400 NO_MATCHING_ALLOCATION
 *  6. Non-spec_programa (pvz., du kategorija) → 400 NOT_SPEC_PROGRAMA „rankiniu būdu"
 */
import type { ServiceBroker } from 'moleculer';
import type {
  BudgetAllocation as BudgetAllocationDTO,
  CreateFvmProjectResponse,
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
import { mockAuthUser, mockOrgAdmin } from '../helpers/auth';

describe('requests.createFvmProject (Iter 11 real implementation)', () => {
  let broker: ServiceBroker;
  let base: BaseFixtures;
  let org: OrgTenantFixtures;
  let cls: FvmClassifierFixtures;
  let orgSpecProgAllocationId: number;

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
      tenantCode: 'AAD',
      tenantName: 'Aplinkos apsaugos departamentas',
    });
  }

  /**
   * Sukuria org tenant'e: funding_source + spec_programa allocation šių metų
   * biudžetui. Naudojama daugumai test'ų.
   */
  async function seedOrgFinances(year = 2026): Promise<void> {
    const orgFs = (await broker.call(
      'fundingSources.create',
      {
        tenantId: org.orgTenantId,
        pavadinimas: `AAD biudžetas ${year}`,
        kodas: `AAD-VB-${year}`,
        tipasClassifierItemId: cls.fundingSourceTypeItemIds.biudzetas,
        metai: year,
        metineSuma: '800000.00',
      },
      { meta: { user: amAdmin() } },
    )) as FundingSourceDTO;

    const alloc = (await broker.call(
      'budgetAllocations.create',
      {
        fundingSourceId: orgFs.id,
        categoryClassifierItemId: cls.budgetCategoryItemIds.spec_programa,
        pavadinimas: `Spec.programa ${year}`,
        specProgTipas: 'atskiras',
        planuotaSuma: '200000.00',
        metai: year,
      },
      { meta: { user: amAdmin() } },
    )) as BudgetAllocationDTO;
    orgSpecProgAllocationId = alloc.id;
  }

  /**
   * Sukuria APPROVED prašymą per direct DB insert (nereikia pereiti pilnu
   * wizard'u — tikrinam tik createFvmProject).
   */
  async function insertApprovedRequest(opts: {
    budgetCategoryId: number;
    fvmProjectId?: number | null;
    grantedAmount?: string;
    year?: number;
  }): Promise<number> {
    const knex = getTestKnex();
    const rows = (await knex('requests')
      .insert({
        tenant_id: org.orgTenantId,
        created_by_user_id: org.orgAdminUserId,
        status: 'APPROVED',
        project_name: 'AAD test prašymas',
        year: opts.year ?? 2026,
        decision_granted_amount: opts.grantedAmount ?? '120000.00',
        budget_category_id: opts.budgetCategoryId,
        spec_program_funding_type: 'atskiras',
        fvm_project_id: opts.fvmProjectId ?? null,
      })
      .returning('id')) as Array<{ id: number }>;
    return rows[0]!.id;
  }

  beforeEach(async () => {
    const knex = getTestKnex();
    await truncateAll(knex);
    base = await seedBaseFixtures(knex);
    org = await seedOrgTenant(knex);
    cls = await seedFvmClassifiers(knex);
  });

  describe('Test 1: AM admin + APPROVED spec.programa + esama allocation', () => {
    it('Sėkmingai sukuriamas projektas, response.status=created', async () => {
      await seedOrgFinances();
      const requestId = await insertApprovedRequest({
        budgetCategoryId: cls.budgetCategoryItemIds.spec_programa,
      });

      const res = (await broker.call(
        'requests.createFvmProject',
        { id: requestId },
        { meta: { user: amAdmin() } },
      )) as CreateFvmProjectResponse;

      expect(res.status).toBe('created');
      expect(res.requestId).toBe(requestId);
      expect(res.message).toBe('Projektas sėkmingai sukurtas');
      if (res.status === 'created') {
        expect(res.project.tipas).toBe('spec_programa');
        expect(res.project.tenantId).toBe(org.orgTenantId);
        expect(res.project.budgetAllocationId).toBe(orgSpecProgAllocationId);
        expect(res.project.requestId).toBe(requestId);
        expect(res.project.biudzetas).toBe('120000.00');
        expect(res.project.statusas).toBe('planuojama');
        expect(res.project.atsakingasUserId).toBe(org.orgAdminUserId);
      }
    });
  });

  describe('Test 2: Po sukūrimo — request.fvmProjectId užpildomas', () => {
    it('request.fvmProjectId === project.id, project.requestId === request.id', async () => {
      await seedOrgFinances();
      const requestId = await insertApprovedRequest({
        budgetCategoryId: cls.budgetCategoryItemIds.spec_programa,
      });

      const res = (await broker.call(
        'requests.createFvmProject',
        { id: requestId },
        { meta: { user: amAdmin() } },
      )) as CreateFvmProjectResponse;
      expect(res.status).toBe('created');
      if (res.status !== 'created') return; // type narrow

      const projectId = res.project.id;
      const requestRow = (await getTestKnex()('requests')
        .where({ id: requestId })
        .first<{ fvm_project_id: number | null }>()) as
        | { fvm_project_id: number | null }
        | undefined;
      expect(requestRow?.fvm_project_id).toBe(projectId);

      const projectRow = (await getTestKnex()('projects')
        .where({ id: projectId })
        .first<{ request_id: number | null }>()) as
        | { request_id: number | null }
        | undefined;
      expect(projectRow?.request_id).toBe(requestId);
    });
  });

  describe('Test 3: SUBMITTED request → 400', () => {
    it('Ne-APPROVED prašymui → 400 INVALID_STATUS', async () => {
      await seedOrgFinances();
      const knex = getTestKnex();
      const rows = (await knex('requests')
        .insert({
          tenant_id: org.orgTenantId,
          created_by_user_id: org.orgAdminUserId,
          status: 'SUBMITTED',
          project_name: 'AAD submitted',
          year: 2026,
          budget_category_id: cls.budgetCategoryItemIds.spec_programa,
        })
        .returning('id')) as Array<{ id: number }>;
      const requestId = rows[0]!.id;

      await expect(
        broker.call(
          'requests.createFvmProject',
          { id: requestId },
          { meta: { user: amAdmin() } },
        ),
      ).rejects.toMatchObject({ code: 400, type: 'INVALID_STATUS' });
    });
  });

  describe('Test 4: Request su fvmProjectId != null — dukart bandant', () => {
    it('Antru kvietimu → 400 REQUEST_ALREADY_HAS_PROJECT', async () => {
      await seedOrgFinances();
      const requestId = await insertApprovedRequest({
        budgetCategoryId: cls.budgetCategoryItemIds.spec_programa,
      });

      // Pirmasis kvietimas — sėkmingas.
      const first = (await broker.call(
        'requests.createFvmProject',
        { id: requestId },
        { meta: { user: amAdmin() } },
      )) as CreateFvmProjectResponse;
      expect(first.status).toBe('created');

      // Antrasis — turi failint.
      await expect(
        broker.call(
          'requests.createFvmProject',
          { id: requestId },
          { meta: { user: amAdmin() } },
        ),
      ).rejects.toMatchObject({
        code: 400,
        type: 'REQUEST_ALREADY_HAS_PROJECT',
      });
    });
  });

  describe('Test 5: Spec_programa be allocation match', () => {
    it('Nėra šių metų spec_programa allocation tenant\'e → 400 NO_MATCHING_ALLOCATION', async () => {
      // SĄMONINGAI ne kviečiam seedOrgFinances() — tenant'as neturi allocation.
      const requestId = await insertApprovedRequest({
        budgetCategoryId: cls.budgetCategoryItemIds.spec_programa,
      });

      await expect(
        broker.call(
          'requests.createFvmProject',
          { id: requestId },
          { meta: { user: amAdmin() } },
        ),
      ).rejects.toMatchObject({
        code: 400,
        type: 'NO_MATCHING_ALLOCATION',
      });
    });

    it('Allocation kitiem metam → 400 NO_MATCHING_ALLOCATION', async () => {
      // Sukuriam allocation 2027 metam, bet prašymas 2026 metam.
      await seedOrgFinances(2027);
      const requestId = await insertApprovedRequest({
        budgetCategoryId: cls.budgetCategoryItemIds.spec_programa,
        year: 2026,
      });
      await expect(
        broker.call(
          'requests.createFvmProject',
          { id: requestId },
          { meta: { user: amAdmin() } },
        ),
      ).rejects.toMatchObject({
        code: 400,
        type: 'NO_MATCHING_ALLOCATION',
      });
    });
  });

  describe('Test 6: Non-spec_programa (pvz., du) → 400', () => {
    it('budget_category=du → 400 NOT_SPEC_PROGRAMA „rankiniu būdu"', async () => {
      await seedOrgFinances();
      // Prašymas su DU kategorija (ne spec_programa).
      const requestId = await insertApprovedRequest({
        budgetCategoryId: cls.budgetCategoryItemIds.du,
      });

      await expect(
        broker.call(
          'requests.createFvmProject',
          { id: requestId },
          { meta: { user: amAdmin() } },
        ),
      ).rejects.toMatchObject({
        code: 400,
        type: 'NOT_SPEC_PROGRAMA',
        message: expect.stringMatching(/rankiniu būdu/),
      });
    });
  });

  describe('Org admin negali kviesti', () => {
    it('Org admin → 403', async () => {
      await seedOrgFinances();
      const requestId = await insertApprovedRequest({
        budgetCategoryId: cls.budgetCategoryItemIds.spec_programa,
      });
      await expect(
        broker.call(
          'requests.createFvmProject',
          { id: requestId },
          { meta: { user: orgAdmin() } },
        ),
      ).rejects.toMatchObject({ code: 403, type: 'FORBIDDEN' });
    });
  });
});
