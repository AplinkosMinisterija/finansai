/**
 * Expenses service integration tests (Iter 12, FVM-4).
 *
 * Test scope:
 *   1. AM admin create expense (single source, saltinioDalis=null)
 *   2. Org admin create savo tenant'e
 *   3. Org user (ne-admin) → 403
 *   4. Multi-source split sumuojantis į expense.suma — sėkmingai
 *   5. Multi-source split NESUMUOJANTIS → 400 LT
 *   6. List filter pagal projectId, year
 *   7. List filter pagal fundingSourceId (GIN @> query) — grąžina multi-source
 *   8. Cross-tenant create → 403 / 400
 *   9. Delete savo expense — sėkmingai
 *   10. Delete kitos tenant'o expense — 403 (org_admin)
 *   11. Update suma + saltinioDalis konsistencija — re-validuoja
 *   12. Get/list tenant scope: org admin negali matyti kitos tenant'o expense
 */
import type { ServiceBroker } from 'moleculer';
import type {
  BudgetAllocation as BudgetAllocationDTO,
  Expense as ExpenseDTO,
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
import { mockAuthUser, mockOrgAdmin, mockOrgUser } from '../helpers/auth';

describe('expenses service (Iter 12)', () => {
  let broker: ServiceBroker;
  let base: BaseFixtures;
  let org: OrgTenantFixtures;
  let cls: FvmClassifierFixtures;
  let amProjectId: number;
  let amDuAllocationId: number;
  let amFundingSourceId: number;
  let amSecondFundingSourceId: number;
  let orgProjectId: number;
  let orgAllocationId: number;
  let orgFundingSourceId: number;

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

    // AM tenant: 2 funding sources, 1 allocation, 1 projektas
    const amFs1 = (await broker.call(
      'fundingSources.create',
      {
        tenantId: base.amTenantId,
        pavadinimas: 'AM Valstybės biudžetas 2026',
        kodas: 'AM-VB-2026',
        tipasClassifierItemId: cls.fundingSourceTypeItemIds.biudzetas,
        metai: 2026,
        metineSuma: '2000000.00',
      },
      { meta: { user: amAdmin() } },
    )) as FundingSourceDTO;
    amFundingSourceId = amFs1.id;

    const amFs2 = (await broker.call(
      'fundingSources.create',
      {
        tenantId: base.amTenantId,
        pavadinimas: 'AM ES fondai 2026',
        kodas: 'AM-ES-2026',
        tipasClassifierItemId: cls.fundingSourceTypeItemIds.es,
        metai: 2026,
        metineSuma: '500000.00',
      },
      { meta: { user: amAdmin() } },
    )) as FundingSourceDTO;
    amSecondFundingSourceId = amFs2.id;

    const amAlloc = (await broker.call(
      'budgetAllocations.create',
      {
        fundingSourceId: amFundingSourceId,
        categoryClassifierItemId: cls.budgetCategoryItemIds.du,
        pavadinimas: 'AM DU 2026',
        planuotaSuma: '500000.00',
        metai: 2026,
      },
      { meta: { user: amAdmin() } },
    )) as BudgetAllocationDTO;
    amDuAllocationId = amAlloc.id;

    const amProject = (await broker.call(
      'projects.create',
      {
        tenantId: base.amTenantId,
        budgetAllocationId: amDuAllocationId,
        pavadinimas: 'AM IT modernizavimas 2026',
        tipas: 'projektas',
        biudzetas: '100000.00',
        pradziosData: '2026-01-01',
        pabaigosData: '2026-12-31',
        // UAT #41 PR-001: išlaidas veda projekto vadovas. Testuose amAdmin =
        // amProject vadovas, kad esami amAdmin write testai liktų galioti.
        atsakingasUserId: base.amAdminUserId,
      },
      { meta: { user: amAdmin() } },
    )) as ProjectDTO;
    amProjectId = amProject.id;

    // Org tenant: 1 funding source, 1 allocation, 1 projektas
    const orgFs = (await broker.call(
      'fundingSources.create',
      {
        tenantId: org.orgTenantId,
        pavadinimas: 'AAD biudžetas 2026',
        kodas: 'AAD-VB-2026',
        tipasClassifierItemId: cls.fundingSourceTypeItemIds.biudzetas,
        metai: 2026,
        metineSuma: '300000.00',
      },
      { meta: { user: amAdmin() } },
    )) as FundingSourceDTO;
    orgFundingSourceId = orgFs.id;

    const orgAlloc = (await broker.call(
      'budgetAllocations.create',
      {
        fundingSourceId: orgFundingSourceId,
        categoryClassifierItemId: cls.budgetCategoryItemIds.prekes_paslaugos,
        pavadinimas: 'AAD prekės/paslaugos 2026',
        planuotaSuma: '200000.00',
        metai: 2026,
      },
      { meta: { user: amAdmin() } },
    )) as BudgetAllocationDTO;
    orgAllocationId = orgAlloc.id;

    const orgProject = (await broker.call(
      'projects.create',
      {
        tenantId: org.orgTenantId,
        budgetAllocationId: orgAllocationId,
        pavadinimas: 'AAD projektas 2026',
        tipas: 'projektas',
        biudzetas: '50000.00',
        pradziosData: '2026-01-01',
        pabaigosData: '2026-12-31',
        // UAT #41 PR-001: orgAdmin = orgProject vadovas (org tenant'o user;
        // projects.create reikalauja, kad vadovas priklausytų projekto tenant'ui).
        atsakingasUserId: org.orgAdminUserId,
      },
      { meta: { user: amAdmin() } },
    )) as ProjectDTO;
    orgProjectId = orgProject.id;
  });

  describe('create', () => {
    it('1. AM admin create expense (single source) — sėkmingai', async () => {
      const created = (await broker.call(
        'expenses.create',
        {
          projectId: amProjectId,
          budgetAllocationId: amDuAllocationId,
          tipas: 'saskaita',
          suma: '1000.00',
          data: '2026-03-15',
          aprasymas: 'Test saskaita',
        },
        { meta: { user: amAdmin() } },
      )) as ExpenseDTO;
      expect(created.id).toBeGreaterThan(0);
      expect(created.projectId).toBe(amProjectId);
      expect(created.budgetAllocationId).toBe(amDuAllocationId);
      expect(created.tipas).toBe('saskaita');
      expect(created.suma).toBe('1000.00');
      expect(created.data).toBe('2026-03-15');
      expect(created.saltinioDalis).toBeNull();
      expect(created.createdByUserId).toBe(base.amAdminUserId);
    });

    it('2. Projekto vadovas (orgProject) create — sėkmingai (UAT #41 PR-001)', async () => {
      // orgAdmin yra orgProject atsakingas asmuo → gali vesti išlaidas.
      const created = (await broker.call(
        'expenses.create',
        {
          projectId: orgProjectId,
          budgetAllocationId: orgAllocationId,
          tipas: 'tiesiogine',
          suma: '250.50',
          data: '2026-04-01',
        },
        { meta: { user: orgAdmin() } },
      )) as ExpenseDTO;
      expect(created.projectId).toBe(orgProjectId);
      expect(created.suma).toBe('250.50');
      expect(created.tipas).toBe('tiesiogine');
    });

    it('3. Ne vadovas (orgUser) create → 403 (UAT #41 PR-001)', async () => {
      // orgUser nėra orgProject atsakingas asmuo → 403 (read-only).
      await expect(
        broker.call(
          'expenses.create',
          {
            projectId: orgProjectId,
            budgetAllocationId: orgAllocationId,
            tipas: 'tiesiogine',
            suma: '100.00',
            data: '2026-04-01',
          },
          { meta: { user: orgUser() } },
        ),
      ).rejects.toMatchObject({ code: 403, type: 'FORBIDDEN' });
    });

    it('4. Multi-source split sumuojantis į expense.suma — sėkmingai', async () => {
      const created = (await broker.call(
        'expenses.create',
        {
          projectId: amProjectId,
          budgetAllocationId: amDuAllocationId,
          tipas: 'sutartis',
          suma: '1000.00',
          data: '2026-05-10',
          aprasymas: 'Multi-source: 600 + 400 = 1000',
          saltinioDalis: [
            { fundingSourceId: amFundingSourceId, suma: '600.00' },
            { fundingSourceId: amSecondFundingSourceId, suma: '400.00' },
          ],
        },
        { meta: { user: amAdmin() } },
      )) as ExpenseDTO;
      expect(created.saltinioDalis).not.toBeNull();
      expect(created.saltinioDalis).toHaveLength(2);
      expect(created.saltinioDalis![0]).toEqual({
        fundingSourceId: amFundingSourceId,
        suma: '600.00',
      });
      expect(created.saltinioDalis![1]).toEqual({
        fundingSourceId: amSecondFundingSourceId,
        suma: '400.00',
      });
    });

    it('5. Multi-source split NESUMUOJANTIS → 400 LT klaida', async () => {
      await expect(
        broker.call(
          'expenses.create',
          {
            projectId: amProjectId,
            budgetAllocationId: amDuAllocationId,
            tipas: 'sutartis',
            suma: '1000.00',
            data: '2026-05-10',
            saltinioDalis: [
              { fundingSourceId: amFundingSourceId, suma: '600.00' },
              { fundingSourceId: amSecondFundingSourceId, suma: '300.00' },
            ],
          },
          { meta: { user: amAdmin() } },
        ),
      ).rejects.toMatchObject({
        code: 400,
        type: 'SOURCE_DISTRIBUTION_MISMATCH',
      });
    });

    it('saltinioDalis su nežinomu funding_source_id → 400', async () => {
      await expect(
        broker.call(
          'expenses.create',
          {
            projectId: amProjectId,
            budgetAllocationId: amDuAllocationId,
            tipas: 'sutartis',
            suma: '500.00',
            data: '2026-05-10',
            saltinioDalis: [{ fundingSourceId: 999_999, suma: '500.00' }],
          },
          { meta: { user: amAdmin() } },
        ),
      ).rejects.toMatchObject({
        code: 400,
        type: 'INVALID_FUNDING_SOURCE',
      });
    });

    it('saltinioDalis su 0 suma → 400 INVALID_SOURCE_AMOUNT', async () => {
      await expect(
        broker.call(
          'expenses.create',
          {
            projectId: amProjectId,
            budgetAllocationId: amDuAllocationId,
            tipas: 'sutartis',
            suma: '500.00',
            data: '2026-05-10',
            saltinioDalis: [
              { fundingSourceId: amFundingSourceId, suma: '500.00' },
              { fundingSourceId: amSecondFundingSourceId, suma: '0' },
            ],
          },
          { meta: { user: amAdmin() } },
        ),
      ).rejects.toMatchObject({
        code: 400,
        type: 'INVALID_SOURCE_AMOUNT',
      });
    });

    it('suma <= 0 → 400 INVALID_AMOUNT', async () => {
      await expect(
        broker.call(
          'expenses.create',
          {
            projectId: amProjectId,
            budgetAllocationId: amDuAllocationId,
            tipas: 'saskaita',
            suma: '0',
            data: '2026-03-15',
          },
          { meta: { user: amAdmin() } },
        ),
      ).rejects.toMatchObject({ code: 400, type: 'INVALID_AMOUNT' });
    });

    it("8. Cross-tenant: org admin bando AM projekt'ą → 403 FORBIDDEN", async () => {
      await expect(
        broker.call(
          'expenses.create',
          {
            projectId: amProjectId,
            budgetAllocationId: amDuAllocationId,
            tipas: 'saskaita',
            suma: '100.00',
            data: '2026-03-15',
          },
          { meta: { user: orgAdmin() } },
        ),
      ).rejects.toMatchObject({ code: 403, type: 'FORBIDDEN' });
    });

    it('Cross-tenant: orgProject vadovas su AM allocation → 400 ALLOCATION_TENANT_MISMATCH', async () => {
      // orgAdmin = orgProject vadovas (praeina write check), bet AM allocation
      // priklauso kitam tenant'ui → 400 mismatch.
      await expect(
        broker.call(
          'expenses.create',
          {
            projectId: orgProjectId,
            budgetAllocationId: amDuAllocationId,
            tipas: 'saskaita',
            suma: '100.00',
            data: '2026-03-15',
          },
          { meta: { user: orgAdmin() } },
        ),
      ).rejects.toMatchObject({
        code: 400,
        type: 'ALLOCATION_TENANT_MISMATCH',
      });
    });
  });

  describe('list', () => {
    it('6. List filter pagal projectId ir year', async () => {
      // Sukuriam 3 expenses: 2 AM projektui (1 — 2026, 1 — 2027), 1 — org projektui
      await broker.call(
        'expenses.create',
        {
          projectId: amProjectId,
          budgetAllocationId: amDuAllocationId,
          tipas: 'saskaita',
          suma: '100.00',
          data: '2026-03-15',
        },
        { meta: { user: amAdmin() } },
      );
      await broker.call(
        'expenses.create',
        {
          projectId: amProjectId,
          budgetAllocationId: amDuAllocationId,
          tipas: 'sutartis',
          suma: '200.00',
          data: '2027-01-15',
        },
        { meta: { user: amAdmin() } },
      );
      await broker.call(
        'expenses.create',
        {
          projectId: orgProjectId,
          budgetAllocationId: orgAllocationId,
          tipas: 'tiesiogine',
          suma: '50.00',
          data: '2026-04-01',
        },
        { meta: { user: orgAdmin() } },
      );

      const list = (await broker.call(
        'expenses.list',
        { projectId: amProjectId, year: 2026 },
        { meta: { user: amAdmin() } },
      )) as ExpenseDTO[];
      expect(list).toHaveLength(1);
      expect(list[0]!.tipas).toBe('saskaita');
      expect(list[0]!.suma).toBe('100.00');
    });

    it('7. List filter pagal fundingSourceId (GIN @> query) — grąžina multi-source', async () => {
      // Sukuriam 3 expenses:
      //  #1: single-source (saltinioDalis=null)
      //  #2: multi-source (primary + secondary)
      //  #3: multi-source (tik secondary)
      await broker.call(
        'expenses.create',
        {
          projectId: amProjectId,
          budgetAllocationId: amDuAllocationId,
          tipas: 'saskaita',
          suma: '500.00',
          data: '2026-03-15',
        },
        { meta: { user: amAdmin() } },
      );
      await broker.call(
        'expenses.create',
        {
          projectId: amProjectId,
          budgetAllocationId: amDuAllocationId,
          tipas: 'sutartis',
          suma: '1000.00',
          data: '2026-04-01',
          saltinioDalis: [
            { fundingSourceId: amFundingSourceId, suma: '600.00' },
            { fundingSourceId: amSecondFundingSourceId, suma: '400.00' },
          ],
        },
        { meta: { user: amAdmin() } },
      );
      await broker.call(
        'expenses.create',
        {
          projectId: amProjectId,
          budgetAllocationId: amDuAllocationId,
          tipas: 'tiesiogine',
          suma: '300.00',
          data: '2026-05-01',
          saltinioDalis: [{ fundingSourceId: amSecondFundingSourceId, suma: '300.00' }],
        },
        { meta: { user: amAdmin() } },
      );

      const listByFs2 = (await broker.call(
        'expenses.list',
        { fundingSourceId: amSecondFundingSourceId },
        { meta: { user: amAdmin() } },
      )) as ExpenseDTO[];
      expect(listByFs2).toHaveLength(2);
      const tipai = listByFs2.map((e) => e.tipas).sort();
      expect(tipai).toEqual(['sutartis', 'tiesiogine']);
    });

    it('Tenant scope: org admin mato tik savo tenant expenses', async () => {
      await broker.call(
        'expenses.create',
        {
          projectId: amProjectId,
          budgetAllocationId: amDuAllocationId,
          tipas: 'saskaita',
          suma: '500.00',
          data: '2026-03-15',
        },
        { meta: { user: amAdmin() } },
      );
      await broker.call(
        'expenses.create',
        {
          projectId: orgProjectId,
          budgetAllocationId: orgAllocationId,
          tipas: 'tiesiogine',
          suma: '50.00',
          data: '2026-04-01',
        },
        { meta: { user: orgAdmin() } },
      );

      const amList = (await broker.call(
        'expenses.list',
        {},
        { meta: { user: amAdmin() } },
      )) as ExpenseDTO[];
      expect(amList).toHaveLength(2);

      const orgList = (await broker.call(
        'expenses.list',
        {},
        { meta: { user: orgAdmin() } },
      )) as ExpenseDTO[];
      expect(orgList).toHaveLength(1);
      expect(orgList[0]!.projectId).toBe(orgProjectId);
    });
  });

  describe('get (tenant scope)', () => {
    it('12. Org admin mato savo tenant; kitos — 403', async () => {
      const orgExpense = (await broker.call(
        'expenses.create',
        {
          projectId: orgProjectId,
          budgetAllocationId: orgAllocationId,
          tipas: 'tiesiogine',
          suma: '50.00',
          data: '2026-04-01',
        },
        { meta: { user: orgAdmin() } },
      )) as ExpenseDTO;
      const amExpense = (await broker.call(
        'expenses.create',
        {
          projectId: amProjectId,
          budgetAllocationId: amDuAllocationId,
          tipas: 'saskaita',
          suma: '500.00',
          data: '2026-03-15',
        },
        { meta: { user: amAdmin() } },
      )) as ExpenseDTO;

      const fetched = (await broker.call(
        'expenses.get',
        { id: orgExpense.id },
        { meta: { user: orgAdmin() } },
      )) as ExpenseDTO;
      expect(fetched.id).toBe(orgExpense.id);

      await expect(
        broker.call('expenses.get', { id: amExpense.id }, { meta: { user: orgAdmin() } }),
      ).rejects.toMatchObject({ code: 403, type: 'FORBIDDEN' });
    });
  });

  describe('delete', () => {
    it('9. Vadovas delete savo expense — sėkmingai (UAT #41 PR-001)', async () => {
      const created = (await broker.call(
        'expenses.create',
        {
          projectId: orgProjectId,
          budgetAllocationId: orgAllocationId,
          tipas: 'tiesiogine',
          suma: '100.00',
          data: '2026-04-01',
        },
        { meta: { user: orgAdmin() } },
      )) as ExpenseDTO;
      const result = await broker.call(
        'expenses.delete',
        { id: created.id },
        { meta: { user: orgAdmin() } },
      );
      expect(result).toEqual({ ok: true });
      await expect(
        broker.call('expenses.get', { id: created.id }, { meta: { user: amAdmin() } }),
      ).rejects.toMatchObject({ code: 404, type: 'EXPENSE_NOT_FOUND' });
    });

    it("10. Delete kitos tenant'o expense → 403 (org_admin)", async () => {
      const amExpense = (await broker.call(
        'expenses.create',
        {
          projectId: amProjectId,
          budgetAllocationId: amDuAllocationId,
          tipas: 'saskaita',
          suma: '500.00',
          data: '2026-03-15',
        },
        { meta: { user: amAdmin() } },
      )) as ExpenseDTO;
      await expect(
        broker.call('expenses.delete', { id: amExpense.id }, { meta: { user: orgAdmin() } }),
      ).rejects.toMatchObject({ code: 403, type: 'FORBIDDEN' });
    });
  });

  describe('update', () => {
    it('11. Update suma + saltinioDalis konsistencija — re-validuoja', async () => {
      const created = (await broker.call(
        'expenses.create',
        {
          projectId: amProjectId,
          budgetAllocationId: amDuAllocationId,
          tipas: 'sutartis',
          suma: '1000.00',
          data: '2026-04-01',
          saltinioDalis: [
            { fundingSourceId: amFundingSourceId, suma: '600.00' },
            { fundingSourceId: amSecondFundingSourceId, suma: '400.00' },
          ],
        },
        { meta: { user: amAdmin() } },
      )) as ExpenseDTO;

      // Bandymas: pakeičiam tik sumą į 1500, bet saltinioDalis lieka 1000 → 400
      await expect(
        broker.call(
          'expenses.update',
          { id: created.id, suma: '1500.00' },
          { meta: { user: amAdmin() } },
        ),
      ).rejects.toMatchObject({
        code: 400,
        type: 'SOURCE_DISTRIBUTION_MISMATCH',
      });

      // Konsistentiškas update: keičiam ir sumą, ir paskirstymą
      const updated = (await broker.call(
        'expenses.update',
        {
          id: created.id,
          suma: '1500.00',
          saltinioDalis: [
            { fundingSourceId: amFundingSourceId, suma: '900.00' },
            { fundingSourceId: amSecondFundingSourceId, suma: '600.00' },
          ],
        },
        { meta: { user: amAdmin() } },
      )) as ExpenseDTO;
      expect(updated.suma).toBe('1500.00');
      expect(updated.saltinioDalis).toHaveLength(2);
      expect(updated.saltinioDalis![0]!.suma).toBe('900.00');
    });

    it('Update saltinioDalis → null — single source pasidaro', async () => {
      const created = (await broker.call(
        'expenses.create',
        {
          projectId: amProjectId,
          budgetAllocationId: amDuAllocationId,
          tipas: 'sutartis',
          suma: '1000.00',
          data: '2026-04-01',
          saltinioDalis: [
            { fundingSourceId: amFundingSourceId, suma: '600.00' },
            { fundingSourceId: amSecondFundingSourceId, suma: '400.00' },
          ],
        },
        { meta: { user: amAdmin() } },
      )) as ExpenseDTO;
      const updated = (await broker.call(
        'expenses.update',
        { id: created.id, saltinioDalis: null },
        { meta: { user: amAdmin() } },
      )) as ExpenseDTO;
      expect(updated.saltinioDalis).toBeNull();
    });
  });

  describe('UAT #41 PR-001 — write access = projekto vadovas', () => {
    // Projektas, kurio vadovas yra org 'user' rolė (ne admin) — atspindi
    // realų modelį: specialistas veda išlaidas, administratorius read-only.
    async function createUserLedProject(): Promise<number> {
      const proj = (await broker.call(
        'projects.create',
        {
          tenantId: org.orgTenantId,
          budgetAllocationId: orgAllocationId,
          pavadinimas: 'AAD vadovo projektas 2026',
          tipas: 'projektas',
          biudzetas: '40000.00',
          pradziosData: '2026-01-01',
          pabaigosData: '2026-12-31',
          atsakingasUserId: org.orgUserId,
        },
        { meta: { user: amAdmin() } },
      )) as ProjectDTO;
      return proj.id;
    }

    it('Vadovas (orgUser) gali vesti išlaidą savo projekte', async () => {
      const projectId = await createUserLedProject();
      const created = (await broker.call(
        'expenses.create',
        {
          projectId,
          budgetAllocationId: orgAllocationId,
          tipas: 'tiesiogine',
          suma: '120.00',
          data: '2026-05-01',
        },
        { meta: { user: orgUser() } },
      )) as ExpenseDTO;
      expect(created.projectId).toBe(projectId);
      expect(created.createdByUserId).toBe(org.orgUserId);
    });

    it('Org admin (ne vadovas) → 403 read-only', async () => {
      const projectId = await createUserLedProject();
      await expect(
        broker.call(
          'expenses.create',
          {
            projectId,
            budgetAllocationId: orgAllocationId,
            tipas: 'tiesiogine',
            suma: '120.00',
            data: '2026-05-01',
          },
          { meta: { user: orgAdmin() } },
        ),
      ).rejects.toMatchObject({ code: 403, type: 'FORBIDDEN' });
    });

    it('AM admin (ne vadovas) → 403 read-only', async () => {
      const projectId = await createUserLedProject();
      await expect(
        broker.call(
          'expenses.create',
          {
            projectId,
            budgetAllocationId: orgAllocationId,
            tipas: 'tiesiogine',
            suma: '120.00',
            data: '2026-05-01',
          },
          { meta: { user: amAdmin() } },
        ),
      ).rejects.toMatchObject({ code: 403, type: 'FORBIDDEN' });
    });

    it('Vadovas negali kurti DU tipo išlaidos rankiniu būdu → 403', async () => {
      const projectId = await createUserLedProject();
      await expect(
        broker.call(
          'expenses.create',
          {
            projectId,
            budgetAllocationId: orgAllocationId,
            tipas: 'du',
            suma: '120.00',
            data: '2026-05-01',
          },
          { meta: { user: orgUser() } },
        ),
      ).rejects.toMatchObject({ code: 403, type: 'DU_EXPENSE_FORBIDDEN' });
    });

    it('DU sistemos projekte rankinis išlaidų vedimas draudžiamas → 403', async () => {
      // is_du_system projektas — sukuriam tiesiogiai (projects.create jo nestato).
      const knex = getTestKnex();
      const [duProject] = (await knex('projects')
        .insert({
          tenant_id: org.orgTenantId,
          budget_allocation_id: orgAllocationId,
          request_id: null,
          pavadinimas: 'AAD DU sistema 2026',
          tipas: 'projektas',
          biudzetas: '10000.00',
          statusas: 'vykdoma',
          atsakingas_user_id: org.orgUserId,
          is_du_system: true,
        })
        .returning(['id'])) as Array<{ id: number }>;
      await expect(
        broker.call(
          'expenses.create',
          {
            projectId: duProject!.id,
            budgetAllocationId: orgAllocationId,
            tipas: 'tiesiogine',
            suma: '120.00',
            data: '2026-05-01',
          },
          { meta: { user: orgUser() } },
        ),
      ).rejects.toMatchObject({ code: 403, type: 'DU_PROJECT_READONLY' });
    });
  });

  // Avoid unused variable warnings
  void orgFundingSourceId;
});
