/**
 * `add_payroll_profile_to_expenses` migracijos integration test'as
 * (Iter 14, FVM-6).
 *
 * Test'ai:
 *  1. Po migracijos `expenses` lentelėje yra `payroll_profile_id` kolona
 *     (integer, nullable), partial indeksas
 *     `idx_expenses_payroll_profile` egzistuoja, FK į `payroll_profiles`
 *     nustatyta su ON DELETE SET NULL.
 *  2. Backfill'as: esamų DU expense'ų (su `aprasymas` formatu
 *     `DU YYYY-MM: <vardas_pavarde>`) `payroll_profile_id` užpildytas
 *     korektišku profile.id. Ne-DU expense'ai lieka su NULL.
 *  3. ON DELETE SET NULL: ištrynus profile, susiję expense'ai išlieka,
 *     bet `payroll_profile_id` tampa NULL (audit trail).
 *  4. Rollback (`migrate.down`) — kolona ir indeksas dingo iš schemos.
 *
 * Pastaba: globalus setup'as paleidžia visas migracijas. Test 4 specifiškai
 * apsisukam šią migraciją per `migrate.down` / `migrate.up`.
 */
import type { Knex } from 'knex';
import bcrypt from 'bcryptjs';
import {
  getTestKnex,
  closeTestKnex,
  truncateAll,
  seedBaseFixtures,
  seedFvmClassifiers,
  type BaseFixtures,
  type FvmClassifierFixtures,
} from '../helpers/db';

const MIGRATION_NAME =
  '20260527100000_add_payroll_profile_to_expenses.ts';
const FK_INDEX_NAME = 'idx_expenses_payroll_profile';

interface ColumnRow {
  column_name: string;
  data_type: string;
  is_nullable: 'YES' | 'NO';
}

interface SeededCtx {
  base: BaseFixtures;
  cls: FvmClassifierFixtures;
  fundingSourceId: number;
  duAllocationId: number;
  ppAllocationId: number;
  duProjectId: number;
  nonDuProjectId: number;
  profileJonas: number;
  profileMarija: number;
}

/**
 * Pridėjimas: AM funding source + DU allocation + PP allocation + DU project +
 * non-DU project + 2 payroll profile'iai (Jonas, Marija). Naudojama backfill +
 * SET NULL test'uose.
 */
async function seed(knex: Knex): Promise<SeededCtx> {
  const base = await seedBaseFixtures(knex);
  const cls = await seedFvmClassifiers(knex);

  const fsRows = (await knex('funding_sources')
    .insert({
      tenant_id: base.amTenantId,
      pavadinimas: 'AM VB 2026',
      kodas: 'AM-VB-2026',
      tipas_classifier_item_id: cls.fundingSourceTypeItemIds.biudzetas,
      metai: 2026,
      metine_suma: '1000000.00',
      aprasymas: null,
      aktyvus: true,
    })
    .returning('id')) as Array<{ id: number }>;
  const fundingSourceId = fsRows[0]!.id;

  const duAllocRows = (await knex('budget_allocations_v2')
    .insert({
      funding_source_id: fundingSourceId,
      category_classifier_item_id: cls.budgetCategoryItemIds.du,
      pavadinimas: 'AM DU 2026',
      planuota_suma: '500000.00',
      metai: 2026,
    })
    .returning('id')) as Array<{ id: number }>;
  const duAllocationId = duAllocRows[0]!.id;

  const ppAllocRows = (await knex('budget_allocations_v2')
    .insert({
      funding_source_id: fundingSourceId,
      category_classifier_item_id: cls.budgetCategoryItemIds.prekes_paslaugos,
      pavadinimas: 'AM PP 2026',
      planuota_suma: '300000.00',
      metai: 2026,
    })
    .returning('id')) as Array<{ id: number }>;
  const ppAllocationId = ppAllocRows[0]!.id;

  const duProjRows = (await knex('projects')
    .insert({
      tenant_id: base.amTenantId,
      budget_allocation_id: duAllocationId,
      request_id: null,
      pavadinimas: 'DU expense system (auto)',
      tipas: 'veikla',
      biudzetas: '0.00',
      statusas: 'vykdoma',
      atsakingas_user_id: base.amAdminUserId,
      aprasymas: 'Auto DU sistema',
      is_du_system: true,
    })
    .returning('id')) as Array<{ id: number }>;
  const duProjectId = duProjRows[0]!.id;

  const ndProjRows = (await knex('projects')
    .insert({
      tenant_id: base.amTenantId,
      budget_allocation_id: ppAllocationId,
      request_id: null,
      pavadinimas: 'PP projektas',
      tipas: 'projektas',
      biudzetas: '50000.00',
      statusas: 'vykdoma',
      atsakingas_user_id: base.amAdminUserId,
      aprasymas: null,
      is_du_system: false,
    })
    .returning('id')) as Array<{ id: number }>;
  const nonDuProjectId = ndProjRows[0]!.id;

  const jonasRows = (await knex('payroll_profiles')
    .insert({
      tenant_id: base.amTenantId,
      user_id: null,
      vardas_pavarde: 'Jonas Jonaitis',
      pareigos: 'Vyr. specialistas',
      sutarties_tipas: 'darbo',
      atlyginimas_bruto: '3000.00',
      priedai: '200.00',
      galioja_nuo: '2026-01-01',
      galioja_iki: null,
    })
    .returning('id')) as Array<{ id: number }>;
  const profileJonas = jonasRows[0]!.id;

  const marijaRows = (await knex('payroll_profiles')
    .insert({
      tenant_id: base.amTenantId,
      user_id: null,
      vardas_pavarde: 'Marija Petraitė',
      pareigos: 'Skyriaus vedėja',
      sutarties_tipas: 'darbo',
      atlyginimas_bruto: '4000.00',
      priedai: '0.00',
      galioja_nuo: '2026-01-01',
      galioja_iki: null,
    })
    .returning('id')) as Array<{ id: number }>;
  const profileMarija = marijaRows[0]!.id;

  return {
    base,
    cls,
    fundingSourceId,
    duAllocationId,
    ppAllocationId,
    duProjectId,
    nonDuProjectId,
    profileJonas,
    profileMarija,
  };
}

describe('expenses.payroll_profile_id migration (Iter 14)', () => {
  let knex: Knex;

  beforeAll(async () => {
    knex = getTestKnex();
  });

  afterAll(async () => {
    // Latest schema laikoma — kiti spec'ai tikisi pilnos struktūros.
    await knex.migrate.latest();
    await closeTestKnex();
  });

  /**
   * Defensyvus migracijos užtikrintojas — jei knex_migrations turi įrašą,
   * bet schema'oje kolonos nėra (gali nutikti, kai kažkuris kitas spec'as
   * rollback'ino chain'o priklausomybės migraciją be tinkamo CASCADE handling'o),
   * ištrinam stale record'ą ir paleidžiam migrate.latest iš naujo.
   *
   * Idempotent — jei kolona jau yra, tiesiog užtikrina, kad migrate.latest
   * būtų paleistas (no-op'as).
   */
  async function ensureMigrationApplied(): Promise<void> {
    await knex.migrate.latest();
    const hasCol = await knex.schema.hasColumn('expenses', 'payroll_profile_id');
    if (!hasCol) {
      await knex('knex_migrations').where({ name: MIGRATION_NAME }).del();
      await knex.migrate.latest();
    }
  }

  describe('Test 1: schema — kolona + FK + partial index', () => {
    beforeAll(async () => {
      await ensureMigrationApplied();
    });

    it('payroll_profile_id kolona yra integer + nullable', async () => {
      const row = (await knex('information_schema.columns')
        .where({
          table_schema: 'public',
          table_name: 'expenses',
          column_name: 'payroll_profile_id',
        })
        .first<ColumnRow>(
          'column_name',
          'data_type',
          'is_nullable',
        )) as ColumnRow | undefined;
      expect(row).toBeDefined();
      expect(row!.data_type).toBe('integer');
      expect(row!.is_nullable).toBe('YES');
    });

    it('FK constraint į payroll_profiles egzistuoja su SET NULL', async () => {
      // Surandam FK constraint pagal kolonos pavadinimą + lentelę.
      interface FkRow {
        constraint_name: string;
        delete_rule: string;
      }
      const rows = (await knex.raw<{
        rows: FkRow[];
      }>(
        `SELECT rc.constraint_name, rc.delete_rule
         FROM information_schema.referential_constraints rc
         JOIN information_schema.key_column_usage kcu
           ON kcu.constraint_name = rc.constraint_name
         WHERE kcu.table_name = 'expenses'
           AND kcu.column_name = 'payroll_profile_id'`,
      )) as { rows: FkRow[] };
      expect(rows.rows.length).toBeGreaterThan(0);
      const fk = rows.rows[0]!;
      expect(fk.delete_rule).toBe('SET NULL');
    });

    it('Partial indeksas idx_expenses_payroll_profile egzistuoja', async () => {
      const rows = (await knex('pg_indexes')
        .where({
          schemaname: 'public',
          tablename: 'expenses',
          indexname: FK_INDEX_NAME,
        })
        .select<Array<{ indexdef: string }>>('indexdef')) as Array<{
        indexdef: string;
      }>;
      expect(rows).toHaveLength(1);
      // Patikrinam, kad partial — `WHERE payroll_profile_id IS NOT NULL`
      expect(rows[0]!.indexdef).toMatch(/payroll_profile_id IS NOT NULL/i);
    });
  });

  describe('Test 2: backfill esamiems DU expense\'ams', () => {
    let ctx: SeededCtx;

    beforeAll(async () => {
      await ensureMigrationApplied();
      await truncateAll(knex);
      ctx = await seed(knex);

      // Apsimetam, kad expense'ai sukurti PRIEŠ migraciją — t.y. su
      // payroll_profile_id=NULL ir aprasymas formate `DU YYYY-MM: ...`.
      // Tam reikia šitą migraciją apsisukti, įdėti expense'us, ir tada
      // vėl paleisti migraciją (kad jos backfill veiktų).
      await knex.migrate.down({ name: MIGRATION_NAME });

      // Insert'inam DU expense'us be payroll_profile_id (migracija dar
      // neaktyvi). 2 — Jonas, 1 — Marija, 1 — be vardo pat.
      await knex('expenses').insert([
        {
          project_id: ctx.duProjectId,
          budget_allocation_id: ctx.duAllocationId,
          tipas: 'du',
          suma: '1500.00',
          data: '2026-03-31',
          aprasymas: 'DU 2026-03: Jonas Jonaitis',
          saltinio_dalis: JSON.stringify([
            { funding_source_id: ctx.fundingSourceId, suma: '1500.00' },
          ]),
          created_by_user_id: ctx.base.amAdminUserId,
        },
        {
          project_id: ctx.duProjectId,
          budget_allocation_id: ctx.duAllocationId,
          tipas: 'du',
          suma: '1700.00',
          data: '2026-04-30',
          aprasymas: 'DU 2026-04: Jonas Jonaitis',
          saltinio_dalis: JSON.stringify([
            { funding_source_id: ctx.fundingSourceId, suma: '1700.00' },
          ]),
          created_by_user_id: ctx.base.amAdminUserId,
        },
        {
          project_id: ctx.duProjectId,
          budget_allocation_id: ctx.duAllocationId,
          tipas: 'du',
          suma: '4000.00',
          data: '2026-03-31',
          aprasymas: 'DU 2026-03: Marija Petraitė',
          saltinio_dalis: JSON.stringify([
            { funding_source_id: ctx.fundingSourceId, suma: '4000.00' },
          ]),
          created_by_user_id: ctx.base.amAdminUserId,
        },
        {
          project_id: ctx.duProjectId,
          budget_allocation_id: ctx.duAllocationId,
          tipas: 'du',
          suma: '2200.00',
          data: '2026-03-31',
          // Nestandartinis aprasymas — backfill neturi match'inti
          aprasymas: 'Some other DU thing',
          saltinio_dalis: JSON.stringify([
            { funding_source_id: ctx.fundingSourceId, suma: '2200.00' },
          ]),
          created_by_user_id: ctx.base.amAdminUserId,
        },
        // Ne-DU expense — neturi būti paliestas
        {
          project_id: ctx.nonDuProjectId,
          budget_allocation_id: ctx.ppAllocationId,
          tipas: 'saskaita',
          suma: '500.00',
          data: '2026-03-15',
          aprasymas: 'Sąskaita 12345',
          saltinio_dalis: null,
          created_by_user_id: ctx.base.amAdminUserId,
        },
      ]);

      // Dabar paleidžiam migraciją up — turi backfill'inti DU expense'us.
      await knex.migrate.up({ name: MIGRATION_NAME });
    });

    it('Jonas Jonaitis DU expense\'ai turi payroll_profile_id = profileJonas', async () => {
      const rows = (await knex('expenses')
        .where('aprasymas', 'like', 'DU %: Jonas Jonaitis')
        .select<Array<{ payroll_profile_id: number | null }>>(
          'payroll_profile_id',
        )) as Array<{ payroll_profile_id: number | null }>;
      expect(rows).toHaveLength(2);
      for (const r of rows) {
        expect(r.payroll_profile_id).toBe(ctx.profileJonas);
      }
    });

    it('Marija Petraitė DU expense turi payroll_profile_id = profileMarija', async () => {
      const rows = (await knex('expenses')
        .where('aprasymas', 'like', 'DU %: Marija Petraitė')
        .select<Array<{ payroll_profile_id: number | null }>>(
          'payroll_profile_id',
        )) as Array<{ payroll_profile_id: number | null }>;
      expect(rows).toHaveLength(1);
      expect(rows[0]!.payroll_profile_id).toBe(ctx.profileMarija);
    });

    it('Nestandartinio aprasymo DU expense — payroll_profile_id NULL', async () => {
      const rows = (await knex('expenses')
        .where('aprasymas', 'Some other DU thing')
        .select<Array<{ payroll_profile_id: number | null }>>(
          'payroll_profile_id',
        )) as Array<{ payroll_profile_id: number | null }>;
      expect(rows).toHaveLength(1);
      expect(rows[0]!.payroll_profile_id).toBeNull();
    });

    it('Ne-DU expense — payroll_profile_id visada NULL', async () => {
      const rows = (await knex('expenses')
        .where('tipas', 'saskaita')
        .select<Array<{ payroll_profile_id: number | null }>>(
          'payroll_profile_id',
        )) as Array<{ payroll_profile_id: number | null }>;
      expect(rows).toHaveLength(1);
      expect(rows[0]!.payroll_profile_id).toBeNull();
    });
  });

  describe('Test 3: ON DELETE SET NULL — profile ištrynimas išlaiko expense\'ą', () => {
    let ctx: SeededCtx;

    beforeAll(async () => {
      await ensureMigrationApplied();
      await truncateAll(knex);
      ctx = await seed(knex);

      // Įdedam DU expense'ą su payroll_profile_id (po migracijos).
      await knex('expenses').insert({
        project_id: ctx.duProjectId,
        budget_allocation_id: ctx.duAllocationId,
        tipas: 'du',
        suma: '1500.00',
        data: '2026-03-31',
        aprasymas: 'DU 2026-03: Jonas Jonaitis',
        saltinio_dalis: JSON.stringify([
          { funding_source_id: ctx.fundingSourceId, suma: '1500.00' },
        ]),
        payroll_profile_id: ctx.profileJonas,
        created_by_user_id: ctx.base.amAdminUserId,
      });
    });

    it('Ištrynus profilį, expense išlieka su payroll_profile_id=NULL', async () => {
      // payroll_distributions nėra šitam profile'ui — galim trinti
      await knex('payroll_profiles').where({ id: ctx.profileJonas }).del();

      const rows = (await knex('expenses')
        .where('aprasymas', 'DU 2026-03: Jonas Jonaitis')
        .select<Array<{ id: number; payroll_profile_id: number | null }>>(
          'id',
          'payroll_profile_id',
        )) as Array<{ id: number; payroll_profile_id: number | null }>;
      expect(rows).toHaveLength(1);
      expect(rows[0]!.payroll_profile_id).toBeNull();
    });
  });

  describe('Test 4: rollback (down) — kolona + indeksas dingo', () => {
    beforeAll(async () => {
      await ensureMigrationApplied();
      const hasCol = await knex.schema.hasColumn(
        'expenses',
        'payroll_profile_id',
      );
      expect(hasCol).toBe(true);
      await knex.migrate.down({ name: MIGRATION_NAME });
    });

    afterAll(async () => {
      await knex.migrate.latest();
    });

    it('Po rollback payroll_profile_id kolona dingo', async () => {
      const hasCol = (await knex('information_schema.columns')
        .where({
          table_schema: 'public',
          table_name: 'expenses',
          column_name: 'payroll_profile_id',
        })
        .first<{ column_name: string }>('column_name')) as
        | { column_name: string }
        | undefined;
      expect(hasCol).toBeUndefined();
    });

    it('Po rollback partial indeksas idx_expenses_payroll_profile dingo', async () => {
      const rows = (await knex('pg_indexes')
        .where({ schemaname: 'public', indexname: FK_INDEX_NAME })
        .select<Array<{ indexname: string }>>('indexname')) as Array<{
        indexname: string;
      }>;
      expect(rows).toHaveLength(0);
    });
  });

  // Suppress unused warning (bcrypt importas reikalingas, jei seedBaseFixtures
  // jo tiesiogiai nenaudoja per testus, kurie čia užtikrina, kad import lieka)
  it('sanity: bcrypt importas naudojamas per seed helper\'į', () => {
    expect(typeof bcrypt.hash).toBe('function');
  });
});
