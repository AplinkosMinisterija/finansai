/**
 * AI katalogo INSTITUCIJOS PJŪVIO (tenantId slice) testai — korektiškumas + ADR-005.
 *
 * Patikrina, kad `spec.tenantId` per /ai/hydrate:
 *  1. AM admin gali pjauti į bet kurią instituciją → mato TOS institucijos skaičius;
 *  2. be pjūvio — suminius (visų matomų);
 *  3. SAUGUMAS: org vartotojas, bandantis pjauti į SVETIMĄ instituciją, NEGAUNA
 *     jos duomenų (intersect su scope → tuščia / 403 prarytas → „—"); jokio leak.
 *
 * Du tenant'ai (A = seedOrgTenant org, B = naujas) su skirtingais skaičiais.
 */
import type { ServiceBroker } from 'moleculer';
import type {
  AiDashboardSpec,
  AiHydrateResponse,
  AiWidget,
  BudgetAllocation as BudgetAllocationDTO,
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

function parseEur(value: string | undefined): number {
  return Number((value ?? '').replace(/[^\d]/g, ''));
}

describe('AI katalogas — institucijos pjūvis (tenantId slice) + ADR-005', () => {
  let broker: ServiceBroker;
  let base: BaseFixtures;
  let org: OrgTenantFixtures; // tenant A
  let cls: FvmClassifierFixtures;
  let tenantBId: number;

  beforeAll(async () => {
    broker = await createTestBroker();
  });
  afterAll(async () => {
    if (broker) await broker.stop();
    await closeTestKnex();
  });

  const amAdmin = () =>
    mockAuthUser({
      id: base.amAdminUserId,
      tenantId: base.amTenantId,
      tenantIsApprover: true,
      role: 'admin',
    });
  const orgAadmin = () => mockOrgAdmin({ id: org.orgAdminUserId, tenantId: org.orgTenantId });

  beforeEach(async () => {
    const knex = getTestKnex();
    await truncateAll(knex);
    base = await seedBaseFixtures(knex);
    org = await seedOrgTenant(knex);
    cls = await seedFvmClassifiers(knex);

    // Tenant B — atskira institucija.
    const inserted = (await knex('tenants')
      .insert({ code: 'RCB', name: 'RC institucija B', is_approver: false, active: true })
      .returning('id')) as Array<{ id: number }>;
    tenantBId = inserted[0]!.id;

    // FVM duomenys abiem tenant'ams (kuria AM admin).
    // A: planuota 100k, faktinė 30k (išlaidą veda projekto vadovas = org A admin),
    //    1 prašymas (prašyta 40k).
    // B: planuota 80k, faktinė 0 (be išlaidų — B neturi savo vartotojo testui),
    //    1 prašymas (prašyta 12k).
    await seedTenantFvm(org.orgTenantId, 'A', '100000.00', {
      suma: '30000.00',
      atsakingasUserId: org.orgAdminUserId,
    });
    await seedTenantFvm(tenantBId, 'B', '80000.00');

    const reqBase = {
      created_by_user_id: base.amAdminUserId,
      year: 2026,
      status: 'SUBMITTED',
      system_code: null,
      project_type: null,
      description: 'slice',
      planned_works: null,
      priority: null,
      procurement_stage: null,
      cost_du: '0.00',
      cost_creation: '0.00',
      cost_analysis: '0.00',
      cost_development: '0.00',
      cost_maintenance: '0.00',
      cost_modernization: '0.00',
      cost_decommissioning: '0.00',
      funding_from_it: '0.00',
      other_funds: '0.00',
      other_funds_source: null,
      q1_amount: '0.00',
      q2_amount: '0.00',
      q3_amount: '0.00',
      q4_amount: '0.00',
      responsible_institution: null,
      executor_name: null,
      executor_email: null,
      implementation_deadline: null,
      submitter_notes: null,
      decision_granted_amount: null,
      decision_funding_source: null,
      decision_protocol: null,
      decision_order: null,
      decided_at: null,
      decided_by_user_id: null,
      budget_category_id: null,
      funding_source_type_id: null,
      spec_program_funding_type: null,
      fvm_project_id: null,
      submitted_at: '2026-02-01T10:00:00Z',
    };
    await knex('requests').insert({
      ...reqBase,
      tenant_id: org.orgTenantId,
      project_name: 'A req',
      cost_equipment: '40000.00',
    });
    await knex('requests').insert({
      ...reqBase,
      tenant_id: tenantBId,
      project_name: 'B req',
      cost_equipment: '12000.00',
    });
  });

  async function seedTenantFvm(
    tenantId: number,
    tag: string,
    planuota: string,
    expense?: { suma: string; atsakingasUserId: number },
  ): Promise<void> {
    const fs = (await broker.call(
      'fundingSources.create',
      {
        tenantId,
        pavadinimas: `VB ${tag}`,
        kodas: `SLICE-VB-${tag}`,
        tipasClassifierItemId: cls.fundingSourceTypeItemIds.biudzetas,
        metai: 2026,
        metineSuma: '500000.00',
      },
      { meta: { user: amAdmin() } },
    )) as FundingSourceDTO;
    const alloc = (await broker.call(
      'budgetAllocations.create',
      {
        fundingSourceId: fs.id,
        categoryClassifierItemId: cls.budgetCategoryItemIds.prekes_paslaugos,
        pavadinimas: `PP ${tag}`,
        planuotaSuma: planuota,
        metai: 2026,
      },
      { meta: { user: amAdmin() } },
    )) as BudgetAllocationDTO;
    const project = (await broker.call(
      'projects.create',
      {
        tenantId,
        budgetAllocationId: alloc.id,
        ...(expense ? { atsakingasUserId: expense.atsakingasUserId } : {}),
        pavadinimas: `Projektas ${tag}`,
        tipas: 'projektas',
        biudzetas: planuota,
      },
      { meta: { user: amAdmin() } },
    )) as ProjectDTO;
    if (expense) {
      // Išlaidą veda projekto vadovas (atsakingas asmuo).
      await broker.call(
        'expenses.create',
        {
          projectId: project.id,
          budgetAllocationId: alloc.id,
          tipas: 'saskaita',
          suma: expense.suma,
          data: '2026-03-10',
        },
        { meta: { user: orgAadmin() } },
      );
    }
  }

  async function hydrate(
    user: ReturnType<typeof amAdmin>,
    tenantId: number | undefined,
  ): Promise<Record<string, AiWidget>> {
    const spec: AiDashboardSpec = {
      year: 2026,
      ...(tenantId !== undefined ? { tenantId } : {}),
      widgets: [
        { id: 'planuota', type: 'stat', dataRef: { source: 'metric', params: { metric: 'biudzetas_planuota' } } },
        { id: 'faktine', type: 'stat', dataRef: { source: 'metric', params: { metric: 'islaidos_faktine' } } },
        { id: 'count', type: 'stat', dataRef: { source: 'metric', params: { metric: 'prasymu_skaicius' } } },
        { id: 'prasyta', type: 'stat', dataRef: { source: 'metric', params: { metric: 'prasyta_suma' } } },
      ],
    };
    const resp = (await broker.call('ai.hydrate', { spec, year: 2026 }, { meta: { user } })) as AiHydrateResponse;
    const out: Record<string, AiWidget> = {};
    for (const w of resp.spec.widgets) out[w.id] = w;
    return out;
  }

  it('AM admin pjauna į A → mato TIK A skaičius', async () => {
    const w = await hydrate(amAdmin(), org.orgTenantId);
    expect(parseEur(w.planuota!.value)).toBe(100000);
    expect(parseEur(w.faktine!.value)).toBe(30000);
    expect(w.count!.value).toBe('1');
    expect(parseEur(w.prasyta!.value)).toBe(40000);
  });

  it('AM admin pjauna į B → mato TIK B skaičius', async () => {
    const w = await hydrate(amAdmin(), tenantBId);
    expect(parseEur(w.planuota!.value)).toBe(80000);
    expect(parseEur(w.faktine!.value)).toBe(0); // B be išlaidų
    expect(w.count!.value).toBe('1');
    expect(parseEur(w.prasyta!.value)).toBe(12000);
  });

  it('AM admin be pjūvio → suminiai (A+B)', async () => {
    const w = await hydrate(amAdmin(), undefined);
    expect(parseEur(w.planuota!.value)).toBe(180000);
    expect(parseEur(w.faktine!.value)).toBe(30000); // tik A turi išlaidų
    expect(w.count!.value).toBe('2');
    expect(parseEur(w.prasyta!.value)).toBe(52000);
  });

  it('org A admin be pjūvio → mato TIK savo (A) pagal scope', async () => {
    const w = await hydrate(orgAadmin(), undefined);
    expect(parseEur(w.planuota!.value)).toBe(100000);
    expect(parseEur(w.faktine!.value)).toBe(30000);
    expect(w.count!.value).toBe('1');
  });

  it('SAUGUMAS: org A admin pjūvis į SVETIMĄ B → numetamas, rodoma SAVO (A); B NESIMATO', async () => {
    // tenantId B nepasiekiamas org A → /ai/hydrate sanitizuoja (canAccessTenant=false
    // → numeta pjūvį) → rodoma A pagal scope. Esmė: B duomenys (80k/12k) NIEKADA
    // nepasimato; sugadintas pjūvis grakščiai krenta į savo scope, ne į fantomą.
    const w = await hydrate(orgAadmin(), tenantBId);
    expect(parseEur(w.planuota!.value)).toBe(100000); // A (ne B=80000, ne 0)
    expect(parseEur(w.faktine!.value)).toBe(30000);
    expect(w.count!.value).toBe('1'); // tik A prašymas (ne B)
    expect(parseEur(w.prasyta!.value)).toBe(40000); // A (ne B=12000)
  });
});
