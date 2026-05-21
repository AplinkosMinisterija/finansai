/**
 * Iter 13.x (saugumo patch'as): DU sistemos projekto identifikatorius.
 *
 * Kontekstas: Iter 13 implementacijos `payroll.computeMonth` auto-create'ino DU
 * sistemos projektą per `ensureDuSystemProject` su pavadinimu „DU expense
 * system" ir `tipas='veikla'`. Specialistas, neturėdamas DU teisės, vis tiek
 * matydavo šį projektą per:
 *  - `GET /projects` (tenant scope leidžia projektus matyti)
 *  - `GET /projects/:id` ir `/summary` (matomi DU expense totalai)
 *  - `GET /expenses?type=du` (DU expense'ai su darbuotojų vardais aprasyme)
 *
 * Sprendimas: pridėti `is_du_system boolean DEFAULT false` koloną į `projects`,
 * pažymėti šio tipo įrašus, ir tada `expenses` + `projects` servisuose
 * filtravimą sukti per šitą flag'ą + `canViewPayroll`-equivalent backend
 * helper'į.
 *
 * Ką daro migracija:
 *  1. ALTER TABLE projects ADD COLUMN is_du_system boolean NOT NULL DEFAULT false.
 *  2. Backfill'as: esamiems projektams su pavadinimu pradedant
 *     „DU expense system" ir `tipas='veikla'` — `is_du_system=true`.
 *  3. Sukuria partial indeksą `idx_projects_is_du_system` ON (is_du_system)
 *     WHERE is_du_system = true. Partial dėl to, kad 99% projektų bus
 *     `false` — partial duoda žymiai mažesnį indeksą + greitesnį DU
 *     query'į (mažas tuple kiekis, kuris ir bus filter'inamas servise).
 *
 * `down`:
 *  - Drop'ina indeksą.
 *  - Drop'ina koloną.
 *
 * Susiję dokumentai:
 *  - docs/fvm/spec/FVM-v0.1.md §4.4 (DU saugumo reikalavimas)
 *  - apps/api/src/services/payroll.service.ts `ensureDuSystemProject`
 *  - apps/api/src/utils/permissions.ts `canViewPayroll`
 */
import type { Knex } from 'knex';

const INDEX_NAME = 'idx_projects_is_du_system';
const DU_SYSTEM_PROJECT_NAME_PREFIX = 'DU expense system';

export async function up(knex: Knex): Promise<void> {
  await knex.transaction(async (trx) => {
    // 1) Pridedam koloną. NOT NULL DEFAULT false — esamiems įrašams
    //    automatiškai bus `false`, tada backfill perrašys reikalingus.
    await trx.schema.alterTable('projects', (t) => {
      t.boolean('is_du_system').notNullable().defaultTo(false);
    });

    // 2) Backfill: esamiems DU sistemos projektams. Match'as identiškas
    //    `payroll.service.ts:ensureDuSystemProject` pavadinimo prefikso
    //    paieškai — kad migracija būtų idempotent'iška su servisu, kuris
    //    jau galėjo sukurti įrašus iki šios migracijos.
    await trx('projects')
      .where('tipas', 'veikla')
      .where('pavadinimas', 'like', `${DU_SYSTEM_PROJECT_NAME_PREFIX}%`)
      .update({ is_du_system: true });

    // 3) Partial indeksas ant is_du_system = true. Šis filter'as bus
    //    naudojamas tik kai reikia rasti DU sistemos projektą per tenant'ą
    //    (`payroll.service.ts:ensureDuSystemProject`) arba kai expense list
    //    nori paslėpti DU sistemos projekto įrašus (`projects.service.ts`).
    //    Partial — nes 99% projektų `false`, taupo vietos ir greičiau.
    await trx.raw(
      `CREATE INDEX ${INDEX_NAME} ON projects (is_du_system) WHERE is_du_system = true`,
    );
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.transaction(async (trx) => {
    // 1) Drop'inam indeksą. CREATE per raw, tad ir DROP per raw, kad būtų
    //    aiškus simetriškumas.
    await trx.raw(`DROP INDEX IF EXISTS ${INDEX_NAME}`);

    // 2) Drop'inam koloną. PostgreSQL automatiškai pašalina default'ą
    //    + bet kokius constraint'us, susijusius su šia kolona.
    await trx.schema.alterTable('projects', (t) => {
      t.dropColumn('is_du_system');
    });
  });
}
