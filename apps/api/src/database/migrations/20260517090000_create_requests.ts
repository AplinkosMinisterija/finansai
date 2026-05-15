/**
 * Iter 2: requests + request_comments lentelės.
 *
 * `requests` — finansavimo prašymas su Excel lentelėje matytais laukais,
 * suskirstytais į 5 logines grupes (žr. docs/05-prasymo-modelis.md).
 *
 * `request_comments` — ping-pong komentarai + audit log (status_change/edit).
 */
import type { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable('requests', (t) => {
    t.increments('id').primary();
    t.integer('tenant_id').notNullable().references('id').inTable('tenants').onDelete('RESTRICT');
    t.integer('created_by_user_id').notNullable().references('id').inTable('users').onDelete('RESTRICT');
    t.string('status', 32).notNullable().defaultTo('DRAFT'); // DRAFT/SUBMITTED/RETURNED/APPROVED/REJECTED

    // Žingsnis 1 — Pagrindinė informacija
    t.string('project_name', 500).notNullable().defaultTo('');
    t.string('system_code', 64).nullable();
    t.string('project_type', 200).nullable();
    t.text('description').nullable();
    t.text('planned_works').nullable();
    t.integer('priority').nullable();
    t.string('procurement_stage', 64).nullable();

    // Žingsnis 2 — Finansavimas (EUR)
    t.decimal('cost_du', 12, 2).notNullable().defaultTo(0);
    t.decimal('cost_equipment', 12, 2).notNullable().defaultTo(0);
    t.decimal('cost_creation', 12, 2).notNullable().defaultTo(0);
    t.decimal('cost_analysis', 12, 2).notNullable().defaultTo(0);
    t.decimal('cost_development', 12, 2).notNullable().defaultTo(0);
    t.decimal('cost_maintenance', 12, 2).notNullable().defaultTo(0);
    t.decimal('cost_modernization', 12, 2).notNullable().defaultTo(0);
    t.decimal('cost_decommissioning', 12, 2).notNullable().defaultTo(0);
    t.decimal('funding_from_it', 12, 2).notNullable().defaultTo(0);
    t.decimal('other_funds', 12, 2).notNullable().defaultTo(0);
    t.string('other_funds_source', 500).nullable();

    // Žingsnis 3 — Ketvirtinis paskirstymas
    t.decimal('q1_amount', 12, 2).notNullable().defaultTo(0);
    t.decimal('q2_amount', 12, 2).notNullable().defaultTo(0);
    t.decimal('q3_amount', 12, 2).notNullable().defaultTo(0);
    t.decimal('q4_amount', 12, 2).notNullable().defaultTo(0);

    // Žingsnis 4 — Atsakingi asmenys
    t.string('responsible_institution', 500).nullable();
    t.string('executor_name', 500).nullable();
    t.string('executor_email', 200).nullable();
    t.date('implementation_deadline').nullable();
    t.text('submitter_notes').nullable();

    // Žingsnis 5 — Sprendimas (AM)
    t.decimal('decision_granted_amount', 12, 2).nullable();
    t.string('decision_funding_source', 500).nullable();
    t.string('decision_protocol', 500).nullable();
    t.string('decision_order', 500).nullable();
    t.timestamp('decided_at', { useTz: true }).nullable();
    t.integer('decided_by_user_id').nullable().references('id').inTable('users').onDelete('SET NULL');

    t.timestamp('submitted_at', { useTz: true }).nullable();
    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());

    t.index(['tenant_id']);
    t.index(['status']);
    t.index(['created_by_user_id']);
  });

  await knex.schema.createTable('request_comments', (t) => {
    t.increments('id').primary();
    t.integer('request_id').notNullable().references('id').inTable('requests').onDelete('CASCADE');
    t.integer('author_user_id').notNullable().references('id').inTable('users').onDelete('RESTRICT');
    t.string('kind', 32).notNullable(); // comment / status_change / submitted / returned / approved / rejected
    t.text('body').nullable();
    t.jsonb('metadata').nullable();
    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());

    t.index(['request_id']);
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('request_comments');
  await knex.schema.dropTableIfExists('requests');
}
