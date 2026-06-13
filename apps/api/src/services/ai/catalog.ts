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
  Expense,
  FinancingRequest,
  FvmSummaryResponse,
  PaginatedResponse,
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

/**
 * Metų-jautri prašymų užklausa. KRITIŠKA: `dashboard.get` agregatai naudoja
 * hardcodintus einamuosius metus ir NEpriima metų — todėl prašymų widget'ai
 * ignoruodavo pasirinktus metus (stat kortelės rodė 0 už 2025, o grafikai —
 * 2026 duomenis). Vietoj to imam prašymus per `requests.list({year})` ir
 * agreguojam patys → 2025 (be duomenų) tampa tuščias, nuoseklu su biudžeto
 * kortelėmis. ADR-005: requests.list pats taiko tenant scope.
 */
function getYearRequests(hc: HydrationCtx, year: number): Promise<FinancingRequest[]> {
  return cached(hc, `requests.list:${year}`, async () => {
    const all: FinancingRequest[] = [];
    const pageSize = 200;
    for (let page = 1; page <= 5; page += 1) {
      const res = await callAction<
        PaginatedResponse<FinancingRequest>,
        { year: number; page: number; pageSize: number }
      >(hc.ctx, 'requests.list', { year, page, pageSize }).catch(() => null);
      if (!res || !Array.isArray(res.items) || res.items.length === 0) break;
      all.push(...res.items);
      if (all.length >= (res.total ?? all.length)) break;
    }
    return all;
  });
}

/** Prašymo „prašyta" suma — 7 cost laukai be DU (kaip dashboard.totalRequestedFromRow). */
function requestedAmount(r: FinancingRequest): number {
  return (
    Number(r.costEquipment ?? 0) +
    Number(r.costCreation ?? 0) +
    Number(r.costAnalysis ?? 0) +
    Number(r.costDevelopment ?? 0) +
    Number(r.costMaintenance ?? 0) +
    Number(r.costModernization ?? 0) +
    Number(r.costDecommissioning ?? 0)
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
        metric === 'patvirtinta_suma' ||
        metric === 'pateikti_laukia'
      ) {
        // Metų-jautru: imam nurodytų metų prašymus (ne year-blind dashboard.get).
        const reqs = await getYearRequests(hc, year);
        const submitted = reqs.filter((r) => r.status === 'SUBMITTED').length;
        const approved = reqs.filter((r) => r.status === 'APPROVED').length;
        if (metric === 'prasymu_skaicius') {
          return {
            kind: 'stat',
            value: String(reqs.length),
            subtitle: `${year} m. · Pateikti: ${submitted} · Patvirtinti: ${approved}`,
          };
        }
        if (metric === 'pateikti_laukia') {
          return {
            kind: 'stat',
            value: String(submitted),
            subtitle: `${year} m. · laukia sprendimo`,
          };
        }
        if (metric === 'prasyta_suma') {
          const sum = reqs.reduce((acc, r) => acc + requestedAmount(r), 0);
          return { kind: 'stat', value: fmtEur(sum), subtitle: `${year} m.` };
        }
        const granted = reqs.reduce(
          (acc, r) =>
            acc +
            (r.status === 'APPROVED' && r.decisionGrantedAmount !== null
              ? Number(r.decisionGrantedAmount)
              : 0),
          0,
        );
        return { kind: 'stat', value: fmtEur(granted), subtitle: `${year} m.` };
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

  // --- Prašymai pagal statusą (metų-jautru) ---
  {
    id: 'requests_by_status',
    kind: 'series',
    widgetTypes: ['bar', 'pie', 'radar', 'table'],
    description:
      'Nurodytų metų prašymų kiekiai pagal statusą (juodraščiai/pateikti/patvirtinti/...).',
    params: [YEAR_PARAM],
    async run(hc, params) {
      const year = paramInt(params, 'year') ?? hc.year;
      const reqs = await getYearRequests(hc, year);
      const counts = new Map<string, number>();
      for (const r of reqs) counts.set(r.status, (counts.get(r.status) ?? 0) + 1);
      const data: Row[] = [...counts.entries()]
        .filter(([, v]) => v > 0)
        .map(([k, v]) => ({ statusas: STATUS_LABELS[k] ?? k, kiekis: v }));
      return {
        kind: 'series',
        data,
        xKey: 'statusas',
        series: [{ key: 'kiekis', label: 'Prašymai', color: '#0f766e' }],
        format: 'number',
      };
    },
  },

  // --- Mėnesinis prašymų trendas (metų-jautru) ---
  {
    id: 'requests_monthly_trend',
    kind: 'series',
    widgetTypes: ['bar', 'line', 'area', 'table'],
    description:
      'Nurodytų metų prašymų pateikimo ir patvirtinimo aktyvumas pagal mėnesį (pagal pateikimo/sprendimo datą).',
    params: [YEAR_PARAM],
    async run(hc, params) {
      const year = paramInt(params, 'year') ?? hc.year;
      const reqs = await getYearRequests(hc, year);
      const submitted = new Map<string, number>();
      const approved = new Map<string, number>();
      for (const r of reqs) {
        if (r.submittedAt) {
          const m = r.submittedAt.slice(0, 7);
          submitted.set(m, (submitted.get(m) ?? 0) + 1);
        }
        if (r.decidedAt && r.status === 'APPROVED') {
          const m = r.decidedAt.slice(0, 7);
          approved.set(m, (approved.get(m) ?? 0) + 1);
        }
      }
      const months = [...new Set([...submitted.keys(), ...approved.keys()])].sort();
      const data: Row[] = months.map((m) => ({
        menuo: m,
        pateikta: submitted.get(m) ?? 0,
        patvirtinta: approved.get(m) ?? 0,
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

  // --- Prašyta pagal lėšų kategorijas (metų-jautru) ---
  {
    id: 'cost_categories',
    kind: 'categorical',
    widgetTypes: ['pie', 'bar', 'table'],
    description:
      'Nurodytų metų prašyta suma (EUR) pagal lėšų kategorijas (DU, įranga, vystymas, ...).',
    params: [YEAR_PARAM],
    async run(hc, params) {
      const year = paramInt(params, 'year') ?? hc.year;
      const reqs = await getYearRequests(hc, year);
      const fields: Array<{ key: string; label: string; field: keyof FinancingRequest }> = [
        { key: 'du', label: 'Darbo užmokestis', field: 'costDu' },
        { key: 'equipment', label: 'Įranga / licencijos', field: 'costEquipment' },
        { key: 'creation', label: 'Kūrimas', field: 'costCreation' },
        { key: 'analysis', label: 'Analizė', field: 'costAnalysis' },
        { key: 'development', label: 'Vystymas', field: 'costDevelopment' },
        { key: 'maintenance', label: 'Palaikymas', field: 'costMaintenance' },
        { key: 'modernization', label: 'Modernizavimas', field: 'costModernization' },
        { key: 'decommissioning', label: 'Likvidavimas', field: 'costDecommissioning' },
      ];
      const sums = fields.map((f) => ({
        name: f.label,
        value: reqs.reduce((acc, r) => acc + Number(r[f.field] ?? 0), 0),
      }));
      const nonZero = sums.filter((s) => s.value > 0).sort((a, b) => b.value - a.value);
      const top = nonZero.slice(0, 7).map((s) => ({ name: s.name, value: toNum(s.value) }));
      const restSum = nonZero.slice(7).reduce((acc, s) => acc + s.value, 0);
      if (restSum > 0) top.push({ name: 'Kita', value: toNum(restSum) });
      return { kind: 'categorical', data: top, format: 'eur' };
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
    async run(hc, params) {
      const year = paramInt(params, 'year') ?? hc.year;
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
    async run(hc, params) {
      const rep = await getBudgetExecution(hc, paramInt(params, 'year') ?? hc.year);
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
    async run(hc, params) {
      const rep = await getBudgetExecution(hc, paramInt(params, 'year') ?? hc.year);
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

  // --- Organizacijų suvestinė (metų-jautru) ---
  {
    id: 'tenants_breakdown',
    kind: 'table',
    widgetTypes: ['table', 'bar'],
    description:
      'Nurodytų metų organizacijų suvestinė (tik tvirtintojams): prašymų skaičius, prašyta/patvirtinta suma per org.',
    params: [YEAR_PARAM],
    async run(hc, params) {
      const year = paramInt(params, 'year') ?? hc.year;
      const reqs = await getYearRequests(hc, year);
      const byTenant = new Map<
        string,
        { org: string; prasymu: number; prasyta: number; patvirtinta: number }
      >();
      for (const r of reqs) {
        const key = String(r.tenantId);
        const t = byTenant.get(key) ?? {
          org: r.tenantName ?? r.tenantCode ?? key,
          prasymu: 0,
          prasyta: 0,
          patvirtinta: 0,
        };
        t.prasymu += 1;
        t.prasyta += requestedAmount(r);
        if (r.status === 'APPROVED' && r.decisionGrantedAmount !== null) {
          t.patvirtinta += Number(r.decisionGrantedAmount);
        }
        byTenant.set(key, t);
      }
      const rows = [...byTenant.values()]
        .sort((a, b) => b.prasyta - a.prasyta)
        .slice(0, 12)
        .map((t) => ({
          org: t.org,
          prasymu: t.prasymu,
          prasyta: toNum(t.prasyta),
          patvirtinta: toNum(t.patvirtinta),
        }));
      return {
        kind: 'table',
        columns: [
          { key: 'org', label: 'Organizacija' },
          { key: 'prasymu', label: 'Prašymai', format: 'number', align: 'right' },
          { key: 'prasyta', label: 'Prašyta', format: 'eur', align: 'right' },
          { key: 'patvirtinta', label: 'Patvirtinta', format: 'eur', align: 'right' },
        ],
        rows,
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
    async run(hc, params) {
      const fvm = await getFvm(hc, paramInt(params, 'year') ?? hc.year);
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
      const rep = await getBudgetExecution(hc, paramInt(params, 'year') ?? hc.year);
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
      const rep = await getBudgetExecution(hc, paramInt(params, 'year') ?? hc.year);
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
      // Šaltinis valdo value/subtitle/trend (data-derived). PERRAŠOM — kitaip
      // perhidruojant (pvz. pakeitus metus) liktų SENA paantraštė/trendas
      // (rodytų pernykščius „4 šaltiniai" nors metai jau kiti).
      w.value = result.value;
      w.subtitle = result.subtitle;
      w.trend = result.trend;
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
  // Globalūs metai (spec.year) PERRAŠO kiekvieno dataRef year — kad metų
  // keitimas atsinaujintų nuosekliai VISUOSE widget'uose (modelis nebeprivalo
  // pataikyti į kiekvieną widget atskirai).
  const globalYear = typeof spec.year === 'number' ? spec.year : undefined;
  const hc: HydrationCtx = { ctx, year: globalYear ?? defaultYear, cache: new Map() };
  const widgets = await Promise.all(
    spec.widgets.map(async (widget) => {
      if (!widget.dataRef) return widget;
      const source = getSource(widget.dataRef.source);
      if (!source) return widget;
      const params: Record<string, unknown> = { ...(widget.dataRef.params ?? {}) };
      if (globalYear !== undefined) params.year = globalYear;
      try {
        const result = await source.run(hc, params);
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
