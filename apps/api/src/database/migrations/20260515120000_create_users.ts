/**
 * Initial users migration (Iter 0).
 *
 * Iter 1 papildys: organizations lentelę + users.tenant_id FK + users.am_scope_org_ids INT[].
 */
import type { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable('users', (t) => {
    t.increments('id').primary();
    t.string('username', 64).notNullable().unique();
    t.string('password_hash', 200).notNullable();
    t.string('full_name', 200).notNullable();
    t.string('email', 200).nullable();
    t.string('role', 32).notNullable();
    t.boolean('active').notNullable().defaultTo(true);
    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('users');
}
