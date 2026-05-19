/**
 * Po-MVP iter: metinis biudžetas su skaidymu pagal klasifikatorius (issue #1).
 *
 * - `budgets` — vienas įrašas vieneriems metams.
 * - `budget_allocations` — biudžeto skaidymas pagal classifier_items
 *   (pvz. „funding_type" grupės items: IT, mokymai, atlyginimai…).
 */
import type { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable('budgets', (t) => {
    t.increments('id').primary();
    t.integer('year').notNullable().unique();
    t.decimal('total_amount', 14, 2).notNullable().defaultTo(0);
    t.text('notes').nullable();
    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
  });

  await knex.schema.createTable('budget_allocations', (t) => {
    t.increments('id').primary();
    t.integer('budget_id').notNullable().references('id').inTable('budgets').onDelete('CASCADE');
    t.integer('classifier_item_id')
      .notNullable()
      .references('id')
      .inTable('classifier_items')
      .onDelete('RESTRICT');
    t.decimal('amount', 14, 2).notNullable().defaultTo(0);
    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());

    t.unique(['budget_id', 'classifier_item_id']);
    t.index(['budget_id']);
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('budget_allocations');
  await knex.schema.dropTableIfExists('budgets');
}
