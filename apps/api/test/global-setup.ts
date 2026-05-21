/**
 * Jest global setup — vyksta VIENĄ kartą prieš visus test failus.
 *
 * Atsakomybės:
 *   1. Užtikrinti, kad `finansai_test` DB egzistuoja (sukurti jei trūksta).
 *   2. Paleisti visas knex migracijas į švarią test DB.
 *   3. Truncate'inti visas duomenines lenteles, kad kiekvienas `yarn test`
 *      paleidimas startuotų nuo žinomos švarios būsenos. Schema lieka
 *      migruota (greitis), bet duomenys — tušti.
 *
 * Pastaba: DB pati neistrinama net jei migracijos pasikeitė — drop-recreate
 * būtų lėčiau ir trintų bet kokius lokalius testo failure inspect'us.
 * Jei reikia full reset — `dropdb finansai_test` rankomis ir vėl `yarn test`.
 */
import 'dotenv/config';
import KnexFactory from 'knex';
import { createKnexConfig } from '../src/database/knexfile';

const DEFAULT_TEST_CONNECTION =
  'postgresql://finansai:finansai@localhost:5433/finansai_test';

interface ParsedConn {
  url: URL;
  dbName: string;
  adminConnection: string;
}

function parseConnection(raw: string): ParsedConn {
  const url = new URL(raw);
  const dbName = url.pathname.replace(/^\//, '');
  if (!dbName) {
    throw new Error(
      `TEST_DB_CONNECTION neturi DB pavadinimo (path): ${raw}`,
    );
  }
  // Admin connection — ta pati host/user/pass, bet jungiamasi prie `postgres`
  // sisteminės DB, kad galėtume `CREATE DATABASE`.
  const adminUrl = new URL(raw);
  adminUrl.pathname = '/postgres';
  return { url, dbName, adminConnection: adminUrl.toString() };
}

async function ensureDatabaseExists(parsed: ParsedConn): Promise<void> {
  const admin = KnexFactory({
    client: 'pg',
    connection: parsed.adminConnection,
    pool: { min: 0, max: 1 },
  });
  try {
    const exists = await admin.raw<{ rows: Array<{ datname: string }> }>(
      'SELECT datname FROM pg_database WHERE datname = ?',
      [parsed.dbName],
    );
    if (exists.rows.length === 0) {
      // Knex neleidžia bindings DDL — saugiai escape'inam.
      const safe = parsed.dbName.replace(/[^a-zA-Z0-9_]/g, '');
      if (safe !== parsed.dbName) {
        throw new Error(
          `Test DB name turi negalimų simbolių: ${parsed.dbName}`,
        );
      }
      await admin.raw(`CREATE DATABASE "${safe}"`);
      // eslint-disable-next-line no-console
      console.log(`[test setup] Sukurta DB: ${safe}`);
    }
  } finally {
    await admin.destroy();
  }
}

async function migrateAndClean(parsed: ParsedConn): Promise<void> {
  const knex = KnexFactory(
    createKnexConfig({ connection: parsed.url.toString(), pool: { min: 0, max: 2 } }),
  );
  try {
    await knex.migrate.latest();

    // Truncate visas non-knex lenteles, kad startuotume švarūs.
    // Ne TRUNCATE knex_migrations — schema metadata reikalinga.
    const tables = await knex.raw<{
      rows: Array<{ tablename: string }>;
    }>(`
      SELECT tablename FROM pg_tables
      WHERE schemaname = 'public'
        AND tablename NOT LIKE 'knex_%'
    `);
    if (tables.rows.length > 0) {
      const list = tables.rows
        .map((r) => `"${r.tablename}"`)
        .join(', ');
      await knex.raw(`TRUNCATE TABLE ${list} RESTART IDENTITY CASCADE`);
    }
  } finally {
    await knex.destroy();
  }
}

export default async function globalSetup(): Promise<void> {
  const conn =
    process.env['TEST_DB_CONNECTION'] ?? DEFAULT_TEST_CONNECTION;
  // Užtikrinam, kad setup-env (kuris paleidžiamas per test file) gaus tą patį.
  process.env['TEST_DB_CONNECTION'] = conn;
  process.env['DB_CONNECTION'] = conn;
  process.env['NODE_ENV'] = 'test';

  const parsed = parseConnection(conn);
  await ensureDatabaseExists(parsed);
  await migrateAndClean(parsed);
}
