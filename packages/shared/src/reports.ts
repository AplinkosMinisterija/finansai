/**
 * Reports modulis (Iter 14, FVM-6) — bendri tipai trim ataskaitom.
 *
 * 3 ataskaitos pagal docx §4.5 + F12-F14:
 *  - F12 Biudžeto vykdymas (`BudgetExecutionReport`) — planuota / faktinė / likutis
 *  - F13 Spec. programų ataskaita (`SpecProgramReport`) — prašyta / patvirtinta / panaudota
 *  - F14 DU paskirstymas (`PayrollDistributionReport`) — kas iš kurio šaltinio per laikotarpį
 *
 * Visos ataskaitos palaiko 3 eksporto formatus per `ReportFormat`:
 *  - `json` (default) — struktūrintas JSON atsakymas (čia esantys tipai)
 *  - `xlsx` — Excel binary (Buffer) per `exceljs` (žr. utils/reports/xlsx.ts)
 *  - `pdf` — PDF binary (Buffer) per `pdfkit` (žr. utils/reports/pdf.ts)
 *
 * SAUGUMO REIKALAVIMAS (ADR-005 + docx §4.4):
 *  - `BudgetExecutionReport`: jei vartotojas neturi `canViewPayroll` teisės —
 *    DU expense'ai NEįskaitomi į `faktine` sumas, DU kategorijos `byCategory`
 *    eilutės pašalintos. Tai vyksta servise per filter'ius (ne čia).
 *  - `PayrollDistributionReport`: TIK `canViewPayroll(me)` — kitiems 403.
 *    Specialistas (org user) niekada negali šios ataskaitos generuoti net
 *    JSON formatu.
 *
 * Detali architektūra — `docs/fvm/iter-14-reports.md` Backend brief.
 *
 * Konvencijos:
 *  - Datos kaip ISO 8601 stringai (YYYY-MM-DD); timestamp'ai — pilnas ISO.
 *  - Sumos kaip decimal string'ai (precision preserved). Aritmetika serveryje
 *    per integer centus, žr. `apps/api/src/utils/money.ts`.
 *  - ID'ai kaip `number` (per ADR-004 — PostgreSQL SERIAL).
 */

/**
 * Galimi report eksporto formatai. Default — `json` (struktūrintas atsakymas).
 *
 * Kai pasirinkta `xlsx` ar `pdf` — endpoint'as grąžina binary Buffer
 * per Moleculer.web `$responseType` mechaniką (žr. reports.service.ts).
 */
export type ReportFormat = 'json' | 'xlsx' | 'pdf';

// ---------- F12 Biudžeto vykdymo ataskaita ----------

/**
 * Vienos kategorijos eilutė per finansavimo šaltinį
 * (`bySource[N].byCategory[M]`).
 *
 * Atspindi vienos `BudgetAllocationV2` situaciją: planuota suma, faktinė
 * (SUM expense'ų per šitą allocation), likutis ir procentinis naudojimas.
 *
 * `isWarning` / `isOver` flag'ai analogiški `BudgetWarningItem`'ui — naudoja
 * tą patį `WARNING_THRESHOLD_PERCENT` (default 80%).
 */
export type BudgetExecutionCategoryRow = {
  /** budget_allocations_v2.id. */
  categoryItemId: number;
  /** Klasifikatoriaus kodas, pvz. „du", „spec_programa", „prekes_paslaugos". */
  categoryCode: string;
  /** Klasifikatoriaus pavadinimas (UI rodymui). */
  categoryName: string;
  /** budget_allocations_v2.pavadinimas (allocation eilutės pavadinimas). */
  allocationName: string;
  planuota: string;
  faktine: string;
  likutis: string;
  percentUsed: number;
  isWarning: boolean;
  isOver: boolean;
};

/**
 * Vienos finansavimo šaltinio (`funding_source`) sekcija ataskaitoje.
 *
 * Grupuoja kategorijų eilutes per šaltinį + suma summarinį šaltinio lygmenį.
 */
export type BudgetExecutionSourceSection = {
  fundingSourceId: number;
  fundingSourceName: string;
  /** Klasifikatoriaus kodas iš `funding_source_type` grupės. */
  fundingSourceTypeCode: string;
  /** Klasifikatoriaus pavadinimas iš `funding_source_type` grupės. */
  fundingSourceTypeName: string;
  planuota: string;
  faktine: string;
  likutis: string;
  percentUsed: number;
  byCategory: BudgetExecutionCategoryRow[];
};

/**
 * F12 — Biudžeto vykdymo ataskaita (planas vs faktinis vs likutis).
 *
 * Apima visų tų metų `funding_sources` + jiems priklausančias
 * `budget_allocations_v2` su agreguotomis `expenses.suma` sumomis.
 *
 * SAUGUMAS: vartotojams be `canViewPayroll` teisės — DU kategorijos
 * eilutės pašalintos (`byCategory` filter'iuotas), DU expense'ai
 * neįskaitomi į `faktine` sumas (`whereNot('tipas', 'du')`).
 */
export type BudgetExecutionReport = {
  year: number;
  /** ISO 8601 timestamp — kada ataskaita sugeneruota. */
  generatedAt: string;
  /** Filter'is tenant'ui (tik AM admin gali pasirinkti). */
  tenantId: number | null;
  /** Tenant pavadinimas (denormalizuotas). NULL kai bendra (AM admin). */
  tenantName: string | null;
  totalPlanuota: string;
  totalFaktine: string;
  totalLikutis: string;
  bySource: BudgetExecutionSourceSection[];
};

export type BudgetExecutionReportQuery = {
  year: number;
  /** Tik AM admin — pasirinkti konkrečią tenant'ą. Org admin/user — ignoruojama. */
  tenantId?: number;
  format?: ReportFormat;
};

// ---------- F13 Spec. programų ataskaita ----------

/**
 * Vienos spec.programos eilutė ataskaitoje.
 *
 * `prasyta` — visi `cost_*` laukai iš `requests` lentelės susumuoti.
 * `patvirtinta` — `requests.decision_granted_amount` per APPROVED status.
 * `panaudota` — SUM(`expenses.suma`) per susietą `projects` įrašą (per
 *   `requests.fvm_project_id` FK). Jei projektas dar nesukurtas — 0.
 */
export type SpecProgramItem = {
  requestId: number;
  /** `requests.project_name` — prašymo „programos" pavadinimas. */
  requestProjectName: string;
  tenantId: number;
  /** Denormalizuotas tenant kodas (UI rodymui). */
  tenantCode: string;
  /** Denormalizuotas tenant pavadinimas (UI rodymui). */
  tenantName: string;
  /** Klasifikatoriaus kodas iš `budget_category` (visada „spec_programa"). */
  budgetCategoryCode: string;
  /** Specifinis spec.programos finansavimo tipas, jei nustatytas. */
  specProgramFundingType: 'atskiras' | 'biudzeto_dalis' | null;
  prasyta: string;
  patvirtinta: string;
  panaudota: string;
  likutis: string;
  percentUsed: number;
  /** Susieto projekto ID (NULL kol nesukurtas per `createFvmProject`). */
  projektoId: number | null;
  /** Projekto statusas (NULL kol nesukurtas). */
  projektoStatusas: 'planuojama' | 'vykdoma' | 'baigta' | 'uzdaryta' | null;
};

/**
 * F13 — Spec. programų ataskaita (prašyta → patvirtinta → panaudota).
 *
 * Įtraukiami TIK APPROVED status'o prašymai su `budget_category` =
 * `spec_programa`. Kiti — neaktualūs šitam pjūviui.
 *
 * SAUGUMAS: nereikalaujama `canViewPayroll` — spec.programos nėra DU.
 * Tenant scope analogiškas `requests.list` (per `canViewRequest`).
 */
export type SpecProgramReport = {
  year: number;
  generatedAt: string;
  tenantId: number | null;
  tenantName: string | null;
  totalPrasyta: string;
  totalPatvirtinta: string;
  totalPanaudota: string;
  items: SpecProgramItem[];
};

export type SpecProgramReportQuery = {
  year: number;
  tenantId?: number;
  format?: ReportFormat;
};

// ---------- F14 DU paskirstymas ----------

/**
 * Vienos finansavimo šaltinio eilutė per darbuotojo profilį.
 *
 * Sumuojama per visus DU expense'us, kuriuose `payroll_profile_id` rodo
 * į šitą profilį ir `saltinio_dalis` jsonb turi įrašą su `funding_source_id`
 * arba single-source per `budget_allocation.funding_source_id`.
 */
export type PayrollDistributionSourceRow = {
  fundingSourceId: number;
  fundingSourceName: string;
  fundingSourceCode: string;
  sumaPerLaikotarpi: string;
};

/**
 * Vieno darbuotojo (profilio) sekcija — visi jo DU expense'ai
 * laikotarpyje sugrupuoti per finansavimo šaltinį.
 */
export type PayrollDistributionProfileSection = {
  profileId: number;
  vardasPavarde: string;
  pareigos: string;
  tenantId: number;
  tenantCode: string;
  tenantName: string;
  /** Bendra šio darbuotojo DU suma laikotarpyje (visi šaltiniai sumuoti). */
  totalPerLaikotarpi: string;
  /** Eilutės per finansavimo šaltinį (sortuotos pagal `fundingSourceName`). */
  bySource: PayrollDistributionSourceRow[];
};

/**
 * Bendra eilutė per finansavimo šaltinį (visi darbuotojai kartu) —
 * naudojama ataskaitos pabaigoje kaip „Iš viso pagal šaltinį" sekcija.
 */
export type PayrollDistributionSourceTotal = {
  fundingSourceId: number;
  fundingSourceName: string;
  fundingSourceCode: string;
  total: string;
};

/**
 * F14 — DU paskirstymo ataskaita (kas kiek iš kurio šaltinio per laikotarpį).
 *
 * SAUGUMO PRIORITETINĖ ataskaita per docx §4.4 + ADR-005:
 *  - Specialistas (org user) — NIEKADA negali šios ataskaitos generuoti
 *    (net JSON formatu)
 *  - Org admin — TIK savo tenant'as
 *  - AM admin — visi tenant'ai (gali filter'inti per `tenantId` param)
 *
 * Per `requireDuAccess(meta, tenantId)` PIRMASIS guard'as servise.
 *
 * Agregacija per `expenses` lentelę kur `tipas='du'` ir `data` per laikotarpį.
 * Per kiekvieną expense:
 *  - Jei `saltinio_dalis` (jsonb) — sumuojam per kiekvieną elementą
 *  - Jei NULL — single-source per `budget_allocation.funding_source_id`
 *  - Susiejimas su profile per `payroll_profile_id` FK (Iter 14 migracija)
 */
export type PayrollDistributionReport = {
  /** ISO 8601 data (YYYY-MM-DD) — laikotarpio pradžia (inclusive). */
  from: string;
  /** ISO 8601 data (YYYY-MM-DD) — laikotarpio pabaiga (inclusive). */
  to: string;
  generatedAt: string;
  tenantId: number | null;
  tenantName: string | null;
  /** Bendra suma per visus darbuotojus per laikotarpį (visi šaltiniai). */
  grandTotal: string;
  /** Per darbuotojo profilį sumuotos eilutės. */
  byProfile: PayrollDistributionProfileSection[];
  /** Per finansavimo šaltinį sumuotos eilutės (visi darbuotojai kartu). */
  totalsBySource: PayrollDistributionSourceTotal[];
};

export type PayrollDistributionReportQuery = {
  from: string;
  to: string;
  tenantId?: number;
  format?: ReportFormat;
};
