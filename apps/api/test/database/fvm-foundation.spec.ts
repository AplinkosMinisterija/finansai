/**
 * FVM foundation migration integration test'as (Iter 9).
 *
 * Test'ai:
 *  1. Setup — sukurti senus `budgets` (2026, 1.5M) + 2 `budget_allocations`
 *     (DU 500k + investicijos 1M). Roll'inam FVM migraciją down → up, ir
 *     patikrinam, kad data migration korektiškai pervarė įrašus į
 *     `funding_sources` + `budget_allocations_v2`.
 *
 *  2. Klasifikatoriai seedinti — `funding_source_type` ir `budget_category`
 *     grupės egzistuoja su default items'ais.
 *
 *  3. Rollback veikia — migracijos `down` nuima naujas lenteles.
 *
 *  4. `verifyFvmFoundation` tikrai FAIL'ina jei alocations sum > funding
 *     source metine_suma (over-commit scenarijus).
 *
 * Pastaba: `global-setup.ts` jau paleido visas migracijas test DB. Per
 * test'us specifiškai apsisukam FVM foundation migraciją per `migrate.down`
 * / `migrate.up`, kad galėtume testuoti `up` su mūsų sukurtais senais
 * duomenimis (data migration patikrinimui).
 */
import type { Knex } from 'knex';
import {
  getTestKnex,
  closeTestKnex,
  truncateAll,
  seedBaseFixtures,
} from '../helpers/db';
import { verifyFvmFoundation } from '../../src/database/migrations/utils/verify-fvm-foundation';

const FVM_MIGRATION = '20260522100000_create_fvm_foundation.ts';

interface ClassifierGroupSeed {
  groupCode: string;
  groupName: string;
  groupDescription: string;
  items: Array<{ code: string; name: string; sortOrder: number }>;
}

/**
 * Įdeda funding_type klasifikatorių (legacy, naudoja budgets+budget_allocations).
 * Tas pats kaip seeds/02_classifiers_and_budget.ts, bet minimaliai: tik tie
 * items, kuriuos referuos mūsų test setup'as.
 */
async function seedLegacyFundingTypeClassifier(knex: Knex): Promise<{
  groupId: number;
  itemIdsByCode: Record<string, number>;
}> {
  const insertedGroups = (await knex('classifier_groups')
    .insert({
      code: 'funding_type',
      name: 'Lėšų tipai',
      description: 'Test fixture — legacy funding_type group',
      active: true,
    })
    .returning('id')) as Array<{ id: number }>;
  const groupId = insertedGroups[0]?.id;
  if (groupId === undefined) {
    throw new Error('Test fixture: nepavyko sukurti funding_type grupės');
  }

  const items: Array<{ code: string; name: string; sortOrder: number }> = [
    { code: 'SALARY', name: 'Atlyginimai', sortOrder: 10 },
    { code: 'INVESTMENT', name: 'Investicijos', sortOrder: 20 },
  ];
  const itemIdsByCode: Record<string, number> = {};
  for (const item of items) {
    const inserted = (await knex('classifier_items')
      .insert({
        group_id: groupId,
        parent_id: null,
        code: item.code,
        name: item.name,
        sort_order: item.sortOrder,
        active: true,
      })
      .returning('id')) as Array<{ id: number }>;
    const id = inserted[0]?.id;
    if (id === undefined) {
      throw new Error(`Test fixture: nepavyko sukurti funding_type item ${item.code}`);
    }
    itemIdsByCode[item.code] = id;
  }

  return { groupId, itemIdsByCode };
}

async function seedOldBudgetWith1500k(
  knex: Knex,
  salaryItemId: number,
  investmentItemId: number,
): Promise<number> {
  const inserted = (await knex('budgets')
    .insert({
      year: 2026,
      total_amount: '1500000.00',
      notes: 'Test fixture — 2026 m. biudžetas',
    })
    .returning('id')) as Array<{ id: number }>;
  const budgetId = inserted[0]?.id;
  if (budgetId === undefined) {
    throw new Error('Test fixture: nepavyko sukurti budgets');
  }

  await knex('budget_allocations').insert([
    {
      budget_id: budgetId,
      classifier_item_id: salaryItemId,
      amount: '500000.00',
    },
    {
      budget_id: budgetId,
      classifier_item_id: investmentItemId,
      amount: '1000000.00',
    },
  ]);

  return budgetId;
}

describe('FVM foundation migration', () => {
  let knex: Knex;

  beforeAll(async () => {
    knex = getTestKnex();
  });

  afterAll(async () => {
    // Visada palieki DB migruotą po šito spec'o (kiti spec'ai gali tikėtis,
    // kad latest schema yra), kad būtų idempotentiškas paleidimas.
    const isAtLatest = (await knex.migrate.currentVersion()).startsWith(
      '20260522100000',
    );
    if (!isAtLatest) {
      await knex.migrate.latest();
    }
    await closeTestKnex();
  });

  describe('Test 1: data migration pervaro senus įrašus', () => {
    let amTenantId: number;

    beforeAll(async () => {
      await truncateAll(knex);

      // Rollback FVM migration only (nepaliekam senųjų po setup'o).
      // currentVersion turi būti FVM — global-setup paleido latest.
      //
      // PASTABA (Iter 11+12+13): nuo Iter 13 yra `payroll_distributions` su
      // FK į `funding_sources`. Nuo Iter 12 yra `expenses` lentelė su FK į
      // `projects` ir `budget_allocations_v2`. Nuo Iter 11 yra `projects`
      // lentelė su FK į `budget_allocations_v2`. Norint rollback'inti Iter 9
      // (foundation), pirma reikia rollback'inti vėlesnes migracijas —
      // pradėdami nuo naujausios (payroll), kitaip FK constraint'ai užkirs
      // kelią DROP TABLE komandoms.
      const hasPayroll = await knex.schema.hasTable('payroll_profiles');
      if (hasPayroll) {
        await knex.migrate.down({ name: '20260526100000_create_payroll.ts' });
      }
      const hasExpenses = await knex.schema.hasTable('expenses');
      if (hasExpenses) {
        await knex.migrate.down({ name: '20260525100000_create_expenses.ts' });
      }
      const hasProjects = await knex.schema.hasTable('projects');
      if (hasProjects) {
        await knex.migrate.down({ name: '20260524100000_create_projects.ts' });
      }
      const hasFvmFields = await knex.schema.hasColumn('requests', 'fvm_project_id');
      if (hasFvmFields) {
        await knex.migrate.down({
          name: '20260523100000_add_fvm_fields_to_requests.ts',
        });
      }
      // Dabar likę paleistos tik iki Iter 9 imtinai — rollback'inam pačią Iter 9.
      await knex.migrate.down({ name: FVM_MIGRATION });

      // Seed AM tenant + admin user.
      const fixtures = await seedBaseFixtures(knex);
      amTenantId = fixtures.amTenantId;

      // Seed legacy funding_type classifier (kad budget_allocations galėtų
      // referuoti į classifier_items).
      const legacy = await seedLegacyFundingTypeClassifier(knex);

      // Seed budget'ą su 2 allocation'ais.
      await seedOldBudgetWith1500k(
        knex,
        legacy.itemIdsByCode['SALARY']!,
        legacy.itemIdsByCode['INVESTMENT']!,
      );

      // Roll'inam FVM migraciją up — data migration vyks paskutiniam žingsniui.
      await knex.migrate.up({ name: FVM_MIGRATION });
    });

    it('sukūrė 1 funding_source 2026 metams su metine_suma = 1.5M', async () => {
      const sources = await knex('funding_sources').select('*');
      expect(sources).toHaveLength(1);
      const source = sources[0]!;
      expect(source.metai).toBe(2026);
      expect(Number(source.metine_suma)).toBeCloseTo(1500000, 2);
      expect(source.tenant_id).toBe(amTenantId);
      expect(source.aktyvus).toBe(true);
      expect(source.kodas).toBe('VB-2026');
      expect(source.pavadinimas).toBe('Valstybės biudžetas 2026');
    });

    it('funding_source tipas yra "biudzetas"', async () => {
      const result = await knex('funding_sources as fs')
        .join(
          'classifier_items as ci',
          'ci.id',
          'fs.tipas_classifier_item_id',
        )
        .select<Array<{ code: string }>>('ci.code')
        .first();
      expect(result?.code).toBe('biudzetas');
    });

    it('sukūrė 2 budget_allocations_v2 su teisingomis sumomis', async () => {
      const allocations = await knex('budget_allocations_v2')
        .orderBy('planuota_suma')
        .select('*');
      expect(allocations).toHaveLength(2);
      const sums = allocations.map((a) => Number(a.planuota_suma));
      expect(sums).toEqual([500000, 1000000]);
      // Visi turi metai=2026 ir funding_source_id į vienintelį source.
      const sourceRow = await knex('funding_sources').first<{ id: number }>('id');
      const sourceId = sourceRow?.id;
      for (const a of allocations) {
        expect(a.metai).toBe(2026);
        expect(a.funding_source_id).toBe(sourceId);
      }
    });

    it('budget_allocations_v2 sumų agregacija = 1.5M (lygi old budgets)', async () => {
      const row = await knex('budget_allocations_v2')
        .sum<Array<{ sum: string | null }>>('planuota_suma as sum')
        .first();
      expect(Number(row?.sum ?? 0)).toBeCloseTo(1500000, 2);
    });

    it('allocations'.concat(' kategorijos pamapintos teisingai (du + investicijos)'), async () => {
      const rows = await knex('budget_allocations_v2 as ba')
        .join(
          'classifier_items as ci',
          'ci.id',
          'ba.category_classifier_item_id',
        )
        .join('classifier_groups as cg', 'cg.id', 'ci.group_id')
        .where('cg.code', 'budget_category')
        .orderBy('ba.planuota_suma')
        .select<Array<{ code: string }>>('ci.code');
      expect(rows.map((r) => r.code)).toEqual(['du', 'investicijos']);
    });
  });

  describe('Test 2: klasifikatoriai seedinti', () => {
    beforeAll(async () => {
      // Test 1 paliko schema užmigruotą — jokio papildomo setup nereikia.
      // Klasifikatoriai jau seedinti per migraciją.
    });

    it('funding_source_type grupė egzistuoja su 3 items', async () => {
      const group = await knex('classifier_groups')
        .where({ code: 'funding_source_type' })
        .first<{ id: number; name: string }>();
      expect(group).toBeDefined();
      expect(group?.name).toBe('Finansavimo šaltinio tipas');

      const items = await knex('classifier_items')
        .where({ group_id: group!.id })
        .orderBy('sort_order')
        .select<Array<{ code: string; name: string }>>('code', 'name');
      const codes = items.map((i) => i.code);
      expect(codes).toEqual(['biudzetas', 'es', 'kita']);
      const names = items.map((i) => i.name);
      expect(names).toContain('Valstybės biudžetas');
      expect(names).toContain('ES fondai');
      expect(names).toContain('Kiti');
    });

    it('budget_category grupė egzistuoja su 5 items', async () => {
      const group = await knex('classifier_groups')
        .where({ code: 'budget_category' })
        .first<{ id: number; name: string }>();
      expect(group).toBeDefined();
      expect(group?.name).toBe('Biudžeto kategorija');

      const items = await knex('classifier_items')
        .where({ group_id: group!.id })
        .orderBy('sort_order')
        .select<Array<{ code: string }>>('code');
      const codes = items.map((i) => i.code);
      expect(codes).toEqual([
        'du',
        'spec_programa',
        'prekes_paslaugos',
        'investicijos',
        'kita',
      ]);
    });
  });

  describe('Test 3: rollback veikia', () => {
    beforeAll(async () => {
      // Įsitikinam, kad esame "latest" prieš rollback'ą.
      await knex.migrate.latest();
      // Pradžioje — patikrinam, kad lentelės yra (skraidant tarp test setup'ų).
      const hasFs = await knex.schema.hasTable('funding_sources');
      const hasBav2 = await knex.schema.hasTable('budget_allocations_v2');
      expect(hasFs).toBe(true);
      expect(hasBav2).toBe(true);

      // Roll'inam migraciją down.
      // PASTABA (Iter 11+12+13): nuo Iter 13 yra `payroll_distributions` su
      // FK į `funding_sources`. Nuo Iter 12 yra `expenses` su FK į `projects`
      // ir `budget_allocations_v2`. Nuo Iter 11 yra `projects` su FK į
      // `budget_allocations_v2`. Pirma rollback'inam vėlesnes migracijas
      // (nuo naujausios atgal), tada pačią Iter 9 (foundation). Žr.
      // analogišką paaiškinimą Test 1.
      const hasPayrollHere = await knex.schema.hasTable('payroll_profiles');
      if (hasPayrollHere) {
        await knex.migrate.down({ name: '20260526100000_create_payroll.ts' });
      }
      const hasExpensesHere = await knex.schema.hasTable('expenses');
      if (hasExpensesHere) {
        await knex.migrate.down({ name: '20260525100000_create_expenses.ts' });
      }
      const hasProjectsHere = await knex.schema.hasTable('projects');
      if (hasProjectsHere) {
        await knex.migrate.down({ name: '20260524100000_create_projects.ts' });
      }
      const hasFvmFieldsHere = await knex.schema.hasColumn(
        'requests',
        'fvm_project_id',
      );
      if (hasFvmFieldsHere) {
        await knex.migrate.down({
          name: '20260523100000_add_fvm_fields_to_requests.ts',
        });
      }
      await knex.migrate.down({ name: FVM_MIGRATION });
    });

    afterAll(async () => {
      // Atstatom — kad sekantis test'as (Test 4) gautų pilną schema.
      await knex.migrate.latest();
    });

    it('po rollback funding_sources nedingo iš schema', async () => {
      const hasFs = await knex.schema.hasTable('funding_sources');
      expect(hasFs).toBe(false);
    });

    it('po rollback budget_allocations_v2 nedingo iš schema', async () => {
      const hasBav2 = await knex.schema.hasTable('budget_allocations_v2');
      expect(hasBav2).toBe(false);
    });

    it('senos lentelės budgets ir budget_allocations po rollback'.concat(' liko (Iter 16 task)'), async () => {
      const hasOldBudgets = await knex.schema.hasTable('budgets');
      const hasOldAllocations = await knex.schema.hasTable('budget_allocations');
      expect(hasOldBudgets).toBe(true);
      expect(hasOldAllocations).toBe(true);
    });
  });

  describe('Test 4: verifyFvmFoundation FAIL detect', () => {
    let amTenantId: number;

    beforeAll(async () => {
      // Pilnai švari būsena: schema latest, lentelės tuščios.
      await knex.migrate.latest();
      await truncateAll(knex);
      const fixtures = await seedBaseFixtures(knex);
      amTenantId = fixtures.amTenantId;
    });

    it('throw'.concat(' kai SUM(allocations) > funding_source.metine_suma'), async () => {
      // Po migracijos klasifikatoriai turėtų egzistuoti, BET truncateAll
      // juos išvalė. Re-seedinam tiek, kiek reikia.
      const fsTypeGroup = (await knex('classifier_groups')
        .insert({
          code: 'funding_source_type',
          name: 'Finansavimo šaltinio tipas',
          description: 'test re-seed',
          active: true,
        })
        .returning('id')) as Array<{ id: number }>;
      const fsTypeGroupId = fsTypeGroup[0]?.id;
      if (fsTypeGroupId === undefined) throw new Error('fixture fail');

      const biudzetasItem = (await knex('classifier_items')
        .insert({
          group_id: fsTypeGroupId,
          parent_id: null,
          code: 'biudzetas',
          name: 'Valstybės biudžetas',
          sort_order: 10,
          active: true,
        })
        .returning('id')) as Array<{ id: number }>;
      const biudzetasItemId = biudzetasItem[0]?.id;
      if (biudzetasItemId === undefined) throw new Error('fixture fail');

      const budgetCategoryGroup = (await knex('classifier_groups')
        .insert({
          code: 'budget_category',
          name: 'Biudžeto kategorija',
          description: 'test re-seed',
          active: true,
        })
        .returning('id')) as Array<{ id: number }>;
      const budgetCategoryGroupId = budgetCategoryGroup[0]?.id;
      if (budgetCategoryGroupId === undefined) throw new Error('fixture fail');

      const duItem = (await knex('classifier_items')
        .insert({
          group_id: budgetCategoryGroupId,
          parent_id: null,
          code: 'du',
          name: 'Darbo užmokestis',
          sort_order: 10,
          active: true,
        })
        .returning('id')) as Array<{ id: number }>;
      const duItemId = duItem[0]?.id;
      if (duItemId === undefined) throw new Error('fixture fail');

      // Sukuriam funding_source su mažesne metine_suma nei vėliau įdėsim
      // allocation'us — over-commit scenarijus.
      const fs = (await knex('funding_sources')
        .insert({
          tenant_id: amTenantId,
          pavadinimas: 'Test šaltinis',
          kodas: 'TEST-2026',
          tipas_classifier_item_id: biudzetasItemId,
          metai: 2026,
          metine_suma: '100.00', // tik 100 €
          aprasymas: 'test fixture',
          aktyvus: true,
        })
        .returning('id')) as Array<{ id: number }>;
      const fsId = fs[0]?.id;
      if (fsId === undefined) throw new Error('fixture fail');

      // Įdedam allocation su 200 € (daugiau nei 100 € šaltinio).
      await knex('budget_allocations_v2').insert({
        funding_source_id: fsId,
        category_classifier_item_id: duItemId,
        pavadinimas: 'Test allocation',
        planuota_suma: '200.00',
        metai: 2026,
        pastabos: 'over-commit test',
      });

      // Įdedam taipogi seną allocation, kad count check'as praeitų
      // (nes oldCount=newCount=1 — patikrina sum match irgi).
      // Hmm... Test 4 izoliuotai: senos lentelės tuščios, naujos turi 1
      // įrašą — count NESUTAMPA (0 vs 1) — bet tai irgi yra fail (žinome,
      // expect'inam throw). Reikia būti tikslesniems su test'u: noriam
      // overcommit'o, ne count mismatch'o.
      // Tam pridėsim seną budget+allocation kad sum sutaptų bet vis tiek
      // overcommit'as įvyktų.
      const oldBudget = (await knex('budgets')
        .insert({
          year: 2026,
          total_amount: '200.00',
          notes: 'test',
        })
        .returning('id')) as Array<{ id: number }>;
      const oldBudgetId = oldBudget[0]?.id;
      if (oldBudgetId === undefined) throw new Error('fixture fail');

      await knex('budget_allocations').insert({
        budget_id: oldBudgetId,
        classifier_item_id: duItemId,
        amount: '200.00',
      });

      // Dabar: senos count=1, naujos count=1; senos sum=200, naujos sum=200;
      // bet funding_source.metine_suma=100 < 200 — overcommit.
      await expect(verifyFvmFoundation(knex)).rejects.toThrow(/overcommitted/);
    });
  });
});
