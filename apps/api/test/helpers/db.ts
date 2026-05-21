/**
 * DB helper'iai test'ams.
 *
 * - `getTestKnex()` — singleton knex instance test prosesui. Pirmas iškvietimas
 *   prijungia Objection'ą prie šio knex'o (kad model'iai veiktų). Reikia
 *   uždaryti per `closeTestKnex()` test failo `afterAll`'e.
 * - `truncateAll(knex)` — išvalo visas non-knex lenteles, kad spec'as
 *   startuotų nuo žinomos švarios būsenos. Naudoti `beforeEach` arba
 *   `beforeAll`.
 * - `seedBaseFixtures(knex)` — minimum reikalingas seed'as DEKLARUOTAM kontextui:
 *   1 AM (approver) tenant'as + 1 AM admin user'is. Grąžina jų ID'us.
 */
import KnexFactory, { type Knex } from 'knex';
import { Model } from 'objection';
import bcrypt from 'bcryptjs';
import pgTypes from 'pg';
import { createKnexConfig } from '../../src/database/knexfile';

// PostgreSQL DATE be timezone conversation — kaip ir `src/database/db.ts`.
pgTypes.types.setTypeParser(1082, (val: string) => val);

let testKnex: Knex | null = null;

function resolveConnection(): string {
  const conn = process.env['TEST_DB_CONNECTION'] ?? process.env['DB_CONNECTION'];
  if (!conn) {
    throw new Error(
      '[test/helpers/db] Nei TEST_DB_CONNECTION, nei DB_CONNECTION nenustatyti. ' +
        'Patikrink, kad jest paleido per setup-env.ts.',
    );
  }
  return conn;
}

/**
 * Grąžina singleton test knex instance'ą. Pirmu iškvietimu — prijungia
 * `Model.knex(...)` (Objection global'us), kad model query'iai veiktų.
 */
export function getTestKnex(): Knex {
  if (!testKnex) {
    testKnex = KnexFactory(
      createKnexConfig({ connection: resolveConnection(), pool: { min: 0, max: 4 } }),
    );
    Model.knex(testKnex);
  }
  return testKnex;
}

/**
 * Uždaro test knex connection'ą. Kviesti spec'o `afterAll`'e.
 */
export async function closeTestKnex(): Promise<void> {
  if (testKnex) {
    await testKnex.destroy();
    testKnex = null;
  }
}

/**
 * Truncate'ina visas duomenines lenteles (visas, išskyrus `knex_*` metadata).
 * `RESTART IDENTITY` reset'ina sequence'us — kad ID'ai pradėtų nuo 1
 * kiekviename test'e (stabilūs assertion'ai).
 */
export async function truncateAll(knex: Knex): Promise<void> {
  const tables = await knex.raw<{
    rows: Array<{ tablename: string }>;
  }>(`
    SELECT tablename FROM pg_tables
    WHERE schemaname = 'public'
      AND tablename NOT LIKE 'knex_%'
  `);
  if (tables.rows.length === 0) return;
  const list = tables.rows.map((r) => `"${r.tablename}"`).join(', ');
  await knex.raw(`TRUNCATE TABLE ${list} RESTART IDENTITY CASCADE`);
}

export interface BaseFixtures {
  amTenantId: number;
  amAdminUserId: number;
}

/**
 * Įdeda minimalius fixture'us testams kuriems reikia auth'ed user'io
 * konteksto:
 *  - 1 AM tenant'as (is_approver=true) su kodu 'AM'.
 *  - 1 admin user'is 'test-am-admin' (slaptažodis 'test') AM tenant'e.
 *
 * Naudoti `beforeEach` po `truncateAll`. Grąžina ID'us tolimesniems
 * spec'o assert'ams.
 */
export async function seedBaseFixtures(knex: Knex): Promise<BaseFixtures> {
  const tenantRows = (await knex('tenants')
    .insert({
      code: 'AM',
      name: 'Aplinkos ministerija',
      description: 'Test fixture — AM tenant',
      is_approver: true,
      active: true,
    })
    .returning('id')) as Array<{ id: number }>;
  const amTenantId = tenantRows[0]?.id;
  if (amTenantId === undefined) {
    throw new Error('Test fixture: nepavyko sukurti AM tenant');
  }

  // 10 round'ų — bcrypt default'as; gerai test'ams kur kvietimas tik 1x.
  const passwordHash = await bcrypt.hash('test', 10);
  const userRows = (await knex('users')
    .insert({
      username: 'test-am-admin',
      password_hash: passwordHash,
      full_name: 'Test AM Admin',
      email: 'test-am-admin@example.com',
      role: 'admin',
      tenant_id: amTenantId,
      am_scope_org_ids: null,
      active: true,
    })
    .returning('id')) as Array<{ id: number }>;
  const amAdminUserId = userRows[0]?.id;
  if (amAdminUserId === undefined) {
    throw new Error('Test fixture: nepavyko sukurti AM admin user');
  }

  return { amTenantId, amAdminUserId };
}
