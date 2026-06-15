/**
 * AI katalogo KOREKTIŠKUMO / suderinamumo (reconciliation) testai.
 *
 * Tikslas — „skaičiai teisingi VISUR ir VISADA": kontroliuojamas FVM fixture'as
 * su žinomais skaičiais, paleidžiamas per TIKRĄ hidracijos kelią (POST /ai/hydrate
 * → hydrateSpec → katalogo šaltiniai → action'ai su user meta), ir tikrinami:
 *
 *  1. Kanoninė „prašyta suma" ĮSKAITO costDu → metric.prasyta_suma == sum(cost_categories)
 *     == tenants_breakdown viso prašyta (sprendimas 2026-06-14).
 *  2. Faktinė sutampa per VISUS biudžeto widget'us: sankey == treemap == lentelė ==
 *     metric.islaidos_faktine == budget_execution_by_source (faktinė). Nulinės faktinės
 *     eilutė NEsukuria fantominio srauto sankey (grynas sizeBy).
 *  3. Kiekiai tikslūs iš serverio total (prasymu_skaicius == sum(requests_by_status)).
 *  4. Re-hidracija PERRAŠO literalius (stale) skaičius šviežiais (prizmė).
 *
 * Visi laukiami skaičiai suskaičiuoti ranka iš fixture'o (žr. komentarus).
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

/** „60 000 €" → 60000 (fmtEur formatuoja sveikais EUR, lt-LT grupavimu). */
function parseEur(value: string | undefined): number {
  return Number((value ?? '').replace(/[^\d]/g, ''));
}

describe('AI katalogas — korektiškumas / reconciliation', () => {
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
    return mockOrgAdmin({ id: org.orgAdminUserId, tenantId: org.orgTenantId });
  }

  beforeEach(async () => {
    const knex = getTestKnex();
    await truncateAll(knex);
    base = await seedBaseFixtures(knex);
    org = await seedOrgTenant(knex);
    cls = await seedFvmClassifiers(knex);
  });

  /**
   * Kontroliuojamas 2026 m. fixture'as. Ranka suskaičiuoti totalai:
   *  - Finansavimo šaltiniai: VB metinė 500k, ES metinė 200k.
   *  - Allocations (planuota): VB→PP 100k, VB→INV 50k (BE išlaidų → faktinė 0), ES→KITA 40k.
   *    Σ planuota = 190k.
   *  - Išlaidos: VB PP 20k (vienašaltinė) + 10k (VB 6k / ES 4k split) = 30k; ES KITA 10k.
   *    Σ faktinė = 40k. Per allocation: VB PP 30k, VB INV 0, ES KITA 10k.
   *    Per source (vykdymo bazė = allocation home-source): VB 30k, ES 10k.
   *  - Prašymai (2026): R1 SUBMITTED (DU 30k + įranga 5k + analizė 5k = 40k);
   *    R2 APPROVED (DU 10k + vystymas 10k = 20k, granted 15k). Σ prašyta = 60k.
   *    Kategorijų sumos: DU 40k, įranga 5k, analizė 5k, vystymas 10k → Σ 60k.
   *    Kiekis = 2 (SUBMITTED 1, APPROVED 1). patvirtinta (granted) = 15k.
   */
  async function seedReconFixture(): Promise<void> {
    const vb = (await broker.call(
      'fundingSources.create',
      {
        tenantId: org.orgTenantId,
        pavadinimas: 'RC Valstybės biudžetas',
        kodas: 'RC-VB-2026',
        tipasClassifierItemId: cls.fundingSourceTypeItemIds.biudzetas,
        metai: 2026,
        metineSuma: '500000.00',
      },
      { meta: { user: amAdmin() } },
    )) as FundingSourceDTO;
    const es = (await broker.call(
      'fundingSources.create',
      {
        tenantId: org.orgTenantId,
        pavadinimas: 'RC ES fondai',
        kodas: 'RC-ES-2026',
        tipasClassifierItemId: cls.fundingSourceTypeItemIds.es,
        metai: 2026,
        metineSuma: '200000.00',
      },
      { meta: { user: amAdmin() } },
    )) as FundingSourceDTO;

    const mkAlloc = (
      fsId: number,
      categoryItemId: number,
      pavadinimas: string,
      planuota: string,
    ): Promise<BudgetAllocationDTO> =>
      broker.call(
        'budgetAllocations.create',
        {
          fundingSourceId: fsId,
          categoryClassifierItemId: categoryItemId,
          pavadinimas,
          planuotaSuma: planuota,
          metai: 2026,
        },
        { meta: { user: amAdmin() } },
      ) as Promise<BudgetAllocationDTO>;

    const vbPp = await mkAlloc(vb.id, cls.budgetCategoryItemIds.prekes_paslaugos, 'VB PP', '100000.00');
    await mkAlloc(vb.id, cls.budgetCategoryItemIds.investicijos, 'VB INV', '50000.00'); // be išlaidų
    const esKita = await mkAlloc(es.id, cls.budgetCategoryItemIds.kita, 'ES KITA', '40000.00');

    const mkProject = (allocId: number, pavadinimas: string, biudzetas: string): Promise<ProjectDTO> =>
      broker.call(
        'projects.create',
        {
          tenantId: org.orgTenantId,
          budgetAllocationId: allocId,
          atsakingasUserId: org.orgAdminUserId,
          pavadinimas,
          tipas: 'projektas',
          biudzetas,
        },
        { meta: { user: amAdmin() } },
      ) as Promise<ProjectDTO>;

    const pVbPp = await mkProject(vbPp.id, 'RC projektas VB PP', '80000.00');
    const pEs = await mkProject(esKita.id, 'RC projektas ES', '40000.00');

    // Išlaidos (kuria projekto atsakingas = orgAdmin).
    await broker.call(
      'expenses.create',
      {
        projectId: pVbPp.id,
        budgetAllocationId: vbPp.id,
        tipas: 'saskaita',
        suma: '20000.00',
        data: '2026-03-10',
      },
      { meta: { user: orgAdmin() } },
    );
    await broker.call(
      'expenses.create',
      {
        projectId: pVbPp.id,
        budgetAllocationId: vbPp.id,
        tipas: 'saskaita',
        suma: '10000.00',
        data: '2026-04-10',
        saltinioDalis: [
          { fundingSourceId: vb.id, suma: '6000.00' },
          { fundingSourceId: es.id, suma: '4000.00' },
        ],
      },
      { meta: { user: orgAdmin() } },
    );
    await broker.call(
      'expenses.create',
      {
        projectId: pEs.id,
        budgetAllocationId: esKita.id,
        tipas: 'saskaita',
        suma: '10000.00',
        data: '2026-05-10',
      },
      { meta: { user: orgAdmin() } },
    );

    // Prašymai — tiesiai per knex (žinomi cost laukai, įsk. costDu).
    const knex = getTestKnex();
    const baseReq = {
      tenant_id: org.orgTenantId,
      created_by_user_id: org.orgAdminUserId,
      year: 2026,
      system_code: null,
      project_type: null,
      description: 'recon',
      planned_works: null,
      priority: null,
      procurement_stage: null,
      cost_creation: '0.00',
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
      decision_funding_source: null,
      decision_protocol: null,
      decision_order: null,
      budget_category_id: null,
      funding_source_type_id: null,
      spec_program_funding_type: null,
      fvm_project_id: null,
    };
    await knex('requests').insert({
      ...baseReq,
      status: 'SUBMITTED',
      project_name: 'RC prašymas 1',
      cost_du: '30000.00',
      cost_equipment: '5000.00',
      cost_analysis: '5000.00',
      cost_development: '0.00',
      decision_granted_amount: null,
      decided_at: null,
      decided_by_user_id: null,
      submitted_at: '2026-02-01T10:00:00Z',
    });
    await knex('requests').insert({
      ...baseReq,
      status: 'APPROVED',
      project_name: 'RC prašymas 2',
      cost_du: '10000.00',
      cost_equipment: '0.00',
      cost_analysis: '0.00',
      cost_development: '10000.00',
      decision_granted_amount: '15000.00',
      decided_at: '2026-04-01T10:00:00Z',
      decided_by_user_id: base.amAdminUserId,
      submitted_at: '2026-03-01T10:00:00Z',
    });
  }

  /** Hidruoja dataRef widget'ų sąrašą ir grąžina map id→widget. */
  async function hydrate(widgets: AiWidget[]): Promise<Record<string, AiWidget>> {
    const spec: AiDashboardSpec = { year: 2026, widgets };
    const resp = (await broker.call(
      'ai.hydrate',
      { spec, year: 2026 },
      { meta: { user: amAdmin() } },
    )) as AiHydrateResponse;
    const out: Record<string, AiWidget> = {};
    for (const w of resp.spec.widgets) out[w.id] = w;
    return out;
  }

  const ref = (id: string, type: AiWidget['type'], source: string, params?: Record<string, unknown>): AiWidget =>
    ({ id, type, dataRef: { source, ...(params ? { params } : {}) } }) as AiWidget;

  it('prašyta suma ĮSKAITO costDu ir sutampa su cost_categories bei tenants_breakdown', async () => {
    await seedReconFixture();
    const w = await hydrate([
      ref('prasyta', 'stat', 'metric', { metric: 'prasyta_suma' }),
      ref('costcat', 'pie', 'cost_categories'),
      ref('tenants', 'table', 'tenants_breakdown'),
    ]);

    expect(parseEur(w.prasyta!.value)).toBe(60000);

    const catData = (w.costcat!.data ?? []) as Array<{ name: string; value: number }>;
    const catSum = catData.reduce((a, c) => a + Number(c.value), 0);
    expect(catSum).toBe(60000);
    // DU kategorija matoma su pilna 40k (įsk. abiejų prašymų costDu).
    const du = catData.find((c) => /darbo užmokestis/i.test(c.name));
    expect(du && Number(du.value)).toBe(40000);

    // INVARIANTAS: stat „prašyta" == kategorijų suma.
    expect(catSum).toBe(parseEur(w.prasyta!.value));

    const rows = (w.tenants!.rows ?? []) as Array<{ prasyta: number }>;
    const tenantsPrasyta = rows.reduce((a, r) => a + Number(r.prasyta), 0);
    expect(tenantsPrasyta).toBe(60000);
  });

  it('kiekiai tikslūs iš serverio total; sum(requests_by_status) == prasymu_skaicius', async () => {
    await seedReconFixture();
    const w = await hydrate([
      ref('count', 'stat', 'metric', { metric: 'prasymu_skaicius' }),
      ref('pateikti', 'stat', 'metric', { metric: 'pateikti_laukia' }),
      ref('patv', 'stat', 'metric', { metric: 'patvirtinta_suma' }),
      ref('status', 'bar', 'requests_by_status'),
    ]);

    expect(w.count!.value).toBe('2');
    expect(w.pateikti!.value).toBe('1');
    expect(parseEur(w.patv!.value)).toBe(15000);

    const statusData = (w.status!.data ?? []) as Array<{ statusas: string; kiekis: number }>;
    const totalCount = statusData.reduce((a, s) => a + Number(s.kiekis), 0);
    expect(totalCount).toBe(2);
    expect(totalCount).toBe(Number(w.count!.value));
  });

  it('faktinė sutampa: sankey == treemap == lentelė == islaidos_faktine == exec-by-source; nulinė eilutė be fantomo', async () => {
    await seedReconFixture();
    const w = await hydrate([
      ref('faktine', 'stat', 'metric', { metric: 'islaidos_faktine' }),
      ref('planuota', 'stat', 'metric', { metric: 'biudzetas_planuota' }),
      ref('sankey', 'sankey', 'budget_flow_sankey', { sizeBy: 'faktine' }),
      ref('treemap', 'treemap', 'budget_hierarchy_treemap', { sizeBy: 'faktine' }),
      ref('table', 'table', 'budget_lines_table'),
      ref('exec', 'bar', 'budget_execution_by_source'),
    ]);

    expect(parseEur(w.faktine!.value)).toBe(40000);
    expect(parseEur(w.planuota!.value)).toBe(190000);

    // Sankey: src→cat ir cat→alloc lygiai abu sumuojasi į 40k; NULINĖ VB INV
    // eilutė NEsukuria fantominio srauto (grynas faktinės sizeBy).
    const nodes = (w.sankey!.nodes ?? []) as Array<{ name: string }>;
    const links = (w.sankey!.links ?? []) as Array<{ source: number; target: number; value: number }>;
    const nodeIsAlloc = (i: number): boolean => /VB PP|ES KITA|VB INV/.test(nodes[i]?.name ?? '');
    const catAllocSum = links
      .filter((l) => nodeIsAlloc(l.target))
      .reduce((a, l) => a + l.value, 0);
    expect(catAllocSum).toBe(40000);
    expect(nodes.some((n) => /VB INV/.test(n.name))).toBe(false);

    // Treemap lapų suma.
    const tm = (w.treemap!.treemap ?? []) as Array<{ children?: Array<{ value?: number }>; value?: number }>;
    const tmSum = tm.reduce(
      (a, s) => a + (s.children ?? []).reduce((b, c) => b + Number(c.value ?? 0), 0) + Number(s.value ?? 0),
      0,
    );
    expect(tmSum).toBe(40000);

    // Lentelė: faktinė stulpelio suma.
    const tableRows = (w.table!.rows ?? []) as Array<{ faktine: number; planuota: number }>;
    const tableFaktine = tableRows.reduce((a, r) => a + Number(r.faktine), 0);
    const tablePlanuota = tableRows.reduce((a, r) => a + Number(r.planuota), 0);
    expect(tableFaktine).toBe(40000);
    expect(tablePlanuota).toBe(190000);

    // Exec by source: faktinė per source (home-source vykdymo bazė).
    const execData = (w.exec!.data ?? []) as Array<{ saltinis: string; planuota: number; faktine: number }>;
    const execFaktine = execData.reduce((a, r) => a + Number(r.faktine), 0);
    expect(execFaktine).toBe(40000);

    // INVARIANTAS: visi faktinės pjūviai sutampa.
    expect(new Set([parseEur(w.faktine!.value), catAllocSum, tmSum, tableFaktine, execFaktine]).size).toBe(1);
  });

  it('lentelės šaltinis (tenants_breakdown) kaip BAR — atvaizduojamas, ne dingsta', async () => {
    // Regresija: „Organizacijos pagal sumą" lentelę pavertus į stulpelinę diagramą
    // (tas pats dataRef, type=bar) — serveris pertvarko table→bar (data/xKey/series).
    await seedReconFixture();
    const w = await hydrate([ref('tb', 'bar', 'tenants_breakdown')]);
    const bar = w.tb!;
    expect(bar.xKey).toBeDefined();
    expect((bar.series ?? []).length).toBeGreaterThan(0);
    expect((bar.data ?? []).length).toBeGreaterThan(0);
    expect(bar.columns).toBeUndefined(); // nebe lentelė → renderable bar
  });

  it('re-hidracija PERRAŠO literalius (stale) skaičius šviežiais iš DB (prizmė)', async () => {
    await seedReconFixture();
    // Widget'as su SENA literalia reikšme + dataRef → hidracija turi perrašyti.
    const stale: AiWidget = {
      id: 'planuota',
      type: 'stat',
      value: '999 999 €',
      subtitle: 'sena',
      dataRef: { source: 'metric', params: { metric: 'biudzetas_planuota' } },
    };
    const w = await hydrate([stale]);
    expect(parseEur(w.planuota!.value)).toBe(190000); // ne 999999
  });
});
