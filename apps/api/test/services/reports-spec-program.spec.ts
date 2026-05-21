/**
 * reports.specProgramExecution integration tests (Iter 14, FVM-6).
 *
 * Test'ai (4+):
 *  1. Approved spec.programa request → įtraukiamas
 *  2. Submitted request → neįtraukiamas (tik APPROVED)
 *  3. Non-spec_programa request (du, prekes_paslaugos, ...) → neįtraukiamas
 *  4. Project su expenses → `panaudota` teisinga; project statusas užfiksuotas
 *  5. xlsx + pdf export
 *  6. Tenant scope: org_admin tik savo tenant
 */
import type { ServiceBroker } from 'moleculer';
import type {
  BudgetAllocation as BudgetAllocationDTO,
  FundingSource as FundingSourceDTO,
  SpecProgramReport,
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

describe('reports.specProgramExecution (Iter 14)', () => {
  let broker: ServiceBroker;
  let base: BaseFixtures;
  let org: OrgTenantFixtures;
  let cls: FvmClassifierFixtures;

  beforeAll(async () => {
    broker = await createTestBroker();
  });

  afterAll(async () => {
    if (broker) await broker.stop();
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

  /**
   * Sukuria spec.programos allocation + APPROVED prašymą + sukuria FVM
   * projektą + įdeda expense (`panaudota` testavimui).
   */
  async function seedFullSpecProgramScenario(opts: {
    requestStatus?: 'DRAFT' | 'SUBMITTED' | 'APPROVED' | 'REJECTED';
    skipExpense?: boolean;
    skipProject?: boolean;
  } = {}): Promise<{
    fs: FundingSourceDTO;
    specAlloc: BudgetAllocationDTO;
    requestId: number;
    projectId?: number;
  }> {
    const fs = (await broker.call(
      'fundingSources.create',
      {
        tenantId: org.orgTenantId,
        pavadinimas: 'Org VB 2026',
        kodas: 'ORG-VB-2026',
        tipasClassifierItemId: cls.fundingSourceTypeItemIds.biudzetas,
        metai: 2026,
        metineSuma: '500000.00',
      },
      { meta: { user: amAdmin() } },
    )) as FundingSourceDTO;

    const specAlloc = (await broker.call(
      'budgetAllocations.create',
      {
        fundingSourceId: fs.id,
        categoryClassifierItemId: cls.budgetCategoryItemIds.spec_programa,
        pavadinimas: 'Org Spec.Programa 2026',
        specProgTipas: 'atskiras',
        planuotaSuma: '100000.00',
        metai: 2026,
      },
      { meta: { user: amAdmin() } },
    )) as BudgetAllocationDTO;

    // Sukuriam DRAFT prašymą per knex (tenant + ai sukurta direct DB level,
    // kad išvengtume API rate-limit'ų / validacijos kaltavimo).
    const knex = getTestKnex();
    const inserted = (await knex('requests')
      .insert({
        tenant_id: org.orgTenantId,
        created_by_user_id: org.orgAdminUserId,
        status: opts.requestStatus ?? 'APPROVED',
        year: 2026,
        project_name: 'Saugomų teritorijų priežiūra',
        system_code: null,
        project_type: null,
        description: 'Spec. programa',
        planned_works: null,
        priority: null,
        procurement_stage: null,
        cost_du: '30000.00',
        cost_equipment: '5000.00',
        cost_creation: '0.00',
        cost_analysis: '5000.00',
        cost_development: '0.00',
        cost_maintenance: '0.00',
        cost_modernization: '0.00',
        cost_decommissioning: '0.00',
        funding_from_it: '0.00',
        other_funds: '0.00',
        other_funds_source: null,
        q1_amount: '10000.00',
        q2_amount: '10000.00',
        q3_amount: '10000.00',
        q4_amount: '10000.00',
        responsible_institution: null,
        executor_name: null,
        executor_email: null,
        implementation_deadline: null,
        submitter_notes: null,
        decision_granted_amount:
          (opts.requestStatus ?? 'APPROVED') === 'APPROVED'
            ? '35000.00'
            : null,
        decision_funding_source: null,
        decision_protocol: null,
        decision_order: null,
        decided_at:
          (opts.requestStatus ?? 'APPROVED') === 'APPROVED'
            ? '2026-04-01T10:00:00Z'
            : null,
        decided_by_user_id:
          (opts.requestStatus ?? 'APPROVED') === 'APPROVED'
            ? base.amAdminUserId
            : null,
        budget_category_id: cls.budgetCategoryItemIds.spec_programa,
        funding_source_type_id: cls.fundingSourceTypeItemIds.biudzetas,
        spec_program_funding_type: 'atskiras',
        fvm_project_id: null,
        submitted_at: null,
      })
      .returning('id')) as Array<{ id: number }>;
    const requestId = inserted[0]!.id;

    let projectId: number | undefined;
    if (
      (opts.requestStatus ?? 'APPROVED') === 'APPROVED' &&
      !opts.skipProject
    ) {
      // Sukuriam FVM projektą su request_id susiejimu.
      // Per knex tiesiai — `requests.createFvmProject` reikalauja AM admin
      // ir prašymo per scope, kuriam reikia ilgesnio set'up'o. Vietoj to
      // tiesiai patch'inam `fvm_project_id`.
      const projRows = (await knex('projects')
        .insert({
          tenant_id: org.orgTenantId,
          budget_allocation_id: specAlloc.id,
          request_id: requestId,
          pavadinimas: 'Spec. programa: Saugomų teritorijų priežiūra',
          tipas: 'spec_programa',
          biudzetas: '35000.00',
          pradzios_data: null,
          pabaigos_data: null,
          statusas: 'vykdoma',
          atsakingas_user_id: org.orgAdminUserId,
          aprasymas: null,
          is_du_system: false,
        })
        .returning('id')) as Array<{ id: number }>;
      projectId = projRows[0]!.id;
      await knex('requests')
        .where({ id: requestId })
        .update({ fvm_project_id: projectId });

      if (!opts.skipExpense) {
        // Įdedam 1 expense su `panaudota`=10000
        await knex('expenses').insert({
          project_id: projectId,
          budget_allocation_id: specAlloc.id,
          tipas: 'saskaita',
          suma: '10000.00',
          data: '2026-05-15',
          aprasymas: 'Sąskaita 12345',
          saltinio_dalis: null,
          payroll_profile_id: null,
          created_by_user_id: org.orgAdminUserId,
        });
      }
    }

    return projectId !== undefined
      ? { fs, specAlloc, requestId, projectId }
      : { fs, specAlloc, requestId };
  }

  beforeEach(async () => {
    const knex = getTestKnex();
    await truncateAll(knex);
    base = await seedBaseFixtures(knex);
    org = await seedOrgTenant(knex);
    cls = await seedFvmClassifiers(knex);
  });

  // ---- Test 1 ----
  it('1. Approved spec.programa request → įtraukiamas su prasyta/patvirtinta/panaudota', async () => {
    const ctx = await seedFullSpecProgramScenario({
      requestStatus: 'APPROVED',
    });

    const resp = (await broker.call(
      'reports.specProgramExecution',
      { year: 2026 },
      { meta: { user: amAdmin() } },
    )) as SpecProgramReport;

    expect(resp.items).toHaveLength(1);
    const item = resp.items[0]!;
    expect(item.requestId).toBe(ctx.requestId);
    // prasyta = 30000 (DU) + 5000 (equipment) + 5000 (analysis) = 40000
    expect(Number.parseFloat(item.prasyta)).toBeCloseTo(40000, 2);
    expect(item.patvirtinta).toBe('35000.00');
    expect(item.panaudota).toBe('10000.00');
    expect(item.likutis).toBe('25000.00');
    expect(item.budgetCategoryCode).toBe('spec_programa');
    expect(item.specProgramFundingType).toBe('atskiras');
    expect(item.projektoId).toBe(ctx.projectId);
    expect(item.projektoStatusas).toBe('vykdoma');

    // Total agregacijos
    expect(resp.totalPatvirtinta).toBe('35000.00');
    expect(resp.totalPanaudota).toBe('10000.00');
  });

  // ---- Test 2 ----
  it('2. Submitted request (ne APPROVED) → NEįtraukiamas', async () => {
    await seedFullSpecProgramScenario({ requestStatus: 'SUBMITTED' });
    const resp = (await broker.call(
      'reports.specProgramExecution',
      { year: 2026 },
      { meta: { user: amAdmin() } },
    )) as SpecProgramReport;
    expect(resp.items).toHaveLength(0);
  });

  // ---- Test 3 ----
  it('3. Non-spec_programa request → NEįtraukiamas', async () => {
    // Sukuriam APPROVED prašymą, bet su DU budget_category (ne spec.programa)
    const knex = getTestKnex();
    await knex('requests').insert({
      tenant_id: org.orgTenantId,
      created_by_user_id: org.orgAdminUserId,
      status: 'APPROVED',
      year: 2026,
      project_name: 'Atlyginimų DU prašymas',
      cost_du: '50000.00',
      cost_equipment: '0.00',
      cost_creation: '0.00',
      cost_analysis: '0.00',
      cost_development: '0.00',
      cost_maintenance: '0.00',
      cost_modernization: '0.00',
      cost_decommissioning: '0.00',
      funding_from_it: '0.00',
      other_funds: '0.00',
      q1_amount: '12500.00',
      q2_amount: '12500.00',
      q3_amount: '12500.00',
      q4_amount: '12500.00',
      decision_granted_amount: '50000.00',
      decided_at: '2026-04-01T10:00:00Z',
      decided_by_user_id: base.amAdminUserId,
      budget_category_id: cls.budgetCategoryItemIds.du,
      funding_source_type_id: cls.fundingSourceTypeItemIds.biudzetas,
      spec_program_funding_type: null,
      fvm_project_id: null,
    });

    const resp = (await broker.call(
      'reports.specProgramExecution',
      { year: 2026 },
      { meta: { user: amAdmin() } },
    )) as SpecProgramReport;
    expect(resp.items).toHaveLength(0);
  });

  // ---- Test 4 ----
  it('4. xlsx + pdf format'+'as grąžina binary buffer', async () => {
    await seedFullSpecProgramScenario({ requestStatus: 'APPROVED' });

    const xlsxResult = (await broker.call(
      'reports.specProgramExecution',
      { year: 2026, format: 'xlsx' },
      { meta: { user: amAdmin() } },
    )) as Buffer;
    expect(Buffer.isBuffer(xlsxResult)).toBe(true);
    expect(xlsxResult.subarray(0, 2).toString('ascii')).toBe('PK');

    const pdfResult = (await broker.call(
      'reports.specProgramExecution',
      { year: 2026, format: 'pdf' },
      { meta: { user: amAdmin() } },
    )) as Buffer;
    expect(Buffer.isBuffer(pdfResult)).toBe(true);
    expect(pdfResult.subarray(0, 4).toString('ascii')).toBe('%PDF');
  });

  // ---- Test 5 ----
  it('5. Tenant scope: org_admin gauna tik savo tenant — kitos tenant 403', async () => {
    await seedFullSpecProgramScenario({ requestStatus: 'APPROVED' });

    // Org admin'ui — savo tenant ataskaita matoma
    const resp = (await broker.call(
      'reports.specProgramExecution',
      { year: 2026 },
      { meta: { user: orgAdmin() } },
    )) as SpecProgramReport;
    expect(resp.items).toHaveLength(1);
    expect(resp.items[0]!.tenantId).toBe(org.orgTenantId);

    // Su kitos tenant tenantId → 403
    await expect(
      broker.call(
        'reports.specProgramExecution',
        { year: 2026, tenantId: base.amTenantId },
        { meta: { user: orgAdmin() } },
      ),
    ).rejects.toMatchObject({ code: 403 });
  });
});
