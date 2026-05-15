/**
 * Knex konfigūracija. Naudoja `DB_CONNECTION` env kintamąjį (PostgreSQL URL).
 * Migracijos ir seedai gyvena `./migrations` ir `./seeds`.
 *
 * Production'e (kai build'inta į `dist/`) migracijų failai turi būti `.js`.
 * Dev/test režime — `.ts` (paleidžiama per ts-node/tsx).
 */
import 'dotenv/config';
import path from 'path';
import type { Knex } from 'knex';

const isCompiled = __filename.endsWith('.js');
const extension = isCompiled ? 'js' : 'ts';
const directoryBase = __dirname;

const config: Knex.Config = {
  client: 'pg',
  connection:
    process.env.DB_CONNECTION || 'postgresql://finansai:finansai@localhost:5433/finansai',
  pool: { min: 0, max: 10 },
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

export default config;
