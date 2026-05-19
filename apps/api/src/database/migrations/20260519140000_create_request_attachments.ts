/**
 * Po-MVP iter: prašymo prikabinti dokumentai (issue #13, paliečia #3).
 *
 * Pradžiai saugoma DB kaip base64 — paprasta, audit'as kartu su prašymu,
 * jokia papildoma infra. Limit'as ~5MB per failą.
 * Vėliau galima migruoti į MinIO.
 */
import type { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable('request_attachments', (t) => {
    t.increments('id').primary();
    t.integer('request_id')
      .notNullable()
      .references('id')
      .inTable('requests')
      .onDelete('CASCADE');
    t.string('kind', 32).notNullable(); // 'order_pdf' | 'invoice' | 'other'
    t.string('file_name', 255).notNullable();
    t.string('mime_type', 100).notNullable();
    t.integer('size_bytes').notNullable();
    t.text('data_base64').notNullable();
    t.integer('uploaded_by_user_id')
      .notNullable()
      .references('id')
      .inTable('users')
      .onDelete('RESTRICT');
    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());

    t.index(['request_id', 'kind']);
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('request_attachments');
}
