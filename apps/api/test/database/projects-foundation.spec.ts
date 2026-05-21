/**
 * FVM projects migracijos integration test'as (Iter 11).
 *
 * Test'ai (9):
 *  1. Po migracijos `projects` turi visus 12 schema laukų (žr. §6.3
 *     architektūros dok'e + iter-11 brief'e).
 *  2. CHECK constraint `tipas`: insert su `tipas='invalid'` throw'ina
 *     PG check_violation.
 *  3. CHECK constraint `statusas`: insert su `statusas='invalid'` throw'ina
 *     PG check_violation.
 *  4. Sėkmingas insert: regular projektas (`tipas='projektas'`, request_id=NULL).
 *  5. Sėkmingas insert: spec_programa su užpildytu request_id.
 *  6. FK requests.fvm_project_id -> projects(id) veikia — patch'inus
 *     requests.fvm_project_id į esamo project'o ID, įrašas išlieka.
 *  7. ON DELETE SET NULL ant projects.request_id: ištrynus request'ą, į
 *     kurį rodo projektas, projektas išlieka, jo request_id tampa NULL.
 *  8. ON DELETE SET NULL ant requests.fvm_project_id: ištrynus projektą, į
 *     kurį rodo request, request išlieka, jo fvm_project_id tampa NULL.
 *  9. Rollback (`migrate.down`) — projects lentelė ir requests.fvm_project_id
 *     FK constraint dingo.
 *
 * Pastaba: `global-setup.ts` jau paleido visas migracijas test DB. Per
 * test'us specifiškai apsisukam šitą migraciją per `migrate.down` /
 * `migrate.up` Test'e 9 — rollback patikrinimui. Kiti testai naudoja
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

const PROJECTS_MIGRATION = '20260524100000_create_projects.ts';

const EXPECTED_COLUMNS = [
  'id',
  'tenant_id',
  'budget_allocation_id',
  'request_id',
  'pavadinimas',
  'tipas',
  'biudzetas',
  'pradzios_data',
  'pabaigos_data',
  'statusas',
  'atsakingas_user_id',
  'aprasymas',
  'created_at',
  'updated_at',
] as const;

// 12 logical fields per spec (id + 10 functional + 2 timestamps = 14 columns
// info_schema'oje, bet brief'as kalba apie „12 laukų" — id + 11 kitų). Tam,
// kad būtų tinkamai prieigai prie reikalavimo „turi visus 12 laukų", tikrinam
// kad esamų kolonų set'as PILNAI apima EXPECTED_COLUMNS, t.y. nė vieno
// kritinio neatsiranda.

interface ColumnRow {
  column_name: string;
  data_type: string;
  is_nullable: 'YES' | 'NO';
}

async function getProjectColumnSet(knex: Knex): Promise<Set<string>> {
  const rows = (await knex('information_schema.columns')
    .where({ table_schema: 'public', table_name: 'projects' })
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
  budgetAllocationId: number;
}

/**
 * Įdeda visą reikalingą "lattice" projects insert'ams:
 *  - AM tenant + admin user'is (per seedBaseFixtures)
 *  - FVM klasifikatoriai (per seedFvmClassifiers)
 *  - 1 funding_source (biudzetas, 2026, 1.000.000)
 *  - 1 budget_allocation_v2 (spec_programa kategorija, 500.000)
 *
 * Šie ID'ai bus naudojami visuose project insert'uose toliau.
 */
async function seedProjectsContext(knex: Knex): Promise<SeededContext> {
  const fixtures = await seedBaseFixtures(knex);
  const classifiers = await seedFvmClassifiers(knex);

  const insertedSource = (await knex('funding_sources')
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
  const fundingSourceId = insertedSource[0]?.id;
  if (fundingSourceId === undefined) {
    throw new Error('Test fixture: nepavyko sukurti funding_source');
  }

  const insertedAlloc = (await knex('budget_allocations_v2')
    .insert({
      funding_source_id: fundingSourceId,
      category_classifier_item_id:
        classifiers.budgetCategoryItemIds.spec_programa,
      pavadinimas: 'Spec. programa: Saugomų teritorijų priežiūra',
      spec_prog_tipas: 'atskiras',
      planuota_suma: '500000.00',
      metai: 2026,
      pastabos: 'test fixture',
    })
    .returning('id')) as Array<{ id: number }>;
  const budgetAllocationId = insertedAlloc[0]?.id;
  if (budgetAllocationId === undefined) {
    throw new Error('Test fixture: nepavyko sukurti budget_allocation_v2');
  }

  return { fixtures, classifiers, fundingSourceId, budgetAllocationId };
}

describe('FVM projects migration (Iter 11)', () => {
  let knex: Knex;

  beforeAll(async () => {
    knex = getTestKnex();
  });

  afterAll(async () => {
    // Palieki DB su naujausia schema, kad kiti spec'ai matytų pilną struktūrą.
    const isAtLatest = (await knex.migrate.currentVersion()).startsWith(
      '20260524100000',
    );
    if (!isAtLatest) {
      await knex.migrate.latest();
    }
    await closeTestKnex();
  });

  describe('Test 1: projects lentelė turi visus reikalingus laukus', () => {
    beforeAll(async () => {
      await knex.migrate.latest();
    });

    it('po migracijos projects turi visus 14 kolonų pagal §6.3', async () => {
      const columns = await getProjectColumnSet(knex);
      for (const col of EXPECTED_COLUMNS) {
        expect(columns.has(col)).toBe(true);
      }
    });

    it('CHECK constraint tipas ir statusas egzistuoja information_schema', async () => {
      const rows = (await knex('information_schema.table_constraints')
        .where({
          table_schema: 'public',
          table_name: 'projects',
          constraint_type: 'CHECK',
        })
        .select<Array<{ constraint_name: string }>>(
          'constraint_name',
        )) as Array<{ constraint_name: string }>;
      const names = rows.map((r) => r.constraint_name);
      expect(names).toEqual(
        expect.arrayContaining([
          'projects_tipas_check',
          'projects_statusas_check',
        ]),
      );
    });

    it('FK requests.fvm_project_id -> projects.id pridėtas', async () => {
      const rows = (await knex('information_schema.table_constraints')
        .where({
          table_schema: 'public',
          table_name: 'requests',
          constraint_name: 'requests_fvm_project_id_foreign',
          constraint_type: 'FOREIGN KEY',
        })
        .select<Array<{ constraint_name: string }>>(
          'constraint_name',
        )) as Array<{ constraint_name: string }>;
      expect(rows).toHaveLength(1);
    });
  });

  describe('Test 2: CHECK constraint tipas — neleistina reikšmė', () => {
    let ctx: SeededContext;

    beforeAll(async () => {
      await knex.migrate.latest();
      await truncateAll(knex);
      ctx = await seedProjectsContext(knex);
    });

    it('insert su tipas="invalid" throw\'ina PG check_violation', async () => {
      await expect(
        knex('projects').insert({
          tenant_id: ctx.fixtures.amTenantId,
          budget_allocation_id: ctx.budgetAllocationId,
          request_id: null,
          pavadinimas: 'Bad tipas project',
          tipas: 'invalid',
          biudzetas: '100.00',
          statusas: 'planuojama',
        }),
      ).rejects.toThrow(/projects_tipas_check/);
    });
  });

  describe('Test 3: CHECK constraint statusas — neleistina reikšmė', () => {
    let ctx: SeededContext;

    beforeAll(async () => {
      await knex.migrate.latest();
      await truncateAll(knex);
      ctx = await seedProjectsContext(knex);
    });

    it('insert su statusas="invalid" throw\'ina PG check_violation', async () => {
      await expect(
        knex('projects').insert({
          tenant_id: ctx.fixtures.amTenantId,
          budget_allocation_id: ctx.budgetAllocationId,
          request_id: null,
          pavadinimas: 'Bad statusas project',
          tipas: 'projektas',
          biudzetas: '100.00',
          statusas: 'invalid',
        }),
      ).rejects.toThrow(/projects_statusas_check/);
    });
  });

  describe('Test 4: regular projektas (tipas=projektas, request_id=NULL)', () => {
    let ctx: SeededContext;

    beforeAll(async () => {
      await knex.migrate.latest();
      await truncateAll(knex);
      ctx = await seedProjectsContext(knex);
    });

    it('insert su tipas=projektas, request_id=NULL — sėkmingai', async () => {
      const inserted = (await knex('projects')
        .insert({
          tenant_id: ctx.fixtures.amTenantId,
          budget_allocation_id: ctx.budgetAllocationId,
          request_id: null,
          pavadinimas: 'IT infrastruktūros modernizavimas',
          tipas: 'projektas',
          biudzetas: '50000.00',
          pradzios_data: '2026-01-01',
          pabaigos_data: '2026-12-31',
          statusas: 'planuojama',
          atsakingas_user_id: ctx.fixtures.amAdminUserId,
          aprasymas: 'Pradinis testas — regular projektas',
        })
        .returning([
          'id',
          'tipas',
          'statusas',
          'request_id',
          'biudzetas',
        ])) as Array<{
        id: number;
        tipas: string;
        statusas: string;
        request_id: number | null;
        biudzetas: string;
      }>;
      const row = inserted[0];
      expect(row).toBeDefined();
      expect(row!.id).toBeGreaterThan(0);
      expect(row!.tipas).toBe('projektas');
      expect(row!.statusas).toBe('planuojama');
      expect(row!.request_id).toBeNull();
      expect(Number(row!.biudzetas)).toBeCloseTo(50000, 2);
    });
  });

  describe('Test 5: spec_programa su užpildytu request_id', () => {
    let ctx: SeededContext;
    let requestId: number;

    beforeAll(async () => {
      await knex.migrate.latest();
      await truncateAll(knex);
      ctx = await seedProjectsContext(knex);

      // Pridedam request'ą, kuris bus susietas su spec_programa projektu.
      const insertedReq = (await knex('requests')
        .insert({
          tenant_id: ctx.fixtures.amTenantId,
          created_by_user_id: ctx.fixtures.amAdminUserId,
          status: 'APPROVED',
          project_name: 'Saugomų teritorijų priežiūros programa',
          year: 2026,
          decision_granted_amount: '120000.00',
          budget_category_id:
            ctx.classifiers.budgetCategoryItemIds.spec_programa,
          spec_program_funding_type: 'atskiras',
        })
        .returning('id')) as Array<{ id: number }>;
      const id = insertedReq[0]?.id;
      if (id === undefined) {
        throw new Error('Test fixture: nepavyko sukurti request');
      }
      requestId = id;
    });

    it('insert spec_programa su request_id — sėkmingai', async () => {
      const inserted = (await knex('projects')
        .insert({
          tenant_id: ctx.fixtures.amTenantId,
          budget_allocation_id: ctx.budgetAllocationId,
          request_id: requestId,
          pavadinimas: 'Spec.programa: Saugomų teritorijų priežiūra 2026',
          tipas: 'spec_programa',
          biudzetas: '120000.00',
          statusas: 'planuojama',
        })
        .returning([
          'id',
          'tipas',
          'request_id',
          'biudzetas',
        ])) as Array<{
        id: number;
        tipas: string;
        request_id: number | null;
        biudzetas: string;
      }>;
      const row = inserted[0];
      expect(row).toBeDefined();
      expect(row!.tipas).toBe('spec_programa');
      expect(row!.request_id).toBe(requestId);
      expect(Number(row!.biudzetas)).toBeCloseTo(120000, 2);
    });
  });

  describe('Test 6: requests.fvm_project_id FK veikia', () => {
    let ctx: SeededContext;
    let requestId: number;
    let projectId: number;

    beforeAll(async () => {
      await knex.migrate.latest();
      await truncateAll(knex);
      ctx = await seedProjectsContext(knex);

      const insertedReq = (await knex('requests')
        .insert({
          tenant_id: ctx.fixtures.amTenantId,
          created_by_user_id: ctx.fixtures.amAdminUserId,
          status: 'APPROVED',
          project_name: 'Approved spec.programa',
          year: 2026,
        })
        .returning('id')) as Array<{ id: number }>;
      const reqId = insertedReq[0]?.id;
      if (reqId === undefined) {
        throw new Error('Test fixture: nepavyko sukurti request');
      }
      requestId = reqId;

      const insertedProj = (await knex('projects')
        .insert({
          tenant_id: ctx.fixtures.amTenantId,
          budget_allocation_id: ctx.budgetAllocationId,
          request_id: requestId,
          pavadinimas: 'Spec.programa projektas (FK test)',
          tipas: 'spec_programa',
          biudzetas: '10000.00',
          statusas: 'planuojama',
        })
        .returning('id')) as Array<{ id: number }>;
      const pid = insertedProj[0]?.id;
      if (pid === undefined) {
        throw new Error('Test fixture: nepavyko sukurti projekto');
      }
      projectId = pid;
    });

    it('patch request.fvm_project_id į esamo projekto ID — sėkmingai', async () => {
      await knex('requests')
        .where({ id: requestId })
        .update({ fvm_project_id: projectId });

      const row = (await knex('requests')
        .where({ id: requestId })
        .first<{ id: number; fvm_project_id: number | null }>()) as
        | { id: number; fvm_project_id: number | null }
        | undefined;
      expect(row).toBeDefined();
      expect(row!.fvm_project_id).toBe(projectId);
    });

    it('patch request.fvm_project_id į neegzistuojantį projekto ID — FK violation', async () => {
      await expect(
        knex('requests')
          .where({ id: requestId })
          .update({ fvm_project_id: 999_999 }),
      ).rejects.toThrow(/requests_fvm_project_id_foreign/);
    });
  });

  describe('Test 7: ON DELETE SET NULL — projects.request_id', () => {
    let ctx: SeededContext;
    let requestId: number;
    let projectId: number;

    beforeAll(async () => {
      await knex.migrate.latest();
      await truncateAll(knex);
      ctx = await seedProjectsContext(knex);

      const insertedReq = (await knex('requests')
        .insert({
          tenant_id: ctx.fixtures.amTenantId,
          created_by_user_id: ctx.fixtures.amAdminUserId,
          status: 'APPROVED',
          project_name: 'Request to delete',
          year: 2026,
        })
        .returning('id')) as Array<{ id: number }>;
      const reqId = insertedReq[0]?.id;
      if (reqId === undefined) {
        throw new Error('Test fixture: nepavyko sukurti request');
      }
      requestId = reqId;

      const insertedProj = (await knex('projects')
        .insert({
          tenant_id: ctx.fixtures.amTenantId,
          budget_allocation_id: ctx.budgetAllocationId,
          request_id: requestId,
          pavadinimas: 'Projektas su request (ON DELETE SET NULL test)',
          tipas: 'spec_programa',
          biudzetas: '10000.00',
          statusas: 'planuojama',
        })
        .returning('id')) as Array<{ id: number }>;
      const pid = insertedProj[0]?.id;
      if (pid === undefined) {
        throw new Error('Test fixture: nepavyko sukurti projekto');
      }
      projectId = pid;
    });

    it('ištrynus request — projektas išlieka, jo request_id NULL', async () => {
      // Pirma — sanity check: prieš trinant request_id turi būti nustatytas.
      const before = (await knex('projects')
        .where({ id: projectId })
        .first<{ request_id: number | null }>()) as
        | { request_id: number | null }
        | undefined;
      expect(before?.request_id).toBe(requestId);

      await knex('requests').where({ id: requestId }).del();

      const after = (await knex('projects')
        .where({ id: projectId })
        .first<{ id: number; request_id: number | null }>()) as
        | { id: number; request_id: number | null }
        | undefined;
      expect(after).toBeDefined();
      expect(after!.id).toBe(projectId);
      expect(after!.request_id).toBeNull();
    });
  });

  describe('Test 8: ON DELETE SET NULL — requests.fvm_project_id', () => {
    let ctx: SeededContext;
    let requestId: number;
    let projectId: number;

    beforeAll(async () => {
      await knex.migrate.latest();
      await truncateAll(knex);
      ctx = await seedProjectsContext(knex);

      const insertedReq = (await knex('requests')
        .insert({
          tenant_id: ctx.fixtures.amTenantId,
          created_by_user_id: ctx.fixtures.amAdminUserId,
          status: 'APPROVED',
          project_name: 'Request rodantis į trinamą projektą',
          year: 2026,
        })
        .returning('id')) as Array<{ id: number }>;
      const reqId = insertedReq[0]?.id;
      if (reqId === undefined) {
        throw new Error('Test fixture: nepavyko sukurti request');
      }
      requestId = reqId;

      const insertedProj = (await knex('projects')
        .insert({
          tenant_id: ctx.fixtures.amTenantId,
          budget_allocation_id: ctx.budgetAllocationId,
          request_id: null, // sąmoningai be reverse linko, kad ON DELETE
          //  ant projects.request_id čia nesusiviešintų. Tikrinam tik
          //  requests -> projects kryptį.
          pavadinimas: 'Trinamas projektas',
          tipas: 'projektas',
          biudzetas: '20000.00',
          statusas: 'planuojama',
        })
        .returning('id')) as Array<{ id: number }>;
      const pid = insertedProj[0]?.id;
      if (pid === undefined) {
        throw new Error('Test fixture: nepavyko sukurti projekto');
      }
      projectId = pid;

      // Užpildom requests.fvm_project_id į šitą projektą.
      await knex('requests')
        .where({ id: requestId })
        .update({ fvm_project_id: projectId });
    });

    it('ištrynus projektą — request išlieka, jo fvm_project_id NULL', async () => {
      // Sanity check pieš trinant.
      const before = (await knex('requests')
        .where({ id: requestId })
        .first<{ fvm_project_id: number | null }>()) as
        | { fvm_project_id: number | null }
        | undefined;
      expect(before?.fvm_project_id).toBe(projectId);

      await knex('projects').where({ id: projectId }).del();

      const after = (await knex('requests')
        .where({ id: requestId })
        .first<{ id: number; fvm_project_id: number | null }>()) as
        | { id: number; fvm_project_id: number | null }
        | undefined;
      expect(after).toBeDefined();
      expect(after!.id).toBe(requestId);
      expect(after!.fvm_project_id).toBeNull();
    });
  });

  describe('Test 9: rollback (down) — projects + FK dingo', () => {
    beforeAll(async () => {
      // Įsitikinam, kad startuojam iš latest.
      await knex.migrate.latest();
      const hasProjects = await knex.schema.hasTable('projects');
      expect(hasProjects).toBe(true);

      // Roll'inam šią migraciją down.
      await knex.migrate.down({ name: PROJECTS_MIGRATION });
    });

    afterAll(async () => {
      // Atstatom — afterAll aukščiau tikisi latest schemos.
      //
      // PASTABA: Test'e 6 mes nustatėme `requests.fvm_project_id = projectId`.
      // Test 9 down'inant `projects` migraciją, FK constraint drop'inamas, BET
      // pati reikšmė `requests.fvm_project_id` lieka, nes ON DELETE SET NULL
      // veikia tik kol FK constraint egzistuoja. Po `migrate.down`-o tame
      // lauke gali likti orphan reikšmė rodanti į buvusio `projects` lentelės
      // įrašą. Jei `migrate.latest()` (čia) pradės Iter 11 migracijos `up`'ą,
      // jos orphan check fail'ins, nes randa NE-NULL `fvm_project_id` su
      // neegzistuojančiu target'u. Todėl prieš migrate.latest — saugiai
      // išvalom `fvm_project_id` visuose request'uose.
      await knex('requests').update({ fvm_project_id: null });
      await knex.migrate.latest();
    });

    it('po rollback projects lentelė dingo iš schema', async () => {
      const hasProjects = await knex.schema.hasTable('projects');
      expect(hasProjects).toBe(false);
    });

    it('po rollback FK requests_fvm_project_id_foreign dingo', async () => {
      const rows = (await knex('information_schema.table_constraints')
        .where({
          table_schema: 'public',
          table_name: 'requests',
          constraint_name: 'requests_fvm_project_id_foreign',
        })
        .select<Array<{ constraint_name: string }>>(
          'constraint_name',
        )) as Array<{ constraint_name: string }>;
      expect(rows).toHaveLength(0);
    });

    it('po rollback requests.fvm_project_id kolona vis dar yra (sukūrė Iter 10)', async () => {
      const hasColumn = await knex.schema.hasColumn(
        'requests',
        'fvm_project_id',
      );
      expect(hasColumn).toBe(true);
    });
  });
});
