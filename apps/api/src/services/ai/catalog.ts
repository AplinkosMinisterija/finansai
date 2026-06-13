/**
 * AI dashboard'o DUOMENŲ ŠALTINIŲ KATALOGAS + hidracija (Iter 18).
 *
 * Problema (Iter 17): AI nupieštas vaizdas įrašydavo literalius skaičius į spec'ą
 * → po savaitės jie likdavo „užšalę", neatsinaujindavo iš DB.
 *
 * Sprendimas: widget'ai nurodo serverio duomenų ŠALTINĮ per `dataRef`
 * (`{source, params}`). Serveris kiekvieno užkrovimo metu HIDRUOJA — paleidžia
 * šaltinio `run()` ir užpildo widget'o data laukus ŠVIEŽIAIS DB duomenimis.
 * Layout'as iš AI, duomenys visada iš DB, be LLM latencijos.
 *
 * SAUGUMAS (ADR-005): kiekvienas šaltinis duomenis ima TIK per esamus Moleculer
 * action'us (`dashboard.*`, `reports.*`, `expenses.*`, `projects.*`) su vartotojo
 * `meta` — tenant scope + DU filtrai galioja identiškai. Jokio tiesioginio DB,
 * jokių payroll šaltinių.
 *
 * Tas pats katalogas naudojamas trijose vietose:
 *  - `GET /ai/dashboard` — default layout hidruojamas iškart.
 *  - `POST /ai/hydrate` — išsaugoto (localStorage) spec'o dataRef'ai atnaujinami.
 *  - `ai.chat` — LLM `query_data` tool'as + render'into spec'o hidracija.
 */
import type { Context } from 'moleculer';
import type {
  AiChartSeries,
  AiDashboardSpec,
  AiProgressItem,
  AiSankeyLink,
  AiSankeyNode,
  AiStatTrend,
  AiTableColumn,
  AiTreemapNode,
  AiValueFormat,
  AiWidget,
  AiWidgetType,
  BudgetExecutionReport,
  DashboardData,
  Expense,
  FvmSummaryResponse,
  Project,
} from '@biip-finansai/shared';
import { isXyWidgetType } from '@biip-finansai/shared';
import type { AuthMeta } from '../auth.service';

const TOOL_CALL_TIMEOUT_MS = 30_000;

type Row = Record<string, string | number | null>;

/**
 * KRITINIS: vidiniai action'ai kviečiami per `broker.call` su nauju root
 * kontekstu (ne `ctx.call`), kad nepaveldėtų Moleculer distributed timeout
 * (requestTimeout=10s nuo request pradžios) — ilgame chat cikle `ctx.call` po
 * 10s mirtų su RequestSkippedError. `meta` perduodam eksplicitiškai → ADR-005
 * tenant scope + DU filtrai galioja (servisai skaito ctx.meta.user).
 */
export function callAction<TResult, TParams>(
  ctx: Context<unknown, AuthMeta>,
  action: string,
  params: TParams,
): Promise<TResult> {
  return ctx.broker.call<TResult, TParams>(action, params, {
    meta: { ...ctx.meta },
    timeout: TOOL_CALL_TIMEOUT_MS,
  });
}

// ---------- Hidracijos rezultatas (serverio vidinis) ----------

export type HydrationResult =
  | { kind: 'stat'; value: string; subtitle?: string; trend?: AiStatTrend }
  | { kind: 'series'; data: Row[]; xKey: string; series: AiChartSeries[]; format?: AiValueFormat }
  | { kind: 'categorical'; data: Array<{ name: string; value: number }>; format?: AiValueFormat }
  | { kind: 'table'; columns: AiTableColumn[]; rows: Row[] }
  | { kind: 'progress'; items: AiProgressItem[] }
  | { kind: 'sankey'; nodes: AiSankeyNode[]; links: AiSankeyLink[] }
  | { kind: 'treemap'; treemap: AiTreemapNode[] };

export type HydrationKind = HydrationResult['kind'];

// ---------- Pagalbinės ----------

function toNum(amount: string | number | null | undefined): number {
  const n = typeof amount === 'number' ? amount : Number(amount ?? 0);
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : 0;
}

function fmtEur(amount: string | number): string {
  const n = typeof amount === 'number' ? amount : Number(amount);
  if (!Number.isFinite(n)) return String(amount);
  return `${n.toLocaleString('lt-LT', { maximumFractionDigits: 0 })} €`;
}

function paramInt(params: Record<string, unknown>, key: string): number | undefined {
  const v = params[key];
  const n = typeof v === 'number' ? v : typeof v === 'string' ? Number(v) : NaN;
  return Number.isFinite(n) ? Math.round(n) : undefined;
}

function paramStr(params: Record<string, unknown>, key: string): string | undefined {
  const v = params[key];
  return typeof v === 'string' && v.trim() ? v.trim() : undefined;
}

const PALETTE = [
  '#0f766e',
  '#0369a1',
  '#b45309',
  '#7c3aed',
  '#15803d',
  '#be123c',
  '#475569',
  '#0891b2',
];

const COST_LABELS: Record<string, string> = {
  du: 'Darbo užmokestis',
  equipment: 'Įranga',
  creation: 'Kūrimas',
  analysis: 'Analizė',
  development: 'Vystymas',
  maintenance: 'Palaikymas',
  modernization: 'Modernizavimas',
  decommissioning: 'Nutraukimas',
};

const STATUS_LABELS: Record<string, string> = {
  DRAFT: 'Juodraščiai',
  SUBMITTED: 'Pateikti',
  RETURNED: 'Grąžinti',
  APPROVED: 'Patvirtinti',
  REJECTED: 'Atmesti',
  NEAKTUALU: 'Neaktualūs',
};

// ---------- Pass kontekstas su memo (kad nedubliuotume action call'ų) ----------

/** Vieno hidracijos „pass'o" kontekstas — memoizuoja action rezultatus. */
export type HydrationCtx = {
  ctx: Context<unknown, AuthMeta>;
  year: number;
  cache: Map<string, Promise<unknown>>;
};

function cached<T>(hc: HydrationCtx, key: string, run: () => Promise<T>): Promise<T> {
  const existing = hc.cache.get(key);
  if (existing) return existing as Promise<T>;
  const p = run();
  hc.cache.set(key, p);
  return p;
}

function getDashboard(hc: HydrationCtx): Promise<DashboardData> {
  return cached(hc, 'dashboard.get', () =>
    callAction<DashboardData, Record<string, never>>(hc.ctx, 'dashboard.get', {}),
  );
}

function getFvm(hc: HydrationCtx, year: number): Promise<FvmSummaryResponse | null> {
  return cached(hc, `dashboard.fvmSummary:${year}`, () =>
    callAction<FvmSummaryResponse, { year: number }>(hc.ctx, 'dashboard.fvmSummary', {
      year,
    }).catch(() => null),
  );
}

function getBudgetExecution(hc: HydrationCtx, year: number): Promise<BudgetExecutionReport | null> {
  return cached(hc, `reports.budgetExecution:${year}`, () =>
    callAction<BudgetExecutionReport, { year: number; format: 'json' }>(
      hc.ctx,
      'reports.budgetExecution',
      { year, format: 'json' },
    ).catch(() => null),
  );
}

function getExpenses(hc: HydrationCtx, year: number, projectId?: number): Promise<Expense[]> {
  const key = `expenses.list:${year}:${projectId ?? '-'}`;
  return cached(hc, key, () =>
    callAction<Expense[], { year: number; projectId?: number }>(hc.ctx, 'expenses.list', {
      year,
      ...(projectId !== undefined ? { projectId } : {}),
    }).catch(() => []),
  );
}

// ---------- Katalogo šaltinis ----------

export type CatalogParamDef = {
  name: string;
  type: 'integer' | 'string' | 'enum';
  required?: boolean;
  values?: string[];
  description: string;
};

export type CatalogSource = {
  id: string;
  kind: HydrationKind;
  /** Kurie widget tipai gali naudoti šį šaltinį. */
  widgetTypes: AiWidgetType[];
  /** Trumpas LT aprašymas LLM prompt'ui. */
  description: string;
  params: CatalogParamDef[];
  run(hc: HydrationCtx, params: Record<string, unknown>): Promise<HydrationResult>;
};

const YEAR_PARAM: CatalogParamDef = {
  name: 'year',
  type: 'integer',
  description: 'Metai (default — einamieji)',
};

// ---------- Šaltinių registras ----------

const SOURCES: CatalogSource[] = [
  // --- Atskiri rodikliai (stat) ---
  {
    id: 'metric',
    kind: 'stat',
    widgetTypes: ['stat'],
    description:
      'Vienas skaitinis rodiklis kortelei. params.metric: biudzetas_planuota | islaidos_faktine | biudzeto_likutis | panaudota_procentai | prasymu_skaicius | prasyta_suma | patvirtinta_suma | aktyvus_projektai | pateikti_laukia.',
    params: [
      {
        name: 'metric',
        type: 'enum',
        required: true,
        values: [
          'biudzetas_planuota',
          'islaidos_faktine',
          'biudzeto_likutis',
          'panaudota_procentai',
          'prasymu_skaicius',
          'prasyta_suma',
          'patvirtinta_suma',
          'aktyvus_projektai',
          'pateikti_laukia',
        ],
        description: 'Kurį rodiklį rodyti',
      },
      YEAR_PARAM,
    ],
    async run(hc, params) {
      const metric = paramStr(params, 'metric') ?? 'biudzetas_planuota';
      const year = paramInt(params, 'year') ?? hc.year;
      if (
        metric === 'prasymu_skaicius' ||
        metric === 'prasyta_suma' ||
        metric === 'patvirtinta_suma'
      ) {
        const dash = await getDashboard(hc);
        if (metric === 'prasymu_skaicius') {
          return {
            kind: 'stat',
            value: String(dash.stats.totalRequests),
            subtitle: `Pateikti: ${dash.stats.byStatus.SUBMITTED} · Patvirtinti: ${dash.stats.byStatus.APPROVED}`,
          };
        }
        if (metric === 'prasyta_suma') {
          return {
            kind: 'stat',
            value: fmtEur(dash.stats.totalRequestedThisYear),
            subtitle: `${dash.year} m.`,
          };
        }
        return {
          kind: 'stat',
          value: fmtEur(dash.stats.totalApprovedThisYear),
          subtitle: `${dash.year} m.`,
        };
      }
      const fvm = await getFvm(hc, year);
      if (!fvm) return { kind: 'stat', value: '—', subtitle: 'Nėra duomenų' };
      switch (metric) {
        case 'islaidos_faktine': {
          const trend: AiStatTrend = fvm.budgetTotals.isOver
            ? { direction: 'up', text: 'Viršytas planas', positive: false }
            : fvm.budgetTotals.isWarning
              ? { direction: 'up', text: 'Artėja prie limito', positive: false }
              : { direction: 'flat', text: 'Pagal planą', positive: true };
          return {
            kind: 'stat',
            value: fmtEur(fvm.budgetTotals.faktine),
            subtitle: `${fvm.budgetTotals.percentUsed}% biudžeto`,
            trend,
          };
        }
        case 'biudzeto_likutis':
          return {
            kind: 'stat',
            value: fmtEur(fvm.budgetTotals.likutis),
            subtitle: `Aktyvūs projektai: ${fvm.activeProjectsCount}`,
          };
        case 'panaudota_procentai':
          return {
            kind: 'stat',
            value: `${fvm.budgetTotals.percentUsed}%`,
            subtitle: `${fmtEur(fvm.budgetTotals.faktine)} iš ${fmtEur(fvm.budgetTotals.planuota)}`,
          };
        case 'aktyvus_projektai':
          return {
            kind: 'stat',
            value: String(fvm.activeProjectsCount),
            subtitle: `Baigti: ${fvm.completedProjectsCount}`,
          };
        case 'pateikti_laukia': {
          const dash = await getDashboard(hc);
          return {
            kind: 'stat',
            value: String(dash.stats.byStatus.SUBMITTED),
            subtitle: 'Laukia sprendimo',
          };
        }
        case 'biudzetas_planuota':
        default:
          return {
            kind: 'stat',
            value: fmtEur(fvm.budgetTotals.planuota),
            subtitle: `${fvm.totalSourcesCount} šaltiniai, ${fvm.totalAllocationsCount} eilutės`,
          };
      }
    },
  },

  // --- Prašymai pagal statusą ---
  {
    id: 'requests_by_status',
    kind: 'series',
    widgetTypes: ['bar', 'pie', 'radar', 'table'],
    description: 'Prašymų kiekiai pagal statusą (juodraščiai/pateikti/patvirtinti/...).',
    params: [YEAR_PARAM],
    async run(hc) {
      const dash = await getDashboard(hc);
      const data: Row[] = Object.entries(dash.stats.byStatus)
        .filter(([, v]) => (v as number) > 0)
        .map(([k, v]) => ({ statusas: STATUS_LABELS[k] ?? k, kiekis: v as number }));
      return {
        kind: 'series',
        data,
        xKey: 'statusas',
        series: [{ key: 'kiekis', label: 'Prašymai', color: '#0f766e' }],
        format: 'number',
      };
    },
  },

  // --- Mėnesinis prašymų trendas ---
  {
    id: 'requests_monthly_trend',
    kind: 'series',
    widgetTypes: ['bar', 'line', 'area', 'table'],
    description: 'Pateiktų ir patvirtintų prašymų skaičius per 12 mėnesių.',
    params: [YEAR_PARAM],
    async run(hc) {
      const dash = await getDashboard(hc);
      const data: Row[] = dash.monthlyTrend.map((m) => ({
        menuo: m.month,
        pateikta: m.submitted,
        patvirtinta: m.approved,
      }));
      return {
        kind: 'series',
        data,
        xKey: 'menuo',
        series: [
          { key: 'pateikta', label: 'Pateikta', color: '#0f766e' },
          { key: 'patvirtinta', label: 'Patvirtinta', color: '#15803d' },
        ],
        format: 'number',
      };
    },
  },

  // --- Prašyta pagal lėšų kategorijas ---
  {
    id: 'cost_categories',
    kind: 'categorical',
    widgetTypes: ['pie', 'bar', 'table'],
    description: 'Prašyta suma (EUR) pagal lėšų kategorijas (DU, įranga, vystymas, ...).',
    params: [YEAR_PARAM],
    async run(hc) {
      const dash = await getDashboard(hc);
      const cats = dash.costCategories
        .filter((c) => c.requested > 0)
        .sort((a, b) => b.requested - a.requested);
      const top = cats.slice(0, 7);
      const restSum = cats.slice(7).reduce((acc, c) => acc + c.requested, 0);
      const data = top.map((c) => ({
        name: c.label ?? COST_LABELS[c.key] ?? c.key,
        value: toNum(c.requested),
      }));
      if (restSum > 0) data.push({ name: 'Kita', value: toNum(restSum) });
      return { kind: 'categorical', data, format: 'eur' };
    },
  },

  // --- Biudžeto vykdymas pagal finansavimo šaltinius ---
  {
    id: 'budget_execution_by_source',
    kind: 'series',
    widgetTypes: ['bar', 'table', 'pie'],
    description:
      'Biudžeto vykdymas pagal finansavimo šaltinius: planuota vs faktinė kiekvienam šaltiniui.',
    params: [YEAR_PARAM],
    async run(hc) {
      const year = hc.year;
      const rep = await getBudgetExecution(hc, year);
      const data: Row[] = (rep?.bySource ?? []).map((s) => ({
        saltinis: s.fundingSourceName,
        planuota: toNum(s.planuota),
        faktine: toNum(s.faktine),
      }));
      return {
        kind: 'series',
        data,
        xKey: 'saltinis',
        series: [
          { key: 'planuota', label: 'Planuota', color: '#94a3b8' },
          { key: 'faktine', label: 'Faktinė', color: '#0f766e' },
        ],
        format: 'eur',
      };
    },
  },

  // --- Biudžeto eilučių panaudojimas (progress) ---
  {
    id: 'budget_lines_usage',
    kind: 'progress',
    widgetTypes: ['progress'],
    description:
      'Biudžeto eilučių panaudojimas — juostos (faktinė / planuota %), arti limito viršuje.',
    params: [YEAR_PARAM],
    async run(hc) {
      const rep = await getBudgetExecution(hc, hc.year);
      const lines: AiProgressItem[] = [];
      for (const s of rep?.bySource ?? []) {
        for (const c of s.byCategory) {
          lines.push({
            label: `${c.allocationName} (${s.fundingSourceName})`,
            value: toNum(c.faktine),
            max: Math.max(toNum(c.planuota), 0.01),
            format: 'eur',
          });
        }
      }
      lines.sort((a, b) => b.value / b.max - a.value / a.max);
      return { kind: 'progress', items: lines.slice(0, 8) };
    },
  },

  // --- Biudžeto eilučių lentelė ---
  {
    id: 'budget_lines_table',
    kind: 'table',
    widgetTypes: ['table'],
    description: 'Biudžeto eilučių lentelė: šaltinis, eilutė, planuota, faktinė, likutis, %.',
    params: [YEAR_PARAM],
    async run(hc) {
      const rep = await getBudgetExecution(hc, hc.year);
      const rows: Row[] = [];
      for (const s of rep?.bySource ?? []) {
        for (const c of s.byCategory) {
          rows.push({
            saltinis: s.fundingSourceName,
            eilute: c.allocationName,
            planuota: toNum(c.planuota),
            faktine: toNum(c.faktine),
            likutis: toNum(c.likutis),
            procentai: c.percentUsed,
          });
        }
      }
      rows.sort((a, b) => (b.procentai as number) - (a.procentai as number));
      return {
        kind: 'table',
        columns: [
          { key: 'saltinis', label: 'Šaltinis' },
          { key: 'eilute', label: 'Eilutė' },
          { key: 'planuota', label: 'Planuota', format: 'eur', align: 'right' },
          { key: 'faktine', label: 'Faktinė', format: 'eur', align: 'right' },
          { key: 'likutis', label: 'Likutis', format: 'eur', align: 'right' },
          { key: 'procentai', label: '%', format: 'percent', align: 'right' },
        ],
        rows: rows.slice(0, 30),
      };
    },
  },

  // --- Organizacijų suvestinė ---
  {
    id: 'tenants_breakdown',
    kind: 'table',
    widgetTypes: ['table', 'bar'],
    description:
      'Organizacijų suvestinė (tik tvirtintojams): prašymų skaičius, prašyta/patvirtinta suma per org.',
    params: [YEAR_PARAM],
    async run(hc) {
      const dash = await getDashboard(hc);
      const breakdown = (dash.perTenantBreakdown ?? [])
        .filter((t) => t.total > 0)
        .sort((a, b) => b.totalRequested - a.totalRequested)
        .slice(0, 12);
      return {
        kind: 'table',
        columns: [
          { key: 'org', label: 'Organizacija' },
          { key: 'prasymu', label: 'Prašymai', format: 'number', align: 'right' },
          { key: 'prasyta', label: 'Prašyta', format: 'eur', align: 'right' },
          { key: 'patvirtinta', label: 'Patvirtinta', format: 'eur', align: 'right' },
        ],
        rows: breakdown.map((t) => ({
          org: t.tenantName,
          prasymu: t.total,
          prasyta: toNum(t.totalRequested),
          patvirtinta: toNum(t.totalApproved),
        })),
      };
    },
  },

  // --- Išlaidos pagal mėnesį ---
  {
    id: 'expenses_monthly',
    kind: 'series',
    widgetTypes: ['bar', 'line', 'area', 'table'],
    description:
      'Faktinės išlaidos (EUR) pagal mėnesį. params.projectId — vieno projekto išlaidos.',
    params: [
      YEAR_PARAM,
      {
        name: 'projectId',
        type: 'integer',
        description: 'Tik šio projekto išlaidos (neprivaloma)',
      },
    ],
    async run(hc, params) {
      const year = paramInt(params, 'year') ?? hc.year;
      const projectId = paramInt(params, 'projectId');
      const expenses = await getExpenses(hc, year, projectId);
      const byMonth = new Map<string, number>();
      for (const e of expenses) {
        const m = typeof e.data === 'string' ? e.data.slice(0, 7) : 'nežinoma';
        byMonth.set(m, (byMonth.get(m) ?? 0) + toNum(e.suma));
      }
      const data: Row[] = [...byMonth.entries()]
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([menuo, suma]) => ({ menuo, suma: Math.round(suma * 100) / 100 }));
      return {
        kind: 'series',
        data,
        xKey: 'menuo',
        series: [{ key: 'suma', label: 'Išlaidos', color: '#0369a1' }],
        format: 'eur',
      };
    },
  },

  // --- Išlaidos pagal tipą ---
  {
    id: 'expenses_by_type',
    kind: 'categorical',
    widgetTypes: ['pie', 'bar', 'table'],
    description: 'Faktinės išlaidos (EUR) pagal tipą (sutartis/sąskaita/tiesioginė/DU).',
    params: [
      YEAR_PARAM,
      { name: 'projectId', type: 'integer', description: 'Tik šio projekto (neprivaloma)' },
    ],
    async run(hc, params) {
      const year = paramInt(params, 'year') ?? hc.year;
      const projectId = paramInt(params, 'projectId');
      const expenses = await getExpenses(hc, year, projectId);
      const labels: Record<string, string> = {
        sutartis: 'Sutartys',
        saskaita: 'Sąskaitos',
        tiesiogine: 'Tiesioginės',
        du: 'Darbo užmokestis',
      };
      const byType = new Map<string, number>();
      for (const e of expenses) byType.set(e.tipas, (byType.get(e.tipas) ?? 0) + toNum(e.suma));
      const data = [...byType.entries()]
        .filter(([, v]) => v > 0)
        .map(([t, v]) => ({ name: labels[t] ?? t, value: Math.round(v * 100) / 100 }));
      return { kind: 'categorical', data, format: 'eur' };
    },
  },

  // --- Projektų lentelė ---
  {
    id: 'projects_table',
    kind: 'table',
    widgetTypes: ['table'],
    description:
      'Projektų sąrašas: pavadinimas, tipas, statusas, biudžetas, organizacija. params.status filtruoja.',
    params: [
      YEAR_PARAM,
      {
        name: 'status',
        type: 'enum',
        values: ['planuojama', 'vykdoma', 'baigta', 'uzdaryta'],
        description: 'Tik šio statuso projektai (neprivaloma)',
      },
    ],
    async run(hc, params) {
      const year = paramInt(params, 'year');
      const status = paramStr(params, 'status');
      const list = await callAction<Project[], { year?: number; status?: string }>(
        hc.ctx,
        'projects.list',
        { ...(year !== undefined ? { year } : {}), ...(status ? { status } : {}) },
      ).catch(() => [] as Project[]);
      const statusLt: Record<string, string> = {
        planuojama: 'Planuojama',
        vykdoma: 'Vykdoma',
        baigta: 'Baigta',
        uzdaryta: 'Uždaryta',
      };
      return {
        kind: 'table',
        columns: [
          { key: 'pavadinimas', label: 'Projektas' },
          { key: 'tipas', label: 'Tipas' },
          { key: 'statusas', label: 'Statusas' },
          { key: 'biudzetas', label: 'Biudžetas', format: 'eur', align: 'right' },
        ],
        rows: list.slice(0, 40).map((p) => ({
          pavadinimas: p.pavadinimas,
          tipas: p.tipas,
          statusas: statusLt[p.statusas] ?? p.statusas,
          biudzetas: toNum(p.biudzetas),
        })),
      };
    },
  },

  // --- Artėjantys terminai ---
  {
    id: 'upcoming_deadlines',
    kind: 'table',
    widgetTypes: ['table'],
    description: 'Artėjantys projektų terminai (30 dienų): projektas, data, liko dienų.',
    params: [YEAR_PARAM],
    async run(hc) {
      const fvm = await getFvm(hc, hc.year);
      return {
        kind: 'table',
        columns: [
          { key: 'pavadinimas', label: 'Projektas' },
          { key: 'data', label: 'Terminas', align: 'right' },
          { key: 'liko', label: 'Liko dienų', format: 'number', align: 'right' },
        ],
        rows: (fvm?.upcomingDeadlines ?? []).slice(0, 10).map((d) => ({
          pavadinimas: d.name,
          data: d.date,
          liko: d.daysUntil,
        })),
      };
    },
  },

  // --- Biudžeto srautas (Sankey) ---
  {
    id: 'budget_flow_sankey',
    kind: 'sankey',
    widgetTypes: ['sankey'],
    description:
      'Biudžeto srautas: finansavimo šaltinis → kategorija → eilutė (srautai pagal faktinę arba planuotą sumą). params.sizeBy: faktine | planuota.',
    params: [
      YEAR_PARAM,
      {
        name: 'sizeBy',
        type: 'enum',
        values: ['faktine', 'planuota'],
        description: 'Pagal ką matuoti srautus (default faktinė; jei nulinė — planuota)',
      },
    ],
    async run(hc, params) {
      const rep = await getBudgetExecution(hc, hc.year);
      const preferred = paramStr(params, 'sizeBy') === 'planuota' ? 'planuota' : 'faktine';
      return buildSankey(rep, preferred);
    },
  },

  // --- Biudžeto hierarchija (Treemap) ---
  {
    id: 'budget_hierarchy_treemap',
    kind: 'treemap',
    widgetTypes: ['treemap'],
    description:
      'Biudžeto hierarchija langeliais: finansavimo šaltinis → eilutės (dydis pagal planuotą arba faktinę). params.sizeBy: planuota | faktine.',
    params: [
      YEAR_PARAM,
      {
        name: 'sizeBy',
        type: 'enum',
        values: ['planuota', 'faktine'],
        description: 'Langelio dydis (default planuota)',
      },
    ],
    async run(hc, params) {
      const rep = await getBudgetExecution(hc, hc.year);
      const sizeBy = paramStr(params, 'sizeBy') === 'faktine' ? 'faktine' : 'planuota';
      return buildTreemap(rep, sizeBy);
    },
  },
];

// ---------- Sankey / Treemap statyba ----------

function buildSankey(
  rep: BudgetExecutionReport | null,
  preferred: 'faktine' | 'planuota',
): HydrationResult {
  const nodes: AiSankeyNode[] = [];
  const nodeIndex = new Map<string, number>();
  const links: AiSankeyLink[] = [];

  function nodeIdx(key: string, name: string): number {
    const existing = nodeIndex.get(key);
    if (existing !== undefined) return existing;
    const idx = nodes.length;
    nodes.push({ name });
    nodeIndex.set(key, idx);
    return idx;
  }

  // Sumuojam srautus šaltinis→kategorija ir kategorija→eilutė; vengiam nulinių.
  const srcCat = new Map<string, number>();
  const catAlloc = new Map<string, number>();
  const srcCatMeta = new Map<
    string,
    { src: string; srcName: string; cat: string; catName: string }
  >();
  const catAllocMeta = new Map<
    string,
    { cat: string; catName: string; alloc: string; allocName: string }
  >();

  for (const s of rep?.bySource ?? []) {
    for (const c of s.byCategory) {
      const val =
        preferred === 'planuota' ? toNum(c.planuota) : toNum(c.faktine) || toNum(c.planuota);
      if (val <= 0) continue;
      const srcKey = `src:${s.fundingSourceId}`;
      const catKey = `cat:${s.fundingSourceId}:${c.categoryCode}`;
      const allocKey = `alloc:${c.categoryItemId}`;
      const scKey = `${srcKey}>${catKey}`;
      const caKey = `${catKey}>${allocKey}`;
      srcCat.set(scKey, (srcCat.get(scKey) ?? 0) + val);
      catAlloc.set(caKey, (catAlloc.get(caKey) ?? 0) + val);
      srcCatMeta.set(scKey, {
        src: srcKey,
        srcName: s.fundingSourceName,
        cat: catKey,
        catName: c.categoryName,
      });
      catAllocMeta.set(caKey, {
        cat: catKey,
        catName: c.categoryName,
        alloc: allocKey,
        allocName: c.allocationName,
      });
    }
  }

  for (const [scKey, val] of srcCat) {
    const m = srcCatMeta.get(scKey);
    if (!m) continue;
    links.push({
      source: nodeIdx(m.src, m.srcName),
      target: nodeIdx(m.cat, m.catName),
      value: Math.round(val),
    });
  }
  for (const [caKey, val] of catAlloc) {
    const m = catAllocMeta.get(caKey);
    if (!m) continue;
    links.push({
      source: nodeIdx(m.cat, m.catName),
      target: nodeIdx(m.alloc, m.allocName),
      value: Math.round(val),
    });
  }

  return { kind: 'sankey', nodes, links: links.filter((l) => l.value > 0) };
}

function buildTreemap(
  rep: BudgetExecutionReport | null,
  sizeBy: 'planuota' | 'faktine',
): HydrationResult {
  const treemap: AiTreemapNode[] = [];
  for (const s of rep?.bySource ?? []) {
    const children: AiTreemapNode[] = [];
    for (const c of s.byCategory) {
      const v = sizeBy === 'faktine' ? toNum(c.faktine) : toNum(c.planuota);
      if (v <= 0) continue;
      const color = c.isOver ? '#be123c' : c.isWarning ? '#b45309' : undefined;
      children.push(
        color ? { name: c.allocationName, value: v, color } : { name: c.allocationName, value: v },
      );
    }
    if (children.length > 0) treemap.push({ name: s.fundingSourceName, children });
  }
  return { kind: 'treemap', treemap };
}

// ---------- Registro prieiga ----------

const SOURCE_BY_ID = new Map(SOURCES.map((s) => [s.id, s]));

export function getSource(id: string): CatalogSource | undefined {
  return SOURCE_BY_ID.get(id);
}

export function listSourceIds(): string[] {
  return SOURCES.map((s) => s.id);
}

/** Katalogo aprašymas LLM system prompt'ui. */
export function buildCatalogPromptDoc(): string {
  const lines = SOURCES.map((s) => {
    const params =
      s.params.length > 0
        ? ' Params: ' +
          s.params
            .map((p) => {
              const req = p.required ? '*' : '';
              const vals = p.values ? `(${p.values.join('|')})` : '';
              return `${p.name}${req}${vals}`;
            })
            .join(', ')
        : '';
    return `- ${s.id} (tinka: ${s.widgetTypes.join('/')}): ${s.description}${params}`;
  });
  return lines.join('\n');
}

// ---------- Hidracija (merge į widget'ą) ----------

/** Pritaiko hidracijos rezultatą widget'ui pagal widget.type ir result.kind. */
export function applyHydration(widget: AiWidget, result: HydrationResult): AiWidget {
  const w: AiWidget = { ...widget };
  switch (result.kind) {
    case 'stat':
      w.value = result.value;
      if (result.subtitle !== undefined && widget.subtitle === undefined)
        w.subtitle = result.subtitle;
      if (result.trend && !widget.trend) w.trend = result.trend;
      break;
    case 'series':
      if (widget.type === 'pie') {
        const key = result.series[0]?.key ?? 'value';
        w.data = result.data.map((r) => ({
          name: String(r[result.xKey] ?? ''),
          value: typeof r[key] === 'number' ? (r[key] as number) : 0,
        }));
        if (result.format) w.format = w.format ?? result.format;
      } else if (widget.type === 'table') {
        w.columns = [
          { key: result.xKey, label: result.xKey },
          ...result.series.map((s) => ({
            key: s.key,
            label: s.label ?? s.key,
            format: result.format,
            align: 'right' as const,
          })),
        ];
        w.rows = result.data;
      } else {
        // bar/line/area/radar
        w.data = result.data;
        w.xKey = result.xKey;
        w.series = result.series;
        if (result.format) w.format = w.format ?? result.format;
      }
      break;
    case 'categorical':
      if (isXyWidgetType(widget.type)) {
        w.data = result.data.map((d) => ({ kategorija: d.name, suma: d.value }));
        w.xKey = 'kategorija';
        w.series = [{ key: 'suma', label: widget.title ?? 'Suma', color: PALETTE[0] }];
        if (result.format) w.format = w.format ?? result.format;
      } else if (widget.type === 'table') {
        w.columns = [
          { key: 'kategorija', label: 'Kategorija' },
          { key: 'suma', label: 'Suma', format: result.format ?? 'eur', align: 'right' },
        ];
        w.rows = result.data.map((d) => ({ kategorija: d.name, suma: d.value }));
      } else {
        // pie (default)
        w.data = result.data;
        if (result.format) w.format = w.format ?? result.format;
      }
      break;
    case 'table':
      w.columns = result.columns;
      w.rows = result.rows;
      break;
    case 'progress':
      w.items = result.items;
      break;
    case 'sankey':
      w.nodes = result.nodes;
      w.links = result.links;
      break;
    case 'treemap':
      w.treemap = result.treemap;
      break;
  }
  return w;
}

/**
 * Hidruoja visą spec'ą: kiekvienam widget'ui su `dataRef` paleidžia šaltinį ir
 * užpildo data laukus šviežiais duomenimis. Widget'ai be dataRef paliekami kaip
 * yra (literalūs/snapshot duomenys). Klaidos tyliai praleidžiamos — widget'as
 * lieka su tuo, kas buvo (arba tuščias → FE jį praleidžia).
 */
export async function hydrateSpec(
  ctx: Context<unknown, AuthMeta>,
  spec: AiDashboardSpec,
  defaultYear: number,
): Promise<AiDashboardSpec> {
  const hc: HydrationCtx = { ctx, year: defaultYear, cache: new Map() };
  const widgets = await Promise.all(
    spec.widgets.map(async (widget) => {
      if (!widget.dataRef) return widget;
      const source = getSource(widget.dataRef.source);
      if (!source) return widget;
      try {
        const result = await source.run(hc, widget.dataRef.params ?? {});
        return applyHydration(widget, result);
      } catch {
        return widget;
      }
    }),
  );
  return { ...spec, widgets };
}

/**
 * `query_data` tool'ui: paleidžia vieną šaltinį ir grąžina kompaktišką
 * rezultatą LLM'ui (kad matytų realius skaičius prieš render'indamas).
 */
export async function runSourceForTool(
  ctx: Context<unknown, AuthMeta>,
  sourceId: string,
  params: Record<string, unknown>,
  defaultYear: number,
): Promise<HydrationResult | { error: string }> {
  const source = getSource(sourceId);
  if (!source) {
    return {
      error: `Nežinomas duomenų šaltinis „${sourceId}". Galimi: ${listSourceIds().join(', ')}`,
    };
  }
  const hc: HydrationCtx = { ctx, year: defaultYear, cache: new Map() };
  try {
    return await source.run(hc, params);
  } catch (err) {
    return { error: `Nepavyko gauti duomenų: ${err instanceof Error ? err.message : String(err)}` };
  }
}
