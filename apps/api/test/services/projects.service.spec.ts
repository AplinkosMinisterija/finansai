/**
 * Projects service integration tests (Iter 11, FVM-3).
 *
 * Test scope:
 *   1. AM admin gali create projektą (tipas=projektas) be request_id
 *   2. AM admin gali create spec_programa su valid request_id (APPROVED)
 *   3. Spec_programa be request_id → 400
 *   4. Spec_programa su SUBMITTED request_id → 400
 *   5. Org admin gali create savo tenant'e
 *   6. Org admin negali create kitos tenant'e — 403
 *   7. Org user (ne admin) negali create — 403
 *   8. AM admin gali list visus; Org admin mato tik savo tenant
 *   9. changeStatus: planuojama → vykdoma — sėkmingai (org_admin)
 *   10. changeStatus: baigta → uzdaryta — tik AM admin (org_admin → 403)
 *   11. changeStatus: vykdoma → planuojama (reverse) — tik AM admin
 *   12. delete: status=vykdoma → 409 RESTRICT
 *   13. summary endpoint grąžina teisingus skaičius (panaudota=0 kol nėra expenses)
 *   14. budget_allocation iš kitos tenant'o → 400
 *
 * Pastaba: spec_programa kūrimui paprastai turėtų būti per `requests.createFvmProject`
 * action'ą, bet projects.service'e tiesioginio create endpoint'as taip pat
 * leidžia su valid request_id — kad būtų galima tipinę spec_programa kurti
 * tiesiogiai (pvz. iš migracijos / data fixture'o).
 */
import type { ServiceBroker } from 'moleculer';
import type {
  BudgetAllocation as BudgetAllocationDTO,
  FundingSource as FundingSourceDTO,
  Project as ProjectDTO,
  ProjectSummary,
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

describe('projects service (Iter 11)', () => {
  let broker: ServiceBroker;
  let base: BaseFixtures;
  let org: OrgTenantFixtures;
  let cls: FvmClassifierFixtures;
  /** AM tenant funding source / allocation (kategorija = projektas / du). */
  let amDuAllocationId: number;
  /** Org tenant funding source / allocation (kategorija = projektas). */
  let orgProjektasAllocationId: number;
  let orgSpecProgAllocationId: number;
  let orgFundingSourceId: number;
  /** APPROVED spec.programos prašymas org tenant'e (be projekto). */
  let orgApprovedSpecRequestId: number;
  /** SUBMITTED prašymas org tenant'e (be projekto). */
  let orgSubmittedRequestId: number;

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

    // AM tenant funding source + DU allocation
    const amFs = (await broker.call(
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

    const amDuAlloc = (await broker.call(
      'budgetAllocations.create',
      {
        fundingSourceId: amFs.id,
        categoryClassifierItemId: cls.budgetCategoryItemIds.du,
        pavadinimas: 'AM DU 2026',
        planuotaSuma: '500000.00',
        metai: 2026,
      },
      { meta: { user: amAdmin() } },
    )) as BudgetAllocationDTO;
    amDuAllocationId = amDuAlloc.id;

    // Org tenant funding source + allocations (projektas + spec_programa)
    const orgFs = (await broker.call(
      'fundingSources.create',
      {
        tenantId: org.orgTenantId,
        pavadinimas: 'AAD biudžetas 2026',
        kodas: 'AAD-VB-2026',
        tipasClassifierItemId: cls.fundingSourceTypeItemIds.biudzetas,
        metai: 2026,
        metineSuma: '800000.00',
      },
      { meta: { user: amAdmin() } },
    )) as FundingSourceDTO;
    orgFundingSourceId = orgFs.id;

    const orgPpAlloc = (await broker.call(
      'budgetAllocations.create',
      {
        fundingSourceId: orgFs.id,
        categoryClassifierItemId: cls.budgetCategoryItemIds.prekes_paslaugos,
        pavadinimas: 'AAD prekes/paslaugos 2026',
        planuotaSuma: '300000.00',
        metai: 2026,
      },
      { meta: { user: amAdmin() } },
    )) as BudgetAllocationDTO;
    orgProjektasAllocationId = orgPpAlloc.id;

    const orgSpecAlloc = (await broker.call(
      'budgetAllocations.create',
      {
        fundingSourceId: orgFs.id,
        categoryClassifierItemId: cls.budgetCategoryItemIds.spec_programa,
        pavadinimas: 'AAD spec.programa: Saugomos teritorijos',
        specProgTipas: 'atskiras',
        planuotaSuma: '200000.00',
        metai: 2026,
      },
      { meta: { user: amAdmin() } },
    )) as BudgetAllocationDTO;
    orgSpecProgAllocationId = orgSpecAlloc.id;

    // APPROVED spec.programos prašymas org tenant'e (direct DB insert,
    // kad nelįstume per visą wizard'ą).
    const insertedReq = (await knex('requests')
      .insert({
        tenant_id: org.orgTenantId,
        created_by_user_id: org.orgAdminUserId,
        status: 'APPROVED',
        project_name: 'AAD saugomų teritorijų programa',
        year: 2026,
        decision_granted_amount: '120000.00',
        budget_category_id: cls.budgetCategoryItemIds.spec_programa,
        spec_program_funding_type: 'atskiras',
      })
      .returning('id')) as Array<{ id: number }>;
    orgApprovedSpecRequestId = insertedReq[0]!.id;

    const insertedSub = (await knex('requests')
      .insert({
        tenant_id: org.orgTenantId,
        created_by_user_id: org.orgAdminUserId,
        status: 'SUBMITTED',
        project_name: 'AAD submitted spec.programa',
        year: 2026,
        budget_category_id: cls.budgetCategoryItemIds.spec_programa,
      })
      .returning('id')) as Array<{ id: number }>;
    orgSubmittedRequestId = insertedSub[0]!.id;
  });

  describe('create', () => {
    it('AM admin gali create projektą (tipas=projektas) be request_id', async () => {
      const created = (await broker.call(
        'projects.create',
        {
          tenantId: org.orgTenantId,
          budgetAllocationId: orgProjektasAllocationId,
          pavadinimas: 'IT modernizavimas 2026',
          tipas: 'projektas',
          biudzetas: '50000.00',
          pradziosData: '2026-01-01',
          pabaigosData: '2026-12-31',
          aprasymas: 'Naujas IT projektas',
        },
        { meta: { user: amAdmin() } },
      )) as ProjectDTO;
      expect(created.id).toBeGreaterThan(0);
      expect(created.tenantId).toBe(org.orgTenantId);
      expect(created.tipas).toBe('projektas');
      expect(created.requestId).toBeNull();
      expect(created.biudzetas).toBe('50000.00');
      expect(created.statusas).toBe('planuojama');
      expect(created.pavadinimas).toBe('IT modernizavimas 2026');
    });

    it('AM admin gali create spec_programa su valid request_id (APPROVED)', async () => {
      const created = (await broker.call(
        'projects.create',
        {
          tenantId: org.orgTenantId,
          budgetAllocationId: orgSpecProgAllocationId,
          requestId: orgApprovedSpecRequestId,
          pavadinimas: 'Spec.programa: saugomos teritorijos',
          tipas: 'spec_programa',
          biudzetas: '120000.00',
        },
        { meta: { user: amAdmin() } },
      )) as ProjectDTO;
      expect(created.tipas).toBe('spec_programa');
      expect(created.requestId).toBe(orgApprovedSpecRequestId);

      // Po sukūrimo — request.fvmProjectId turi būti užpildytas.
      const requestRow = (await getTestKnex()('requests')
        .where({ id: orgApprovedSpecRequestId })
        .first<{ fvm_project_id: number | null }>()) as
        | { fvm_project_id: number | null }
        | undefined;
      expect(requestRow?.fvm_project_id).toBe(created.id);
    });

    it('Spec_programa be request_id → 400 SPEC_PROGRAMA_REQUEST_REQUIRED', async () => {
      await expect(
        broker.call(
          'projects.create',
          {
            tenantId: org.orgTenantId,
            budgetAllocationId: orgSpecProgAllocationId,
            pavadinimas: 'Spec.programa be request',
            tipas: 'spec_programa',
            biudzetas: '50000.00',
          },
          { meta: { user: amAdmin() } },
        ),
      ).rejects.toMatchObject({
        code: 400,
        type: 'SPEC_PROGRAMA_REQUEST_REQUIRED',
      });
    });

    it('Spec_programa su SUBMITTED request_id → 400 REQUEST_NOT_APPROVED', async () => {
      await expect(
        broker.call(
          'projects.create',
          {
            tenantId: org.orgTenantId,
            budgetAllocationId: orgSpecProgAllocationId,
            requestId: orgSubmittedRequestId,
            pavadinimas: 'Bandymas SUBMITTED request',
            tipas: 'spec_programa',
            biudzetas: '50000.00',
          },
          { meta: { user: amAdmin() } },
        ),
      ).rejects.toMatchObject({
        code: 400,
        type: 'REQUEST_NOT_APPROVED',
      });
    });

    it('Org admin gali create savo tenant\'e', async () => {
      const created = (await broker.call(
        'projects.create',
        {
          tenantId: org.orgTenantId,
          budgetAllocationId: orgProjektasAllocationId,
          pavadinimas: 'AAD savas projektas',
          tipas: 'projektas',
          biudzetas: '20000.00',
        },
        { meta: { user: orgAdmin() } },
      )) as ProjectDTO;
      expect(created.tenantId).toBe(org.orgTenantId);
      expect(created.tipas).toBe('projektas');
    });

    it('Org admin negali create kitos tenant\'e — 403', async () => {
      await expect(
        broker.call(
          'projects.create',
          {
            tenantId: base.amTenantId,
            budgetAllocationId: amDuAllocationId,
            pavadinimas: 'Hackeris bando AM',
            tipas: 'projektas',
            biudzetas: '10000.00',
          },
          { meta: { user: orgAdmin() } },
        ),
      ).rejects.toMatchObject({ code: 403, type: 'FORBIDDEN' });
    });

    it('Org user (ne admin) negali create — 403', async () => {
      await expect(
        broker.call(
          'projects.create',
          {
            tenantId: org.orgTenantId,
            budgetAllocationId: orgProjektasAllocationId,
            pavadinimas: 'User bando',
            tipas: 'projektas',
            biudzetas: '5000.00',
          },
          { meta: { user: orgUser() } },
        ),
      ).rejects.toMatchObject({ code: 403, type: 'FORBIDDEN' });
    });

    it('budget_allocation iš kitos tenant\'o → 400 ALLOCATION_TENANT_MISMATCH', async () => {
      // amDuAllocationId priklauso AM tenant'ui per funding_source.
      // Bandom panaudoti org projekto kūrimui.
      await expect(
        broker.call(
          'projects.create',
          {
            tenantId: org.orgTenantId,
            budgetAllocationId: amDuAllocationId,
            pavadinimas: 'Cross-tenant allocation',
            tipas: 'projektas',
            biudzetas: '10000.00',
          },
          { meta: { user: amAdmin() } },
        ),
      ).rejects.toMatchObject({
        code: 400,
        type: 'ALLOCATION_TENANT_MISMATCH',
      });
    });

    it('biudzetas <= 0 → 400 INVALID_AMOUNT', async () => {
      await expect(
        broker.call(
          'projects.create',
          {
            tenantId: org.orgTenantId,
            budgetAllocationId: orgProjektasAllocationId,
            pavadinimas: 'Zero budget',
            tipas: 'projektas',
            biudzetas: '0',
          },
          { meta: { user: amAdmin() } },
        ),
      ).rejects.toMatchObject({ code: 400, type: 'INVALID_AMOUNT' });
    });

    it('pradzia > pabaiga → 400 INVALID_DATE_RANGE', async () => {
      await expect(
        broker.call(
          'projects.create',
          {
            tenantId: org.orgTenantId,
            budgetAllocationId: orgProjektasAllocationId,
            pavadinimas: 'Bad dates',
            tipas: 'projektas',
            biudzetas: '10000.00',
            pradziosData: '2026-12-31',
            pabaigosData: '2026-01-01',
          },
          { meta: { user: amAdmin() } },
        ),
      ).rejects.toMatchObject({ code: 400, type: 'INVALID_DATE_RANGE' });
    });
  });

  describe('list and scope', () => {
    it('AM admin gali list visus; Org admin mato tik savo tenant', async () => {
      // 1 projektas AM tenant'e (per AM allocation), 1 — org tenant'e.
      await broker.call(
        'projects.create',
        {
          tenantId: base.amTenantId,
          budgetAllocationId: amDuAllocationId,
          pavadinimas: 'AM projektas',
          tipas: 'projektas',
          biudzetas: '10000.00',
        },
        { meta: { user: amAdmin() } },
      );
      await broker.call(
        'projects.create',
        {
          tenantId: org.orgTenantId,
          budgetAllocationId: orgProjektasAllocationId,
          pavadinimas: 'Org projektas',
          tipas: 'projektas',
          biudzetas: '20000.00',
        },
        { meta: { user: amAdmin() } },
      );

      const amList = (await broker.call(
        'projects.list',
        {},
        { meta: { user: amAdmin() } },
      )) as ProjectDTO[];
      expect(amList).toHaveLength(2);

      const orgList = (await broker.call(
        'projects.list',
        {},
        { meta: { user: orgAdmin() } },
      )) as ProjectDTO[];
      expect(orgList).toHaveLength(1);
      expect(orgList[0]!.tenantId).toBe(org.orgTenantId);
    });
  });

  describe('changeStatus', () => {
    let projectId: number;

    beforeEach(async () => {
      const created = (await broker.call(
        'projects.create',
        {
          tenantId: org.orgTenantId,
          budgetAllocationId: orgProjektasAllocationId,
          pavadinimas: 'Status flow test',
          tipas: 'projektas',
          biudzetas: '10000.00',
        },
        { meta: { user: amAdmin() } },
      )) as ProjectDTO;
      projectId = created.id;
    });

    it('planuojama → vykdoma — sėkmingai (org_admin)', async () => {
      const updated = (await broker.call(
        'projects.changeStatus',
        { id: projectId, statusas: 'vykdoma' },
        { meta: { user: orgAdmin() } },
      )) as ProjectDTO;
      expect(updated.statusas).toBe('vykdoma');
    });

    it('baigta → uzdaryta — tik AM admin (org_admin → 403)', async () => {
      // Pasiekiam baigta būseną per kelis žingsnius (kaip AM admin, kad
      // turėtume validų scenarijų).
      await broker.call(
        'projects.changeStatus',
        { id: projectId, statusas: 'vykdoma' },
        { meta: { user: amAdmin() } },
      );
      await broker.call(
        'projects.changeStatus',
        { id: projectId, statusas: 'baigta' },
        { meta: { user: amAdmin() } },
      );
      // Dabar org_admin bando uzdaryta — turi 403.
      await expect(
        broker.call(
          'projects.changeStatus',
          { id: projectId, statusas: 'uzdaryta' },
          { meta: { user: orgAdmin() } },
        ),
      ).rejects.toMatchObject({
        code: 403,
        type: 'STATUS_TRANSITION_AM_ONLY',
      });
      // AM admin gali.
      const closed = (await broker.call(
        'projects.changeStatus',
        { id: projectId, statusas: 'uzdaryta' },
        { meta: { user: amAdmin() } },
      )) as ProjectDTO;
      expect(closed.statusas).toBe('uzdaryta');
    });

    it('vykdoma → planuojama (reverse) — tik AM admin', async () => {
      // Pirma — pereinam į vykdoma kaip AM admin.
      await broker.call(
        'projects.changeStatus',
        { id: projectId, statusas: 'vykdoma' },
        { meta: { user: amAdmin() } },
      );
      // Org admin bando reverse — 403.
      await expect(
        broker.call(
          'projects.changeStatus',
          { id: projectId, statusas: 'planuojama' },
          { meta: { user: orgAdmin() } },
        ),
      ).rejects.toMatchObject({
        code: 403,
        type: 'STATUS_REVERSE_FORBIDDEN',
      });
      // AM admin gali.
      const reverted = (await broker.call(
        'projects.changeStatus',
        { id: projectId, statusas: 'planuojama' },
        { meta: { user: amAdmin() } },
      )) as ProjectDTO;
      expect(reverted.statusas).toBe('planuojama');
    });

    it('skipping status (planuojama → baigta) — 400 INVALID_STATUS_TRANSITION', async () => {
      await expect(
        broker.call(
          'projects.changeStatus',
          { id: projectId, statusas: 'baigta' },
          { meta: { user: amAdmin() } },
        ),
      ).rejects.toMatchObject({
        code: 400,
        type: 'INVALID_STATUS_TRANSITION',
      });
    });
  });

  describe('delete', () => {
    it('delete status=planuojama — sėkmingai (AM admin)', async () => {
      const created = (await broker.call(
        'projects.create',
        {
          tenantId: org.orgTenantId,
          budgetAllocationId: orgProjektasAllocationId,
          pavadinimas: 'To delete',
          tipas: 'projektas',
          biudzetas: '5000.00',
        },
        { meta: { user: amAdmin() } },
      )) as ProjectDTO;
      const result = await broker.call(
        'projects.delete',
        { id: created.id },
        { meta: { user: amAdmin() } },
      );
      expect(result).toEqual({ ok: true });
    });

    it('delete status=vykdoma → 409 PROJECT_NOT_DELETABLE', async () => {
      const created = (await broker.call(
        'projects.create',
        {
          tenantId: org.orgTenantId,
          budgetAllocationId: orgProjektasAllocationId,
          pavadinimas: 'Cannot delete',
          tipas: 'projektas',
          biudzetas: '5000.00',
        },
        { meta: { user: amAdmin() } },
      )) as ProjectDTO;
      await broker.call(
        'projects.changeStatus',
        { id: created.id, statusas: 'vykdoma' },
        { meta: { user: amAdmin() } },
      );
      await expect(
        broker.call(
          'projects.delete',
          { id: created.id },
          { meta: { user: amAdmin() } },
        ),
      ).rejects.toMatchObject({ code: 409, type: 'PROJECT_NOT_DELETABLE' });
    });

    it('delete org_admin — 403 (tik AM admin trina)', async () => {
      const created = (await broker.call(
        'projects.create',
        {
          tenantId: org.orgTenantId,
          budgetAllocationId: orgProjektasAllocationId,
          pavadinimas: 'Org admin bandymas',
          tipas: 'projektas',
          biudzetas: '5000.00',
        },
        { meta: { user: amAdmin() } },
      )) as ProjectDTO;
      await expect(
        broker.call(
          'projects.delete',
          { id: created.id },
          { meta: { user: orgAdmin() } },
        ),
      ).rejects.toMatchObject({ code: 403, type: 'FORBIDDEN' });
    });
  });

  describe('summary', () => {
    it('summary grąžina teisingus skaičius (panaudota=0 kol nėra expenses)', async () => {
      const created = (await broker.call(
        'projects.create',
        {
          tenantId: org.orgTenantId,
          budgetAllocationId: orgProjektasAllocationId,
          pavadinimas: 'Summary test',
          tipas: 'projektas',
          biudzetas: '12345.67',
        },
        { meta: { user: amAdmin() } },
      )) as ProjectDTO;
      const summary = (await broker.call(
        'projects.summary',
        { id: created.id },
        { meta: { user: amAdmin() } },
      )) as ProjectSummary;
      expect(summary.biudzetas).toBe('12345.67');
      expect(summary.panaudota).toBe('0.00');
      expect(summary.likutis).toBe('12345.67');
    });

    it('summary neegzistuojančio → 404', async () => {
      await expect(
        broker.call(
          'projects.summary',
          { id: 999_999 },
          { meta: { user: amAdmin() } },
        ),
      ).rejects.toMatchObject({ code: 404, type: 'PROJECT_NOT_FOUND' });
    });
  });

  describe('get (tenant scope)', () => {
    it('Org admin mato savo tenant projektą; kitos — 403', async () => {
      const myProject = (await broker.call(
        'projects.create',
        {
          tenantId: org.orgTenantId,
          budgetAllocationId: orgProjektasAllocationId,
          pavadinimas: 'Org savas',
          tipas: 'projektas',
          biudzetas: '10000.00',
        },
        { meta: { user: amAdmin() } },
      )) as ProjectDTO;
      const otherProject = (await broker.call(
        'projects.create',
        {
          tenantId: base.amTenantId,
          budgetAllocationId: amDuAllocationId,
          pavadinimas: 'AM kito tenant\'o',
          tipas: 'projektas',
          biudzetas: '10000.00',
        },
        { meta: { user: amAdmin() } },
      )) as ProjectDTO;
      const fetched = (await broker.call(
        'projects.get',
        { id: myProject.id },
        { meta: { user: orgAdmin() } },
      )) as ProjectDTO;
      expect(fetched.id).toBe(myProject.id);

      // Kitos tenant — 403.
      await expect(
        broker.call(
          'projects.get',
          { id: otherProject.id },
          { meta: { user: orgAdmin() } },
        ),
      ).rejects.toMatchObject({ code: 403, type: 'FORBIDDEN' });
    });
  });

  describe('update', () => {
    it('Update pavadinimą + biudzetą — sėkmingai (org_admin)', async () => {
      const created = (await broker.call(
        'projects.create',
        {
          tenantId: org.orgTenantId,
          budgetAllocationId: orgProjektasAllocationId,
          pavadinimas: 'Original',
          tipas: 'projektas',
          biudzetas: '10000.00',
        },
        { meta: { user: amAdmin() } },
      )) as ProjectDTO;
      const updated = (await broker.call(
        'projects.update',
        {
          id: created.id,
          pavadinimas: 'Updated',
          biudzetas: '15000.00',
        },
        { meta: { user: orgAdmin() } },
      )) as ProjectDTO;
      expect(updated.pavadinimas).toBe('Updated');
      expect(updated.biudzetas).toBe('15000.00');
      // tipas nepakeičiamas — update neturi tipas param'o
      expect(updated.tipas).toBe('projektas');
    });
  });

  // Avoid unused warnings — keep references for documentation
  void orgFundingSourceId;
});
