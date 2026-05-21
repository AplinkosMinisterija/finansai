/**
 * Patikrinimo helper'is FVM foundation migracijai (Iter 9).
 *
 * Trys integritetiniai patikrinimai pagal `docs/fvm/02-migration-strategy.md`
 * Žingsnis 3:
 *   1. Allocation kiekio match — kiek senų `budget_allocations` įrašų yra,
 *      tiek turi būti naujų `budget_allocations_v2`.
 *   2. Sumų match — bendra `amount` suma senose lygi bendrai `planuota_suma`
 *      naujose (su epsilon = 0.01).
 *   3. Per kiekvieną `funding_source`: `metine_suma >= SUM(allocations.planuota_suma)`.
 *      T.y. negali būti, kad paskirstyme yra daugiau, nei pats šaltinis numato.
 *
 * Funkcija FAIL'inant `throw`'ina su informatyviu message'u — kviečiama
 * migracijos `up` pabaigoje IŠ transaction'o, todėl fail → auto-rollback.
 *
 * Naudoja `Knex` arba `Knex.Transaction` (Knex.Transaction extends Knex).
 */
import type { Knex } from 'knex';

interface CountRow {
  count: string | number;
}

interface SumRow {
  sum: string | number | null;
}

interface FundingSourceRow {
  id: number;
  kodas: string;
  metine_suma: string | number;
}

function toNumber(val: string | number | null | undefined): number {
  if (val === null || val === undefined) return 0;
  return typeof val === 'number' ? val : Number(val);
}

export async function verifyFvmFoundation(knex: Knex): Promise<void> {
  // 1. Allocation kiekio match.
  const oldCountRow = (await knex('budget_allocations')
    .count<CountRow[]>('id as count')
    .first()) as CountRow | undefined;
  const newCountRow = (await knex('budget_allocations_v2')
    .count<CountRow[]>('id as count')
    .first()) as CountRow | undefined;
  const oldCount = toNumber(oldCountRow?.count ?? 0);
  const newCount = toNumber(newCountRow?.count ?? 0);
  if (oldCount !== newCount) {
    throw new Error(
      `[verifyFvmFoundation] Allocation count mismatch: ` +
        `senos budget_allocations=${oldCount}, naujos budget_allocations_v2=${newCount}`,
    );
  }

  // 2. Sumų match (epsilon 0.01 dėl decimal precision).
  const oldSumRow = (await knex('budget_allocations')
    .sum<SumRow[]>('amount as sum')
    .first()) as SumRow | undefined;
  const newSumRow = (await knex('budget_allocations_v2')
    .sum<SumRow[]>('planuota_suma as sum')
    .first()) as SumRow | undefined;
  const oldSum = toNumber(oldSumRow?.sum ?? 0);
  const newSum = toNumber(newSumRow?.sum ?? 0);
  if (Math.abs(oldSum - newSum) >= 0.01) {
    throw new Error(
      `[verifyFvmFoundation] Sum mismatch: ` +
        `senos sum=${oldSum.toFixed(2)}, naujos sum=${newSum.toFixed(2)}`,
    );
  }

  // 3. Kiekvienas funding_source.metine_suma >= SUM(allocations).
  const sources = (await knex('funding_sources').select<FundingSourceRow[]>(
    'id',
    'kodas',
    'metine_suma',
  )) as FundingSourceRow[];
  for (const s of sources) {
    const allocSumRow = (await knex('budget_allocations_v2')
      .where({ funding_source_id: s.id })
      .sum<SumRow[]>('planuota_suma as sum')
      .first()) as SumRow | undefined;
    const allocSum = toNumber(allocSumRow?.sum ?? 0);
    const sourceAmount = toNumber(s.metine_suma);
    if (sourceAmount + 0.01 < allocSum) {
      throw new Error(
        `[verifyFvmFoundation] Šaltinis "${s.kodas}" (id=${s.id}) ` +
          `overcommitted: metine_suma=${sourceAmount.toFixed(2)}, ` +
          `allocations sum=${allocSum.toFixed(2)}`,
      );
    }
  }
}
