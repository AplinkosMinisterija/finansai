/**
 * Iter 6: rolių modelio supaprastinimas.
 *
 * Senos reikšmės: 'am_admin' | 'am_user' | 'org_admin' | 'org_user'
 * Naujos: 'admin' | 'user'
 *
 * Mapping:
 *   am_admin  → admin
 *   am_user   → user
 *   org_admin → admin
 *   org_user  → user
 *
 * Po šios migracijos:
 *  - Visiems vartotojams role ∈ {'admin', 'user'}.
 *  - Semantiką nustato tenants.is_approver (AM vs pavaldi institucija).
 *  - AM specialistui (`user` rolei AM tenant'e) galioja am_scope_org_ids.
 */
import type { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  await knex('users').whereIn('role', ['am_admin', 'org_admin']).update({ role: 'admin' });
  await knex('users').whereIn('role', ['am_user', 'org_user']).update({ role: 'user' });
}

export async function down(knex: Knex): Promise<void> {
  // Best-effort rollback: rolę inferinam iš tenant.is_approver.
  // am_* tenant aprover'iams, org_* — pavaldžioms.
  await knex.raw(`
    UPDATE users u
    SET role = CASE
      WHEN t.is_approver = TRUE AND u.role = 'admin' THEN 'am_admin'
      WHEN t.is_approver = TRUE AND u.role = 'user'  THEN 'am_user'
      WHEN t.is_approver = FALSE AND u.role = 'admin' THEN 'org_admin'
      WHEN t.is_approver = FALSE AND u.role = 'user'  THEN 'org_user'
      ELSE u.role
    END
    FROM tenants t
    WHERE u.tenant_id = t.id
  `);
}
