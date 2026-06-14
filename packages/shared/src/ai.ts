/**
 * AI generatyvinio dashboard'o tipai (Iter 17–18, eksperimentinis).
 *
 * Widget spec'as — deklaratyvus JSON, kurį generuoja LLM per `render_dashboard`
 * tool-call'ą, o frontend'as (`DashboardCanvas`) atvaizduoja. Server'is PRIVALO
 * validuoti spec'ą per `validateDashboardSpec` prieš siųsdamas į frontend'ą —
 * LLM output'as yra nepatikimas input'as.
 *
 * Iter 18: duomenų nuorodos (`dataRef`). Widget'as gali nurodyti serverio
 * duomenų šaltinį (`{source, params}`) vietoj literalių skaičių — serveris
 * juos užpildo ŠVIEŽIAIS iš DB kiekvieno užkrovimo metu („hidracija"). Layout'as
 * iš AI, duomenys visada iš DB. Kai `dataRef` nurodytas, literalūs data laukai
 * gali būti praleisti — juos užpildo hidracija.
 *
 * Pinigų konvencija: chart'uose/lentelėse skaičiai (EUR vienetais, ne centais),
 * stat'uose — jau suformatuoti stringai (pvz. „1 145 900 €").
 */

// ---------- Widget spec ----------

export type AiWidgetType =
  | 'stat'
  | 'bar'
  | 'line'
  | 'area'
  | 'pie'
  | 'radar'
  | 'table'
  | 'progress'
  | 'markdown'
  | 'sankey'
  | 'treemap';

export type AiValueFormat = 'eur' | 'number' | 'percent' | 'text';

export type AiChartSeries = {
  /** Lauko raktas `data` objektuose. */
  key: string;
  /** Žmogui rodoma etiketė (legendoje/tooltip'e). */
  label?: string;
  /** Hex spalva, pvz. `#0f766e`. Jei nėra — paletė pagal indeksą. */
  color?: string;
};

export type AiTableColumn = {
  key: string;
  label: string;
  format?: AiValueFormat;
  align?: 'left' | 'right' | 'center';
};

export type AiProgressItem = {
  label: string;
  value: number;
  max: number;
  format?: AiValueFormat;
};

export type AiStatTrend = {
  direction: 'up' | 'down' | 'flat';
  text: string;
  /** Ar trendas „geras" (žalias) ar „blogas" (raudonas). Nenurodžius — neutralus. */
  positive?: boolean;
};

/** Sankey mazgas. Indeksas masyve = nuoroda iš links.source/target. */
export type AiSankeyNode = {
  name: string;
};

/** Sankey srautas tarp dviejų mazgų (indeksai į nodes). value > 0. */
export type AiSankeyLink = {
  source: number;
  target: number;
  value: number;
};

/** Treemap langelis (gali turėti vieną vaikų lygį). */
export type AiTreemapNode = {
  name: string;
  /** Dydis (langelio plotas). Tėviniam mazgui ignoruojamas, jei yra children. */
  value?: number;
  color?: string;
  children?: AiTreemapNode[];
};

/**
 * Duomenų nuoroda į serverio katalogo šaltinį. Kai widget'e yra `dataRef`,
 * serveris hidruoja jį ŠVIEŽIAIS duomenimis iš DB; literalūs data laukai
 * (data/series/value/...) tada nebūtini — juos užpildo serveris.
 */
export type AiDataRef = {
  /** Katalogo šaltinio id (žr. serverio duomenų šaltinių katalogą). */
  source: string;
  /** Parametrai šaltiniui (pvz. {year: 2026, status: "vykdoma"}). */
  params?: Record<string, string | number | boolean>;
};

export type AiWidget = {
  /** Unikalus id spec'o ribose — naudojamas React key + perėjimo animacijoms. */
  id: string;
  type: AiWidgetType;
  title?: string;
  /** Plotis 4 stulpelių tinklelyje (1–4). Default: stat=1, kiti=2. */
  span?: 1 | 2 | 3 | 4;

  /**
   * Duomenų nuoroda — kai nustatyta, serveris užpildo data laukus šviežiais
   * duomenimis (hidracija). Pirmenybė prieš literalius data.
   */
  dataRef?: AiDataRef;

  // --- stat ---
  value?: string;
  subtitle?: string;
  trend?: AiStatTrend;

  // --- bar / line / area / radar / pie ---
  /** pie atveju: [{ name, value }]. radar: kaip bar (xKey = ašies laukas). */
  data?: Array<Record<string, string | number | null>>;
  xKey?: string;
  series?: AiChartSeries[];
  stacked?: boolean;
  /** Y ašies / pie / tooltip reikšmių formatas. */
  format?: AiValueFormat;

  // --- table ---
  columns?: AiTableColumn[];
  rows?: Array<Record<string, string | number | null>>;

  // --- progress ---
  items?: AiProgressItem[];

  // --- markdown (palaikom paprastą poaibį: ## antraštės, **bold**, - sąrašai) ---
  content?: string;

  // --- sankey ---
  nodes?: AiSankeyNode[];
  links?: AiSankeyLink[];

  // --- treemap ---
  treemap?: AiTreemapNode[];
};

export type AiDashboardSpec = {
  title?: string;
  subtitle?: string;
  /**
   * Globalūs metai visam vaizdui. Kai nustatyti, serveris hidruodamas
   * PRIVERSTINAI pritaiko šiuos metus VISŲ widget'ų dataRef'ams (perrašo
   * kiekvieno widget'o `params.year`). Taip metų keitimas vienu žodžiu
   * („rodyk 2025") atsinaujina nuosekliai visuose grafikuose.
   */
  year?: number;
  /**
   * Globalus institucijos (tenant) pjūvis. Kai nustatytas, serveris hidruodamas
   * PRIVERSTINAI apriboja VISŲ widget'ų duomenis šia institucija (intersect su
   * vartotojo matomu scope — ADR-005 negali praplėsti matomumo). Taip „rodyk tik
   * AAD" pjūvis išsisaugo spec'e ir RE-HIDRUOJASI be LLM. undefined = visos
   * (pagal vartotojo scope).
   */
  tenantId?: number;
  widgets: AiWidget[];
};

// ---------- Chat protokolas ----------

export type AiChatMessage = {
  role: 'user' | 'assistant';
  content: string;
};

export type AiChatRequest = {
  /** Pokalbio istorija (tik matomos žinutės, be tool transcript'ų). */
  messages: AiChatMessage[];
  /** Dabartinis dashboard spec'as — leidžia LLM'ui daryti inkrementinius pakeitimus. */
  spec?: AiDashboardSpec | null;
  /** Kontekstiniai metai (default — einamieji). */
  year?: number;
};

/** SSE event'ai, siunčiami iš `POST /ai/chat` (text/event-stream). */
export type AiChatEvent =
  | { type: 'status'; label: string }
  | { type: 'spec'; spec: AiDashboardSpec }
  | { type: 'reply'; text: string }
  | { type: 'error'; message: string }
  | { type: 'done' };

export type AiDashboardResponse = {
  spec: AiDashboardSpec;
  generatedAt: string;
};

/** `POST /ai/hydrate` — užpildo spec'o dataRef'us šviežiais DB duomenimis. */
export type AiHydrateRequest = {
  spec: AiDashboardSpec;
  year?: number;
};

export type AiHydrateResponse = {
  spec: AiDashboardSpec;
  generatedAt: string;
};

// ---------- Validacija / sanitizacija ----------

export const AI_SPEC_LIMITS = {
  maxWidgets: 14,
  maxDataPoints: 200,
  maxRows: 100,
  maxColumns: 12,
  maxSeries: 8,
  maxItems: 30,
  maxStringLen: 4000,
  maxTitleLen: 200,
  maxSankeyNodes: 60,
  maxSankeyLinks: 200,
  maxTreemapNodes: 60,
  maxRefParams: 12,
} as const;

const WIDGET_TYPES: ReadonlySet<string> = new Set([
  'stat',
  'bar',
  'line',
  'area',
  'pie',
  'radar',
  'table',
  'progress',
  'markdown',
  'sankey',
  'treemap',
]);
const FORMATS: ReadonlySet<string> = new Set(['eur', 'number', 'percent', 'text']);
const ALIGNS: ReadonlySet<string> = new Set(['left', 'right', 'center']);
const TREND_DIRECTIONS: ReadonlySet<string> = new Set(['up', 'down', 'flat']);
/** XY tipai, kurie naudoja data + xKey + series. radar reuse'ina tą patį. */
const XY_TYPES: ReadonlySet<string> = new Set(['bar', 'line', 'area', 'radar']);

export type AiSpecValidationResult =
  | {
      ok: true;
      spec: AiDashboardSpec;
      /** Įspėjimai apie atmestus/apkarpytus widget'us (salvage atveju netuščias). */
      errors: string[];
    }
  | { ok: false; errors: string[] };

function clampStr(v: unknown, max: number): string | undefined {
  if (typeof v !== 'string') return undefined;
  const trimmed = v.trim();
  if (!trimmed) return undefined;
  return trimmed.length > max ? trimmed.slice(0, max) : trimmed;
}

function isFiniteNumber(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v);
}

/** Palieka tik string|number|null reikšmes; kitas išmeta. */
function sanitizeRecord(
  raw: unknown,
  maxLen: number,
): Record<string, string | number | null> | undefined {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return undefined;
  const out: Record<string, string | number | null> = {};
  let any = false;
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (!k || k.length > 100) continue;
    if (v === null) {
      out[k] = null;
      any = true;
    } else if (isFiniteNumber(v)) {
      out[k] = v;
      any = true;
    } else if (typeof v === 'string') {
      out[k] = v.length > maxLen ? v.slice(0, maxLen) : v;
      any = true;
    }
  }
  return any ? out : undefined;
}

/** dataRef sanitizacija — source string + flat primitive params. */
function sanitizeDataRef(raw: unknown): AiDataRef | undefined {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return undefined;
  const r = raw as Record<string, unknown>;
  const source = clampStr(r.source, 100);
  if (!source) return undefined;
  const ref: AiDataRef = { source };
  if (typeof r.params === 'object' && r.params !== null && !Array.isArray(r.params)) {
    const params: Record<string, string | number | boolean> = {};
    let count = 0;
    for (const [k, v] of Object.entries(r.params as Record<string, unknown>)) {
      if (count >= AI_SPEC_LIMITS.maxRefParams) break;
      if (!k || k.length > 60) continue;
      if (typeof v === 'string') {
        params[k] = v.length > 200 ? v.slice(0, 200) : v;
        count += 1;
      } else if (isFiniteNumber(v)) {
        params[k] = v;
        count += 1;
      } else if (typeof v === 'boolean') {
        params[k] = v;
        count += 1;
      }
    }
    if (count > 0) ref.params = params;
  }
  return ref;
}

function sanitizeChartData(
  raw: unknown,
  errors: string[],
  idx: number,
  type: string,
): Array<Record<string, string | number | null>> | null {
  if (!Array.isArray(raw) || raw.length === 0) {
    errors.push(`widgets[${idx}] (${type}): trūksta „data" masyvo`);
    return null;
  }
  const data = raw
    .slice(0, AI_SPEC_LIMITS.maxDataPoints)
    .map((d) => sanitizeRecord(d, AI_SPEC_LIMITS.maxTitleLen))
    .filter((d): d is Record<string, string | number | null> => d !== undefined);
  if (data.length === 0) {
    errors.push(`widgets[${idx}] (${type}): „data" be tinkamų objektų`);
    return null;
  }
  return data;
}

function sanitizeSeries(raw: unknown): AiChartSeries[] {
  if (!Array.isArray(raw)) return [];
  const series: AiChartSeries[] = [];
  for (const s of raw.slice(0, AI_SPEC_LIMITS.maxSeries)) {
    if (typeof s !== 'object' || s === null) continue;
    const sr = s as Record<string, unknown>;
    const key = clampStr(sr.key, 100);
    if (!key) continue;
    const entry: AiChartSeries = { key };
    const label = clampStr(sr.label, AI_SPEC_LIMITS.maxTitleLen);
    if (label) entry.label = label;
    const color = clampStr(sr.color, 30);
    if (color && /^#[0-9a-fA-F]{3,8}$/.test(color)) entry.color = color;
    series.push(entry);
  }
  return series;
}

function sanitizeColumns(raw: unknown): AiTableColumn[] {
  if (!Array.isArray(raw)) return [];
  const columns: AiTableColumn[] = [];
  for (const c of raw.slice(0, AI_SPEC_LIMITS.maxColumns)) {
    if (typeof c !== 'object' || c === null) continue;
    const cr = c as Record<string, unknown>;
    const key = clampStr(cr.key, 100);
    const label = clampStr(cr.label, AI_SPEC_LIMITS.maxTitleLen) ?? key;
    if (!key || !label) continue;
    const col: AiTableColumn = { key, label };
    if (typeof cr.format === 'string' && FORMATS.has(cr.format))
      col.format = cr.format as AiValueFormat;
    if (typeof cr.align === 'string' && ALIGNS.has(cr.align))
      col.align = cr.align as AiTableColumn['align'];
    columns.push(col);
  }
  return columns;
}

function sanitizeSankey(
  rawNodes: unknown,
  rawLinks: unknown,
): { nodes: AiSankeyNode[]; links: AiSankeyLink[] } | null {
  if (!Array.isArray(rawNodes) || !Array.isArray(rawLinks)) return null;
  const nodes: AiSankeyNode[] = [];
  for (const n of rawNodes.slice(0, AI_SPEC_LIMITS.maxSankeyNodes)) {
    const name =
      typeof n === 'object' && n !== null
        ? clampStr((n as Record<string, unknown>).name, AI_SPEC_LIMITS.maxTitleLen)
        : clampStr(n, AI_SPEC_LIMITS.maxTitleLen);
    nodes.push({ name: name ?? `#${nodes.length}` });
  }
  if (nodes.length < 2) return null;
  const links: AiSankeyLink[] = [];
  for (const l of rawLinks.slice(0, AI_SPEC_LIMITS.maxSankeyLinks)) {
    if (typeof l !== 'object' || l === null) continue;
    const lr = l as Record<string, unknown>;
    const source = lr.source;
    const target = lr.target;
    const value = lr.value;
    if (
      isFiniteNumber(source) &&
      isFiniteNumber(target) &&
      isFiniteNumber(value) &&
      value > 0 &&
      source >= 0 &&
      target >= 0 &&
      source < nodes.length &&
      target < nodes.length &&
      source !== target
    ) {
      links.push({ source: Math.floor(source), target: Math.floor(target), value });
    }
  }
  if (links.length === 0) return null;
  return { nodes, links };
}

function sanitizeTreemap(raw: unknown, depth = 0): AiTreemapNode[] {
  if (!Array.isArray(raw)) return [];
  const out: AiTreemapNode[] = [];
  for (const n of raw.slice(0, AI_SPEC_LIMITS.maxTreemapNodes)) {
    if (typeof n !== 'object' || n === null) continue;
    const nr = n as Record<string, unknown>;
    const name = clampStr(nr.name, AI_SPEC_LIMITS.maxTitleLen);
    if (!name) continue;
    const node: AiTreemapNode = { name };
    const color = clampStr(nr.color, 30);
    if (color && /^#[0-9a-fA-F]{3,8}$/.test(color)) node.color = color;
    const children = depth < 1 ? sanitizeTreemap(nr.children, depth + 1) : [];
    if (children.length > 0) {
      node.children = children;
    } else if (isFiniteNumber(nr.value) && nr.value > 0) {
      node.value = nr.value;
    } else {
      continue; // leaf be teigiamos value — praleidžiam
    }
    out.push(node);
  }
  return out;
}

function sanitizeWidget(raw: unknown, idx: number, errors: string[]): AiWidget | null {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    errors.push(`widgets[${idx}]: ne objektas`);
    return null;
  }
  const w = raw as Record<string, unknown>;
  const type = typeof w.type === 'string' ? w.type : '';
  if (!WIDGET_TYPES.has(type)) {
    errors.push(
      `widgets[${idx}]: nežinomas type „${String(w.type)}" (galimi: ${[...WIDGET_TYPES].join(', ')})`,
    );
    return null;
  }
  const id = clampStr(w.id, 100) ?? `w${idx}`;
  const out: AiWidget = { id, type: type as AiWidgetType };

  const title = clampStr(w.title, AI_SPEC_LIMITS.maxTitleLen);
  if (title) out.title = title;

  if (isFiniteNumber(w.span)) {
    const span = Math.round(w.span);
    if (span >= 1 && span <= 4) out.span = span as 1 | 2 | 3 | 4;
  }

  if (typeof w.format === 'string' && FORMATS.has(w.format)) {
    out.format = w.format as AiValueFormat;
  }

  // dataRef — kai yra, literalūs data laukai nebūtini (hidracija užpildys).
  const dataRef = sanitizeDataRef(w.dataRef);
  if (dataRef) out.dataRef = dataRef;
  const hydrated = dataRef !== undefined;

  // Bendri (visada sanitizuojam, jei pateikti) data laukai — kad ir su dataRef
  // modelio pateikti literalūs duomenys (jei yra) būtų saugūs iki hidracijos.
  switch (out.type) {
    case 'stat': {
      const value = clampStr(w.value, AI_SPEC_LIMITS.maxTitleLen);
      if (value !== undefined) out.value = value;
      else if (isFiniteNumber(w.value)) out.value = String(w.value);
      const subtitle = clampStr(w.subtitle, AI_SPEC_LIMITS.maxTitleLen);
      if (subtitle) out.subtitle = subtitle;
      if (typeof w.trend === 'object' && w.trend !== null) {
        const t = w.trend as Record<string, unknown>;
        const direction =
          typeof t.direction === 'string' && TREND_DIRECTIONS.has(t.direction)
            ? (t.direction as AiStatTrend['direction'])
            : undefined;
        const text = clampStr(t.text, AI_SPEC_LIMITS.maxTitleLen);
        if (direction && text) {
          out.trend = { direction, text };
          if (typeof t.positive === 'boolean') out.trend.positive = t.positive;
        }
      }
      if (!hydrated && out.value === undefined) {
        errors.push(`widgets[${idx}] (stat): trūksta „value" (arba dataRef)`);
        return null;
      }
      break;
    }
    case 'bar':
    case 'line':
    case 'area':
    case 'radar': {
      const data = w.data !== undefined ? sanitizeChartData(w.data, [], idx, out.type) : null;
      if (data) out.data = data;
      const xKey = clampStr(w.xKey, 100);
      if (xKey) out.xKey = xKey;
      const series = sanitizeSeries(w.series);
      if (series.length > 0) out.series = series;
      if (typeof w.stacked === 'boolean') out.stacked = w.stacked;
      if (!hydrated && (!out.data || !out.xKey || !out.series)) {
        errors.push(`widgets[${idx}] (${out.type}): reikia data+xKey+series (arba dataRef)`);
        return null;
      }
      break;
    }
    case 'pie': {
      if (w.data !== undefined) {
        const data: Array<Record<string, string | number | null>> = [];
        for (const d of Array.isArray(w.data) ? w.data.slice(0, 24) : []) {
          const rec = sanitizeRecord(d, AI_SPEC_LIMITS.maxTitleLen);
          if (!rec) continue;
          if (typeof rec.name === 'string' && isFiniteNumber(rec.value) && rec.value >= 0) {
            data.push({ name: rec.name, value: rec.value });
          }
        }
        if (data.length > 0) out.data = data;
      }
      if (!hydrated && !out.data) {
        errors.push(`widgets[${idx}] (pie): „data" [{name, value>=0}] (arba dataRef)`);
        return null;
      }
      break;
    }
    case 'table': {
      const columns = sanitizeColumns(w.columns);
      if (columns.length > 0) out.columns = columns;
      if (Array.isArray(w.rows)) {
        out.rows = w.rows
          .slice(0, AI_SPEC_LIMITS.maxRows)
          .map((r) => sanitizeRecord(r, AI_SPEC_LIMITS.maxTitleLen))
          .filter((r): r is Record<string, string | number | null> => r !== undefined);
      }
      if (!hydrated && (!out.columns || out.rows === undefined)) {
        errors.push(`widgets[${idx}] (table): reikia columns+rows (arba dataRef)`);
        return null;
      }
      break;
    }
    case 'progress': {
      if (Array.isArray(w.items)) {
        const items: AiProgressItem[] = [];
        for (const it of w.items.slice(0, AI_SPEC_LIMITS.maxItems)) {
          if (typeof it !== 'object' || it === null) continue;
          const ir = it as Record<string, unknown>;
          const label = clampStr(ir.label, AI_SPEC_LIMITS.maxTitleLen);
          if (!label || !isFiniteNumber(ir.value) || !isFiniteNumber(ir.max) || ir.max <= 0)
            continue;
          const item: AiProgressItem = { label, value: ir.value, max: ir.max };
          if (typeof ir.format === 'string' && FORMATS.has(ir.format))
            item.format = ir.format as AiValueFormat;
          items.push(item);
        }
        if (items.length > 0) out.items = items;
      }
      if (!hydrated && !out.items) {
        errors.push(`widgets[${idx}] (progress): „items" [{label, value, max>0}] (arba dataRef)`);
        return null;
      }
      break;
    }
    case 'markdown': {
      const content = clampStr(w.content, AI_SPEC_LIMITS.maxStringLen);
      if (content) out.content = content;
      // markdown su dataRef neturi prasmės, bet leidžiam (tekstas turi būti).
      if (!out.content) {
        errors.push(`widgets[${idx}] (markdown): trūksta „content"`);
        return null;
      }
      break;
    }
    case 'sankey': {
      const sankey = sanitizeSankey(w.nodes, w.links);
      if (sankey) {
        out.nodes = sankey.nodes;
        out.links = sankey.links;
      }
      if (!hydrated && !out.nodes) {
        errors.push(`widgets[${idx}] (sankey): reikia nodes+links (arba dataRef)`);
        return null;
      }
      break;
    }
    case 'treemap': {
      if (w.treemap !== undefined) {
        const treemap = sanitizeTreemap(w.treemap);
        if (treemap.length > 0) out.treemap = treemap;
      }
      if (!hydrated && !out.treemap) {
        errors.push(`widgets[${idx}] (treemap): „treemap" [{name, value>0}] (arba dataRef)`);
        return null;
      }
      break;
    }
  }
  return out;
}

/**
 * Validuoja + sanitizuoja LLM sugeneruotą dashboard spec'ą.
 *
 * Strategija: salvage — geri widget'ai praleidžiami, blogi atmetami su klaidų
 * sąrašu (klaidos grąžinamos LLM'ui kaip tool result, kad galėtų pataisyti).
 * `ok: false` tik tada, kai nelieka NĖ VIENO tinkamo widget'o.
 */
export function validateDashboardSpec(input: unknown): AiSpecValidationResult {
  const errors: string[] = [];
  if (typeof input !== 'object' || input === null || Array.isArray(input)) {
    return { ok: false, errors: ['Spec turi būti objektas su „widgets" masyvu'] };
  }
  const raw = input as Record<string, unknown>;
  if (!Array.isArray(raw.widgets) || raw.widgets.length === 0) {
    return { ok: false, errors: ['„widgets" turi būti netuščias masyvas'] };
  }
  if (raw.widgets.length > AI_SPEC_LIMITS.maxWidgets) {
    errors.push(
      `Per daug widget'ų (${raw.widgets.length} > ${AI_SPEC_LIMITS.maxWidgets}) — pertekliniai atmesti`,
    );
  }
  const widgets: AiWidget[] = [];
  const seenIds = new Set<string>();
  raw.widgets.slice(0, AI_SPEC_LIMITS.maxWidgets).forEach((rawWidget, idx) => {
    const w = sanitizeWidget(rawWidget, idx, errors);
    if (!w) return;
    if (seenIds.has(w.id)) w.id = `${w.id}-${idx}`;
    seenIds.add(w.id);
    widgets.push(w);
  });
  if (widgets.length === 0) {
    return {
      ok: false,
      errors: errors.length ? errors : ['Nė vienas widgetas nepraėjo validacijos'],
    };
  }
  const spec: AiDashboardSpec = { widgets };
  const title = clampStr(raw.title, AI_SPEC_LIMITS.maxTitleLen);
  if (title) spec.title = title;
  const subtitle = clampStr(raw.subtitle, AI_SPEC_LIMITS.maxTitleLen);
  if (subtitle) spec.subtitle = subtitle;
  if (isFiniteNumber(raw.year)) {
    const y = Math.round(raw.year);
    if (y >= 2000 && y <= 3000) spec.year = y;
  } else if (typeof raw.year === 'string') {
    const y = Math.round(Number(raw.year));
    if (Number.isFinite(y) && y >= 2000 && y <= 3000) spec.year = y;
  }
  // Globalus institucijos pjūvis (tenantId). Serveris papildomai validuoja prieš
  // scope (intersect) — čia tik bazinė sanitizacija (teigiamas sveikas).
  const tenantId = isFiniteNumber(raw.tenantId)
    ? Math.round(raw.tenantId)
    : typeof raw.tenantId === 'string' && raw.tenantId.trim()
      ? Math.round(Number(raw.tenantId))
      : NaN;
  if (Number.isFinite(tenantId) && tenantId > 0) spec.tenantId = tenantId;
  return { ok: true, spec, errors };
}

/** Naudinga FE/serveriui: ar XY tipo (data+xKey+series) widget'as. */
export function isXyWidgetType(type: AiWidgetType): boolean {
  return XY_TYPES.has(type);
}
