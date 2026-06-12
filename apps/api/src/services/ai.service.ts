/**
 * AI generatyvinio dashboard'o servisas (Iter 17, eksperimentinis).
 *
 * Du endpoint'ai:
 *  - `ai.dashboard` (GET /ai/dashboard) — deterministinis pradinis spec'as,
 *    sugeneruotas iš realių dashboard.get + dashboard.fvmSummary duomenų
 *    (be LLM — greitas pirmas atvaizdavimas).
 *  - `ai.chat` (POST /ai/chat) — SSE stream'as: LLM tool-loop'as, kuris
 *    renka duomenis per vidinius action'us ir perpiešia dashboard'ą per
 *    `render_dashboard` tool-call'ą.
 *
 * LLM: OpenAI-compatible endpoint'as (vLLM / qwen3.6), konfigūruojamas per env:
 *  - LLM_BASE_URL    (pvz. http://192.168.50.55:8000/v1) — be jo /ai/chat grąžina 503
 *  - LLM_MODEL       (default 'qwen3.6')
 *  - LLM_AUTH_HEADER (optional — pilna Authorization header reikšmė)
 *
 * SAUGUMAS (ADR-005): visi duomenų tool'ai vykdomi per `ctx.call` — meta.user
 * propaguojasi, tad tenant scope + DU filtrai taikomi lygiai taip pat, kaip
 * tiesioginiams API kvietimams. AI sluoksnis NIEKADA nekviečia DB tiesiogiai
 * ir neturi payroll tool'ų.
 *
 * Broker `requestTimeout` (10s) neblokuoja ilgo LLM ciklo: handler'is grąžina
 * PassThrough stream'ą iškart, o darbas tęsiasi asinchroniškai rašant SSE
 * event'us į stream'ą.
 */
import { PassThrough } from 'stream';
import type { Context, LoggerInstance, ServiceSchema } from 'moleculer';
import { Errors } from 'moleculer';
import type {
  AiChatEvent,
  AiChatMessage,
  AiDashboardResponse,
  AiDashboardSpec,
  AiWidget,
  AuthUser,
  BudgetExecutionReport,
  DashboardData,
  Expense,
  FvmSummaryResponse,
  Project,
  ProjectSummary,
} from '@biip-finansai/shared';
import { AI_SPEC_LIMITS, validateDashboardSpec } from '@biip-finansai/shared';
import type { AuthMeta } from './auth.service';

// ---------- Konfigūracija ----------

const LLM_MODEL_DEFAULT = 'qwen3.6';
const MAX_LLM_STEPS = 8;
const MAX_RENDER_ATTEMPTS = 3;
/** Kiek kartų perbandyti, kai modelis grąžina tuščią atsakymą be tool call'ų. */
const MAX_EMPTY_RETRIES = 2;
const LLM_CALL_TIMEOUT_MS = 120_000;
const CHAT_DEADLINE_MS = 300_000;
/** Vidinių duomenų action'ų timeout (per broker.call — žr. callAction). */
const TOOL_CALL_TIMEOUT_MS = 30_000;
/** Max lygiagrečių chat stream'ų vienam vartotojui (GPU apsauga). */
const MAX_CONCURRENT_CHATS_PER_USER = 2;
const MAX_TOOL_RESULT_CHARS = 14_000;
const MAX_HISTORY_MESSAGES = 24;
const MAX_USER_MESSAGE_CHARS = 4_000;

type LlmConfig = { baseUrl: string; model: string; authHeader?: string };

function llmConfig(): LlmConfig | null {
  const baseUrl = process.env.LLM_BASE_URL?.replace(/\/+$/, '');
  if (!baseUrl) return null;
  return {
    baseUrl,
    model: process.env.LLM_MODEL || LLM_MODEL_DEFAULT,
    authHeader: process.env.LLM_AUTH_HEADER || undefined,
  };
}

// ---------- OpenAI-compatible API tipai (minimalus poaibis) ----------

type LlmToolCall = {
  id: string;
  type: 'function';
  function: { name: string; arguments: string };
};

type LlmAssistantMessage = {
  role: 'assistant';
  content: string | null;
  tool_calls?: LlmToolCall[];
  /** vLLM reasoning parser output — perduodam atgal multi-step'e, FE nerodom. */
  reasoning_content?: string | null;
};

type LlmMessage =
  | { role: 'system' | 'user'; content: string }
  | LlmAssistantMessage
  | { role: 'tool'; tool_call_id: string; content: string };

type LlmChoice = { message: LlmAssistantMessage; finish_reason: string };

// ---------- Tool definicijos ----------

const SPEC_TOOL_NAME = 'render_dashboard';

const LLM_TOOLS = [
  {
    type: 'function',
    function: {
      name: 'fvm_suvestine',
      description:
        'FVM biudžeto suvestinė metams: planuota/faktinė/likutis/% panaudojimas, top įspėjimai (eilutės arti limito), artėjantys projektų terminai, projektų ir šaltinių skaičiai.',
      parameters: {
        type: 'object',
        properties: { year: { type: 'integer', description: 'Metai, pvz. 2026' } },
        required: ['year'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'bendra_statistika',
      description:
        'Finansavimo prašymų statistika: kiekiai ir sumos pagal statusą, 12 mėn. pateikimų/patvirtinimų trendas, pjūviai pagal lėšų ir biudžeto kategorijas, (tvirtintojams) suvestinė pagal organizacijas.',
      parameters: { type: 'object', properties: {} },
    },
  },
  {
    type: 'function',
    function: {
      name: 'biudzeto_vykdymas',
      description:
        'Detali biudžeto vykdymo ataskaita metams: finansavimo šaltiniai ir jų biudžeto eilutės su planuota/faktine/likučiu/% kiekvienai.',
      parameters: {
        type: 'object',
        properties: { year: { type: 'integer' } },
        required: ['year'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'projektai',
      description:
        'Projektų sąrašas: id, pavadinimas, tipas, statusas, biudžetas, organizacija, terminai. Galima filtruoti pagal metus ir statusą.',
      parameters: {
        type: 'object',
        properties: {
          year: { type: 'integer' },
          status: {
            type: 'string',
            enum: ['planuojama', 'vykdoma', 'baigta', 'uzdaryta'],
          },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'projekto_suvestine',
      description:
        'Vieno projekto finansinė suvestinė: planuota, faktinė, likutis, % panaudojimas.',
      parameters: {
        type: 'object',
        properties: {
          id: { type: 'integer', description: 'Projekto id (iš projektai tool rezultato)' },
        },
        required: ['id'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'islaidos',
      description:
        'Faktinių išlaidų agregatai: suma pagal mėnesį, pagal tipą, bendra suma ir įrašų skaičius. Galima filtruoti pagal metus ir projektą.',
      parameters: {
        type: 'object',
        properties: {
          year: { type: 'integer' },
          projectId: { type: 'integer' },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: SPEC_TOOL_NAME,
      description:
        'Perpiešia dashboardą. Pateik PILNĄ naują vaizdą — jis PAKEIČIA dabartinį. Naudok realius skaičius iš duomenų tool rezultatų.',
      parameters: {
        type: 'object',
        properties: {
          title: { type: 'string' },
          subtitle: { type: 'string' },
          widgets: {
            type: 'array',
            maxItems: AI_SPEC_LIMITS.maxWidgets,
            items: {
              type: 'object',
              properties: {
                id: { type: 'string' },
                type: {
                  type: 'string',
                  enum: ['stat', 'bar', 'line', 'area', 'pie', 'table', 'progress', 'markdown'],
                },
                title: { type: 'string' },
                span: { type: 'integer', minimum: 1, maximum: 4 },
                value: { type: 'string' },
                subtitle: { type: 'string' },
                trend: {
                  type: 'object',
                  properties: {
                    direction: { type: 'string', enum: ['up', 'down', 'flat'] },
                    text: { type: 'string' },
                    positive: { type: 'boolean' },
                  },
                },
                data: { type: 'array', items: { type: 'object' } },
                xKey: { type: 'string' },
                series: {
                  type: 'array',
                  items: {
                    type: 'object',
                    properties: {
                      key: { type: 'string' },
                      label: { type: 'string' },
                      color: { type: 'string' },
                    },
                    required: ['key'],
                  },
                },
                stacked: { type: 'boolean' },
                format: { type: 'string', enum: ['eur', 'number', 'percent', 'text'] },
                columns: { type: 'array', items: { type: 'object' } },
                rows: { type: 'array', items: { type: 'object' } },
                items: { type: 'array', items: { type: 'object' } },
                content: { type: 'string' },
              },
              required: ['id', 'type'],
            },
          },
        },
        required: ['widgets'],
      },
    },
  },
] as const;

const TOOL_STATUS_LABELS: Record<string, string> = {
  fvm_suvestine: 'Renkama FVM biudžeto suvestinė…',
  bendra_statistika: 'Renkama prašymų statistika…',
  biudzeto_vykdymas: 'Renkami biudžeto vykdymo duomenys…',
  projektai: 'Renkamas projektų sąrašas…',
  projekto_suvestine: 'Renkama projekto suvestinė…',
  islaidos: 'Agreguojamos išlaidos…',
  [SPEC_TOOL_NAME]: 'Piešiamas naujas vaizdas…',
};

// ---------- Pagalbinės ----------

function requireMe(ctx: Context<unknown, AuthMeta>): AuthUser {
  if (!ctx.meta.user) {
    throw new Errors.MoleculerClientError('Neautentifikuota', 401, 'AUTH_REQUIRED');
  }
  return ctx.meta.user;
}

function fmtEurStat(amount: string | number): string {
  const n = typeof amount === 'number' ? amount : Number(amount);
  if (!Number.isFinite(n)) return String(amount);
  return `${n.toLocaleString('lt-LT', { maximumFractionDigits: 0 })} €`;
}

function toNum(amount: string | number | null | undefined): number {
  const n = typeof amount === 'number' ? amount : Number(amount ?? 0);
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : 0;
}

/** JSON stringify su dydžio lubomis — kad tool result'ai nesprogdintų konteksto. */
function compactJson(value: unknown, maxChars = MAX_TOOL_RESULT_CHARS): string {
  const s = JSON.stringify(value);
  if (s.length <= maxChars) return s;
  return `${s.slice(0, maxChars)} …[apkarpyta dėl dydžio]`;
}

function sseWrite(stream: PassThrough, event: AiChatEvent): void {
  if (stream.destroyed || stream.writableEnded) return;
  stream.write(`data: ${JSON.stringify(event)}\n\n`);
}

function toSpecOrNull(raw: unknown): AiDashboardSpec | null {
  const result = validateDashboardSpec(raw);
  return result.ok ? result.spec : null;
}

/**
 * Gelbėjimas: modelis kartais (ignoruodamas instrukcijas) įdeda widget spec'ą
 * į atsakymo TEKSTĄ (\`\`\`json blokas arba plikas JSON) vietoj render_dashboard
 * tool call'o. Ištraukiam spec'ą iš teksto — jei validus, perpiešiam vaizdą,
 * o tekste paliekam tik žmogišką dalį.
 */
function tryRescueSpecFromText(
  text: string,
): { spec: AiDashboardSpec; cleanedText: string } | null {
  if (!text.includes('"widgets"')) return null;

  const candidates: Array<{ raw: string; whole: string }> = [];
  const fenceRe = /```(?:json)?\s*([\s\S]*?)```/gi;
  let m: RegExpExecArray | null;
  while ((m = fenceRe.exec(text)) !== null) {
    candidates.push({ raw: m[1] ?? '', whole: m[0] });
  }
  // Be fence'ų — bandome nuo pirmo '{' iki paskutinio '}'.
  if (candidates.length === 0) {
    const start = text.indexOf('{');
    const end = text.lastIndexOf('}');
    if (start !== -1 && end > start) {
      const raw = text.slice(start, end + 1);
      candidates.push({ raw, whole: raw });
    }
  }

  for (const c of candidates) {
    if (!c.raw.includes('"widgets"')) continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(c.raw.trim());
    } catch {
      continue;
    }
    const result = validateDashboardSpec(parsed);
    if (!result.ok) continue;
    return { spec: result.spec, cleanedText: text.replace(c.whole, '').trim() };
  }
  return null;
}

/** Tolerantiška sveiko skaičiaus koercija — LLM dažnai siunčia "2026" kaip string. */
function toInt(value: unknown): number | undefined {
  const n = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : NaN;
  return Number.isFinite(n) ? Math.round(n) : undefined;
}

/**
 * KRITINIS: vidiniai duomenų action'ai kviečiami per `broker.call` su nauju
 * root kontekstu, o NE per `ctx.call`. Originalus request ctx paveldi
 * Moleculer distributed timeout (requestTimeout=10s nuo request pradžios) —
 * ilgame LLM cikle visi `ctx.call` po 10s mirtų su RequestSkippedError.
 * `meta` perduodam eksplicitiškai, tad ADR-005 tenant scope + DU filtrai
 * galioja identiškai (servisai skaito ctx.meta.user).
 */
function callAction<TResult, TParams>(
  ctx: Context<ChatParams, AuthMeta>,
  action: string,
  params: TParams,
): Promise<TResult> {
  return ctx.broker.call<TResult, TParams>(action, params, {
    meta: { ...ctx.meta },
    timeout: TOOL_CALL_TIMEOUT_MS,
  });
}

// ---------- System prompt ----------

const WIDGET_DOCS = `Widget tipai (visi turi privalomus "id" (unikalus, stabilus — jei widgetas lieka po perpiešimo, išlaikyk tą patį id) ir "type"; "title" — LT antraštė; "span" — plotis 1–4 stulpelių tinklelyje):
- stat: { value: "1 234 567 €" (jau suformatuotas string), subtitle?, trend?: {direction: up|down|flat, text, positive?: bool} }. span default 1.
- bar | line | area: { data: [{<xKey>: "2026-01", <serijos raktas>: 12345}, ...], xKey, series: [{key, label?, color?: "#hex"}], stacked?, format?: eur|number|percent }. Mėnesius duok "YYYY-MM" formatu — UI pats suformatuoja. Skaičiai — gryni number (ne string).
- pie: { data: [{name: "Kategorija", value: 12345}, ...], format? }. Max ~8 gabalai — smulkius sujunk į "Kita".
- table: { columns: [{key, label, format?: eur|number|percent|text, align?: left|right|center}], rows: [{<key>: reikšmė}] }. Max ~15 eilučių.
- progress: { items: [{label, value, max, format?}] } — panaudojimo juostos (pvz. biudžeto eilučių naudojimas; value=faktinė, max=planuota).
- markdown: { content } — trumpos tekstinės įžvalgos (## antraštės, **bold**, - sąrašai).

Spalvų paletė (naudok šitas): #0f766e (pagrindinė teal), #15803d (žalia/teigiama), #b45309 (gintarinė/įspėjimas), #be123c (raudona/viršyta), #0369a1 (mėlyna), #7c3aed (violetinė), #475569 (pilka).`;

function buildSystemPrompt(
  me: AuthUser,
  year: number,
  currentSpec: AiDashboardSpec | null,
): string {
  const roleDesc = me.tenantIsApprover
    ? me.role === 'admin'
      ? 'AM administratorius (mato visų organizacijų duomenis)'
      : 'AM specialistas (mato priskirtų organizacijų duomenis)'
    : me.role === 'admin'
      ? `organizacijos „${me.tenantName}" administratorius`
      : `organizacijos „${me.tenantName}" specialistas`;

  // Spec'as į prompt'ą: pilnas JSON jei telpa; kitaip — santrauka (id/type/title),
  // kad netrunkuotume JSON'o per vidurį (modelis negalėtų atkurti widget'ų).
  let specJson = 'null (dar nenupieštas)';
  if (currentSpec) {
    const full = JSON.stringify(currentSpec);
    specJson =
      full.length <= 6000
        ? full
        : JSON.stringify({
            title: currentSpec.title,
            _pastaba:
              'Pilnas spec per didelis — čia tik widgetų sąrašas. Duomenis perkrauk per duomenų tools.',
            widgets: currentSpec.widgets.map((w) => ({ id: w.id, type: w.type, title: w.title })),
          });
  }

  return `Tu esi BIIP „Finansai" sistemos (Aplinkos ministerijos finansavimo prašymų ir finansų valdymo platforma) AI asistentas, valdantis generatyvinį dashboardą.

Šiandien: ${new Date().toISOString().slice(0, 10)}. Numatytieji metai: ${year}.
Vartotojas: ${me.fullName}, ${roleDesc}.

KAIP DIRBI:
1. Vartotojas lietuviškai prašo pakeisti vaizdą arba užduoda klausimą apie finansus.
2. Duomenis imk TIK iš duomenų tool rezultatų — NIEKADA neišgalvok skaičių. Jei tool grąžina klaidą ar tuščius duomenis — pasakyk tai atvirai.
3. Kai vartotojas prašo pakeisti/parodyti vaizdą — kviesk ${SPEC_TOOL_NAME} su PILNU nauju spec (jis pakeičia visą dashboardą). Jei prašoma tik papildyti — perduok ir esamus widgetus (su tais pačiais id) + naujus.
4. Jei klausimas atsakomas trumpai ir vaizdo keisti neprašoma — atsakyk vien tekstu, be perpiešimo.
5. Po sėkmingo ${SPEC_TOOL_NAME} atsakyk trumpai (1–2 sakiniai) lietuviškai, ką pakeitei.
6. KRITIŠKAI SVARBU: widget JSON NIEKADA nerašomas į atsakymo TEKSTĄ — jokių \`\`\`json blokų, jokio spec'o pokalbyje. Vaizdas keičiamas TIK per ${SPEC_TOOL_NAME} tool call. Jei pastebi, kad ruošiesi rašyti JSON tekste — sustok ir kviesk ${SPEC_TOOL_NAME}.

DABARTINIS DASHBOARD SPEC:
${specJson}

${WIDGET_DOCS}

GEROS PRAKTIKOS:
- Pirmoje eilėje 3–4 stat kortelės (span 1), žemiau span 2 grafikai/lentelės. Iš viso 4–8 widgetai.
- Pinigus stat kortelėse formatuok "1 234 567 €" (tarpai tūkstančiams). Grafikuose/lentelėse — gryni skaičiai + format: "eur".
- Visos etiketės lietuviškai.
- Jei duomenų mažai — geriau mažiau, bet prasmingų widgetų.`;
}

// ---------- LLM kvietimas ----------

async function callLlm(cfg: LlmConfig, messages: LlmMessage[]): Promise<LlmAssistantMessage> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (cfg.authHeader) headers.Authorization = cfg.authHeader;

  const res = await fetch(`${cfg.baseUrl}/chat/completions`, {
    method: 'POST',
    headers,
    signal: AbortSignal.timeout(LLM_CALL_TIMEOUT_MS),
    body: JSON.stringify({
      model: cfg.model,
      messages,
      tools: LLM_TOOLS,
      tool_choice: 'auto',
      temperature: 0.6,
      max_tokens: 8000,
    }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`LLM atsakė ${res.status}: ${body.slice(0, 300)}`);
  }
  const data = (await res.json()) as { choices?: LlmChoice[] };
  const message = data.choices?.[0]?.message;
  if (!message) {
    throw new Error('LLM atsakymas be choices[0].message');
  }
  return message;
}

// ---------- Duomenų tool'ai ----------

/** Išlaidų agregacija LLM'ui — niekada negrąžinam raw eilučių (dydis + privatumas). */
function aggregateExpenses(expenses: Expense[]): {
  visoEur: number;
  irasuSkaicius: number;
  pagalMenesi: Array<{ menuo: string; suma: number }>;
  pagalTipa: Array<{ tipas: string; suma: number; kiekis: number }>;
} {
  const byMonth = new Map<string, number>();
  const byType = new Map<string, { suma: number; kiekis: number }>();
  let total = 0;
  for (const e of expenses) {
    const suma = toNum(e.suma);
    total += suma;
    const month = typeof e.data === 'string' ? e.data.slice(0, 7) : 'nežinoma';
    byMonth.set(month, (byMonth.get(month) ?? 0) + suma);
    const t = byType.get(e.tipas) ?? { suma: 0, kiekis: 0 };
    t.suma += suma;
    t.kiekis += 1;
    byType.set(e.tipas, t);
  }
  return {
    visoEur: Math.round(total * 100) / 100,
    irasuSkaicius: expenses.length,
    pagalMenesi: [...byMonth.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([menuo, suma]) => ({ menuo, suma: Math.round(suma * 100) / 100 })),
    pagalTipa: [...byType.entries()].map(([tipas, v]) => ({
      tipas,
      suma: Math.round(v.suma * 100) / 100,
      kiekis: v.kiekis,
    })),
  };
}

/**
 * Duomenų tool vykdymas per `callAction` (broker.call su explicit meta) —
 * meta.user propaguojasi, todėl ADR-005 tenant scope + DU filtrai galioja
 * automatiškai. Klaidos grąžinamos kaip {error} tool result (ne throw) —
 * modelis gali prisitaikyti.
 */
async function executeDataTool(
  ctx: Context<ChatParams, AuthMeta>,
  logger: LoggerInstance,
  name: string,
  args: Record<string, unknown>,
  defaultYear: number,
): Promise<string> {
  const year = toInt(args.year) ?? defaultYear;
  try {
    switch (name) {
      case 'fvm_suvestine': {
        const r = await callAction<FvmSummaryResponse, { year: number }>(
          ctx,
          'dashboard.fvmSummary',
          { year },
        );
        return compactJson(r);
      }
      case 'bendra_statistika': {
        const r = await callAction<DashboardData, Record<string, never>>(ctx, 'dashboard.get', {});
        return compactJson({
          year: r.year,
          stats: r.stats,
          monthlyTrend: r.monthlyTrend,
          costCategories: r.costCategories,
          budgetCategoryStats: r.budgetCategoryStats,
          perTenantBreakdown: r.perTenantBreakdown ?? undefined,
        });
      }
      case 'biudzeto_vykdymas': {
        const r = await callAction<BudgetExecutionReport, { year: number; format: 'json' }>(
          ctx,
          'reports.budgetExecution',
          { year, format: 'json' },
        );
        return compactJson({
          year: r.year,
          totalPlanuota: r.totalPlanuota,
          totalFaktine: r.totalFaktine,
          totalLikutis: r.totalLikutis,
          saltiniuViso: r.bySource.length,
          bySource: r.bySource.slice(0, 20).map((s) => ({
            fundingSourceName: s.fundingSourceName,
            tipas: s.fundingSourceTypeName,
            planuota: s.planuota,
            faktine: s.faktine,
            likutis: s.likutis,
            percentUsed: s.percentUsed,
            eilutes: s.byCategory.slice(0, 40).map((c) => ({
              pavadinimas: c.allocationName,
              kategorija: c.categoryName,
              planuota: c.planuota,
              faktine: c.faktine,
              likutis: c.likutis,
              percentUsed: c.percentUsed,
              isWarning: c.isWarning,
              isOver: c.isOver,
            })),
          })),
        });
      }
      case 'projektai': {
        const params: { year?: number; status?: string } = {};
        if (args.year !== undefined) params.year = year;
        if (typeof args.status === 'string') params.status = args.status;
        const r = await callAction<Project[], typeof params>(ctx, 'projects.list', params);
        return compactJson({
          count: r.length,
          projektai: r.slice(0, 60).map((p) => ({
            id: p.id,
            pavadinimas: p.pavadinimas,
            tipas: p.tipas,
            statusas: p.statusas,
            biudzetas: p.biudzetas,
            organizacija: (p as Project & { tenantCode?: string }).tenantCode ?? null,
            pradzia: p.pradziosData,
            pabaiga: p.pabaigosData,
          })),
        });
      }
      case 'projekto_suvestine': {
        const id = toInt(args.id);
        if (id === undefined) return JSON.stringify({ error: 'Trūksta projekto id' });
        const r = await callAction<ProjectSummary, { id: number }>(ctx, 'projects.summary', {
          id,
        });
        return compactJson(r);
      }
      case 'islaidos': {
        const params: { year?: number; projectId?: number } = { year };
        const projectId = toInt(args.projectId);
        if (projectId !== undefined) params.projectId = projectId;
        const r = await callAction<Expense[], typeof params>(ctx, 'expenses.list', params);
        // `metai` įdedam, kad modelis matytų, kurių metų agregatas grąžintas
        // (year filtras taikomas visada — default einamieji metai).
        return compactJson({ metai: year, ...aggregateExpenses(r) });
      }
      default:
        return JSON.stringify({ error: `Nežinomas tool „${name}"` });
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.warn(`AI tool ${name} klaida:`, message);
    return JSON.stringify({ error: `Nepavyko gauti duomenų: ${message}` });
  }
}

// ---------- Chat ciklas ----------

type ChatParams = {
  messages: AiChatMessage[];
  spec?: AiDashboardSpec | null;
  year?: number;
};

/** Aktyvių chat stream'ų skaičius per user.id (in-memory, single-node API). */
const activeChats = new Map<number, number>();

async function runChatLoop(
  ctx: Context<ChatParams, AuthMeta>,
  logger: LoggerInstance,
  me: AuthUser,
  cfg: LlmConfig,
  stream: PassThrough,
): Promise<void> {
  const deadline = Date.now() + CHAT_DEADLINE_MS;
  let aborted = false;
  stream.on('close', () => {
    aborted = true;
  });

  const year = ctx.params.year ?? new Date().getFullYear();
  const currentSpec = ctx.params.spec ? toSpecOrNull(ctx.params.spec) : null;
  const history = (ctx.params.messages ?? []).slice(-MAX_HISTORY_MESSAGES);

  const llmMessages: LlmMessage[] = [
    { role: 'system', content: buildSystemPrompt(me, year, currentSpec) },
    ...history.map((m): LlmMessage => ({ role: m.role, content: m.content })),
  ];

  let renderAttempts = 0;
  let renderedThisTurn = false;
  let emptyRetries = 0;

  const deadlineReply = (): void => {
    sseWrite(stream, {
      type: 'reply',
      text: 'Užklausa truko per ilgai — pabandykite suformuluoti paprasčiau.',
    });
  };

  for (let step = 0; step < MAX_LLM_STEPS; step += 1) {
    if (aborted) return;
    if (Date.now() > deadline) {
      deadlineReply();
      return;
    }

    sseWrite(stream, { type: 'status', label: step === 0 ? 'Galvojama…' : 'Tęsiama…' });
    const assistant = await callLlm(cfg, llmMessages);
    if (aborted) return;

    const toolCalls = assistant.tool_calls ?? [];

    if (toolCalls.length === 0) {
      const text = (assistant.content ?? '').trim();
      if (!text) {
        // Tuščias atsakymas be tool call'ų — pasitaiko, kai reasoning suvalgo
        // max_tokens arba parser'is nesugavo tool call'o. Nepushinam tuščios
        // žinutės į istoriją — tiesiog perbandom (sampling duos kitą rezultatą).
        if (!renderedThisTurn && emptyRetries < MAX_EMPTY_RETRIES) {
          emptyRetries += 1;
          logger.warn(`AI: tuščias LLM atsakymas be tool call'ų — retry ${emptyRetries}`);
          continue;
        }
        sseWrite(stream, {
          type: 'reply',
          text: renderedThisTurn
            ? 'Atnaujinau vaizdą.'
            : 'Atsiprašau, nepavyko sugeneruoti atsakymo. Pabandykite dar kartą.',
        });
        return;
      }
      // Gelbėjimas: modelis spec'ą įrašė į tekstą vietoj tool call'o —
      // perpiešiam vaizdą patys ir tekste paliekam tik žmogišką dalį.
      const rescued = tryRescueSpecFromText(text);
      if (rescued) {
        logger.warn('AI: spec rastas atsakymo tekste (ne tool call) — išgelbėtas į dashboard');
        renderedThisTurn = true;
        sseWrite(stream, { type: 'spec', spec: rescued.spec });
        sseWrite(stream, {
          type: 'reply',
          text: rescued.cleanedText || 'Atnaujinau vaizdą pagal prašymą.',
        });
        return;
      }
      sseWrite(stream, { type: 'reply', text });
      return;
    }

    // Assistant žinutę (su reasoning_content, jei yra) grąžinam atgal —
    // qwen3.6 preserve_thinking template'ui to reikia multi-step cikle.
    llmMessages.push(assistant);

    for (const tc of toolCalls) {
      if (aborted) return;
      if (Date.now() > deadline) {
        deadlineReply();
        return;
      }
      const name = tc.function?.name ?? '';
      sseWrite(stream, {
        type: 'status',
        label: TOOL_STATUS_LABELS[name] ?? `Vykdoma: ${name}…`,
      });

      let args: Record<string, unknown> = {};
      try {
        args = tc.function.arguments
          ? (JSON.parse(tc.function.arguments) as Record<string, unknown>)
          : {};
      } catch {
        llmMessages.push({
          role: 'tool',
          tool_call_id: tc.id,
          content: JSON.stringify({ error: 'Nepavyko išparsinti tool argumentų (blogas JSON)' }),
        });
        continue;
      }

      if (name === SPEC_TOOL_NAME) {
        renderAttempts += 1;
        const result = validateDashboardSpec(args);
        if (result.ok) {
          renderedThisTurn = true;
          sseWrite(stream, { type: 'spec', spec: result.spec });
          llmMessages.push({
            role: 'tool',
            tool_call_id: tc.id,
            content: JSON.stringify({
              ok: true,
              // Salvage atveju modelis turi žinoti, kurie widget'ai atmesti —
              // kitaip atsakyme aprašys neegzistuojančius elementus.
              ...(result.errors.length > 0 ? { atmestiWidgetai: result.errors } : {}),
              pastaba:
                result.errors.length > 0
                  ? 'Dashboard atnaujintas, bet dalis widgetų atmesta (žr. atmestiWidgetai). Atsakyk vartotojui trumpai lietuviškai apie tai, kas RODOMA.'
                  : 'Dashboard atnaujintas. Atsakyk vartotojui trumpai lietuviškai (be tool call).',
            }),
          });
        } else if (renderAttempts >= MAX_RENDER_ATTEMPTS) {
          llmMessages.push({
            role: 'tool',
            tool_call_id: tc.id,
            content: JSON.stringify({
              ok: false,
              errors: result.errors,
              pastaba: 'Limitas pasiektas — NEBEKVIESK render_dashboard, atsakyk tekstu.',
            }),
          });
        } else {
          llmMessages.push({
            role: 'tool',
            tool_call_id: tc.id,
            content: JSON.stringify({
              ok: false,
              errors: result.errors,
              pastaba: 'Pataisyk spec ir bandyk dar kartą.',
            }),
          });
        }
        continue;
      }

      const toolResult = await executeDataTool(ctx, logger, name, args, year);
      llmMessages.push({ role: 'tool', tool_call_id: tc.id, content: toolResult });
    }
  }

  // Ciklas išseko be galutinio atsakymo.
  sseWrite(stream, {
    type: 'reply',
    text: renderedThisTurn
      ? 'Atnaujinau vaizdą pagal jūsų prašymą.'
      : 'Atsiprašau — nepavyko užbaigti užklausos. Pabandykite suformuluoti paprasčiau.',
  });
}

// ---------- Default spec generavimas ----------

function buildDefaultSpec(
  dash: DashboardData,
  fvm: FvmSummaryResponse | null,
  year: number,
): AiDashboardSpec {
  const widgets: AiWidget[] = [];

  // --- Stat eilutė ---
  if (fvm) {
    widgets.push(
      {
        id: 'stat-planuota',
        type: 'stat',
        title: `Biudžetas ${year}`,
        value: fmtEurStat(fvm.budgetTotals.planuota),
        subtitle: `${fvm.totalSourcesCount} šaltiniai, ${fvm.totalAllocationsCount} eilutės`,
        span: 1,
      },
      {
        id: 'stat-faktine',
        type: 'stat',
        title: 'Faktinės išlaidos',
        value: fmtEurStat(fvm.budgetTotals.faktine),
        subtitle: `${fvm.budgetTotals.percentUsed}% biudžeto`,
        trend: fvm.budgetTotals.isOver
          ? { direction: 'up', text: 'Viršytas planas', positive: false }
          : fvm.budgetTotals.isWarning
            ? { direction: 'up', text: 'Artėja prie limito', positive: false }
            : { direction: 'flat', text: 'Pagal planą', positive: true },
        span: 1,
      },
      {
        id: 'stat-likutis',
        type: 'stat',
        title: 'Likutis',
        value: fmtEurStat(fvm.budgetTotals.likutis),
        subtitle: `Aktyvūs projektai: ${fvm.activeProjectsCount}`,
        span: 1,
      },
    );
  }
  widgets.push({
    id: 'stat-prasymai',
    type: 'stat',
    title: `Prašymai ${dash.year}`,
    value: String(dash.stats.totalRequests),
    subtitle: `Pateikti: ${dash.stats.byStatus.SUBMITTED} · Patvirtinti: ${dash.stats.byStatus.APPROVED}`,
    span: 1,
  });

  // --- Mėnesinis trendas ---
  if (dash.monthlyTrend.length > 0) {
    widgets.push({
      id: 'chart-trend',
      type: 'bar',
      title: 'Prašymų srautas per 12 mėn.',
      span: 2,
      data: dash.monthlyTrend.map((m) => ({
        month: m.month,
        pateikta: m.submitted,
        patvirtinta: m.approved,
      })),
      xKey: 'month',
      series: [
        { key: 'pateikta', label: 'Pateikta', color: '#0f766e' },
        { key: 'patvirtinta', label: 'Patvirtinta', color: '#15803d' },
      ],
      format: 'number',
    });
  }

  // --- Lėšų kategorijos (pie) ---
  const categories = dash.costCategories
    .filter((c) => c.requested > 0)
    .sort((a, b) => b.requested - a.requested);
  if (categories.length > 0) {
    const top = categories.slice(0, 6);
    const restSum = categories.slice(6).reduce((acc, c) => acc + c.requested, 0);
    const data = top.map((c) => ({ name: c.label, value: toNum(c.requested) }));
    if (restSum > 0) data.push({ name: 'Kita', value: toNum(restSum) });
    widgets.push({
      id: 'chart-categories',
      type: 'pie',
      title: 'Prašyta pagal lėšų kategorijas',
      span: 2,
      data,
      format: 'eur',
    });
  }

  // --- Biudžeto eilučių panaudojimas (progress) ---
  if (fvm && fvm.topWarnings.length > 0) {
    widgets.push({
      id: 'progress-warnings',
      type: 'progress',
      title: 'Biudžeto eilutės arti limito',
      span: 2,
      items: fvm.topWarnings.slice(0, 6).map((w) => ({
        label: `${w.allocationName} (${w.fundingSourceName})`,
        value: toNum(w.faktine),
        max: Math.max(toNum(w.planuota), 0.01),
        format: 'eur' as const,
      })),
    });
  }

  // --- Organizacijų suvestinė (table, tik approver'iams) ---
  const breakdown = (dash.perTenantBreakdown ?? [])
    .filter((t) => t.total > 0)
    .sort((a, b) => b.totalRequested - a.totalRequested)
    .slice(0, 8);
  if (breakdown.length > 0) {
    widgets.push({
      id: 'table-tenants',
      type: 'table',
      title: 'Organizacijos pagal prašytą sumą',
      span: 2,
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
    });
  } else if (fvm && fvm.upcomingDeadlines.length > 0) {
    widgets.push({
      id: 'table-deadlines',
      type: 'table',
      title: 'Artėjantys terminai (30 d.)',
      span: 2,
      columns: [
        { key: 'pavadinimas', label: 'Projektas' },
        { key: 'data', label: 'Terminas', align: 'right' },
        { key: 'liko', label: 'Liko dienų', format: 'number', align: 'right' },
      ],
      rows: fvm.upcomingDeadlines.slice(0, 8).map((d) => ({
        pavadinimas: d.name,
        data: d.date,
        liko: d.daysUntil,
      })),
    });
  }

  return {
    title: 'Finansų apžvalga',
    subtitle: `Sugeneruota iš realių ${year} m. duomenų. Paprašykite asistento perpiešti vaizdą.`,
    widgets,
  };
}

// ---------- Servisas ----------

const AiService: ServiceSchema = {
  name: 'ai',

  actions: {
    /**
     * Deterministinis pradinis dashboardas — iš realių agregatų, be LLM.
     * Greitas (2 vidiniai call'ai), todėl tinka pirmam puslapio atvaizdavimui.
     */
    dashboard: {
      async handler(ctx: Context<unknown, AuthMeta>): Promise<AiDashboardResponse> {
        requireMe(ctx);
        const year = new Date().getFullYear();
        const [dash, fvm] = await Promise.all([
          ctx.call<DashboardData, Record<string, never>>('dashboard.get', {}),
          ctx
            .call<FvmSummaryResponse, { year: number }>('dashboard.fvmSummary', { year })
            .catch(() => null),
        ]);
        return {
          spec: buildDefaultSpec(dash, fvm, year),
          generatedAt: new Date().toISOString(),
        };
      },
    },

    /**
     * AI chat — SSE stream'as (text/event-stream).
     *
     * Handler'is grąžina stream'ą IŠKART (apeina broker requestTimeout),
     * o LLM tool ciklas vyksta asinchroniškai.
     */
    chat: {
      params: {
        messages: {
          type: 'array',
          max: MAX_HISTORY_MESSAGES * 2,
          items: {
            type: 'object',
            props: {
              role: { type: 'enum', values: ['user', 'assistant'] },
              content: { type: 'string', max: MAX_USER_MESSAGE_CHARS },
            },
          },
        },
        spec: { type: 'object', optional: true },
        year: {
          type: 'number',
          integer: true,
          optional: true,
          convert: true,
          min: 2000,
          max: 3000,
        },
      },
      handler(
        ctx: Context<
          ChatParams,
          AuthMeta & { $responseType?: string; $responseHeaders?: Record<string, string> }
        >,
      ): PassThrough {
        const me = requireMe(ctx);
        const cfg = llmConfig();
        if (!cfg) {
          throw new Errors.MoleculerClientError(
            'AI asistentas nesukonfigūruotas (trūksta LLM_BASE_URL)',
            503,
            'AI_NOT_CONFIGURED',
          );
        }

        // Per-user concurrency guard — vienas vartotojas negali užtvindyti GPU
        // lygiagrečiais stream'ais (FE busy flag'as apeinamas tiesiogine užklausa).
        const inFlight = activeChats.get(me.id) ?? 0;
        if (inFlight >= MAX_CONCURRENT_CHATS_PER_USER) {
          throw new Errors.MoleculerClientError(
            'Per daug lygiagrečių AI užklausų — palaukite, kol baigsis ankstesnė.',
            429,
            'AI_TOO_MANY_STREAMS',
          );
        }
        activeChats.set(me.id, inFlight + 1);

        const stream = new PassThrough();
        ctx.meta.$responseType = 'text/event-stream; charset=utf-8';
        ctx.meta.$responseHeaders = {
          'Cache-Control': 'no-cache, no-transform',
          Connection: 'keep-alive',
          'X-Accel-Buffering': 'no',
        };

        const logger = ctx.broker.logger;
        // Async darbas po return — klaidos tik į stream'ą, ne į HTTP statusą.
        void runChatLoop(ctx, logger, me, cfg, stream)
          .catch((err: unknown) => {
            logger.error('AI chat ciklo klaida:', err);
            sseWrite(stream, {
              type: 'error',
              message: 'Nepavyko susisiekti su AI modeliu. Bandykite dar kartą.',
            });
          })
          .finally(() => {
            const current = activeChats.get(me.id) ?? 1;
            if (current <= 1) activeChats.delete(me.id);
            else activeChats.set(me.id, current - 1);
            sseWrite(stream, { type: 'done' });
            stream.end();
          });

        return stream;
      },
    },
  },
};

export default AiService;
