/**
 * Seed versijos detekcija — kad dev/local aplinkos automatiškai persiseedintų
 * praplėtus demo duomenis (Iter 18 „showcase").
 *
 * `runSeeds()` yra pilnas wipe+rebuild (01_initial ištrina viską ir atstato).
 * `runner.ts:maybeSeed` jį kviečia tik kai DB tuščia. Šis helper'is leidžia
 * maybeSeed atpažinti, kad esamoje (jau seed'intoje) DB nėra naujo showcase
 * dataset'o → tada saugiai paleidžiamas pilnas reseed (demo aplinkose tai OK).
 *
 * Detekcija: showcase seed'as sukuria ≥ `SEED_MIN_FUNDING_SOURCES` finansavimo
 * šaltinius (senasis — 2). Jei mažiau — laikom, kad showcase dar neįdiegtas.
 */
import type { Knex } from 'knex';

/** Showcase seed'as sukuria tiek finansavimo šaltinių (senasis seed'as — 2). */
export const SEED_MIN_FUNDING_SOURCES = 4;

export async function isShowcaseSeeded(knex: Knex): Promise<boolean> {
  if (!(await knex.schema.hasTable('funding_sources'))) return false;
  const row = (await knex('funding_sources').count<{ count: string }[]>('id as count').first()) as
    | { count: string }
    | undefined;
  const count = row ? Number(row.count) : 0;
  return count >= SEED_MIN_FUNDING_SOURCES;
}
