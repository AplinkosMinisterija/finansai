import type { Knex } from 'knex';
// #9: AM tvirtintojo aprobacijos lygiai (approval_levels kodai). Analogiškai
// users.am_scope_org_ids — masyvas, default tuščias.
export async function up(knex: Knex): Promise<void> {
  await knex.schema.alterTable('users', (t) => {
    t.specificType('approval_level_codes', 'text[]').notNullable().defaultTo('{}');
  });
}
export async function down(knex: Knex): Promise<void> {
  await knex.schema.alterTable('users', (t) => {
    t.dropColumn('approval_level_codes');
  });
}
