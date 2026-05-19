/**
 * Po-MVP iter: klasifikatorių sistema.
 *
 * Du lygiai:
 * - classifier_groups — grupė, pvz. „funding_type", „is_system", „project_type", „source_program"
 * - classifier_items — vertė grupėje, su nepriv. tėvu (hierarchija, pvz. IT → licencijos)
 *
 * Naudojami: biudžeto skaidymas (#1), IS dropdown (#7), statistika (#6),
 * šaltinio programa (#8).
 */
import type { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable('classifier_groups', (t) => {
    t.increments('id').primary();
    t.string('code', 64).notNullable().unique();
    t.string('name', 200).notNullable();
    t.text('description').nullable();
    t.boolean('active').notNullable().defaultTo(true);
    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
  });

  await knex.schema.createTable('classifier_items', (t) => {
    t.increments('id').primary();
    t.integer('group_id').notNullable().references('id').inTable('classifier_groups').onDelete('CASCADE');
    t.integer('parent_id').nullable().references('id').inTable('classifier_items').onDelete('CASCADE');
    t.string('code', 64).notNullable();
    t.string('name', 200).notNullable();
    t.integer('sort_order').notNullable().defaultTo(0);
    t.boolean('active').notNullable().defaultTo(true);
    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());

    t.unique(['group_id', 'code']);
    t.index(['group_id', 'parent_id', 'sort_order']);
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('classifier_items');
  await knex.schema.dropTableIfExists('classifier_groups');
}
