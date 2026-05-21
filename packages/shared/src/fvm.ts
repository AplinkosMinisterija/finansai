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
  /**
   * DU sistemos projektas (Iter 13.x saugumo patch'as). `true` — auto-sukurtas
   * per `payroll.computeMonth` ir laiko DU expense'us. Matomas tik
   * vartotojams su DU prieiga (AM admin + org admin); kitiems backend'as ir
   * frontend'as paslepia (žr. `canViewPayroll`).
   */
  isDuSystem: boolean;
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

// ---------- Payroll (Iter 13, FVM-5) ----------

/**
 * Darbuotojo sutarties tipas (docx §6.5).
 *
 *  - `darbo` — darbo sutartis
 *  - `paslaugu` — paslaugų sutartis (su trečiąja šalimi, kuri gali neturėti
 *    sistemos paskyros — tada `userId` NULL, `vardasPavarde` užpildomas rankomis)
 *  - `autorine` — autorinė sutartis
 *
 * Apribota PostgreSQL CHECK constraint'u — žr.
 * `20260526100000_create_payroll.ts`.
 */
export type ContractType = 'darbo' | 'paslaugu' | 'autorine';

/**
 * DU paskirstymo tipas (docx §6.6).
 *
 *  - `procentais` — `reiksme` yra procentai (0-100). SUM(procentais.reiksme)
 *    per profile per overlap'inantį periodą ≤ 100.
 *  - `fiksuota` — `reiksme` yra fiksuota suma eurais.
 *
 * Apribota PostgreSQL CHECK constraint'u — žr.
 * `20260526100000_create_payroll.ts`.
 */
export type DistributionType = 'procentais' | 'fiksuota';

/**
 * Darbuotojo finansinis profilis — Iter 13 entitetas (docx §4.4, §6.5).
 *
 * SAUGUMO REIKALAVIMAS (docx §4.4): DU duomenis mato tik:
 *  - AM administratorius (visi tenant'ai)
 *  - Org admin (tik savo tenant'as)
 *  - Specialistas (org_user) — NEMATO net savo
 *
 * Per ADR-003: tik bruto + priedai, BE Sodra/GPM apskaitos.
 */
export type PayrollProfile = {
  id: number;
  tenantId: number;
  /** Tenant kodas (denormalizuotas išvedimui). */
  tenantCode?: string;
  /** Tenant pavadinimas (denormalizuotas išvedimui). */
  tenantName?: string;
  /** NULL leidžiamas — darbuotojas gali neturėti sistemos paskyros. */
  userId: number | null;
  /** Vartotojo pilnas vardas (denormalizuotas, jei userId ne NULL). */
  userFullName?: string | null;
  /** Redundant copy — istorinis snapshot, stabilus net jei user pakeistas. */
  vardasPavarde: string;
  pareigos: string;
  sutartiesTipas: ContractType;
  /** Bruto atlyginimas. Decimal(10, 2) — string formatas. */
  atlyginimasBruto: string;
  /** Priedai. Decimal(10, 2) — string formatas. Default '0'. */
  priedai: string;
  /** ISO 8601 data (YYYY-MM-DD). */
  galiojaNuo: string;
  /** ISO 8601 data (YYYY-MM-DD) arba NULL (jei vis dar galioja). */
  galiojaIki: string | null;
  createdAt: string;
  updatedAt: string;
};

export type PayrollProfileCreateDTO = {
  tenantId: number;
  userId?: number | null;
  vardasPavarde: string;
  pareigos: string;
  sutartiesTipas: ContractType;
  atlyginimasBruto: string;
  priedai?: string;
  galiojaNuo: string;
  galiojaIki?: string | null;
};

export type PayrollProfileUpdateDTO = {
  userId?: number | null;
  vardasPavarde?: string;
  pareigos?: string;
  sutartiesTipas?: ContractType;
  atlyginimasBruto?: string;
  priedai?: string;
  galiojaNuo?: string;
  galiojaIki?: string | null;
};

export type PayrollProfileListQuery = {
  tenantId?: number;
  userId?: number;
  /**
   * Jei true — filtruoja tik profilius, aktyvius šios dienos datai
   * (`galioja_nuo <= today AND (galioja_iki IS NULL OR galioja_iki >= today)`).
   */
  active?: boolean;
};

/**
 * DU paskirstymas — Iter 13 entitetas (docx §4.4, §6.6).
 */
export type PayrollDistribution = {
  id: number;
  payrollProfileId: number;
  fundingSourceId: number;
  /** Finansavimo šaltinio pavadinimas (denormalizuotas). */
  fundingSourceName?: string;
  /** Finansavimo šaltinio kodas (denormalizuotas). */
  fundingSourceCode?: string;
  paskirstymoTipas: DistributionType;
  /** Decimal(10, 4) — procentai (0-100) arba fiksuota suma eurais. */
  reiksme: string;
  galiojaNuo: string;
  galiojaIki: string | null;
  createdAt: string;
  updatedAt: string;
};

export type PayrollDistributionCreateDTO = {
  payrollProfileId: number;
  fundingSourceId: number;
  paskirstymoTipas: DistributionType;
  reiksme: string;
  galiojaNuo: string;
  galiojaIki?: string | null;
};

export type PayrollDistributionUpdateDTO = {
  fundingSourceId?: number;
  paskirstymoTipas?: DistributionType;
  reiksme?: string;
  galiojaNuo?: string;
  galiojaIki?: string | null;
};

export type PayrollDistributionListQuery = {
  profileId?: number;
  sourceId?: number;
};

/**
 * `payroll.computeMonth` endpoint'o atsakymas.
 *
 * Apskaičiavimas idempotentiškas: pakartotinis to paties mėnesio kvietimas
 * ištrina ankstesnius DU expense'us prieš sukuriant naujus.
 */
export type ComputeMonthResponse = {
  status: 'computed';
  /** YYYY-MM formatu. */
  month: string;
  /** Kiek profile'ų buvo aktyvūs mėnesyje. */
  profilesProcessed: number;
  /** Kiek `expenses` įrašų sukurta. */
  expensesCreated: number;
  /** Suvestinė bendra suma. Decimal string formatas. */
  totalAmount: string;
};

// ---------- FVM Dashboard (Iter 15, F15) ----------

/**
 * Artėjantis terminas — projekto pabaigos arba allocation metų pabaigos data.
 * Naudojama `dashboard.fvmSummary.upcomingDeadlines` sąraše.
 *
 * - `type='project_end'` — projekto `pabaigosData` (planuojama arba vykdoma)
 * - `type='allocation_year_end'` — kalendoriniai metų-pabaigos termini'ai
 *   (rezervuota plėtimui; iteracijoje 15 grąžinami tik projektų terminai)
 *
 * `daysUntil` skaičiuojamas nuo `now()` iki nurodytos datos (whole days,
 * floor). Neigiamos reikšmės reiškia, kad terminas jau praleistas, bet
 * default'inė query grąžina TIK ateities terminus (0–30 d).
 */
export type UpcomingDeadline = {
  type: 'project_end' | 'allocation_year_end';
  /** Entity ID (projekto ID arba allocation ID). */
  id: number;
  name: string;
  /** ISO 8601 data (YYYY-MM-DD). */
  date: string;
  /** Dienų skaičius nuo dabar iki datos (whole days). */
  daysUntil: number;
};

/**
 * FVM dashboard suvestinė nurodytiems metams. Apima:
 *  - bendrus biudžeto totals (planuota / faktinė / likutis / percentUsed)
 *  - top 5 warning'us (vykdomi allocations su isWarning arba isOver)
 *  - artėjančius terminus (30 d horizontas)
 *  - projektų skaičius (aktyvūs + baigti)
 *  - šaltinių ir paskirstymų skaičius
 *
 * Tenant scope per ADR-005 (canViewPayroll filter):
 *  - AM admin: visi tenant'ai
 *  - AM user su scope: scope tenant'ai
 *  - Org admin / user: tik savo tenant
 *  - !canViewPayroll: DU expense'ai / allocations excluded iš totals
 *    (defense-in-depth)
 */
export type FvmSummaryResponse = {
  year: number;
  /** Užklausos generavimo laikas (ISO 8601). */
  generatedAt: string;
  budgetTotals: {
    planuota: string;
    faktine: string;
    likutis: string;
    percentUsed: number;
    isWarning: boolean;
    isOver: boolean;
  };
  /**
   * Top 5 warning'ai — allocations su `isWarning` arba `isOver`, surūšiuoti
   * pagal `percentUsed` desc. Naudoja tą patį tipą kaip
   * `expenses.budgetSummary`.
   */
  topWarnings: BudgetWarningItem[];
  /**
   * Projektai, kurių `pabaigosData` patenka į [now, now+30d] intervalą.
   * Status'as NE 'baigta' ir NE 'uzdaryta' — tik vykdomi arba planuojami.
   */
  upcomingDeadlines: UpcomingDeadline[];
  /** Projektai su status'ais 'planuojama' arba 'vykdoma'. */
  activeProjectsCount: number;
  /** Projektai su status'ais 'baigta' arba 'uzdaryta'. */
  completedProjectsCount: number;
  /** Visi tenant scope funding_sources nurodytais metais. */
  totalSourcesCount: number;
  /** Visi tenant scope budget_allocations nurodytais metais. */
  totalAllocationsCount: number;
};

/**
 * Biudžeto kopijavimo iš praėjusių metų atsakymas (Iter 15, F16).
 *
 * `fundingSources.copyFromYear` endpoint'as kopijuoja visus tenant'o funding
 * sources + budget_allocations iš `sourceYear` į `targetYear`. Visa transakcijoje.
 */
export type CopyBudgetResponse = {
  /** Kiek funding_sources sukurta target year'e. */
  copiedSources: number;
  /** Kiek budget_allocations sukurta target year'e. */
  copiedAllocations: number;
  /** Tikslo metai (echo iš request'o). */
  targetYear: number;
};
