/**
 * Issue #2: ketvirtinis atsiskaitymas už patvirtintų finansavimų panaudojimą.
 *
 * PRIELAIDOS (Giedrė dar neatsakė į detalų klausimą — šios prielaidos pažymėtos
 * issue #2 komentaruose, kad ji galėtų pataisyti testavimo metu):
 *
 *  1. Struktūra: vienas atsiskaitymas per periodą su `amount_used` + `description`.
 *     Nedalinama per atskiras lėšų kategorijas (jei prireiks — atskira lentelė
 *     `request_report_lines`).
 *  2. Periodiškumas: KETVIRTINIS (Q1-Q4) arba METINIS (period_quarter = NULL).
 *  3. Inicijuoja TEIKĖJAS — spaudžia mygtuką prie patvirtinto prašymo.
 *  4. „Vykdomi projektai" = APPROVED statuso prašymai (be atskiros esybės).
 *  5. Statusas: DRAFT → SUBMITTED. AM gali komentuoti per request_comments.
 */
import type { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable('request_reports', (t) => {
    t.increments('id').primary();
    t.integer('request_id')
      .notNullable()
      .references('id')
      .inTable('requests')
      .onDelete('CASCADE');
    t.integer('period_year').notNullable();
    /** 1..4 = ketvirtis; NULL = metinis suvestinis. */
    t.integer('period_quarter').nullable();
    t.decimal('amount_used', 12, 2).notNullable().defaultTo(0);
    t.text('description').nullable();
    t.string('status', 20).notNullable().defaultTo('DRAFT'); // DRAFT | SUBMITTED
    t.integer('submitted_by_user_id')
      .notNullable()
      .references('id')
      .inTable('users')
      .onDelete('RESTRICT');
    t.timestamp('submitted_at', { useTz: true }).nullable();
    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());

    t.unique(['request_id', 'period_year', 'period_quarter']);
    t.index(['request_id']);
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('request_reports');
}
