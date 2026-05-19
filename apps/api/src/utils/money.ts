/**
 * Bendras pinigų sumų helper'is — visi servisai turi naudoti šitą,
 * kad nesidubliuotų normalize / sum / cents logikos (audit #6).
 *
 * Konvencija: decimal sumos pernešamos kaip stringai su 2 fraction
 * skaitmenimis (pvz. „123.45"). Aritmetiką darom per integer cents,
 * kad išvengtume float drift'o.
 */
import { Errors } from 'moleculer';

/**
 * Convert input to canonical decimal string with 2 fraction digits.
 * Throws Moleculer client error on invalid / negative input.
 *
 * `null` / `undefined` / `''` → '0.00'.
 */
export function normalizeAmount(value: unknown): string {
  if (value === null || value === undefined || value === '') return '0';
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n) || n < 0) {
    throw new Errors.MoleculerClientError(
      'Suma turi būti teigiamas skaičius',
      400,
      'INVALID_AMOUNT',
    );
  }
  return n.toFixed(2);
}

/**
 * Convert decimal string (or number) to integer cents.
 * Tuščia / netinkama reikšmė → 0 (nemeta klaidos — naudojam reduce loop'uose,
 * validaciją daro `normalizeAmount` įvedimo metu).
 */
export function toCents(value: string | number | null | undefined): number {
  if (value === null || value === undefined || value === '') return 0;
  const n = typeof value === 'number' ? value : parseFloat(value);
  if (!Number.isFinite(n)) return 0;
  return Math.round(n * 100);
}

/** Convert cents to canonical decimal string. */
export function centsToAmount(cents: number): string {
  return (cents / 100).toFixed(2);
}

/** Sum array of decimal strings without float drift (cents internally). */
export function sumAmounts(values: string[]): string {
  const totalCents = values.reduce((acc, v) => acc + toCents(v), 0);
  return centsToAmount(totalCents);
}
