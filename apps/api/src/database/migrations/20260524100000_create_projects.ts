/**
 * Iter 11 (FVM-3): Projects (3 FVM lygis) — projektai, spec.programos, veiklos.
 *
 * Ką daro ši migracija:
 *  1. Sukuria `projects` lentelę — 3-as FVM hierarchijos lygis. "Kas
 *     konkrečiai išleidžia?" — projektai, spec. programos, skyriaus veiklos.
 *     Schema atitinka `docs/fvm/01-architecture.md` ir docx §6.3.
 *     Visi `tipas` ir `statusas` reikšmių apribojimai įgyvendinti per
 *     PostgreSQL CHECK constraint'us, įdėtus per `knex.raw` (Knex schema
 *     builder neturi tiesioginio `.check(...)` API enum'ams).
 *  2. Pridedamas FK `requests.fvm_project_id -> projects.id ON DELETE SET NULL`.
 *     Iter 10 sukūrė pačią `fvm_project_id` koloną be FK. Iter 11 pridėjus
 *     `projects` lentelę — galima realiai integraciją užbaigti. Prieš FK
 *     pridėjimą — orphan'ų patikrinimas (sąžiningas guard): jei kuris
 *     `requests.fvm_project_id` jau nustatytas (ne NULL) — migracija
 *     fail'ina su aiškia LT žinute, kad nedingtų sąlyga. Po Iter 10 visi
 *     fvm_project_id turi būti NULL (tame iter'e tas laukas tik įdėtas, į
 *     jį niekas nerašė).
 *
 * Viskas vyksta vienoje `knex.transaction` — jei kuris žingsnis fail'ina,
 * viskas roll'inasi atgal.
 *
 * Indexai:
 *  - idx_projects_tenant — tenant scope filtravimui.
 *  - idx_projects_allocation — budget_allocation 1:N join'ams.
 *  - idx_projects_request — request 1:1 (spec.programos) lookup'ams.
 *  - idx_projects_status — list'ų filtravimui pagal statusą.
 *
 * FK politika (ON DELETE):
 *  - tenant_id          -> RESTRICT (tenant ištrynimas užblokuojamas, kol
 *                          yra rišamų projektų — saugumo skardis).
 *  - budget_allocation_id -> RESTRICT (biudžeto eilutės ištrynimas blokuojamas).
 *  - request_id         -> SET NULL (jei spec.programos prašymas ištrintas,
 *                          projektas išlieka, tik nuoroda dingsta).
 *  - atsakingas_user_id -> SET NULL (atsakingo user'io ištrynimas neturi
 *                          užmušti projekto).
 *
 * `down` drop'ina FK iš `requests` ir pačią `projects` lentelę (su jos
 * constraint'ais ir indeksais — PostgreSQL nuima kaskadiškai per
 * DROP TABLE).
 *
 * Susiję dokumentai:
 *  - docs/fvm/01-architecture.md — projects schema sekcija
 *  - docs/fvm/spec/FVM-v0.1.md — §2.4, §6.3
 *  - docs/fvm/iter-11-projects.md — DBA brief
 */
import type { Knex } from 'knex';

const TIPAS_CHECK_NAME = 'projects_tipas_check';
const STATUSAS_CHECK_NAME = 'projects_statusas_check';
const REQUESTS_FVM_PROJECT_FK_NAME = 'requests_fvm_project_id_foreign';

export async function up(knex: Knex): Promise<void> {
  await knex.transaction(async (trx) => {
    // 1) Sukuriam `projects` lentelę.
    await trx.schema.createTable('projects', (t) => {
      t.increments('id').primary();
      t.integer('tenant_id')
        .notNullable()
        .references('id')
        .inTable('tenants')
        .onDelete('RESTRICT');
      t.integer('budget_allocation_id')
        .notNullable()
        .references('id')
        .inTable('budget_allocations_v2')
        .onDelete('RESTRICT');
      // NULL jei ne spec.programa.
      t.integer('request_id')
        .nullable()
        .references('id')
        .inTable('requests')
        .onDelete('SET NULL');
      t.string('pavadinimas', 300).notNullable();
      // tipas IN ('projektas', 'spec_programa', 'veikla') — CHECK pridedamas
      // atskirai per raw SQL.
      t.string('tipas', 20).notNullable();
      t.decimal('biudzetas', 15, 2).notNullable();
      t.date('pradzios_data').nullable();
      t.date('pabaigos_data').nullable();
      // statusas IN ('planuojama', 'vykdoma', 'baigta', 'uzdaryta')
      t.string('statusas', 20).notNullable().defaultTo('planuojama');
      t.integer('atsakingas_user_id')
        .nullable()
        .references('id')
        .inTable('users')
        .onDelete('SET NULL');
      t.text('aprasymas').nullable();
      t.timestamp('created_at', { useTz: true })
        .notNullable()
        .defaultTo(trx.fn.now());
      t.timestamp('updated_at', { useTz: true })
        .notNullable()
        .defaultTo(trx.fn.now());

      t.index(['tenant_id'], 'idx_projects_tenant');
      t.index(['budget_allocation_id'], 'idx_projects_allocation');
      t.index(['request_id'], 'idx_projects_request');
      t.index(['statusas'], 'idx_projects_status');
    });

    // 2) CHECK constraints per raw SQL — Knex schema builder neturi
    //    tiesioginio Postgres-style `.check()` API enum'ams. Constraint
    //    name'ai fixed, kad `down` galėtų drop'inti, ir kad PG error message
    //    būtų atpažįstamas test'uose.
    await trx.raw(`
      ALTER TABLE projects
        ADD CONSTRAINT ${TIPAS_CHECK_NAME}
        CHECK (tipas IN ('projektas', 'spec_programa', 'veikla'))
    `);
    await trx.raw(`
      ALTER TABLE projects
        ADD CONSTRAINT ${STATUSAS_CHECK_NAME}
        CHECK (statusas IN ('planuojama', 'vykdoma', 'baigta', 'uzdaryta'))
    `);

    // 3) Orphan check prieš FK pridėjimą į requests.fvm_project_id.
    //    Po Iter 10 visi fvm_project_id turi būti NULL (kolona ką tik
    //    sukurta, jokiu kodu dar į ją nerašoma). Jei kažkas vis tiek
    //    yra užpildęs — abort'inam su LT žinute.
    const orphanCheck = (await trx('requests')
      .whereNotNull('fvm_project_id')
      .count<Array<{ count: string }>>('id as count')
      .first()) as { count: string } | undefined;
    const orphanCount = Number(orphanCheck?.count ?? 0);
    if (orphanCount > 0) {
      throw new Error(
        `[Iter 11 migracija] Negalima pridėti FK requests.fvm_project_id -> projects.id: ` +
          `rasta ${orphanCount} requests įrašų su NE-NULL fvm_project_id reikšme. ` +
          `Po Iter 10 visi fvm_project_id turi būti NULL. Patikrink duomenis.`,
      );
    }

    // 4) FK requests.fvm_project_id -> projects(id) ON DELETE SET NULL.
    //    Pridedam per raw SQL, kad galėtume nustatyti constraint name'ą,
    //    suderintą su esama Knex naming konvencija.
    await trx.raw(`
      ALTER TABLE requests
        ADD CONSTRAINT ${REQUESTS_FVM_PROJECT_FK_NAME}
        FOREIGN KEY (fvm_project_id)
        REFERENCES projects(id)
        ON DELETE SET NULL
    `);
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.transaction(async (trx) => {
    // 1) Pirma — drop'inam FK iš requests, kad nebūtų orphan referencijos
    //    į projects lentelę, kurią toliau drop'insim.
    await trx.raw(`
      ALTER TABLE requests
        DROP CONSTRAINT IF EXISTS ${REQUESTS_FVM_PROJECT_FK_NAME}
    `);

    // 2) Išvalom `requests.fvm_project_id` reikšmes — kitaip po projects
    //    drop'inus, kolona liktų su orphan reikšmėmis, ir ateityje, kai
    //    `up` būtų paleistas vėl, orphan check fail'intų. Tai svarbu ir
    //    produkcijoje, ir test izoliacijai.
    //    `requests.fvm_project_id` kolona pati YRA — ją sukūrė Iter 10 ir
    //    šita migracija jos NE drop'ina (atsakomybė priklauso Iter 10).
    await trx('requests')
      .whereNotNull('fvm_project_id')
      .update({ fvm_project_id: null });

    // 3) Drop'inam `projects` lentelę. PostgreSQL kartu nuima
    //    CHECK constraint'us, indeksus ir FK constraint'us, susijusius su
    //    šios lentelės kolonomis.
    await trx.schema.dropTableIfExists('projects');
  });
}
