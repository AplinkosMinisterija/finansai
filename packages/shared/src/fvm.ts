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
 * Allocation suvestinė: planuota / faktinė / likutis + warning flag'ai.
 *
 * - `planuota` = `BudgetAllocation.planuotaSuma`
 * - `faktine` = SUM(expenses kur expense.budget_allocation_id = allocation.id).
 *   Tiek single-source (saltinio_dalis=null), tiek multi-source išlaidos
 *   visada įskaitomos pagal `expenses.budget_allocation_id` (multi-source split
 *   nekeičia allocation pasirinkimo — tik finansavimo šaltinio paskirstymą).
 * - `likutis` = `planuota - faktine`.
 * - `percentUsed` — faktine / planuota × 100, suapvalinta iki 2 skaičių.
 * - `isWarning` — true, kai percentUsed >= WARNING_THRESHOLD_PERCENT (default 80).
 * - `isOver` — true, kai percentUsed > 100.
 */
export type BudgetAllocationSummary = {
  planuota: string;
  faktine: string;
  likutis: string;
  percentUsed: number;
  isWarning: boolean;
  isOver: boolean;
};

// ---------- Projects (3 lygis, Iter 11) ----------

/**
 * Projekto tipas (3 FVM lygio entiteto potipis):
 *  - `projektas` — paprastas projektas (pvz. „IT modernizavimas")
 *  - `spec_programa` — specialiosios programos projektas; turi request_id
 *  - `veikla` — skyriaus veikla (pvz. „Mokymai 2026")
 *
 * Visi trys naudoja tą pačią `projects` lentelę. Skiriasi tik
 * verslo logika (pvz., spec_programa auto-create iš patvirtinto prašymo).
 */
export type ProjectType = 'projektas' | 'spec_programa' | 'veikla';

/**
 * Projekto gyvavimo ciklas:
 *  - `planuojama` — biudžetas užfiksuotas, vykdymas dar neprasidėjęs
 *  - `vykdoma` — projektas vykdomas, kaupiamos išlaidos
 *  - `baigta` — visas darbas atliktas; gali likti uždarymo procedūros
 *  - `uzdaryta` — galutinai uždaryta; nebepasiekiama jokia atnaujinama
 *    operacija (read-only)
 *
 * Forward tranzicijas leidžia tiek AM admin, tiek org admin. Reverse
 * tranzicijos (pvz. „uzdaryta → baigta") tik AM admin.
 */
export type ProjectStatus =
  | 'planuojama'
  | 'vykdoma'
  | 'baigta'
  | 'uzdaryta';

/**
 * Projektas — 3 FVM lygio entitetas. Atsako į klausimą „Kas konkrečiai
 * išleidžia?". Susietas su biudžeto eilute (`budgetAllocationId`) ir,
 * jei tipas = `spec_programa`, su patvirtintu prašymu (`requestId`).
 */
export type Project = {
  id: number;
  tenantId: number;
  /** Tenant kodas (denormalizuotas išvedimui). */
  tenantCode?: string;
  /** Tenant pavadinimas (denormalizuotas išvedimui). */
  tenantName?: string;
  budgetAllocationId: number;
  /** Allocation pavadinimas (denormalizuotas). */
  budgetAllocationName?: string;
  /** NULL kai tipas != 'spec_programa'. */
  requestId: number | null;
  /** Susieto prašymo pavadinimas (denormalizuotas). */
  requestProjectName?: string | null;
  pavadinimas: string;
  tipas: ProjectType;
  /** Planuojamas projektui skirtas biudžetas. Decimal string formatas. */
  biudzetas: string;
  pradziosData: string | null;
  pabaigosData: string | null;
  statusas: ProjectStatus;
  atsakingasUserId: number | null;
  /** Atsakingo asmens pilnas vardas (denormalizuotas). */
  atsakingasUserName?: string | null;
  aprasymas: string | null;
  createdAt: string;
  updatedAt: string;
};

export type ProjectCreateDTO = {
  tenantId: number;
  budgetAllocationId: number;
  requestId?: number | null;
  pavadinimas: string;
  tipas: ProjectType;
  biudzetas: string;
  pradziosData?: string | null;
  pabaigosData?: string | null;
  statusas?: ProjectStatus;
  atsakingasUserId?: number | null;
  aprasymas?: string | null;
};

export type ProjectUpdateDTO = {
  budgetAllocationId?: number;
  pavadinimas?: string;
  biudzetas?: string;
  pradziosData?: string | null;
  pabaigosData?: string | null;
  atsakingasUserId?: number | null;
  aprasymas?: string | null;
};

export type ProjectChangeStatusDTO = {
  statusas: ProjectStatus;
};

export type ProjectListQuery = {
  tenantId?: number;
  status?: ProjectStatus;
  type?: ProjectType;
  allocationId?: number;
  requestId?: number;
  year?: number;
};

/**
 * Projekto suvestinė: biudžetas / panaudota / likutis + warning flag'ai.
 *
 * - `biudzetas` — `Project.biudzetas`
 * - `panaudota` — SUM(expenses kur expense.project_id = project.id).
 * - `likutis` = `biudzetas - panaudota`.
 * - `percentUsed` — panaudota / biudzetas × 100, suapvalinta iki 2 skaičių.
 * - `isWarning` — true, kai percentUsed >= WARNING_THRESHOLD_PERCENT (default 80).
 * - `isOver` — true, kai percentUsed > 100.
 */
export type ProjectSummary = {
  biudzetas: string;
  panaudota: string;
  likutis: string;
  percentUsed: number;
  isWarning: boolean;
  isOver: boolean;
};

// ---------- Expenses (Iter 12) ----------

/**
 * Išlaidos tipas (FVM-4):
 *  - `du` — darbo užmokestis (per payroll_distributions / Iter 13 modulius)
 *  - `sutartis` — pagal sutartį (paslaugos, autorinė)
 *  - `saskaita` — sąskaita-faktūra prekei ar paslaugai
 *  - `tiesiogine` — tiesioginės išlaidos (komandiruotės, smulkios pirkimai)
 *
 * Apribota PostgreSQL CHECK constraint'u — žr.
 * `20260525100000_create_expenses.ts`.
 */
export type ExpenseType = 'du' | 'sutartis' | 'saskaita' | 'tiesiogine';

/**
 * Multi-source split eilutė. `saltinio_dalis` jsonb — array iš tokių objektų.
 * SUM(`suma`) per visus elementus turi atitikti `Expense.suma` (epsilon
 * comparison serveryje per centus).
 */
export type ExpenseSourceDistributionItem = {
  fundingSourceId: number;
  /** Decimal string formatas. */
  suma: string;
};

/**
 * Išlaida — 3 FVM lygio entiteto (`Project`) faktinė išlaida. Padidina
 * biudžeto naudojimą, sumažina likutį.
 *
 * `saltinioDalis = null` — paveldima per `budget_allocation.funding_source_id`
 * (single-source default). Multi-source atveju jsonb laikomas tarp finansavimo
 * šaltinių (žr. ADR-002).
 */
export type Expense = {
  id: number;
  projectId: number;
  /** Projekto pavadinimas (denormalizuotas išvedimui). */
  projectName?: string;
  budgetAllocationId: number;
  /** Biudžeto eilutės pavadinimas (denormalizuotas). */
  budgetAllocationName?: string;
  /** Tenant ID iš projekto (denormalizuotas — naudingas list filtravimui). */
  tenantId?: number;
  tipas: ExpenseType;
  /** Decimal(15,2) — string formatas. */
  suma: string;
  /** ISO 8601 data (YYYY-MM-DD). */
  data: string;
  aprasymas: string | null;
  /** NULL kai single-source; multi-source split kai array. */
  saltinioDalis: ExpenseSourceDistributionItem[] | null;
  createdByUserId: number;
  /** Sukūrusio vartotojo vardas (denormalizuotas). */
  createdByName?: string;
  createdAt: string;
  updatedAt: string;
};

export type ExpenseCreateDTO = {
  projectId: number;
  budgetAllocationId: number;
  tipas: ExpenseType;
  suma: string;
  data: string;
  aprasymas?: string | null;
  saltinioDalis?: ExpenseSourceDistributionItem[] | null;
};

export type ExpenseUpdateDTO = {
  budgetAllocationId?: number;
  tipas?: ExpenseType;
  suma?: string;
  data?: string;
  aprasymas?: string | null;
  saltinioDalis?: ExpenseSourceDistributionItem[] | null;
};

export type ExpenseListQuery = {
  projectId?: number;
  allocationId?: number;
  /** Metai (overlapping su `data` lauku). */
  year?: number;
  type?: ExpenseType;
  /** YYYY-MM-DD. */
  dateFrom?: string;
  dateTo?: string;
  /** Filtruoja per `saltinio_dalis` jsonb @> containment'ą. */
  fundingSourceId?: number;
};

/**
 * Biudžeto suvestinės eilutė įspėjimų sąraše. Atspindi vienos
 * `BudgetAllocationV2` situaciją per nurodytą metus.
 */
export type BudgetWarningItem = {
  allocationId: number;
  allocationName: string;
  /** Finansavimo šaltinio pavadinimas (denormalizuotas) — UI rodymui. */
  fundingSourceName: string;
  planuota: string;
  faktine: string;
  likutis: string;
  percentUsed: number;
  isWarning: boolean;
  isOver: boolean;
};

/**
 * `expenses.budgetSummary` endpoint'o atsakymas. Grąžina visus tų metų
 * allocations (tenant-scoped) su pilnu likučio + warning'o vaizdu.
 */
export type BudgetWarningsResponse = {
  year: number;
  items: BudgetWarningItem[];
};
