/**
 * Issue #4: prašymas turi metų lauką (multi-year planavimas).
 *
 * - year === currentYear → einamųjų metų prašymas
 * - year  >  currentYear → planas (iki 5 m. priekį)
 *
 * Esami prašymai per backfill gauna metus iš `created_at` (immutable).
 */
import type { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  await knex.schema.alterTable('requests', (t) => {
    t.integer('year').nullable();
  });

  // Backfill: esami prašymai gauna metus iš jų sukūrimo datos (immutable).
  await knex.raw(
    "UPDATE requests SET year = EXTRACT(YEAR FROM created_at)::int WHERE year IS NULL",
  );

  await knex.schema.alterTable('requests', (t) => {
    t.integer('year').notNullable().alter();
  });

  await knex.raw('CREATE INDEX IF NOT EXISTS requests_year_idx ON requests (year)');
}

export async function down(knex: Knex): Promise<void> {
  await knex.raw('DROP INDEX IF EXISTS requests_year_idx');
  await knex.schema.alterTable('requests', (t) => {
    t.dropColumn('year');
  });
}
