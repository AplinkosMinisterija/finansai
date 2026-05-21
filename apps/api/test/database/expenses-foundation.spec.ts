/**
 * FVM expenses migracijos integration test'as (Iter 12).
 *
 * Test'ai (8):
 *  1. Po migracijos `expenses` turi visus 11 schema laukų (žr. §6.4
 *     architektūros dok'e + iter-12 brief'e). Plius CHECK constraint
 *     `tipas` ir GIN indeksas `idx_expenses_saltinio_dalis_gin` egzistuoja.
 *  2. CHECK constraint `tipas`: insert su `tipas='invalid'` throw'ina PG
 *     check_violation.
 *  3. FK constraint `project_id`: insert su neegzistuojančiu projektu
 *     throw'ina FK violation.
 *  4. ON DELETE RESTRICT ant `project_id`: bandant ištrint projektą su
 *     priklausančia išlaida — DB throw'ina FK violation.
 *  5. ON DELETE RESTRICT ant `budget_allocation_id`: bandant ištrint
 *     allocation, į kurį rodo išlaida — DB throw'ina FK violation.
 *  6. `saltinio_dalis` jsonb veikia: insert su array
 *     `[{ funding_source_id: N, suma: "..." }, ...]` — sėkmingai
 *     grąžinama kaip jsonb (parsed array).
 *  7. GIN index query veikia: `SELECT WHERE saltinio_dalis @>
 *     '[{"funding_source_id": N}]'::jsonb` grąžina teisingus rezultatus
 *     (filtruoja pagal funding_source_id per containment'ą).
 *  8. Rollback (`migrate.down`) — `expenses` lentelė + GIN indeksas dingo
 *     iš schemos.
 *
 * Pastaba: `global-setup.ts` jau paleido visas migracijas test DB. Per
 * test'us specifiškai apsisukam šitą migraciją per `migrate.down` /
 * `migrate.up` Test'e 8 — rollback patikrinimui. Kiti testai naudoja
 * latest schema.
 */
import type { Knex } from 'knex';
import {
  getTestKnex,
  closeTestKnex,
  truncateAll,
  seedBaseFixtures,
  seedFvmClassifiers,
  type BaseFixtures,
  type FvmClassifierFixtures,
} from '../helpers/db';

const EXPENSES_MIGRATION = '20260525100000_create_expenses.ts';

const EXPECTED_COLUMNS = [
  'id',
  'project_id',
  'budget_allocation_id',
  'tipas',
  'suma',
  'data',
  'aprasymas',
  'saltinio_dalis',
  'created_by_user_id',
  'created_at',
  'updated_at',
] as const;

interface ColumnRow {
  column_name: string;
  data_type: string;
  is_nullable: 'YES' | 'NO';
}

async function getExpensesColumnSet(knex: Knex): Promise<Set<string>> {
  const rows = (await knex('information_schema.columns')
    .where({ table_schema: 'public', table_name: 'expenses' })
    .select<ColumnRow[]>(
      'column_name',
      'data_type',
      'is_nullable',
    )) as ColumnRow[];
  return new Set(rows.map((r) => r.column_name));
}

interface SeededContext {
  fixtures: BaseFixtures;
  classifiers: FvmClassifierFixtures;
  fundingSourceId: number;
  secondFundingSourceId: number;
  budgetAllocationId: number;
  projectId: number;
}

/**
 * Įdeda visą reikalingą "lattice" expense insert'ams:
 *  - AM tenant + admin user'is (per seedBaseFixtures)
 *  - FVM klasifikatoriai (per seedFvmClassifiers)
 *  - 2 funding_sources (kad multi-source split testai turėtų ką naudoti)
 *  - 1 budget_allocation_v2 (prekes_paslaugos kategorija, 500.000)
 *  - 1 projektas (planuojama statuse, biudžetas 50.000)
 *
 * Šie ID'ai bus naudojami visuose expense insert'uose toliau.
 */
async function seedExpensesContext(knex: Knex): Promise<SeededContext> {
  const fixtures = await seedBaseFixtures(knex);
  const classifiers = await seedFvmClassifiers(knex);

  // Funding source #1 — pagrindinis (biudžetas).
  const insertedSource1 = (await knex('funding_sources')
    .insert({
      tenant_id: fixtures.amTenantId,
      pavadinimas: 'Valstybės biudžetas 2026 (test)',
      kodas: 'VB-2026-TEST',
      tipas_classifier_item_id: classifiers.fundingSourceTypeItemIds.biudzetas,
      metai: 2026,
      metine_suma: '1000000.00',
      aprasymas: 'test fixture',
      aktyvus: true,
    })
    .returning('id')) as Array<{ id: number }>;
  const fundingSourceId = insertedSource1[0]?.id;
  if (fundingSourceId === undefined) {
    throw new Error('Test fixture: nepavyko sukurti funding_source #1');
  }

  // Funding source #2 — ES fondai (multi-source split scenarijams).
  const insertedSource2 = (await knex('funding_sources')
    .insert({
      tenant_id: fixtures.amTenantId,
      pavadinimas: 'ES fondai 2026 (test)',
      kodas: 'ES-2026-TEST',
      tipas_classifier_item_id: classifiers.fundingSourceTypeItemIds.es,
      metai: 2026,
      metine_suma: '500000.00',
      aprasymas: 'test fixture — ES',
      aktyvus: true,
    })
    .returning('id')) as Array<{ id: number }>;
  const secondFundingSourceId = insertedSource2[0]?.id;
  if (secondFundingSourceId === undefined) {
    throw new Error('Test fixture: nepavyko sukurti funding_source #2');
  }

  const insertedAlloc = (await knex('budget_allocations_v2')
    .insert({
      funding_source_id: fundingSourceId,
      category_classifier_item_id:
        classifiers.budgetCategoryItemIds.prekes_paslaugos,
      pavadinimas: 'Prekės ir paslaugos 2026',
      planuota_suma: '500000.00',
      metai: 2026,
      pastabos: 'test fixture',
    })
    .returning('id')) as Array<{ id: number }>;
  const budgetAllocationId = insertedAlloc[0]?.id;
  if (budgetAllocationId === undefined) {
    throw new Error('Test fixture: nepavyko sukurti budget_allocation_v2');
  }

  const insertedProj = (await knex('projects')
    .insert({
      tenant_id: fixtures.amTenantId,
      budget_allocation_id: budgetAllocationId,
      request_id: null,
      pavadinimas: 'IT infrastruktūros modernizavimas (test)',
      tipas: 'projektas',
      biudzetas: '50000.00',
      pradzios_data: '2026-01-01',
      pabaigos_data: '2026-12-31',
      statusas: 'planuojama',
      atsakingas_user_id: fixtures.amAdminUserId,
      aprasymas: 'Test fixture — projektas išlaidoms',
    })
    .returning('id')) as Array<{ id: number }>;
  const projectId = insertedProj[0]?.id;
  if (projectId === undefined) {
    throw new Error('Test fixture: nepavyko sukurti projekto');
  }

  return {
    fixtures,
    classifiers,
    fundingSourceId,
    secondFundingSourceId,
    budgetAllocationId,
    projectId,
  };
}

describe('FVM expenses migration (Iter 12)', () => {
  let knex: Knex;

  beforeAll(async () => {
    knex = getTestKnex();
  });

  afterAll(async () => {
    // Palieki DB su naujausia schema, kad kiti spec'ai matytų pilną struktūrą.
    const isAtLatest = (await knex.migrate.currentVersion()).startsWith(
      '20260525100000',
    );
    if (!isAtLatest) {
      await knex.migrate.latest();
    }
    await closeTestKnex();
  });

  describe('Test 1: expenses lentelė turi visus 11 laukų + CHECK + GIN', () => {
    beforeAll(async () => {
      await knex.migrate.latest();
    });

    it('po migracijos expenses turi visus 11 (Iter 12) + 1 (Iter 14) kolonų pagal §6.4', async () => {
      const columns = await getExpensesColumnSet(knex);
      for (const col of EXPECTED_COLUMNS) {
        expect(columns.has(col)).toBe(true);
      }
      // Iter 14 (FVM-6) pridėjo `payroll_profile_id` koloną — tikrinam, kad ir
      // ji yra (vienas papildomas laukas virš §6.4 pradinių 11).
      expect(columns.has('payroll_profile_id')).toBe(true);
      // Patikrinam, kad būtent 12 (Iter 12 — 11 + Iter 14 — 1).
      expect(columns.size).toBe(EXPECTED_COLUMNS.length + 1);
    });

    it('saltinio_dalis kolona yra jsonb tipo ir nullable', async () => {
      const row = (await knex('information_schema.columns')
        .where({
          table_schema: 'public',
          table_name: 'expenses',
          column_name: 'saltinio_dalis',
        })
        .first<ColumnRow>('column_name', 'data_type', 'is_nullable')) as
        | ColumnRow
        | undefined;
      expect(row).toBeDefined();
      expect(row!.data_type).toBe('jsonb');
      expect(row!.is_nullable).toBe('YES');
    });

    it('CHECK constraint expenses_tipas_check egzistuoja', async () => {
      const rows = (await knex('information_schema.table_constraints')
        .where({
          table_schema: 'public',
          table_name: 'expenses',
          constraint_type: 'CHECK',
        })
        .select<Array<{ constraint_name: string }>>(
          'constraint_name',
        )) as Array<{ constraint_name: string }>;
      const names = rows.map((r) => r.constraint_name);
      expect(names).toEqual(
        expect.arrayContaining(['expenses_tipas_check']),
      );
    });

    it('GIN indeksas idx_expenses_saltinio_dalis_gin egzistuoja', async () => {
      const rows = (await knex('pg_indexes')
        .where({
          schemaname: 'public',
          tablename: 'expenses',
          indexname: 'idx_expenses_saltinio_dalis_gin',
        })
        .select<Array<{ indexname: string; indexdef: string }>>(
          'indexname',
          'indexdef',
        )) as Array<{ indexname: string; indexdef: string }>;
      expect(rows).toHaveLength(1);
      // Patikrinam, kad indeksas naudoja gin + jsonb_path_ops.
      expect(rows[0]!.indexdef).toMatch(/USING gin/i);
      expect(rows[0]!.indexdef).toMatch(/jsonb_path_ops/);
    });
  });

  describe('Test 2: CHECK constraint tipas — neleistina reikšmė', () => {
    let ctx: SeededContext;

    beforeAll(async () => {
      await knex.migrate.latest();
      await truncateAll(knex);
      ctx = await seedExpensesContext(knex);
    });

    it('insert su tipas="invalid" throw\'ina PG check_violation', async () => {
      await expect(
        knex('expenses').insert({
          project_id: ctx.projectId,
          budget_allocation_id: ctx.budgetAllocationId,
          tipas: 'invalid',
          suma: '100.00',
          data: '2026-02-15',
          aprasymas: 'Bad tipas',
          saltinio_dalis: null,
          created_by_user_id: ctx.fixtures.amAdminUserId,
        }),
      ).rejects.toThrow(/expenses_tipas_check/);
    });

    it('visi 4 leistini tipai priimami', async () => {
      // Patikrinam, kad CHECK leidžia visas 4 dokumentuotas reikšmes
      // (du, sutartis, saskaita, tiesiogine). Insert'inam keturias atskiras
      // eilutes — jei kurios nors fail'intų, throw bus.
      const types = ['du', 'sutartis', 'saskaita', 'tiesiogine'] as const;
      for (const tipas of types) {
        const inserted = (await knex('expenses')
          .insert({
            project_id: ctx.projectId,
            budget_allocation_id: ctx.budgetAllocationId,
            tipas,
            suma: '10.00',
            data: '2026-02-15',
            aprasymas: `Test ${tipas}`,
            saltinio_dalis: null,
            created_by_user_id: ctx.fixtures.amAdminUserId,
          })
          .returning(['id', 'tipas'])) as Array<{ id: number; tipas: string }>;
        expect(inserted[0]?.tipas).toBe(tipas);
      }
    });
  });

  describe('Test 3: FK constraint project_id — neegzistuojantis projektas', () => {
    let ctx: SeededContext;

    beforeAll(async () => {
      await knex.migrate.latest();
      await truncateAll(knex);
      ctx = await seedExpensesContext(knex);
    });

    it('insert su project_id=999999 throw\'ina FK violation', async () => {
      await expect(
        knex('expenses').insert({
          project_id: 999_999,
          budget_allocation_id: ctx.budgetAllocationId,
          tipas: 'saskaita',
          suma: '100.00',
          data: '2026-02-15',
          aprasymas: 'Bad project_id',
          saltinio_dalis: null,
          created_by_user_id: ctx.fixtures.amAdminUserId,
        }),
      ).rejects.toThrow(/expenses_project_id_foreign/);
    });

    it('insert su budget_allocation_id=999999 throw\'ina FK violation', async () => {
      await expect(
        knex('expenses').insert({
          project_id: ctx.projectId,
          budget_allocation_id: 999_999,
          tipas: 'saskaita',
          suma: '100.00',
          data: '2026-02-15',
          aprasymas: 'Bad allocation_id',
          saltinio_dalis: null,
          created_by_user_id: ctx.fixtures.amAdminUserId,
        }),
      ).rejects.toThrow(/expenses_budget_allocation_id_foreign/);
    });
  });

  describe('Test 4: ON DELETE RESTRICT — project_id', () => {
    let ctx: SeededContext;

    beforeAll(async () => {
      await knex.migrate.latest();
      await truncateAll(knex);
      ctx = await seedExpensesContext(knex);

      // Įdedam išlaidą, susietą su projektu.
      await knex('expenses').insert({
        project_id: ctx.projectId,
        budget_allocation_id: ctx.budgetAllocationId,
        tipas: 'saskaita',
        suma: '250.00',
        data: '2026-03-10',
        aprasymas: 'Saskaita — RESTRICT test',
        saltinio_dalis: null,
        created_by_user_id: ctx.fixtures.amAdminUserId,
      });
    });

    it('bandant ištrint projektą su priklausančia išlaida — FK violation', async () => {
      await expect(
        knex('projects').where({ id: ctx.projectId }).del(),
      ).rejects.toThrow(/expenses_project_id_foreign/);

      // Sanity check: projektas vis dar yra.
      const row = (await knex('projects')
        .where({ id: ctx.projectId })
        .first<{ id: number }>()) as { id: number } | undefined;
      expect(row?.id).toBe(ctx.projectId);
    });
  });

  describe('Test 5: ON DELETE RESTRICT — budget_allocation_id', () => {
    let ctx: SeededContext;
    let isolatedAllocationId: number;

    beforeAll(async () => {
      await knex.migrate.latest();
      await truncateAll(knex);
      ctx = await seedExpensesContext(knex);

      // Sukuriam ATSKIRĄ allocation, į kurį nukreipsim TIK išlaidą (be
      // projekto sąsajos), kad RESTRICT testas patikrintų būtent
      // expenses->budget_allocations_v2 FK (ne projects->budget_allocations_v2
      // FK iš Iter 11). Pati `expenses.budget_allocation_id` schema leidžia
      // skirtis nuo projekto numatytojo allocation — žr. backend brief'ą,
      // kuris mini „leidžiama skirtinga jei vartotojas eksplicitiškai
      // nurodo (rare case)".
      const insertedAlloc = (await knex('budget_allocations_v2')
        .insert({
          funding_source_id: ctx.fundingSourceId,
          category_classifier_item_id:
            ctx.classifiers.budgetCategoryItemIds.investicijos,
          pavadinimas: 'Investicijos 2026 (RESTRICT test)',
          planuota_suma: '100000.00',
          metai: 2026,
          pastabos: 'test fixture — atskira allocation',
        })
        .returning('id')) as Array<{ id: number }>;
      const allocId = insertedAlloc[0]?.id;
      if (allocId === undefined) {
        throw new Error('Test fixture: nepavyko sukurti atskiros allocation');
      }
      isolatedAllocationId = allocId;

      // Įdedam išlaidą, susietą su naująja allocation.
      await knex('expenses').insert({
        project_id: ctx.projectId,
        budget_allocation_id: isolatedAllocationId,
        tipas: 'sutartis',
        suma: '1500.00',
        data: '2026-04-05',
        aprasymas: 'Sutartis — RESTRICT test',
        saltinio_dalis: null,
        created_by_user_id: ctx.fixtures.amAdminUserId,
      });
    });

    it('bandant ištrint allocation su priklausančia išlaida — FK violation', async () => {
      await expect(
        knex('budget_allocations_v2').where({ id: isolatedAllocationId }).del(),
      ).rejects.toThrow(/expenses_budget_allocation_id_foreign/);

      // Sanity check: allocation vis dar yra.
      const row = (await knex('budget_allocations_v2')
        .where({ id: isolatedAllocationId })
        .first<{ id: number }>()) as { id: number } | undefined;
      expect(row?.id).toBe(isolatedAllocationId);
    });
  });

  describe('Test 6: saltinio_dalis jsonb — insert ir read array', () => {
    let ctx: SeededContext;

    beforeAll(async () => {
      await knex.migrate.latest();
      await truncateAll(knex);
      ctx = await seedExpensesContext(knex);
    });

    it('insert su saltinio_dalis array — sėkmingai grąžinama kaip jsonb (parsed)', async () => {
      // Multi-source split: 600 € iš biudžeto + 400 € iš ES = 1000 € total.
      const saltinioDalis = [
        { funding_source_id: ctx.fundingSourceId, suma: '600.00' },
        { funding_source_id: ctx.secondFundingSourceId, suma: '400.00' },
      ];

      // Knex'ui jsonb reikšmę paduodam per `JSON.stringify`, kad pg
      // klientas teisingai serializuotų array kaip vieną jsonb reikšmę
      // (ne kaip kelias atskiras eilutes per INSERT).
      const inserted = (await knex('expenses')
        .insert({
          project_id: ctx.projectId,
          budget_allocation_id: ctx.budgetAllocationId,
          tipas: 'saskaita',
          suma: '1000.00',
          data: '2026-05-12',
          aprasymas: 'Multi-source split saskaita',
          saltinio_dalis: JSON.stringify(saltinioDalis),
          created_by_user_id: ctx.fixtures.amAdminUserId,
        })
        .returning(['id', 'suma', 'saltinio_dalis'])) as Array<{
        id: number;
        suma: string;
        saltinio_dalis: Array<{ funding_source_id: number; suma: string }>;
      }>;
      const row = inserted[0];
      expect(row).toBeDefined();
      expect(row!.id).toBeGreaterThan(0);
      expect(Number(row!.suma)).toBeCloseTo(1000, 2);
      // pg klientas automatiškai parse'ina jsonb į JS object/array.
      expect(Array.isArray(row!.saltinio_dalis)).toBe(true);
      expect(row!.saltinio_dalis).toHaveLength(2);
      expect(row!.saltinio_dalis[0]).toEqual({
        funding_source_id: ctx.fundingSourceId,
        suma: '600.00',
      });
      expect(row!.saltinio_dalis[1]).toEqual({
        funding_source_id: ctx.secondFundingSourceId,
        suma: '400.00',
      });
    });

    it('insert su saltinio_dalis=NULL (single-source default) — sėkmingai', async () => {
      const inserted = (await knex('expenses')
        .insert({
          project_id: ctx.projectId,
          budget_allocation_id: ctx.budgetAllocationId,
          tipas: 'tiesiogine',
          suma: '50.00',
          data: '2026-05-15',
          aprasymas: 'Tiesioginė be split',
          saltinio_dalis: null,
          created_by_user_id: ctx.fixtures.amAdminUserId,
        })
        .returning(['id', 'saltinio_dalis'])) as Array<{
        id: number;
        saltinio_dalis: unknown;
      }>;
      const row = inserted[0];
      expect(row).toBeDefined();
      expect(row!.saltinio_dalis).toBeNull();
    });
  });

  describe('Test 7: GIN index query — saltinio_dalis containment', () => {
    let ctx: SeededContext;

    beforeAll(async () => {
      await knex.migrate.latest();
      await truncateAll(knex);
      ctx = await seedExpensesContext(knex);

      // Įdedam 3 expenses skirtingais split scenarijais:
      //  - #1: split biudzetas+ES (600+400)
      //  - #2: split tik ES (1000) — vienintelis šaltinis viduje array
      //  - #3: single-source (saltinio_dalis NULL) — neturi būti grąžinamas
      //        per `@>` query'us (NULL nepateks į GIN'ą)
      await knex('expenses').insert([
        {
          project_id: ctx.projectId,
          budget_allocation_id: ctx.budgetAllocationId,
          tipas: 'saskaita',
          suma: '1000.00',
          data: '2026-06-01',
          aprasymas: 'Multi: biudzetas + ES',
          saltinio_dalis: JSON.stringify([
            { funding_source_id: ctx.fundingSourceId, suma: '600.00' },
            { funding_source_id: ctx.secondFundingSourceId, suma: '400.00' },
          ]),
          created_by_user_id: ctx.fixtures.amAdminUserId,
        },
        {
          project_id: ctx.projectId,
          budget_allocation_id: ctx.budgetAllocationId,
          tipas: 'sutartis',
          suma: '2000.00',
          data: '2026-06-02',
          aprasymas: 'ES tik',
          saltinio_dalis: JSON.stringify([
            { funding_source_id: ctx.secondFundingSourceId, suma: '2000.00' },
          ]),
          created_by_user_id: ctx.fixtures.amAdminUserId,
        },
        {
          project_id: ctx.projectId,
          budget_allocation_id: ctx.budgetAllocationId,
          tipas: 'tiesiogine',
          suma: '50.00',
          data: '2026-06-03',
          aprasymas: 'Single-source (NULL)',
          saltinio_dalis: null,
          created_by_user_id: ctx.fixtures.amAdminUserId,
        },
      ]);
    });

    it('@> containment pagal pirmą funding_source_id grąžina 1 įrašą', async () => {
      // Ieškom expenses, kurių saltinio_dalis turi įrašą su biudžeto
      // funding_source_id. Pagal seed — turi būti tik #1.
      const filter = JSON.stringify([
        { funding_source_id: ctx.fundingSourceId },
      ]);
      const rows = (await knex('expenses')
        .whereRaw('saltinio_dalis @> ?::jsonb', [filter])
        .select<Array<{ id: number; aprasymas: string | null }>>(
          'id',
          'aprasymas',
        )) as Array<{ id: number; aprasymas: string | null }>;
      expect(rows).toHaveLength(1);
      expect(rows[0]!.aprasymas).toBe('Multi: biudzetas + ES');
    });

    it('@> containment pagal antrą funding_source_id grąžina 2 įrašus', async () => {
      // ES šaltinis matomas #1 (multi) ir #2 (vien ES).
      const filter = JSON.stringify([
        { funding_source_id: ctx.secondFundingSourceId },
      ]);
      const rows = (await knex('expenses')
        .whereRaw('saltinio_dalis @> ?::jsonb', [filter])
        .orderBy('id')
        .select<Array<{ id: number; aprasymas: string | null }>>(
          'id',
          'aprasymas',
        )) as Array<{ id: number; aprasymas: string | null }>;
      expect(rows).toHaveLength(2);
      const descriptions = rows.map((r) => r.aprasymas);
      expect(descriptions).toEqual([
        'Multi: biudzetas + ES',
        'ES tik',
      ]);
    });

    it('@> containment pagal neegzistuojantį funding_source_id grąžina 0', async () => {
      const filter = JSON.stringify([{ funding_source_id: 999_999 }]);
      const rows = (await knex('expenses')
        .whereRaw('saltinio_dalis @> ?::jsonb', [filter])
        .select<Array<{ id: number }>>('id')) as Array<{ id: number }>;
      expect(rows).toHaveLength(0);
    });
  });

  describe('Test 8: rollback (down) — expenses + GIN dingo', () => {
    beforeAll(async () => {
      // Įsitikinam, kad startuojam iš latest. Defensyvi patikra: jei
      // knex_migrations turi later'inį migracijos įrašą bet schema'oje
      // tos kolonos nėra (gali nutikti, kai priešesnis test'as rollback'ino
      // expenses tačiau migrate.latest po to nepaleido downstream migracijų),
      // ištrinam stale įrašą iš knex_migrations ir paleidžiam migrate.latest
      // iš naujo — kad mūsų down chain'as veiktų normaliai.
      await knex.migrate.latest();
      const hasPayrollProfileCol = await knex.schema.hasColumn(
        'expenses',
        'payroll_profile_id',
      );
      if (!hasPayrollProfileCol) {
        await knex('knex_migrations')
          .where({
            name: '20260527100000_add_payroll_profile_to_expenses.ts',
          })
          .del();
        await knex.migrate.latest();
      }
      const hasExpenses = await knex.schema.hasTable('expenses');
      expect(hasExpenses).toBe(true);

      // Roll'inam visus migracijų stack'us, kurie priklauso nuo `expenses`
      // lentelės — tvarka svarbi:
      //   1. `add_payroll_profile_to_expenses` (Iter 14) prideda koloną į
      //      expenses, todėl roll'inam pirmiausia (kitaip create_expenses
      //      down tos kolonos rasti negalėtų — nors konkrečiu atveju
      //      DROP TABLE viską nuima, knex_migrations table'as
      //      neatsinaujintų, kad migracija paliesta).
      //   2. `create_expenses` — pati lentelės kūrimas.
      // Šitas chain'as užtikrina, kad `migrate.latest()` po test'o vėl
      // teisingai išskaičiuoja, kurias migracijas reikia paleisti.
      await knex.migrate.down({
        name: '20260527100000_add_payroll_profile_to_expenses.ts',
      });
      await knex.migrate.down({ name: EXPENSES_MIGRATION });
    });

    afterAll(async () => {
      // Atstatom — afterAll aukščiau tikisi latest schemos.
      await knex.migrate.latest();
    });

    it('po rollback expenses lentelė dingo iš schema', async () => {
      const hasExpenses = await knex.schema.hasTable('expenses');
      expect(hasExpenses).toBe(false);
    });

    it('po rollback GIN indeksas idx_expenses_saltinio_dalis_gin dingo', async () => {
      // PostgreSQL DROP TABLE kartu nuima indeksus — patikrinam, kad iš
      // pg_indexes neliko įrašo.
      const rows = (await knex('pg_indexes')
        .where({
          schemaname: 'public',
          indexname: 'idx_expenses_saltinio_dalis_gin',
        })
        .select<Array<{ indexname: string }>>('indexname')) as Array<{
        indexname: string;
      }>;
      expect(rows).toHaveLength(0);
    });

    it('po rollback CHECK constraint expenses_tipas_check dingo', async () => {
      const rows = (await knex('information_schema.table_constraints')
        .where({
          table_schema: 'public',
          constraint_name: 'expenses_tipas_check',
        })
        .select<Array<{ constraint_name: string }>>(
          'constraint_name',
        )) as Array<{ constraint_name: string }>;
      expect(rows).toHaveLength(0);
    });
  });
});
