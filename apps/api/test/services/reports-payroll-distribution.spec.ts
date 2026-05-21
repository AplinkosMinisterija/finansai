/**
 * reports.payrollDistribution integration tests (Iter 14, FVM-6).
 *
 * SAUGUMO PRIORITETINĖ ataskaita (per ADR-005 + docx §4.4):
 *  - Specialist (org user) ⇒ VISADA 403 (net JSON formatu)
 *  - Org admin ⇒ tik savo tenant
 *  - AM admin ⇒ visi tenant'ai
 *
 * Test'ai (5+):
 *  1. AM admin gauna ataskaitą su DU agregacijomis per profile + per source
 *  2. Org user → 403 (canViewPayroll false) — Specialist niekada nemato
 *  3. Org admin gauna savo tenant'o tik (visi DU expense'ai matomi)
 *  4. Cross-tenant: org admin su kito tenant tenantId → 403
 *  5. Date range filter veikia — laikotarpis išskiria mėnesius
 *  6. xlsx + pdf format'ai grąžina binary buffer
 *  7. SAUGUMO: org user net xlsx format'u → 403 (NE binary)
 */
import type { ServiceBroker } from 'moleculer';
import type {
  BudgetAllocation as BudgetAllocationDTO,
  FundingSource as FundingSourceDTO,
  PayrollDistributionReport,
  PayrollProfile as PayrollProfileDTO,
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

describe('reports.payrollDistribution (Iter 14) — SAUGUMO PRIORITETINĖ', () => {
  let broker: ServiceBroker;
  let base: BaseFixtures;
  let org: OrgTenantFixtures;
  let secondOrg: OrgTenantFixtures;
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
    secondOrg = await seedOrgTenant(knex, { code: 'AAD2', name: 'AAD #2' });
    cls = await seedFvmClassifiers(knex);
  });

  /**
   * Sukuria org tenant'ą su 2 profilius (Jonas su 100% į FS1, Marija su
   * 50%/50% į FS1/FS2) ir paleidžia computeMonth 2 mėnesiams: 2026-03,
   * 2026-04.
   */
  async function seedFullPayrollScenario(): Promise<{
    fs1Id: number;
    fs2Id: number;
    duAllocId: number;
    profileJonasId: number;
    profileMarijaId: number;
  }> {
    const fs1 = (await broker.call(
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
    const fs2 = (await broker.call(
      'fundingSources.create',
      {
        tenantId: org.orgTenantId,
        pavadinimas: 'Org ES 2026',
        kodas: 'ORG-ES-2026',
        tipasClassifierItemId: cls.fundingSourceTypeItemIds.es,
        metai: 2026,
        metineSuma: '200000.00',
      },
      { meta: { user: amAdmin() } },
    )) as FundingSourceDTO;

    const duAlloc = (await broker.call(
      'budgetAllocations.create',
      {
        fundingSourceId: fs1.id,
        categoryClassifierItemId: cls.budgetCategoryItemIds.du,
        pavadinimas: 'Org DU 2026',
        planuotaSuma: '200000.00',
        metai: 2026,
      },
      { meta: { user: amAdmin() } },
    )) as BudgetAllocationDTO;

    // Profile Jonas: 100% į FS1
    const jonas = (await broker.call(
      'payroll.createProfile',
      {
        tenantId: org.orgTenantId,
        vardasPavarde: 'Jonas Jonaitis',
        pareigos: 'Vyr. specialistas',
        sutartiesTipas: 'darbo',
        atlyginimasBruto: '3000.00',
        priedai: '500.00',
        galiojaNuo: '2026-01-01',
      },
      { meta: { user: amAdmin() } },
    )) as PayrollProfileDTO;
    await broker.call(
      'payroll.createDistribution',
      {
        payrollProfileId: jonas.id,
        fundingSourceId: fs1.id,
        paskirstymoTipas: 'procentais',
        reiksme: '100',
        galiojaNuo: '2026-01-01',
      },
      { meta: { user: amAdmin() } },
    );

    // Profile Marija: 50/50 split tarp FS1 ir FS2
    const marija = (await broker.call(
      'payroll.createProfile',
      {
        tenantId: org.orgTenantId,
        vardasPavarde: 'Marija Petraitė',
        pareigos: 'Skyriaus vedėja',
        sutartiesTipas: 'darbo',
        atlyginimasBruto: '4000.00',
        priedai: '0.00',
        galiojaNuo: '2026-01-01',
      },
      { meta: { user: amAdmin() } },
    )) as PayrollProfileDTO;
    await broker.call(
      'payroll.createDistribution',
      {
        payrollProfileId: marija.id,
        fundingSourceId: fs1.id,
        paskirstymoTipas: 'procentais',
        reiksme: '50',
        galiojaNuo: '2026-01-01',
      },
      { meta: { user: amAdmin() } },
    );
    await broker.call(
      'payroll.createDistribution',
      {
        payrollProfileId: marija.id,
        fundingSourceId: fs2.id,
        paskirstymoTipas: 'procentais',
        reiksme: '50',
        galiojaNuo: '2026-01-01',
      },
      { meta: { user: amAdmin() } },
    );

    // Paleidžiam 2 mėnesius
    await broker.call(
      'payroll.computeMonth',
      { month: '2026-03' },
      { meta: { user: amAdmin() } },
    );
    await broker.call(
      'payroll.computeMonth',
      { month: '2026-04' },
      { meta: { user: amAdmin() } },
    );

    return {
      fs1Id: fs1.id,
      fs2Id: fs2.id,
      duAllocId: duAlloc.id,
      profileJonasId: jonas.id,
      profileMarijaId: marija.id,
    };
  }

  // ---- Test 1 ----
  it('1. AM admin gauna ataskaitą su DU agregacijomis per profile + per source', async () => {
    const ctx = await seedFullPayrollScenario();
    const resp = (await broker.call(
      'reports.payrollDistribution',
      { from: '2026-03-01', to: '2026-04-30' },
      { meta: { user: amAdmin() } },
    )) as PayrollDistributionReport;

    expect(resp.from).toBe('2026-03-01');
    expect(resp.to).toBe('2026-04-30');
    expect(resp.byProfile).toHaveLength(2);

    // Jonas: 3000 + 500 = 3500/mėn × 2 = 7000 (100% į fs1)
    const jonasSection = resp.byProfile.find(
      (p) => p.profileId === ctx.profileJonasId,
    )!;
    expect(jonasSection).toBeDefined();
    expect(jonasSection.vardasPavarde).toBe('Jonas Jonaitis');
    expect(Number.parseFloat(jonasSection.totalPerLaikotarpi)).toBeCloseTo(
      7000,
      2,
    );
    expect(jonasSection.bySource).toHaveLength(1);
    expect(jonasSection.bySource[0]!.fundingSourceId).toBe(ctx.fs1Id);
    expect(
      Number.parseFloat(jonasSection.bySource[0]!.sumaPerLaikotarpi),
    ).toBeCloseTo(7000, 2);

    // Marija: 4000/mėn × 2 = 8000 total, 50/50 = 4000 + 4000
    const marijaSection = resp.byProfile.find(
      (p) => p.profileId === ctx.profileMarijaId,
    )!;
    expect(marijaSection).toBeDefined();
    expect(Number.parseFloat(marijaSection.totalPerLaikotarpi)).toBeCloseTo(
      8000,
      2,
    );
    expect(marijaSection.bySource).toHaveLength(2);

    // totalsBySource: fs1 = 7000 (Jonas) + 4000 (Marija) = 11000
    //                  fs2 = 4000 (Marija)
    const fs1Total = resp.totalsBySource.find(
      (t) => t.fundingSourceId === ctx.fs1Id,
    )!;
    expect(Number.parseFloat(fs1Total.total)).toBeCloseTo(11000, 2);
    const fs2Total = resp.totalsBySource.find(
      (t) => t.fundingSourceId === ctx.fs2Id,
    )!;
    expect(Number.parseFloat(fs2Total.total)).toBeCloseTo(4000, 2);

    // Grand total = 15000
    expect(Number.parseFloat(resp.grandTotal)).toBeCloseTo(15000, 2);
  });

  // ---- Test 2 ----
  it('2. Org user → 403 (canViewPayroll false). Specialist niekada nemato', async () => {
    await seedFullPayrollScenario();
    await expect(
      broker.call(
        'reports.payrollDistribution',
        { from: '2026-03-01', to: '2026-04-30' },
        { meta: { user: orgUser() } },
      ),
    ).rejects.toMatchObject({ code: 403 });
  });

  // ---- Test 3 ----
  it('3. Org admin gauna savo tenant ataskaitą (mato visus savo DU)', async () => {
    const ctx = await seedFullPayrollScenario();

    const resp = (await broker.call(
      'reports.payrollDistribution',
      { from: '2026-03-01', to: '2026-04-30' },
      { meta: { user: orgAdmin() } },
    )) as PayrollDistributionReport;

    expect(resp.tenantId).toBe(org.orgTenantId);
    expect(resp.byProfile).toHaveLength(2);
    expect(
      resp.byProfile.find((p) => p.profileId === ctx.profileJonasId),
    ).toBeDefined();
  });

  // ---- Test 4 ----
  it('4. Cross-tenant: org admin su kito tenant tenantId param → 403', async () => {
    await seedFullPayrollScenario();
    await expect(
      broker.call(
        'reports.payrollDistribution',
        {
          from: '2026-03-01',
          to: '2026-04-30',
          tenantId: secondOrg.orgTenantId,
        },
        { meta: { user: orgAdmin() } },
      ),
    ).rejects.toMatchObject({ code: 403 });
  });

  // ---- Test 5 ----
  it('5. Date range filter — siauresnis laikotarpis išskiria vieną mėnesį', async () => {
    const ctx = await seedFullPayrollScenario();
    // Tik kovas
    const resp = (await broker.call(
      'reports.payrollDistribution',
      { from: '2026-03-01', to: '2026-03-31' },
      { meta: { user: amAdmin() } },
    )) as PayrollDistributionReport;

    // Tik 1 mėnesis — Jonas 3500, Marija 4000 = 7500 grand total
    expect(Number.parseFloat(resp.grandTotal)).toBeCloseTo(7500, 2);
    const jonas = resp.byProfile.find((p) => p.profileId === ctx.profileJonasId)!;
    expect(Number.parseFloat(jonas.totalPerLaikotarpi)).toBeCloseTo(3500, 2);
  });

  // ---- Test 6 ----
  it('6. xlsx + pdf format'+'as grąžina binary buffer (AM admin only)', async () => {
    await seedFullPayrollScenario();

    const xlsxResult = (await broker.call(
      'reports.payrollDistribution',
      { from: '2026-03-01', to: '2026-04-30', format: 'xlsx' },
      { meta: { user: amAdmin() } },
    )) as Buffer;
    expect(Buffer.isBuffer(xlsxResult)).toBe(true);
    expect(xlsxResult.subarray(0, 2).toString('ascii')).toBe('PK');

    const pdfResult = (await broker.call(
      'reports.payrollDistribution',
      { from: '2026-03-01', to: '2026-04-30', format: 'pdf' },
      { meta: { user: amAdmin() } },
    )) as Buffer;
    expect(Buffer.isBuffer(pdfResult)).toBe(true);
    expect(pdfResult.subarray(0, 4).toString('ascii')).toBe('%PDF');
  });

  // ---- Test 7 ----
  it('7. SAUGUMO: org user net xlsx format'+'u → 403 (NE binary atsakymas)', async () => {
    await seedFullPayrollScenario();
    // Specialist negali pasiekti net xlsx — guard'as PIRMASIS prieš generator'į.
    await expect(
      broker.call(
        'reports.payrollDistribution',
        { from: '2026-03-01', to: '2026-04-30', format: 'xlsx' },
        { meta: { user: orgUser() } },
      ),
    ).rejects.toMatchObject({ code: 403 });
  });

  // ---- Test 8 ----
  it('8. Invalid date range (from > to) → 400', async () => {
    await expect(
      broker.call(
        'reports.payrollDistribution',
        { from: '2026-04-30', to: '2026-03-01' },
        { meta: { user: amAdmin() } },
      ),
    ).rejects.toMatchObject({ code: 400 });
  });
});
