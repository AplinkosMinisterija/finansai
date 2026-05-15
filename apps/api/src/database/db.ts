/**
 * DB bootstrap'as: inicializuoja Knex instance'ą, prijungia Objection'ą prie jo.
 * Eksportuoja `getKnex()`, `closeDb()`, `runMigrations()`.
 */
import KnexFactory, { type Knex } from 'knex';
import { Model } from 'objection';
import pgTypes from 'pg';
import knexConfig from './knexfile';

// PostgreSQL DATE (type OID 1082) — be timezone konversijos, kaip 'YYYY-MM-DD'.
// Be šito pg modulis grąžina JS Date prie local midnight, ir tada toISOString
// nuslysta į UTC, sukurdamas off-by-one dieną.
pgTypes.types.setTypeParser(1082, (val: string) => val);

let knexInstance: Knex | null = null;

export function getKnex(): Knex {
  if (!knexInstance) {
    knexInstance = KnexFactory(knexConfig);
    Model.knex(knexInstance);
  }
  return knexInstance;
}

export async function initDb(): Promise<Knex> {
  const knex = getKnex();
  // Sanity check — bandymas užklausti versiją.
  await knex.raw('SELECT 1');
  return knex;
}

export async function runMigrations(): Promise<void> {
  const knex = getKnex();
  await knex.migrate.latest();
}

export async function runSeeds(): Promise<void> {
  const knex = getKnex();
  await knex.seed.run();
}

export async function closeDb(): Promise<void> {
  if (knexInstance) {
    await knexInstance.destroy();
    knexInstance = null;
  }
}
