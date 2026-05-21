/**
 * Iter 10 (FVM-2): requests lentelės papildymas FVM laukais (P05 docx §3.1).
 *
 * Ką daro ši migracija:
 *  1. Prideda 4 nullable kolonas į `requests` lentelę:
 *     - `budget_category_id` — FK į `classifier_items` (grupė `budget_category`).
 *       ON DELETE SET NULL — jei klasifikatorius ištrintas, request'as išlieka.
 *     - `funding_source_type_id` — FK į `classifier_items` (grupė
 *       `funding_source_type`). ON DELETE SET NULL.
 *     - `spec_program_funding_type` — varchar(20) su CHECK constraint
 *       (`atskiras` arba `biudzeto_dalis`). Tik kai budget_category =
 *       `spec_programa`.
 *     - `fvm_project_id` — integer (be FK; FK į `projects` bus pridėtas
 *       Iter 11, kai sukursim tą lentelę).
 *  2. Sukuria indexą `idx_requests_budget_category` ant `budget_category_id`,
 *     kad dashboard'o agregacija (P06) būtų greita.
 *  3. CHECK constraint įdėtas per `knex.raw` — Knex schema builder
 *     neturi tiesioginio Postgres-style `.check()` API; constraint name
 *     fixed, kad galima būtų drop'inti per `down`.
 *
 * Visi pakeitimai vienoje `knex.transaction` — atominė operacija. Jei
 * vienas žingsnis fail'ina, viskas roll'inasi atgal.
 *
 * Visos kolonos nullable — backward compatibility: seni prašymai (be naujų
 * laukų) toliau veikia be jokio breaking change'o.
 *
 * `down` drop'ina visas 4 kolonas + indexą + CHECK constraint, vienoje
 * transakcijoje. Galim drop'inti pačias kolonas — PostgreSQL kartu nuima
 * ir constraint'us, ir foreign key'us, ir indexus, susijusius su tomis
 * kolonomis. Bet eksplicitiškai pirma drop'inam constraint + index, kad
 * `down` būtų aiškus skaitytojui.
 *
 * Susiję dokumentai:
 *  - docs/fvm/01-architecture.md — sekcija „requests papildomi laukai"
 *  - docs/fvm/spec/FVM-v0.1.md — §3.1 (P05 lentelė)
 *  - docs/fvm/iter-10-request-integration.md — DBA brief
 */
import type { Knex } from 'knex';

const CHECK_CONSTRAINT_NAME = 'requests_spec_program_funding_type_check';
const INDEX_NAME = 'idx_requests_budget_category';

export async function up(knex: Knex): Promise<void> {
  await knex.transaction(async (trx) => {
    // 1) Pridedam 4 nullable kolonas. Order:
    //    - budget_category_id, funding_source_type_id (FK į classifier_items)
    //    - spec_program_funding_type (varchar, CHECK pridedamas atskirai)
    //    - fvm_project_id (kol kas be FK — FK į `projects` Iter 11)
    await trx.schema.alterTable('requests', (t) => {
      t.integer('budget_category_id')
        .nullable()
        .references('id')
        .inTable('classifier_items')
        .onDelete('SET NULL');
      t.integer('funding_source_type_id')
        .nullable()
        .references('id')
        .inTable('classifier_items')
        .onDelete('SET NULL');
      t.string('spec_program_funding_type', 20).nullable();
      t.integer('fvm_project_id').nullable();

      t.index(['budget_category_id'], INDEX_NAME);
    });

    // 2) CHECK constraint spec_program_funding_type — Knex.schema neturi
    //    tiesioginio .check() API, todėl naudojam raw SQL. Constraint name
    //    fixed, kad `down` galėtų drop'inti.
    await trx.raw(`
      ALTER TABLE requests
        ADD CONSTRAINT ${CHECK_CONSTRAINT_NAME}
        CHECK (
          spec_program_funding_type IS NULL
          OR spec_program_funding_type IN ('atskiras', 'biudzeto_dalis')
        )
    `);
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.transaction(async (trx) => {
    // 1) Pirma — drop'inam CHECK constraint (kad neliktų orphan po kolonos
    //    nuėmimo). `IF EXISTS` saugumo dėlei.
    await trx.raw(`
      ALTER TABLE requests
        DROP CONSTRAINT IF EXISTS ${CHECK_CONSTRAINT_NAME}
    `);

    // 2) Drop'inam visas 4 kolonas (Knex tas pats automatiškai
    //    nuima index'ą ir FK constraint'us, susijusius su jomis, bet
    //    eksplicitiškai paminim indexą `down` skaitytojui — `dropIndex`
    //    nešovė klaidos jei index'as jau dingo kartu su kolona.
    await trx.schema.alterTable('requests', (t) => {
      t.dropIndex(['budget_category_id'], INDEX_NAME);
    });

    await trx.schema.alterTable('requests', (t) => {
      t.dropColumn('fvm_project_id');
      t.dropColumn('spec_program_funding_type');
      t.dropColumn('funding_source_type_id');
      t.dropColumn('budget_category_id');
    });
  });
}
