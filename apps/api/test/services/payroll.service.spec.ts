/**
 * Payroll service functionality integration tests (Iter 13, FVM-5).
 *
 * Permission gates atskirai testuojami `payroll-permissions.spec.ts`.
 * Šis spec'as tikrina LOGIKĄ + DUOMENŲ INVARIANTUS:
 *
 * Test'ai (10+):
 *  1. AM admin sukuria profile + 1 distribution
 *  2. createDistribution procentais (50%) — sėkmingai
 *  3. createDistribution fiksuota (€500) — sėkmingai
 *  4. SUM(procentais) > 100 per overlapping period → 400 LT
 *  5. SUM(procentais) <= 100 per non-overlapping period — sėkmingai
 *  6. Delete profile su distributions → 409 RESTRICT
 *  7. Delete profile be distributions — sėkmingai
 *  8. computeMonth idempotent: 2x kvietimas → antras ištrina pirmo expense'us
 *  9. computeMonth sukuria expense'us tipas='du', sumos teisingos
 *  10. computeMonth jei DU allocation nesukurta — 400 LT klaida
 *
 * Pasirinkimas dokumentuotas: profile aktyvus dalį mėnesio (galioja_iki vidury)
 * — full month suma (NE proportional). Žr. payroll.service.ts computeMonth
 * doc comment.
 */
import type { ServiceBroker } from 'moleculer';
import type {
  BudgetAllocation as BudgetAllocationDTO,
  ComputeMonthResponse,
  FundingSource as FundingSourceDTO,
  PayrollDistribution as PayrollDistributionDTO,
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
import { mockAuthUser } from '../helpers/auth';

describe('payroll service functionality (Iter 13)', () => {
  let broker: ServiceBroker;
  let base: BaseFixtures;
  let org: OrgTenantFixtures;
  let cls: FvmClassifierFixtures;
  let amFundingSourceId: number;
  let amSecondFundingSourceId: number;
  let amDuAllocationId: number;

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

  beforeEach(async () => {
    const knex = getTestKnex();
    await truncateAll(knex);
    base = await seedBaseFixtures(knex);
    org = await seedOrgTenant(knex);
    cls = await seedFvmClassifiers(knex);

    // AM funding source 1 + DU allocation
    const fs1 = (await broker.call(
      'fundingSources.create',
      {
        tenantId: base.amTenantId,
        pavadinimas: 'AM VB 2026',
        kodas: 'AM-VB-2026',
        tipasClassifierItemId: cls.fundingSourceTypeItemIds.biudzetas,
        metai: 2026,
        metineSuma: '2000000.00',
      },
      { meta: { user: amAdmin() } },
    )) as FundingSourceDTO;
    amFundingSourceId = fs1.id;

    // AM funding source 2
    const fs2 = (await broker.call(
      'fundingSources.create',
      {
        tenantId: base.amTenantId,
        pavadinimas: 'AM ES 2026',
        kodas: 'AM-ES-2026',
        tipasClassifierItemId: cls.fundingSourceTypeItemIds.es,
        metai: 2026,
        metineSuma: '500000.00',
      },
      { meta: { user: amAdmin() } },
    )) as FundingSourceDTO;
    amSecondFundingSourceId = fs2.id;

    // AM DU allocation
    const alloc = (await broker.call(
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
    amDuAllocationId = alloc.id;
  });

  // -------- 1. Create profile + distribution --------

  it('1. AM admin sukuria profile + 1 distribution', async () => {
    const profile = (await broker.call(
      'payroll.createProfile',
      {
        tenantId: base.amTenantId,
        vardasPavarde: 'Jonas Jonaitis',
        pareigos: 'Vyr. specialistas',
        sutartiesTipas: 'darbo',
        atlyginimasBruto: '3000.00',
        priedai: '200.00',
        galiojaNuo: '2026-01-01',
      },
      { meta: { user: amAdmin() } },
    )) as PayrollProfileDTO;
    expect(profile.id).toBeGreaterThan(0);
    expect(profile.tenantId).toBe(base.amTenantId);
    expect(profile.vardasPavarde).toBe('Jonas Jonaitis');
    expect(profile.atlyginimasBruto).toBe('3000.00');
    expect(profile.priedai).toBe('200.00');
    expect(profile.sutartiesTipas).toBe('darbo');
    expect(profile.galiojaNuo).toBe('2026-01-01');
    expect(profile.galiojaIki).toBeNull();

    const dist = (await broker.call(
      'payroll.createDistribution',
      {
        payrollProfileId: profile.id,
        fundingSourceId: amFundingSourceId,
        paskirstymoTipas: 'procentais',
        reiksme: '100',
        galiojaNuo: '2026-01-01',
      },
      { meta: { user: amAdmin() } },
    )) as PayrollDistributionDTO;
    expect(dist.id).toBeGreaterThan(0);
    expect(dist.payrollProfileId).toBe(profile.id);
    expect(dist.fundingSourceId).toBe(amFundingSourceId);
    expect(dist.paskirstymoTipas).toBe('procentais');
    expect(Number(dist.reiksme)).toBe(100);
  });

  // -------- 2-3. Distribution types --------

  it('2. createDistribution procentais (50%) — sėkmingai', async () => {
    const profile = (await broker.call(
      'payroll.createProfile',
      {
        tenantId: base.amTenantId,
        vardasPavarde: 'Jonas',
        pareigos: 'Test',
        sutartiesTipas: 'darbo',
        atlyginimasBruto: '2000.00',
        galiojaNuo: '2026-01-01',
      },
      { meta: { user: amAdmin() } },
    )) as PayrollProfileDTO;
    const dist = (await broker.call(
      'payroll.createDistribution',
      {
        payrollProfileId: profile.id,
        fundingSourceId: amFundingSourceId,
        paskirstymoTipas: 'procentais',
        reiksme: '50',
        galiojaNuo: '2026-01-01',
      },
      { meta: { user: amAdmin() } },
    )) as PayrollDistributionDTO;
    expect(dist.paskirstymoTipas).toBe('procentais');
    expect(Number(dist.reiksme)).toBe(50);
  });

  it('3. createDistribution fiksuota (€500) — sėkmingai', async () => {
    const profile = (await broker.call(
      'payroll.createProfile',
      {
        tenantId: base.amTenantId,
        vardasPavarde: 'Jonas',
        pareigos: 'Test',
        sutartiesTipas: 'darbo',
        atlyginimasBruto: '2000.00',
        galiojaNuo: '2026-01-01',
      },
      { meta: { user: amAdmin() } },
    )) as PayrollProfileDTO;
    const dist = (await broker.call(
      'payroll.createDistribution',
      {
        payrollProfileId: profile.id,
        fundingSourceId: amFundingSourceId,
        paskirstymoTipas: 'fiksuota',
        reiksme: '500',
        galiojaNuo: '2026-01-01',
      },
      { meta: { user: amAdmin() } },
    )) as PayrollDistributionDTO;
    expect(dist.paskirstymoTipas).toBe('fiksuota');
    expect(Number(dist.reiksme)).toBe(500);
  });

  // -------- 4-5. SUM(procentais) constraints --------

  it('4. SUM(procentais) > 100 per overlapping period → 400 LT klaida', async () => {
    const profile = (await broker.call(
      'payroll.createProfile',
      {
        tenantId: base.amTenantId,
        vardasPavarde: 'Jonas',
        pareigos: 'Test',
        sutartiesTipas: 'darbo',
        atlyginimasBruto: '2000.00',
        galiojaNuo: '2026-01-01',
      },
      { meta: { user: amAdmin() } },
    )) as PayrollProfileDTO;
    // Distribution 1: 60% nuo 2026-01-01 (open ended)
    await broker.call(
      'payroll.createDistribution',
      {
        payrollProfileId: profile.id,
        fundingSourceId: amFundingSourceId,
        paskirstymoTipas: 'procentais',
        reiksme: '60',
        galiojaNuo: '2026-01-01',
      },
      { meta: { user: amAdmin() } },
    );
    // Distribution 2: 50% nuo 2026-01-01 — overlap'inasi, SUM=110 → 400
    await expect(
      broker.call(
        'payroll.createDistribution',
        {
          payrollProfileId: profile.id,
          fundingSourceId: amSecondFundingSourceId,
          paskirstymoTipas: 'procentais',
          reiksme: '50',
          galiojaNuo: '2026-01-01',
        },
        { meta: { user: amAdmin() } },
      ),
    ).rejects.toMatchObject({
      code: 400,
      type: 'DISTRIBUTION_SUM_EXCEEDS_100',
    });
  });

  it('5. SUM(procentais) per non-overlapping period — sėkmingai', async () => {
    const profile = (await broker.call(
      'payroll.createProfile',
      {
        tenantId: base.amTenantId,
        vardasPavarde: 'Jonas',
        pareigos: 'Test',
        sutartiesTipas: 'darbo',
        atlyginimasBruto: '2000.00',
        galiojaNuo: '2026-01-01',
      },
      { meta: { user: amAdmin() } },
    )) as PayrollProfileDTO;
    // Distribution 1: 100% nuo 2026-01-01 iki 2026-06-30
    await broker.call(
      'payroll.createDistribution',
      {
        payrollProfileId: profile.id,
        fundingSourceId: amFundingSourceId,
        paskirstymoTipas: 'procentais',
        reiksme: '100',
        galiojaNuo: '2026-01-01',
        galiojaIki: '2026-06-30',
      },
      { meta: { user: amAdmin() } },
    );
    // Distribution 2: 100% nuo 2026-07-01 — NE overlap, sėkmingai
    const dist2 = (await broker.call(
      'payroll.createDistribution',
      {
        payrollProfileId: profile.id,
        fundingSourceId: amSecondFundingSourceId,
        paskirstymoTipas: 'procentais',
        reiksme: '100',
        galiojaNuo: '2026-07-01',
      },
      { meta: { user: amAdmin() } },
    )) as PayrollDistributionDTO;
    expect(dist2.id).toBeGreaterThan(0);
  });

  // -------- 6-7. Delete profile --------

  it('6. Delete profile su distributions → 409 RESTRICT', async () => {
    const profile = (await broker.call(
      'payroll.createProfile',
      {
        tenantId: base.amTenantId,
        vardasPavarde: 'Jonas',
        pareigos: 'Test',
        sutartiesTipas: 'darbo',
        atlyginimasBruto: '2000.00',
        galiojaNuo: '2026-01-01',
      },
      { meta: { user: amAdmin() } },
    )) as PayrollProfileDTO;
    await broker.call(
      'payroll.createDistribution',
      {
        payrollProfileId: profile.id,
        fundingSourceId: amFundingSourceId,
        paskirstymoTipas: 'procentais',
        reiksme: '100',
        galiojaNuo: '2026-01-01',
      },
      { meta: { user: amAdmin() } },
    );
    await expect(
      broker.call(
        'payroll.deleteProfile',
        { id: profile.id },
        { meta: { user: amAdmin() } },
      ),
    ).rejects.toMatchObject({
      code: 409,
      type: 'PAYROLL_PROFILE_HAS_DISTRIBUTIONS',
    });
  });

  it('7. Delete profile be distributions — sėkmingai', async () => {
    const profile = (await broker.call(
      'payroll.createProfile',
      {
        tenantId: base.amTenantId,
        vardasPavarde: 'Jonas',
        pareigos: 'Test',
        sutartiesTipas: 'darbo',
        atlyginimasBruto: '2000.00',
        galiojaNuo: '2026-01-01',
      },
      { meta: { user: amAdmin() } },
    )) as PayrollProfileDTO;
    const result = await broker.call(
      'payroll.deleteProfile',
      { id: profile.id },
      { meta: { user: amAdmin() } },
    );
    expect(result).toEqual({ ok: true });
    await expect(
      broker.call(
        'payroll.getProfile',
        { id: profile.id },
        { meta: { user: amAdmin() } },
      ),
    ).rejects.toMatchObject({ code: 404 });
  });

  // -------- 8-9. computeMonth --------

  it('8. computeMonth idempotent: 2x kvietimas — antras ištrina pirmo expense\'us', async () => {
    const profile = (await broker.call(
      'payroll.createProfile',
      {
        tenantId: base.amTenantId,
        vardasPavarde: 'Jonas Idempo',
        pareigos: 'Test',
        sutartiesTipas: 'darbo',
        atlyginimasBruto: '2000.00',
        priedai: '0.00',
        galiojaNuo: '2026-01-01',
      },
      { meta: { user: amAdmin() } },
    )) as PayrollProfileDTO;
    await broker.call(
      'payroll.createDistribution',
      {
        payrollProfileId: profile.id,
        fundingSourceId: amFundingSourceId,
        paskirstymoTipas: 'procentais',
        reiksme: '100',
        galiojaNuo: '2026-01-01',
      },
      { meta: { user: amAdmin() } },
    );

    // Pirmas kvietimas
    const r1 = (await broker.call(
      'payroll.computeMonth',
      { month: '2026-03' },
      { meta: { user: amAdmin() } },
    )) as ComputeMonthResponse;
    expect(r1.status).toBe('computed');
    expect(r1.expensesCreated).toBe(1);
    expect(r1.totalAmount).toBe('2000.00');

    // Patikrinam expense egzistuoja
    const knex = getTestKnex();
    let countResult = (await knex('expenses')
      .where('tipas', 'du')
      .where('aprasymas', 'like', 'DU 2026-03: %')
      .count<{ count: string }[]>('id as count')) as Array<{ count: string }>;
    expect(Number(countResult[0]!.count)).toBe(1);

    // Antras kvietimas — ištrina pirmojo expense'us ir sukuria naujus
    const r2 = (await broker.call(
      'payroll.computeMonth',
      { month: '2026-03' },
      { meta: { user: amAdmin() } },
    )) as ComputeMonthResponse;
    expect(r2.status).toBe('computed');
    expect(r2.expensesCreated).toBe(1);

    countResult = (await knex('expenses')
      .where('tipas', 'du')
      .where('aprasymas', 'like', 'DU 2026-03: %')
      .count<{ count: string }[]>('id as count')) as Array<{ count: string }>;
    expect(Number(countResult[0]!.count)).toBe(1);
  });

  it('9. computeMonth sukuria expense\'us tipas=du su teisingomis sumomis', async () => {
    const profile = (await broker.call(
      'payroll.createProfile',
      {
        tenantId: base.amTenantId,
        vardasPavarde: 'Jonas Sums',
        pareigos: 'Test',
        sutartiesTipas: 'darbo',
        atlyginimasBruto: '3000.00',
        priedai: '500.00',
        galiojaNuo: '2026-01-01',
      },
      { meta: { user: amAdmin() } },
    )) as PayrollProfileDTO;
    // 70% iš FS1 + 30% iš FS2 — bendras monthly_total = 3500
    await broker.call(
      'payroll.createDistribution',
      {
        payrollProfileId: profile.id,
        fundingSourceId: amFundingSourceId,
        paskirstymoTipas: 'procentais',
        reiksme: '70',
        galiojaNuo: '2026-01-01',
      },
      { meta: { user: amAdmin() } },
    );
    await broker.call(
      'payroll.createDistribution',
      {
        payrollProfileId: profile.id,
        fundingSourceId: amSecondFundingSourceId,
        paskirstymoTipas: 'procentais',
        reiksme: '30',
        galiojaNuo: '2026-01-01',
      },
      { meta: { user: amAdmin() } },
    );

    const r = (await broker.call(
      'payroll.computeMonth',
      { month: '2026-04' },
      { meta: { user: amAdmin() } },
    )) as ComputeMonthResponse;
    expect(r.status).toBe('computed');
    expect(r.expensesCreated).toBe(2);
    // 70% × 3500 + 30% × 3500 = 2450 + 1050 = 3500
    expect(r.totalAmount).toBe('3500.00');

    const knex = getTestKnex();
    const expenses = (await knex('expenses')
      .where('tipas', 'du')
      .where('aprasymas', 'like', 'DU 2026-04: %')
      .orderBy('suma', 'desc')
      .select(
        'id',
        'suma',
        'data',
        'aprasymas',
        'tipas',
      )) as Array<{
      id: number;
      suma: string;
      data: string;
      aprasymas: string;
      tipas: string;
    }>;
    expect(expenses).toHaveLength(2);
    // Visa data — mėnesio paskutinė diena
    expect(expenses[0]!.data).toBe('2026-04-30');
    expect(expenses[1]!.data).toBe('2026-04-30');
    // Visi tipas='du'
    expect(expenses[0]!.tipas).toBe('du');
    // Sumos: 2450 ir 1050
    expect(expenses[0]!.suma).toBe('2450.00');
    expect(expenses[1]!.suma).toBe('1050.00');
    // Aprasymas
    expect(expenses[0]!.aprasymas).toBe('DU 2026-04: Jonas Sums');
  });

  it('10. computeMonth jei DU allocation nesukurta — 400 LT klaida', async () => {
    // Ištrinam AM DU allocation, kad jos nebūtų
    const knex = getTestKnex();
    await knex('budget_allocations_v2').where('id', amDuAllocationId).delete();

    // Sukuriam profile + distribution
    const profile = (await broker.call(
      'payroll.createProfile',
      {
        tenantId: base.amTenantId,
        vardasPavarde: 'Jonas',
        pareigos: 'Test',
        sutartiesTipas: 'darbo',
        atlyginimasBruto: '2000.00',
        galiojaNuo: '2026-01-01',
      },
      { meta: { user: amAdmin() } },
    )) as PayrollProfileDTO;
    await broker.call(
      'payroll.createDistribution',
      {
        payrollProfileId: profile.id,
        fundingSourceId: amFundingSourceId,
        paskirstymoTipas: 'procentais',
        reiksme: '100',
        galiojaNuo: '2026-01-01',
      },
      { meta: { user: amAdmin() } },
    );

    await expect(
      broker.call(
        'payroll.computeMonth',
        { month: '2026-03' },
        { meta: { user: amAdmin() } },
      ),
    ).rejects.toMatchObject({
      code: 400,
      type: 'DU_ALLOCATION_NOT_FOUND',
    });
  });

  // -------- Papildomi --------

  it('11. computeMonth: profile galiojantis tik dalį mėnesio — full month suma', async () => {
    // Pasirinkimas dokumentuotas: profile aktyvus dalį mėnesio (galioja_iki
    // vidury) — full month suma. Žr. payroll.service.ts computeMonth doc
    // comment.
    const profile = (await broker.call(
      'payroll.createProfile',
      {
        tenantId: base.amTenantId,
        vardasPavarde: 'Jonas Part',
        pareigos: 'Test',
        sutartiesTipas: 'darbo',
        atlyginimasBruto: '2000.00',
        galiojaNuo: '2026-03-01',
        galiojaIki: '2026-03-15', // galioja tik pusę mėnesio
      },
      { meta: { user: amAdmin() } },
    )) as PayrollProfileDTO;
    await broker.call(
      'payroll.createDistribution',
      {
        payrollProfileId: profile.id,
        fundingSourceId: amFundingSourceId,
        paskirstymoTipas: 'procentais',
        reiksme: '100',
        galiojaNuo: '2026-03-01',
        galiojaIki: '2026-03-15',
      },
      { meta: { user: amAdmin() } },
    );

    const r = (await broker.call(
      'payroll.computeMonth',
      { month: '2026-03' },
      { meta: { user: amAdmin() } },
    )) as ComputeMonthResponse;
    // Full month suma — NE proportional (2000, not 1000)
    expect(r.totalAmount).toBe('2000.00');
  });

  it('12. Fiksuota distribution — computeMonth naudoja fiksuotą sumą', async () => {
    const profile = (await broker.call(
      'payroll.createProfile',
      {
        tenantId: base.amTenantId,
        vardasPavarde: 'Jonas Fixed',
        pareigos: 'Test',
        sutartiesTipas: 'darbo',
        atlyginimasBruto: '5000.00',
        galiojaNuo: '2026-01-01',
      },
      { meta: { user: amAdmin() } },
    )) as PayrollProfileDTO;
    // Fiksuota €750 — nesvarbu kiek bruto
    await broker.call(
      'payroll.createDistribution',
      {
        payrollProfileId: profile.id,
        fundingSourceId: amFundingSourceId,
        paskirstymoTipas: 'fiksuota',
        reiksme: '750',
        galiojaNuo: '2026-01-01',
      },
      { meta: { user: amAdmin() } },
    );

    const r = (await broker.call(
      'payroll.computeMonth',
      { month: '2026-05' },
      { meta: { user: amAdmin() } },
    )) as ComputeMonthResponse;
    expect(r.totalAmount).toBe('750.00');
  });

  // suppress unused
  void org;
});
