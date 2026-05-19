/**
 * Issue #9: daugiapakopė aprobacija (data model).
 *
 * Vienas prašymas turi N žingsnių (sequence). Šitas etapas (AAD) naudoja
 * tik vieną default žingsnį (level = "am_admin"), bet schema palaiko N
 * (skyrius → departamentas → kancleris), kad pridėti būsimus žingsnius
 * būtų galima konfigūracija, ne migracija.
 *
 * Žingsnio statusas: PENDING → APPROVED | REJECTED | RETURNED. Visi žingsniai
 * APPROVED → prašymas APPROVED. Bet kuris RETURNED ar REJECTED → prašymas
 * grįžta į tą būklę.
 */
import type { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable('approval_steps', (t) => {
    t.increments('id').primary();
    t.integer('request_id')
      .notNullable()
      .references('id')
      .inTable('requests')
      .onDelete('CASCADE');
    t.integer('sequence').notNullable(); // 1, 2, 3...
    /** classifier_items.code iš grupės "approval_levels" (am_admin / skyrius / depas / kancleris) */
    t.string('level_code', 64).notNullable();
    t.string('level_name', 200).notNullable(); // snapshot label (kad istorija nesigriautų jei klasifikatorius pasikeitė)
    t.string('status', 20).notNullable().defaultTo('PENDING'); // PENDING | APPROVED | REJECTED | RETURNED
    t.integer('decided_by_user_id')
      .nullable()
      .references('id')
      .inTable('users')
      .onDelete('SET NULL');
    t.timestamp('decided_at', { useTz: true }).nullable();
    t.text('comment').nullable();
    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());

    t.unique(['request_id', 'sequence']);
    t.index(['request_id', 'status']);
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('approval_steps');
}
