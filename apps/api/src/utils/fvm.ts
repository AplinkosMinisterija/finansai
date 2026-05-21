/**
 * FVM specifinės konstantos ir helper'iai (Iter 12+).
 *
 * - `WARNING_THRESHOLD_PERCENT` — biudžeto perspėjimo riba procentais.
 *   Naudojama `budgetAllocations.summary`, `projects.summary` ir
 *   `expenses.budgetSummary` endpoint'uose, kad atspindėtų, ar artėja
 *   biudžeto limitas (F11 iš docx §4.3).
 *
 *   Default reikšmė — 80 (procentai). Override per environment variable
 *   `FVM_WARNING_THRESHOLD_PERCENT` (parsinama kaip integer, 0–100 rėžiuose).
 *
 *   Sprendimas — env'as, ne app_settings lentelė: Iter 12 specifiškai nurodo
 *   kol kas hard-coded ar env override (žr. iter-12-expenses.md NEAPIMA
 *   sekcija). Iter 13+ gali būti perkelta į `app_settings` ten, kur AM admin
 *   tuningina per UI.
 *
 * - `EXPENSE_SUM_EPSILON_CENTS` — leidžiamas absoliutus nuokrypis (centais)
 *   palyginant multi-source split sumą su išlaidos suma. 1 centas — kad
 *   leistume rounding errors per UI po `toFixed(2)`. Praktikoje visada turi
 *   būti 0, bet tolerancija leidžia gradacijų / display rounding'ą.
 */
const DEFAULT_WARNING_THRESHOLD_PERCENT = 80;

/**
 * Skaito `FVM_WARNING_THRESHOLD_PERCENT` iš env'o ir validuoja. Jei reikšmė
 * neparseable arba ne 0–100 rėžiuose — fallback'inam į default'ą.
 */
function resolveWarningThreshold(): number {
  const raw = process.env['FVM_WARNING_THRESHOLD_PERCENT'];
  if (raw === undefined || raw === '') return DEFAULT_WARNING_THRESHOLD_PERCENT;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0 || n > 100) {
    return DEFAULT_WARNING_THRESHOLD_PERCENT;
  }
  return n;
}

/** Biudžeto perspėjimo riba procentais. Skaitoma kas užklausą, kad
 * test'ai galėtų nustatyti `process.env.FVM_WARNING_THRESHOLD_PERCENT`. */
export function getWarningThresholdPercent(): number {
  return resolveWarningThreshold();
}

/** Leidžiamas nuokrypis palyginant multi-source split su išlaidos suma
 * (1 centas — žr. modulio header'į). */
export const EXPENSE_SUM_EPSILON_CENTS = 1;

/**
 * Apskaičiuoja % naudojimą (faktine / planuota × 100). Apdoroja zero-planned
 * atvejį: planuota=0 + faktine=0 → 0%; planuota=0 + faktine>0 → 100% (viskas
 * over).
 *
 * Suapvalinama iki 2 skaičių po kablelio (būna „79.99" arba „80.50" — svarbu
 * stabiliam UI rodymui).
 */
export function calculatePercentUsed(
  planuotaCents: number,
  faktineCents: number,
): number {
  if (planuotaCents <= 0) {
    return faktineCents > 0 ? 100 : 0;
  }
  const ratio = (faktineCents / planuotaCents) * 100;
  return Math.round(ratio * 100) / 100;
}

/**
 * Apskaičiuoja warning ir over flag'us iš procento.
 *
 * - `isWarning` — true, jei procentas >= threshold (default 80%).
 * - `isOver` — true, jei procentas > 100%.
 *
 * Sąmoningai `isWarning` `>=` (ne `>`) — kad lygiai 80% atsirastų UI
 * notifikacija (audit kriterijus F11).
 */
export function calculateWarningFlags(percentUsed: number): {
  isWarning: boolean;
  isOver: boolean;
} {
  const threshold = getWarningThresholdPercent();
  return {
    isWarning: percentUsed >= threshold,
    isOver: percentUsed > 100,
  };
}
