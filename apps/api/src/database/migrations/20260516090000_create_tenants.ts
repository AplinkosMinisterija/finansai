/**
 * Iter 1: tenants lentelė + users.tenant_id, users.am_scope_org_ids
 *
 * Tenant = organizacija (AM + pavaldžios institucijos).
 */
import type { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable('tenants', (t) => {
    t.increments('id').primary();
    t.string('code', 32).notNullable().unique();
    t.string('name', 200).notNullable();
    t.boolean('is_approver').notNullable().defaultTo(false);
    t.boolean('active').notNullable().defaultTo(true);
    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
  });

  await knex.schema.alterTable('users', (t) => {
    t.integer('tenant_id').nullable().references('id').inTable('tenants').onDelete('RESTRICT');
    t.specificType('am_scope_org_ids', 'integer[]').nullable();
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.alterTable('users', (t) => {
    t.dropColumn('tenant_id');
    t.dropColumn('am_scope_org_ids');
  });
  await knex.schema.dropTableIfExists('tenants');
}
