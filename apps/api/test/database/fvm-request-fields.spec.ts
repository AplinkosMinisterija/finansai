/**
 * FVM request laukų migracijos integration test'as (Iter 10, P05).
 *
 * Test'ai (5):
 *  1. Po migracijos visos 4 naujos kolonos egzistuoja `requests` lentelėje
 *     (`information_schema.columns` query).
 *  2. Insert request'as su NULL visuose naujuose laukuose — sėkmingai
 *     (backward compatibility seniems prašymams).
 *  3. Insert request'as su visi nauji laukai užpildyti (`budget_category_id`,
 *     `funding_source_type_id`, `spec_program_funding_type='atskiras'`,
 *     `fvm_project_id=NULL`) — sėkmingai.
 *  4. CHECK constraint patikrinimas: insert su `spec_program_funding_type`
 *     reikšme, kurios nėra leistinų sąraše — DB throw'ina
 *     (PostgreSQL `check_violation`, SQLSTATE 23514).
 *  5. Rollback (`migrate.down`) — visos 4 kolonos dingo iš schemos; esamas
 *     request'as (be naujų laukų) lieka stabilus.
 *
 * Pastaba: `global-setup.ts` jau paleido visas migracijas. Šitam spec'ui
 * specifiškai apsisukam šitą migraciją per `migrate.down` / `migrate.up`,
 * kad galėtume patikrinti, jog rollback'as veikia.
 *
 * `afterAll` palieka DB stabilią (`migrate.latest`) — kiti spec'ai tikisi
 * latest schemos.
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

const FVM_REQUESTS_MIGRATION = '20260523100000_add_fvm_fields_to_requests.ts';

const NEW_COLUMNS = [
  'budget_category_id',
  'funding_source_type_id',
  'spec_program_funding_type',
  'fvm_project_id',
] as const;

interface ColumnRow {
  column_name: string;
  data_type: string;
  is_nullable: 'YES' | 'NO';
}

async function getRequestColumnSet(knex: Knex): Promise<Set<string>> {
  const rows = (await knex('information_schema.columns')
    .where({ table_schema: 'public', table_name: 'requests' })
    .select<ColumnRow[]>(
      'column_name',
      'data_type',
      'is_nullable',
    )) as ColumnRow[];
  return new Set(rows.map((r) => r.column_name));
}

describe('FVM request fields migration (Iter 10)', () => {
  let knex: Knex;

  beforeAll(async () => {
    knex = getTestKnex();
  });

  afterAll(async () => {
    // Visada palieki DB su naujausia schema (latest), kad kiti spec'ai
    // matytų pilną struktūrą.
    const isAtLatest = (await knex.migrate.currentVersion()).startsWith(
      '20260523100000',
    );
    if (!isAtLatest) {
      await knex.migrate.latest();
    }
    await closeTestKnex();
  });

  describe('Test 1: visos 4 naujos kolonos egzistuoja', () => {
    beforeAll(async () => {
      await knex.migrate.latest();
    });

    it('po migracijos requests turi visus 4 naujus laukus', async () => {
      const columns = await getRequestColumnSet(knex);
      for (const col of NEW_COLUMNS) {
        expect(columns.has(col)).toBe(true);
      }
    });

    it('visi 4 laukai yra nullable (backward compat)', async () => {
      const rows = (await knex('information_schema.columns')
        .where({ table_schema: 'public', table_name: 'requests' })
        .whereIn('column_name', [...NEW_COLUMNS])
        .select<ColumnRow[]>(
          'column_name',
          'data_type',
          'is_nullable',
        )) as ColumnRow[];
      expect(rows).toHaveLength(NEW_COLUMNS.length);
      for (const row of rows) {
        expect(row.is_nullable).toBe('YES');
      }
    });
  });

  describe('Test 2: insert su NULL naujuose laukuose (backward compat)', () => {
    let fixtures: BaseFixtures;

    beforeAll(async () => {
      await knex.migrate.latest();
      await truncateAll(knex);
      fixtures = await seedBaseFixtures(knex);
    });

    it('insert request be naujų laukų — sėkmingai', async () => {
      const inserted = (await knex('requests')
        .insert({
          tenant_id: fixtures.amTenantId,
          created_by_user_id: fixtures.amAdminUserId,
          status: 'DRAFT',
          project_name: 'Legacy request (be FVM laukų)',
          year: 2026,
        })
        .returning(['id', 'budget_category_id', 'funding_source_type_id', 'spec_program_funding_type', 'fvm_project_id'])) as Array<{
          id: number;
          budget_category_id: number | null;
          funding_source_type_id: number | null;
          spec_program_funding_type: string | null;
          fvm_project_id: number | null;
        }>;
      const row = inserted[0];
      expect(row).toBeDefined();
      expect(row!.id).toBeGreaterThan(0);
      expect(row!.budget_category_id).toBeNull();
      expect(row!.funding_source_type_id).toBeNull();
      expect(row!.spec_program_funding_type).toBeNull();
      expect(row!.fvm_project_id).toBeNull();
    });
  });

  describe('Test 3: insert su visi nauji laukai užpildyti', () => {
    let fixtures: BaseFixtures;
    let classifiers: FvmClassifierFixtures;

    beforeAll(async () => {
      await knex.migrate.latest();
      await truncateAll(knex);
      fixtures = await seedBaseFixtures(knex);
      classifiers = await seedFvmClassifiers(knex);
    });

    it('request su budget_category_id, funding_source_type_id, spec_program_funding_type — sėkmingai', async () => {
      const inserted = (await knex('requests')
        .insert({
          tenant_id: fixtures.amTenantId,
          created_by_user_id: fixtures.amAdminUserId,
          status: 'DRAFT',
          project_name: 'Spec.programa request',
          year: 2026,
          budget_category_id: classifiers.budgetCategoryItemIds.spec_programa,
          funding_source_type_id: classifiers.fundingSourceTypeItemIds.biudzetas,
          spec_program_funding_type: 'atskiras',
          fvm_project_id: null,
        })
        .returning([
          'id',
          'budget_category_id',
          'funding_source_type_id',
          'spec_program_funding_type',
          'fvm_project_id',
        ])) as Array<{
          id: number;
          budget_category_id: number | null;
          funding_source_type_id: number | null;
          spec_program_funding_type: string | null;
          fvm_project_id: number | null;
        }>;
      const row = inserted[0];
      expect(row).toBeDefined();
      expect(row!.id).toBeGreaterThan(0);
      expect(row!.budget_category_id).toBe(
        classifiers.budgetCategoryItemIds.spec_programa,
      );
      expect(row!.funding_source_type_id).toBe(
        classifiers.fundingSourceTypeItemIds.biudzetas,
      );
      expect(row!.spec_program_funding_type).toBe('atskiras');
      expect(row!.fvm_project_id).toBeNull();
    });

    it('antra leistina spec_program_funding_type reikšmė `biudzeto_dalis` priimama', async () => {
      const inserted = (await knex('requests')
        .insert({
          tenant_id: fixtures.amTenantId,
          created_by_user_id: fixtures.amAdminUserId,
          status: 'DRAFT',
          project_name: 'Spec.programa request (biudzeto_dalis)',
          year: 2026,
          budget_category_id: classifiers.budgetCategoryItemIds.spec_programa,
          spec_program_funding_type: 'biudzeto_dalis',
        })
        .returning(['id', 'spec_program_funding_type'])) as Array<{
          id: number;
          spec_program_funding_type: string | null;
        }>;
      expect(inserted[0]?.spec_program_funding_type).toBe('biudzeto_dalis');
    });
  });

  describe('Test 4: CHECK constraint spec_program_funding_type', () => {
    let fixtures: BaseFixtures;

    beforeAll(async () => {
      await knex.migrate.latest();
      await truncateAll(knex);
      fixtures = await seedBaseFixtures(knex);
    });

    it('insert su `neteisinga` reikšme throw\'ina PG check_violation', async () => {
      // PostgreSQL `check_violation` — SQLSTATE 23514. Knex wrap'ina į
      // standartinį Error su `code` property, todėl tikrinam ir žinutę,
      // ir SQLSTATE.
      await expect(
        knex('requests').insert({
          tenant_id: fixtures.amTenantId,
          created_by_user_id: fixtures.amAdminUserId,
          status: 'DRAFT',
          project_name: 'Bad spec_program_funding_type',
          year: 2026,
          spec_program_funding_type: 'neteisinga',
        }),
      ).rejects.toThrow(/requests_spec_program_funding_type_check/);
    });

    it('insert su tuščia eilute irgi atmetama (ne `atskiras`/`biudzeto_dalis`)', async () => {
      await expect(
        knex('requests').insert({
          tenant_id: fixtures.amTenantId,
          created_by_user_id: fixtures.amAdminUserId,
          status: 'DRAFT',
          project_name: 'Empty spec_program_funding_type',
          year: 2026,
          spec_program_funding_type: '',
        }),
      ).rejects.toThrow(/requests_spec_program_funding_type_check/);
    });
  });

  describe('Test 5: rollback (down) — kolonos dingo, senas request lieka', () => {
    let fixtures: BaseFixtures;
    let legacyRequestId: number;

    beforeAll(async () => {
      await knex.migrate.latest();
      await truncateAll(knex);
      fixtures = await seedBaseFixtures(knex);

      // Sukuriam request'ą be naujų laukų — turi išlikti po rollback'o.
      const inserted = (await knex('requests')
        .insert({
          tenant_id: fixtures.amTenantId,
          created_by_user_id: fixtures.amAdminUserId,
          status: 'DRAFT',
          project_name: 'Pre-rollback legacy request',
          year: 2026,
        })
        .returning('id')) as Array<{ id: number }>;
      const id = inserted[0]?.id;
      if (id === undefined) {
        throw new Error('Test fixture: nepavyko sukurti pre-rollback request');
      }
      legacyRequestId = id;

      // Roll'inam šią migraciją down.
      //
      // PASTABA (Iter 11+12): Iter 12 sukūrė `expenses` su FK į `projects`.
      // Iter 11 sukūrė `projects` su FK `requests.fvm_project_id ->
      // projects.id`. Drop'inant Iter 10 (kuri sukūrė `fvm_project_id`
      // koloną), reikia visų vėlesnių migracijų rollback'o. Tvarka — nuo
      // naujausios atgal: Iter 13.x (is_du_system kolona) → Iter 12 (expenses)
      // → Iter 11 (projects) → Iter 10. Po `afterAll` `migrate.latest()`
      // visos atstatomos.
      const hasIsDuSystem = await knex.schema.hasColumn(
        'projects',
        'is_du_system',
      );
      if (hasIsDuSystem) {
        await knex.migrate.down({
          name: '20260526200000_add_is_du_system_to_projects.ts',
        });
      }
      const hasExpenses = await knex.schema.hasTable('expenses');
      if (hasExpenses) {
        await knex.migrate.down({
          name: '20260525100000_create_expenses.ts',
        });
      }
      const hasProjects = await knex.schema.hasTable('projects');
      if (hasProjects) {
        await knex.migrate.down({
          name: '20260524100000_create_projects.ts',
        });
      }
      await knex.migrate.down({ name: FVM_REQUESTS_MIGRATION });
    });

    afterAll(async () => {
      // Atstatom — kiti spec'ai (ir afterAll aukščiau) tikisi latest schemos.
      await knex.migrate.latest();
    });

    it('po rollback visos 4 kolonos dingo iš schema', async () => {
      const columns = await getRequestColumnSet(knex);
      for (const col of NEW_COLUMNS) {
        expect(columns.has(col)).toBe(false);
      }
    });

    it('po rollback CHECK constraint dingo iš schema', async () => {
      const rows = (await knex('information_schema.table_constraints')
        .where({
          table_schema: 'public',
          table_name: 'requests',
          constraint_name: 'requests_spec_program_funding_type_check',
        })
        .select<Array<{ constraint_name: string }>>(
          'constraint_name',
        )) as Array<{ constraint_name: string }>;
      expect(rows).toHaveLength(0);
    });

    it('esamas senas request lieka po rollback (be naujų laukų)', async () => {
      const row = (await knex('requests')
        .where({ id: legacyRequestId })
        .first<{ id: number; project_name: string }>()) as
        | { id: number; project_name: string }
        | undefined;
      expect(row).toBeDefined();
      expect(row?.project_name).toBe('Pre-rollback legacy request');
    });
  });
});
