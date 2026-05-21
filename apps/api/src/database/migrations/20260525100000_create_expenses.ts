/**
 * Iter 12 (FVM-4): Expenses — faktinės išlaidos projektams.
 *
 * Ką daro ši migracija:
 *  1. Sukuria `expenses` lentelę — projektų faktinių išlaidų kaupimas su
 *     multi-source split per `saltinio_dalis` jsonb lauką. Schema atitinka
 *     `docs/fvm/01-architecture.md` §6.4 ir docx §6.4.
 *     - tipas ('du' | 'sutartis' | 'saskaita' | 'tiesiogine') apribojamas
 *       per PostgreSQL CHECK constraint, pridėtą per `knex.raw` (Knex
 *       schema builder neturi tiesioginio `.check(...)` API enum'ams).
 *     - saltinio_dalis (jsonb) — NULL kai išlaida vieno šaltinio (paveldima
 *       per `budget_allocation.funding_source_id`); array
 *       `[{ funding_source_id: int, suma: "string-decimal" }, ...]` kai
 *       išlaida padalinta tarp kelių finansavimo šaltinių (F07). Sprendimas
 *       naudoti jsonb (ne junction lentelę) — žr. ADR-002.
 *  2. Sukuria indeksus:
 *     - `idx_expenses_project` (project_id) — projekto detail puslapio
 *       išlaidų sąrašas + likučio agregacijos.
 *     - `idx_expenses_allocation` (budget_allocation_id) — biudžeto eilutės
 *       summary endpoint'ai (planuota / faktine / likutis).
 *     - `idx_expenses_date` (data) — list'ų filtravimui pagal datą + year
 *       agregacijoms.
 *     - `idx_expenses_saltinio_dalis_gin` — GIN indeksas naudojant
 *       `jsonb_path_ops` operatorių klasę. Naudojamas multi-source
 *       containment'o query'ams (`saltinio_dalis @> '[{"funding_source_id": N}]'`).
 *       Pasirinkome `jsonb_path_ops` (ne default'inio `jsonb_ops`) — jis
 *       mažesnis, greitesnis containment query'ams, kurie mums vieninteliai
 *       svarbūs (žr. backend `list` su `fundingSourceId` filter).
 *
 * FK politika (ON DELETE):
 *  - project_id            -> RESTRICT (projekto ištrynimas blokuojamas, kol
 *                             yra rišamų išlaidų — saugumo skardis,
 *                             biudžeto sekimas turi būti pilnas).
 *  - budget_allocation_id  -> RESTRICT (biudžeto eilutės ištrynimas blokuojamas).
 *  - created_by_user_id    -> RESTRICT (user'io ištrynimas blokuojamas, kol
 *                             yra jo sukurtų išlaidų — audit trail privalo
 *                             išlikti pilnas).
 *
 * Viskas vyksta vienoje `knex.transaction` — jei kuris žingsnis fail'ina,
 * viskas roll'inasi atgal.
 *
 * `down` drop'ina `expenses` lentelę (kartu su jos CHECK constraint'ais,
 * indeksais — įskaitant GIN indeksą — bei FK constraint'ais, susijusiais
 * su šios lentelės kolonomis, per PostgreSQL DROP TABLE kaskadą).
 *
 * Susiję dokumentai:
 *  - docs/fvm/01-architecture.md — expenses schema sekcija (§6.4)
 *  - docs/fvm/spec/FVM-v0.1.md — §4.3, §6.4
 *  - docs/fvm/03-decisions-log.md — ADR-002 (jsonb pasirinkimas)
 *  - docs/fvm/iter-12-expenses.md — DBA brief
 */
import type { Knex } from 'knex';

const TIPAS_CHECK_NAME = 'expenses_tipas_check';
const GIN_INDEX_NAME = 'idx_expenses_saltinio_dalis_gin';

export async function up(knex: Knex): Promise<void> {
  await knex.transaction(async (trx) => {
    // 1) Sukuriam `expenses` lentelę.
    await trx.schema.createTable('expenses', (t) => {
      t.increments('id').primary();
      t.integer('project_id')
        .notNullable()
        .references('id')
        .inTable('projects')
        .onDelete('RESTRICT');
      t.integer('budget_allocation_id')
        .notNullable()
        .references('id')
        .inTable('budget_allocations_v2')
        .onDelete('RESTRICT');
      // tipas IN ('du', 'sutartis', 'saskaita', 'tiesiogine') — CHECK
      // pridedamas atskirai per raw SQL.
      t.string('tipas', 20).notNullable();
      t.decimal('suma', 15, 2).notNullable();
      t.date('data').notNullable();
      t.string('aprasymas', 500).nullable();
      // Multi-source split: array `[{ funding_source_id: int, suma: "string-decimal" }, ...]`.
      // NULL kai išlaida vieno šaltinio — paveldima per
      // `budget_allocation.funding_source_id`. Validation logika
      // (SUM(saltinio_dalis[].suma) === expense.suma) — backend serviso
      // atsakomybė (epsilon comparison reikalingas decimal'ams).
      t.jsonb('saltinio_dalis').nullable();
      t.integer('created_by_user_id')
        .notNullable()
        .references('id')
        .inTable('users')
        .onDelete('RESTRICT');
      t.timestamp('created_at', { useTz: true })
        .notNullable()
        .defaultTo(trx.fn.now());
      t.timestamp('updated_at', { useTz: true })
        .notNullable()
        .defaultTo(trx.fn.now());

      t.index(['project_id'], 'idx_expenses_project');
      t.index(['budget_allocation_id'], 'idx_expenses_allocation');
      t.index(['data'], 'idx_expenses_date');
    });

    // 2) CHECK constraint per raw SQL — Knex schema builder neturi
    //    tiesioginio Postgres-style `.check()` API enum'ams. Constraint
    //    name fixed, kad `down` galėtų drop'inti (per DROP TABLE), ir
    //    kad PG error message būtų atpažįstamas test'uose.
    await trx.raw(`
      ALTER TABLE expenses
        ADD CONSTRAINT ${TIPAS_CHECK_NAME}
        CHECK (tipas IN ('du', 'sutartis', 'saskaita', 'tiesiogine'))
    `);

    // 3) GIN indeksas su `jsonb_path_ops` — multi-source containment
    //    query'ams (pvz., filter pagal funding_source_id per `@>` operator).
    //    `jsonb_path_ops` (ne default'inio `jsonb_ops`) — mažesnis ir
    //    greitesnis būtent containment query'ams; kitų jsonb operacijų
    //    (key existence `?`, etc.) mes neplanuojam.
    await trx.raw(`
      CREATE INDEX ${GIN_INDEX_NAME}
        ON expenses USING gin (saltinio_dalis jsonb_path_ops)
    `);
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.transaction(async (trx) => {
    // PostgreSQL drop'ina kartu visus CHECK constraint'us, indeksus
    // (įskaitant GIN'ą) ir FK constraint'us, susijusius su šios lentelės
    // kolonomis. Jokio papildomo explicit drop'inimo nereikia.
    await trx.schema.dropTableIfExists('expenses');
  });
}
