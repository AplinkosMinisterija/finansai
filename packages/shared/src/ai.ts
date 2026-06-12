/**
 * AI generatyvinio dashboard'o tipai (Iter 17, eksperimentinis).
 *
 * Widget spec'as — deklaratyvus JSON, kurį generuoja LLM per `render_dashboard`
 * tool-call'ą, o frontend'as (`DashboardCanvas`) atvaizduoja. Server'is PRIVALO
 * validuoti spec'ą per `validateDashboardSpec` prieš siųsdamas į frontend'ą —
 * LLM output'as yra nepatikimas input'as.
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
  | 'table'
  | 'progress'
  | 'markdown';

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

export type AiWidget = {
  /** Unikalus id spec'o ribose — naudojamas React key + perėjimo animacijoms. */
  id: string;
  type: AiWidgetType;
  title?: string;
  /** Plotis 4 stulpelių tinklelyje (1–4). Default: stat=1, kiti=2. */
  span?: 1 | 2 | 3 | 4;

  // --- stat ---
  value?: string;
  subtitle?: string;
  trend?: AiStatTrend;

  // --- bar / line / area / pie ---
  /** pie atveju: [{ name, value }]. */
  data?: Array<Record<string, string | number | null>>;
  xKey?: string;
  series?: AiChartSeries[];
  stacked?: boolean;
  /** Y ašies / pie reikšmių formatas. */
  format?: AiValueFormat;

  // --- table ---
  columns?: AiTableColumn[];
  rows?: Array<Record<string, string | number | null>>;

  // --- progress ---
  items?: AiProgressItem[];

  // --- markdown (palaikom paprastą poaibį: ## antraštės, **bold**, - sąrašai) ---
  content?: string;
};

export type AiDashboardSpec = {
  title?: string;
  subtitle?: string;
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

// ---------- Validacija / sanitizacija ----------

export const AI_SPEC_LIMITS = {
  maxWidgets: 12,
  maxDataPoints: 200,
  maxRows: 100,
  maxColumns: 12,
  maxSeries: 8,
  maxItems: 30,
  maxStringLen: 4000,
  maxTitleLen: 200,
} as const;

const WIDGET_TYPES: ReadonlySet<string> = new Set([
  'stat',
  'bar',
  'line',
  'area',
  'pie',
  'table',
  'progress',
  'markdown',
]);
const FORMATS: ReadonlySet<string> = new Set(['eur', 'number', 'percent', 'text']);
const ALIGNS: ReadonlySet<string> = new Set(['left', 'right', 'center']);
const TREND_DIRECTIONS: ReadonlySet<string> = new Set(['up', 'down', 'flat']);

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

  switch (out.type) {
    case 'stat': {
      const value = clampStr(w.value, AI_SPEC_LIMITS.maxTitleLen);
      if (value === undefined) {
        // Toleruojam skaičių — konvertuojam į string.
        if (isFiniteNumber(w.value)) out.value = String(w.value);
        else {
          errors.push(`widgets[${idx}] (stat): trūksta „value"`);
          return null;
        }
      } else {
        out.value = value;
      }
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
      break;
    }
    case 'bar':
    case 'line':
    case 'area': {
      if (!Array.isArray(w.data) || w.data.length === 0) {
        errors.push(`widgets[${idx}] (${out.type}): trūksta „data" masyvo`);
        return null;
      }
      const data = w.data
        .slice(0, AI_SPEC_LIMITS.maxDataPoints)
        .map((d) => sanitizeRecord(d, AI_SPEC_LIMITS.maxTitleLen))
        .filter((d): d is Record<string, string | number | null> => d !== undefined);
      if (data.length === 0) {
        errors.push(`widgets[${idx}] (${out.type}): „data" be tinkamų objektų`);
        return null;
      }
      out.data = data;
      const xKey = clampStr(w.xKey, 100);
      if (!xKey) {
        errors.push(`widgets[${idx}] (${out.type}): trūksta „xKey"`);
        return null;
      }
      out.xKey = xKey;
      if (!Array.isArray(w.series) || w.series.length === 0) {
        errors.push(`widgets[${idx}] (${out.type}): trūksta „series" masyvo`);
        return null;
      }
      const series: AiChartSeries[] = [];
      for (const s of w.series.slice(0, AI_SPEC_LIMITS.maxSeries)) {
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
      if (series.length === 0) {
        errors.push(`widgets[${idx}] (${out.type}): „series" be tinkamų įrašų`);
        return null;
      }
      out.series = series;
      if (typeof w.stacked === 'boolean') out.stacked = w.stacked;
      break;
    }
    case 'pie': {
      if (!Array.isArray(w.data) || w.data.length === 0) {
        errors.push(`widgets[${idx}] (pie): trūksta „data" masyvo`);
        return null;
      }
      const data: Array<Record<string, string | number | null>> = [];
      for (const d of w.data.slice(0, 24)) {
        const rec = sanitizeRecord(d, AI_SPEC_LIMITS.maxTitleLen);
        if (!rec) continue;
        const name = rec.name;
        const value = rec.value;
        if (typeof name === 'string' && isFiniteNumber(value) && value >= 0) {
          data.push({ name, value });
        }
      }
      if (data.length === 0) {
        errors.push(`widgets[${idx}] (pie): „data" turi būti [{name, value>=0}] formos`);
        return null;
      }
      out.data = data;
      break;
    }
    case 'table': {
      if (!Array.isArray(w.columns) || w.columns.length === 0) {
        errors.push(`widgets[${idx}] (table): trūksta „columns"`);
        return null;
      }
      const columns: AiTableColumn[] = [];
      for (const c of w.columns.slice(0, AI_SPEC_LIMITS.maxColumns)) {
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
      if (columns.length === 0) {
        errors.push(`widgets[${idx}] (table): „columns" be tinkamų įrašų`);
        return null;
      }
      out.columns = columns;
      if (!Array.isArray(w.rows)) {
        errors.push(`widgets[${idx}] (table): trūksta „rows"`);
        return null;
      }
      out.rows = w.rows
        .slice(0, AI_SPEC_LIMITS.maxRows)
        .map((r) => sanitizeRecord(r, AI_SPEC_LIMITS.maxTitleLen))
        .filter((r): r is Record<string, string | number | null> => r !== undefined);
      break;
    }
    case 'progress': {
      if (!Array.isArray(w.items) || w.items.length === 0) {
        errors.push(`widgets[${idx}] (progress): trūksta „items"`);
        return null;
      }
      const items: AiProgressItem[] = [];
      for (const it of w.items.slice(0, AI_SPEC_LIMITS.maxItems)) {
        if (typeof it !== 'object' || it === null) continue;
        const ir = it as Record<string, unknown>;
        const label = clampStr(ir.label, AI_SPEC_LIMITS.maxTitleLen);
        if (!label || !isFiniteNumber(ir.value) || !isFiniteNumber(ir.max) || ir.max <= 0) continue;
        const item: AiProgressItem = { label, value: ir.value, max: ir.max };
        if (typeof ir.format === 'string' && FORMATS.has(ir.format))
          item.format = ir.format as AiValueFormat;
        items.push(item);
      }
      if (items.length === 0) {
        errors.push(`widgets[${idx}] (progress): „items" turi būti [{label, value, max>0}] formos`);
        return null;
      }
      out.items = items;
      break;
    }
    case 'markdown': {
      const content = clampStr(w.content, AI_SPEC_LIMITS.maxStringLen);
      if (!content) {
        errors.push(`widgets[${idx}] (markdown): trūksta „content"`);
        return null;
      }
      out.content = content;
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
  return { ok: true, spec, errors };
}
