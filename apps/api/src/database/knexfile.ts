/**
 * Knex konfigūracija. Naudoja `DB_CONNECTION` env kintamąjį (PostgreSQL URL).
 * Migracijos ir seedai gyvena `./migrations` ir `./seeds`.
 *
 * Production'e (kai build'inta į `dist/`) migracijų failai turi būti `.js`.
 * Dev/test režime — `.ts` (paleidžiama per ts-node/tsx).
 *
 * Eksportuoja:
 *  - `default` — knex CLI vartoja per `--knexfile`, ima `DB_CONNECTION`.
 *  - `createKnexConfig(overrides)` — factory test'ams, leidžia
 *    perduoti `connection` (`TEST_DB_CONNECTION`) ir kitus override'us.
 */
import 'dotenv/config';
import path from 'path';
import type { Knex } from 'knex';

const isCompiled = __filename.endsWith('.js');
const extension = isCompiled ? 'js' : 'ts';
const directoryBase = __dirname;

const DEFAULT_CONNECTION =
  'postgresql://finansai:finansai@localhost:5433/finansai';

export interface KnexConfigOverrides {
  connection?: string;
  pool?: Knex.PoolConfig;
}

export function createKnexConfig(overrides: KnexConfigOverrides = {}): Knex.Config {
  return {
    client: 'pg',
    connection:
      overrides.connection ?? process.env.DB_CONNECTION ?? DEFAULT_CONNECTION,
    pool: overrides.pool ?? { min: 0, max: 10 },
    migrations: {
      directory: path.join(directoryBase, 'migrations'),
      extension,
      loadExtensions: [`.${extension}`],
      tableName: 'knex_migrations',
    },
    seeds: {
      directory: path.join(directoryBase, 'seeds'),
      extension,
      loadExtensions: [`.${extension}`],
    },
  };
}

const config: Knex.Config = createKnexConfig();

export default config;
