/**
 * FVM (Finansų valdymo modelio) bendri tipai — naudoja API ir Web.
 *
 * Iter 9 (FVM-1) sukurta nauja 2 lygio biudžeto hierarchija:
 *   1 lygis: `FundingSource` — finansavimo šaltinis ("Iš kur pinigai?")
 *   2 lygis: `BudgetAllocation` — biudžeto paskirstymas ("Kam skiriama?")
 *
 * Detali architektūra — `docs/fvm/01-architecture.md`.
 *
 * Konvencijos:
 *  - camelCase laukai (snake_case lieka DB-internal)
 *  - Datos kaip ISO 8601 stringai
 *  - Pinigų sumos kaip `string` (decimal preservation; aritmetiką per cents)
 *  - ID'ai kaip `number` (PostgreSQL SERIAL per ADR-004)
 */

// ---------- Finansavimo šaltinis (1 lygis) ----------

/**
 * Finansavimo šaltinis — 1 FVM lygio entitetas. Atsako į klausimą
 * „Iš kur pinigai?" (pvz., Valstybės biudžetas 2026, ES fondas, ...).
 *
 * `tipas` — FK į classifier_items grupėje `funding_source_type`
 * (default seed: biudzetas / es / kita). Per ADR-001 nukrypimas nuo
 * docx'o enum'o — naudojam klasifikatorių, kad būtų plečiamas.
 *
 * Unique constraint: (tenant_id, kodas, metai) — tą patį šaltinį galima
 * turėti per kelis metus (kiekvienais metais — atskiras įrašas).
 */
export type FundingSource = {
  id: number;
  tenantId: number;
  pavadinimas: string;
  kodas: string;
  /** FK į classifier_items (group_code = 'funding_source_type'). */
  tipasClassifierItemId: number;
  /** Klasifikatoriaus item kodas (denormalizuotas išvedimui). */
  tipasCode?: string;
  /** Klasifikatoriaus item pavadinimas (denormalizuotas išvedimui). */
  tipasName?: string;
  /** Tenant kodas (denormalizuotas išvedimui). */
  tenantCode?: string;
  /** Tenant pavadinimas (denormalizuotas išvedimui). */
  tenantName?: string;
  metai: number;
  /** Metinė bendra suma (planuojama). Decimal string formatas. */
  metineSuma: string;
  aprasymas: string | null;
  aktyvus: boolean;
  /** Visų rišamų `BudgetAllocation` skaičius (užkrautas serveryje, kai prašoma). */
  allocationsCount?: number;
  /** Sumažintas allocations.planuotaSuma per šaltinį (užkrautas serveryje). */
  allocatedAmount?: string;
  createdAt: string;
  updatedAt: string;
};

export type FundingSourceCreateDTO = {
  tenantId: number;
  pavadinimas: string;
  kodas: string;
  tipasClassifierItemId: number;
  metai: number;
  metineSuma: string;
  aprasymas?: string | null;
  aktyvus?: boolean;
};

export type FundingSourceUpdateDTO = {
  pavadinimas?: string;
  kodas?: string;
  tipasClassifierItemId?: number;
  metai?: number;
  metineSuma?: string;
  aprasymas?: string | null;
  aktyvus?: boolean;
};

export type FundingSourceListQuery = {
  /** Filtras pagal metus. */
  year?: number;
  /** Filtras pagal tenant'ą (organizaciją). */
  tenantId?: number;
  /** Filtras pagal tipo classifier item ID. */
  typeItemId?: number;
};

// ---------- Biudžeto paskirstymas (2 lygis) ----------

/**
 * Spec.programos posistemis. Naudojama tik kai allocation kategorija = `spec_programa`.
 * Kitais atvejais — `null`.
 *
 * - `atskiras` — atskira spec.programa (auto-create projekto įrašas Iter 11)
 * - `biudzeto_dalis` — yra dalis bendro biudžeto, atskirai netiriamas
 */
export type SpecProgTipas = 'atskiras' | 'biudzeto_dalis';

/**
 * Biudžeto paskirstymas — 2 FVM lygio entitetas. Atsako į klausimą
 * „Kam skiriama?" (pvz., DU 500k, Spec.programa A 200k, ...).
 *
 * `categoryClassifierItemId` — FK į classifier_items grupėje `budget_category`
 * (default seed: du / spec_programa / prekes_paslaugos / investicijos / kita).
 * Per ADR-001 nukrypimas nuo docx'o enum'o.
 *
 * Lentelė laikinai vadinasi `budget_allocations_v2` (DB level) — Iter 16
 * bus pervadinta į `budget_allocations` po staging UAT.
 */
export type BudgetAllocation = {
  id: number;
  fundingSourceId: number;
  /** FK į classifier_items (group_code = 'budget_category'). */
  categoryClassifierItemId: number;
  /** Klasifikatoriaus item kodas (denormalizuotas). */
  categoryCode?: string;
  /** Klasifikatoriaus item pavadinimas (denormalizuotas). */
  categoryName?: string;
  pavadinimas: string;
  /** Tik kai `categoryCode === 'spec_programa'`. Kitais atvejais NULL. */
  specProgTipas: SpecProgTipas | null;
  /** Planuojama suma šiam paskirstymui. Decimal string formatas. */
  planuotaSuma: string;
  metai: number;
  pastabos: string | null;
  /** Finansavimo šaltinio kodas (denormalizuotas). */
  fundingSourceCode?: string;
  /** Finansavimo šaltinio pavadinimas (denormalizuotas). */
  fundingSourceName?: string;
  createdAt: string;
  updatedAt: string;
};

export type BudgetAllocationCreateDTO = {
  fundingSourceId: number;
  categoryClassifierItemId: number;
  pavadinimas: string;
  specProgTipas?: SpecProgTipas | null;
  planuotaSuma: string;
  metai: number;
  pastabos?: string | null;
};

export type BudgetAllocationUpdateDTO = {
  categoryClassifierItemId?: number;
  pavadinimas?: string;
  specProgTipas?: SpecProgTipas | null;
  planuotaSuma?: string;
  metai?: number;
  pastabos?: string | null;
};

export type BudgetAllocationListQuery = {
  fundingSourceId?: number;
  year?: number;
  categoryItemId?: number;
};

/**
 * Allocation suvestinė: planuota / faktinė / likutis.
 *
 * - `planuota` = `BudgetAllocation.planuotaSuma`
 * - `faktine` = SUM(expenses kur expense.budget_allocation_id = allocation.id).
 *   Kol expenses lentelė nesukurta (Iter 12), grąžinama '0.00'.
 * - `likutis` = `planuota - faktine`.
 */
export type BudgetAllocationSummary = {
  planuota: string;
  faktine: string;
  likutis: string;
};
