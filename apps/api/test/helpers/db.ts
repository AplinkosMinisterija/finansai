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

export interface OrgTenantFixtures {
  orgTenantId: number;
  orgAdminUserId: number;
  orgUserId: number;
}

/**
 * Sukuria papildomą organizacijos tenant'ą (NE-AM, ne-approver) su admin ir
 * paprastu user'iu. Naudojama permission test'ams (kad galima būtų patikrinti
 * 403 atsakymus, kai ne-AM admin bando kurti/keisti FVM duomenis).
 *
 * Default'iniai kodai/usernames pasirinkti, kad nesidubliuotų su
 * `seedBaseFixtures`'o AM tenant'o user'iais.
 */
export async function seedOrgTenant(
  knex: Knex,
  opts: { code?: string; name?: string } = {},
): Promise<OrgTenantFixtures> {
  const code = opts.code ?? 'AAD';
  const name = opts.name ?? 'Aplinkos apsaugos departamentas';
  const tenantRows = (await knex('tenants')
    .insert({
      code,
      name,
      description: 'Test fixture — org tenant',
      is_approver: false,
      active: true,
    })
    .returning('id')) as Array<{ id: number }>;
  const orgTenantId = tenantRows[0]?.id;
  if (orgTenantId === undefined) {
    throw new Error('Test fixture: nepavyko sukurti org tenant');
  }

  const passwordHash = await bcrypt.hash('test', 10);
  const adminRows = (await knex('users')
    .insert({
      username: `test-${code.toLowerCase()}-admin`,
      password_hash: passwordHash,
      full_name: `Test ${code} Admin`,
      email: `test-${code.toLowerCase()}-admin@example.com`,
      role: 'admin',
      tenant_id: orgTenantId,
      am_scope_org_ids: null,
      active: true,
    })
    .returning('id')) as Array<{ id: number }>;
  const orgAdminUserId = adminRows[0]?.id;
  if (orgAdminUserId === undefined) {
    throw new Error('Test fixture: nepavyko sukurti org admin user');
  }

  const userRows = (await knex('users')
    .insert({
      username: `test-${code.toLowerCase()}-user`,
      password_hash: passwordHash,
      full_name: `Test ${code} User`,
      email: `test-${code.toLowerCase()}-user@example.com`,
      role: 'user',
      tenant_id: orgTenantId,
      am_scope_org_ids: null,
      active: true,
    })
    .returning('id')) as Array<{ id: number }>;
  const orgUserId = userRows[0]?.id;
  if (orgUserId === undefined) {
    throw new Error('Test fixture: nepavyko sukurti org user');
  }

  return { orgTenantId, orgAdminUserId, orgUserId };
}

export interface FvmClassifierFixtures {
  fundingSourceTypeGroupId: number;
  fundingSourceTypeItemIds: {
    biudzetas: number;
    es: number;
    kita: number;
  };
  budgetCategoryGroupId: number;
  budgetCategoryItemIds: {
    du: number;
    spec_programa: number;
    prekes_paslaugos: number;
    investicijos: number;
    kita: number;
  };
  /** UAT #42 (PA-005): source_program grupė su tėvais (funding_source_type). */
  sourceProgramGroupId: number;
  sourceProgramItemIds: {
    /** Tėvas = funding_source_type.biudzetas */
    am_it_budget: number;
    /** Tėvas = funding_source_type.es */
    eu_funds: number;
    /** Be tėvo (legacy). */
    kita: number;
  };
}

interface ClassifierItemSeed {
  code: string;
  name: string;
  sortOrder: number;
}

async function ensureGroup(
  knex: Knex,
  code: string,
  name: string,
  description: string,
  items: ClassifierItemSeed[],
): Promise<{ groupId: number; itemIdsByCode: Record<string, number> }> {
  const existing = (await knex('classifier_groups').where({ code }).first<{ id: number }>()) as
    | { id: number }
    | undefined;
  let groupId: number;
  if (existing) {
    groupId = existing.id;
  } else {
    const inserted = (await knex('classifier_groups')
      .insert({ code, name, description, active: true })
      .returning('id')) as Array<{ id: number }>;
    const newId = inserted[0]?.id;
    if (newId === undefined) {
      throw new Error(`Test fixture: nepavyko sukurti grupės ${code}`);
    }
    groupId = newId;
  }
  const itemIdsByCode: Record<string, number> = {};
  for (const item of items) {
    const existingItem = (await knex('classifier_items')
      .where({ group_id: groupId, code: item.code })
      .first<{ id: number }>()) as { id: number } | undefined;
    if (existingItem) {
      itemIdsByCode[item.code] = existingItem.id;
      continue;
    }
    const inserted = (await knex('classifier_items')
      .insert({
        group_id: groupId,
        parent_id: null,
        code: item.code,
        name: item.name,
        sort_order: item.sortOrder,
        active: true,
      })
      .returning('id')) as Array<{ id: number }>;
    const id = inserted[0]?.id;
    if (id === undefined) {
      throw new Error(`Test fixture: nepavyko sukurti item ${code}:${item.code}`);
    }
    itemIdsByCode[item.code] = id;
  }
  return { groupId, itemIdsByCode };
}

/**
 * Įdeda FVM klasifikatorius (`funding_source_type` ir `budget_category` grupės
 * + jų default items). Atitinka tai, ką daro
 * `20260522100000_create_fvm_foundation.ts` migracija production'e — bet šiame
 * test setup'e duomenys įdedami po `truncateAll`'o, tad reikia seedinti
 * iš naujo per kiekvieną test'ą.
 *
 * Idempotent — jei grupė ar item'as jau yra, naudoja esamą ID.
 */
export async function seedFvmClassifiers(knex: Knex): Promise<FvmClassifierFixtures> {
  const fundingSourceType = await ensureGroup(
    knex,
    'funding_source_type',
    'Finansavimo šaltinio tipas',
    'Test fixture — funding_source_type group',
    [
      { code: 'biudzetas', name: 'Valstybės biudžetas', sortOrder: 10 },
      { code: 'es', name: 'ES fondai', sortOrder: 20 },
      { code: 'kita', name: 'Kiti', sortOrder: 99 },
    ],
  );
  const budgetCategory = await ensureGroup(
    knex,
    'budget_category',
    'Biudžeto kategorija',
    'Test fixture — budget_category group',
    [
      { code: 'du', name: 'Darbo užmokestis', sortOrder: 10 },
      { code: 'spec_programa', name: 'Specialioji programa', sortOrder: 20 },
      { code: 'prekes_paslaugos', name: 'Prekės ir paslaugos', sortOrder: 30 },
      { code: 'investicijos', name: 'Investicijos', sortOrder: 40 },
      { code: 'kita', name: 'Kita', sortOrder: 99 },
    ],
  );

  // UAT #42 (PA-005): source_program grupė. Dvi programos susietos su
  // funding_source_type tėvais (per parent_id), viena — be tėvo (legacy).
  const sourceProgram = await ensureGroup(
    knex,
    'source_program',
    'Finansavimo šaltinio programos',
    'Test fixture — source_program group',
    [
      { code: 'AM_IT_BUDGET', name: 'AM IT biudžetas', sortOrder: 10 },
      { code: 'EU_FUNDS', name: 'ES struktūriniai fondai', sortOrder: 20 },
      { code: 'OTHER', name: 'Kita', sortOrder: 99 },
    ],
  );
  // Priskiriam tėvus (funding_source_type) source_program reikšmėms.
  await knex('classifier_items')
    .where({ id: sourceProgram.itemIdsByCode['AM_IT_BUDGET']! })
    .update({ parent_id: fundingSourceType.itemIdsByCode['biudzetas']! });
  await knex('classifier_items')
    .where({ id: sourceProgram.itemIdsByCode['EU_FUNDS']! })
    .update({ parent_id: fundingSourceType.itemIdsByCode['es']! });

  return {
    fundingSourceTypeGroupId: fundingSourceType.groupId,
    fundingSourceTypeItemIds: {
      biudzetas: fundingSourceType.itemIdsByCode['biudzetas']!,
      es: fundingSourceType.itemIdsByCode['es']!,
      kita: fundingSourceType.itemIdsByCode['kita']!,
    },
    budgetCategoryGroupId: budgetCategory.groupId,
    budgetCategoryItemIds: {
      du: budgetCategory.itemIdsByCode['du']!,
      spec_programa: budgetCategory.itemIdsByCode['spec_programa']!,
      prekes_paslaugos: budgetCategory.itemIdsByCode['prekes_paslaugos']!,
      investicijos: budgetCategory.itemIdsByCode['investicijos']!,
      kita: budgetCategory.itemIdsByCode['kita']!,
    },
    sourceProgramGroupId: sourceProgram.groupId,
    sourceProgramItemIds: {
      am_it_budget: sourceProgram.itemIdsByCode['AM_IT_BUDGET']!,
      eu_funds: sourceProgram.itemIdsByCode['EU_FUNDS']!,
      kita: sourceProgram.itemIdsByCode['OTHER']!,
    },
  };
}
