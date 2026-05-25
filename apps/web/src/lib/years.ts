/**
 * Metų pasirinkimo helper'is formoms (UAT #40 FS-001 / BP-002).
 *
 * Giedrės UAT prašymas: metų laukas formose turi būti dropdown su einamieji
 * metai ±3, numatytoji reikšmė — einamieji metai. Filtrai jau naudoja dropdown,
 * čia tik formų (create/edit) laukams.
 *
 * `include` užtikrina, kad redaguojant įrašą su metais už diapazono ribų
 * (pvz. nukopijuotą į 2030), esama reikšmė vis tiek matoma sąraše.
 */
export function yearOptions(opts?: {
  back?: number;
  forward?: number;
  include?: number | null;
}): number[] {
  const current = new Date().getFullYear();
  const back = opts?.back ?? 3;
  const forward = opts?.forward ?? 3;
  const set = new Set<number>();
  for (let y = current - back; y <= current + forward; y += 1) set.add(y);
  if (opts?.include != null && Number.isFinite(opts.include)) {
    set.add(opts.include);
  }
  return Array.from(set).sort((a, b) => a - b);
}
