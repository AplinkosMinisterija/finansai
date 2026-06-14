/**
 * AI generatyvinio dashboard'o servisas (Iter 17–18, eksperimentinis).
 *
 * Endpoint'ai:
 *  - `ai.dashboard` (GET /ai/dashboard) — default layout (dataRef'ai) + iškart
 *    hidruoti duomenys. Greitas pirmas atvaizdavimas be LLM.
 *  - `ai.hydrate` (POST /ai/hydrate) — užpildo išsaugoto spec'o dataRef'us
 *    ŠVIEŽIAIS DB duomenimis (taip grafikai neužšąla po savaitės).
 *  - `ai.chat` (POST /ai/chat) — SSE stream'as: LLM tool-loop'as. Modelis renka
 *    duomenis per `query_data` (katalogo šaltiniai) ir perpiešia per
 *    `render_dashboard` (widget'ai su dataRef). Spec'as hidruojamas prieš emit.
 *
 * LLM: OpenAI-compatible endpoint'as (vLLM / qwen3.6), env:
 *  - LLM_BASE_URL    — be jo /ai/chat grąžina 503 (dashboard/hydrate veikia)
 *  - LLM_MODEL       (default 'qwen3.6')
 *  - LLM_AUTH_HEADER (optional — pilna Authorization header reikšmė)
 *
 * SAUGUMAS (ADR-005): duomenys imami TIK per katalogo šaltinius (žr.
 * `ai/catalog.ts`), kurie kviečia esamus action'us su vartotojo meta — tenant
 * scope + DU filtrai galioja. Jokio payroll, jokio tiesioginio DB.
 */
import { PassThrough } from 'stream';
import type { Context, LoggerInstance, ServiceSchema } from 'moleculer';
import { Errors } from 'moleculer';
import type {
  AiChatEvent,
  AiChatMessage,
  AiDashboardResponse,
  AiDashboardSpec,
  AiHydrateResponse,
  AiWidget,
  AuthUser,
} from '@biip-finansai/shared';
import { AI_SPEC_LIMITS, validateDashboardSpec } from '@biip-finansai/shared';
import type { AuthMeta } from './auth.service';
import { canAccessTenant } from '../utils/permissions';
import { buildCatalogPromptDoc, hydrateSpec, listSourceIds, runSourceForTool } from './ai/catalog';

// ---------- Konfigūracija ----------

const LLM_MODEL_DEFAULT = 'qwen3.6';
const MAX_LLM_STEPS = 8;
const MAX_RENDER_ATTEMPTS = 3;
const MAX_EMPTY_RETRIES = 2;
const LLM_CALL_TIMEOUT_MS = 120_000;
const CHAT_DEADLINE_MS = 300_000;
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
  reasoning_content?: string | null;
};

type LlmMessage =
  | { role: 'system' | 'user'; content: string }
  | LlmAssistantMessage
  | { role: 'tool'; tool_call_id: string; content: string };

type LlmChoice = { message: LlmAssistantMessage; finish_reason: string };

// ---------- Tool definicijos ----------

const SPEC_TOOL_NAME = 'render_dashboard';
const QUERY_TOOL_NAME = 'query_data';

const LLM_TOOLS = [
  {
    type: 'function',
    function: {
      name: QUERY_TOOL_NAME,
      description:
        'Gauk realius finansų duomenis iš katalogo šaltinio (kad matytum skaičius prieš piešdamas). Grąžina suvestinę su tikrais skaičiais. Šaltinių sąrašas — sistemos žinutėje.',
      parameters: {
        type: 'object',
        properties: {
          source: { type: 'string', enum: listSourceIds(), description: 'Katalogo šaltinio id' },
          params: { type: 'object', description: 'Šaltinio parametrai, pvz. {"year":2026}' },
        },
        required: ['source'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: SPEC_TOOL_NAME,
      description:
        'Atnaujina dashboardą. PAGAL NUTYLĖJIMĄ (mode="add") pateik TIK naujus ar keičiamus widgetus — jie PRIDEDAMI prie esamų (esami NEDINGSTA). Esamą widgetą keisk naudodamas TĄ PATĮ id. Visą vaizdą pakeisk (mode="replace") TIK kai vartotojas aiškiai prašo pradėti iš naujo arba palikti tik tai, ko prašo. Konkrečią esamą kortelę pašalink per removeWidgetIds. PIRMENYBĖ: kiekvienam widget naudok "dataRef":{"source","params"} — serveris užpildys šviežius duomenis (jie neužšals). Literalius data laukus naudok tik pjūviams be katalogo šaltinio.',
      parameters: {
        type: 'object',
        properties: {
          title: { type: 'string' },
          subtitle: { type: 'string' },
          mode: {
            type: 'string',
            enum: ['add', 'replace'],
            description:
              'add (NUTYLĖTAS) — pateikti widgetai pridedami prie esamų (tas pats id perrašo esamą). replace — pateiktas vaizdas PILNAI pakeičia esamą. Naudok replace tik kai vartotojas aiškiai prašo „rodyk tik…", „pradėk iš naujo", „ištrink viską ir palik tik…".',
          },
          removeWidgetIds: {
            type: 'array',
            items: { type: 'string' },
            description:
              'add režime: esamų widgetų id, kuriuos pašalinti (kai vartotojas prašo ištrinti konkrečią kortelę). Likę esami widgetai išsaugomi.',
          },
          year: {
            type: 'integer',
            description:
              'Globalūs metai visam vaizdui — serveris pritaiko VISIEMS widget dataRef. Naudok šitą, kai vartotojas keičia metus (pvz. „rodyk 2025").',
          },
          institution: {
            type: 'string',
            description:
              'Institucijos (organizacijos) pjūvis VISAM vaizdui — kodas arba pavadinimas iš sąrašo sistemos žinutėje (pvz. „AAD"). Serveris apriboja VISŲ widget\'ų duomenis šia institucija. „visos"/„all" = panaikinti pjūvį. Naudok, kai vartotojas prašo „rodyk tik <institucija>" arba „<institucijos> pjūvis".',
          },
          tenantId: {
            type: 'integer',
            description:
              'Alternatyva institution — institucijos id (number) iš sąrašo. Pakanka vieno iš institution/tenantId.',
          },
          widgets: {
            type: 'array',
            maxItems: AI_SPEC_LIMITS.maxWidgets,
            items: {
              type: 'object',
              properties: {
                id: { type: 'string' },
                type: {
                  type: 'string',
                  enum: [
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
                  ],
                },
                title: { type: 'string' },
                span: { type: 'integer', minimum: 1, maximum: 4 },
                dataRef: {
                  type: 'object',
                  properties: {
                    source: { type: 'string', enum: listSourceIds() },
                    params: { type: 'object' },
                  },
                  required: ['source'],
                },
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
                series: { type: 'array', items: { type: 'object' } },
                stacked: { type: 'boolean' },
                format: { type: 'string', enum: ['eur', 'number', 'percent', 'text'] },
                columns: { type: 'array', items: { type: 'object' } },
                rows: { type: 'array', items: { type: 'object' } },
                items: { type: 'array', items: { type: 'object' } },
                content: { type: 'string' },
                nodes: { type: 'array', items: { type: 'object' } },
                links: { type: 'array', items: { type: 'object' } },
                treemap: { type: 'array', items: { type: 'object' } },
              },
              required: ['id', 'type'],
            },
          },
        },
      },
    },
  },
] as const;

// ---------- Pagalbinės ----------

function requireMe(ctx: Context<unknown, AuthMeta>): AuthUser {
  if (!ctx.meta.user) {
    throw new Errors.MoleculerClientError('Neautentifikuota', 401, 'AUTH_REQUIRED');
  }
  return ctx.meta.user;
}

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

function toInt(value: unknown): number | undefined {
  const n = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : NaN;
  return Number.isFinite(n) ? Math.round(n) : undefined;
}

// ---------- render_dashboard merge ----------

export type RenderMode = 'add' | 'replace';

/**
 * Iš render_dashboard tool argumentų ištraukia valdymo laukus (`mode`,
 * `removeWidgetIds`). Šie laukai NĖRA spec'o dalis — `validateDashboardSpec`
 * juos ignoruoja, todėl skaitom atskirai prieš/po validacijos.
 */
export function parseRenderControl(args: Record<string, unknown>): {
  mode: RenderMode;
  removeIds: string[];
} {
  const mode: RenderMode = args.mode === 'replace' ? 'replace' : 'add';
  const removeIds = Array.isArray(args.removeWidgetIds)
    ? (args.removeWidgetIds as unknown[]).filter(
        (x): x is string => typeof x === 'string' && x.length > 0,
      )
    : [];
  return { mode, removeIds };
}

/**
 * Sujungia naują (validuotą) spec'ą su dabartiniu pagal režimą.
 *
 * - `replace` (arba kai dar nėra dabartinio vaizdo): naujas spec'as pakeičia viską.
 * - `add` (NUTYLĖTAS): esami widgetai išsaugomi; naujas widget'as su tuo pačiu id
 *   PERRAŠO esamą (modeliui liepta keisti widgetą tuo pačiu id), kiti pridedami
 *   gale; `removeIds` pašalina nurodytus esamus. Vaizdo `title`/`subtitle` lieka
 *   esami (vieno grafiko pridėjimas nepervadina viso dashboard'o); `year` —
 *   naujas, jei nurodytas (kad „rodyk 2025" pritaikytų metus, neištrindamas widgetų).
 *
 * Sutapatinama TIK pagal id. Antraštė NEnaudojama kaip raktas — ji laisvai
 * modelio renkama ir nebūtinai unikali; sutapus pavadinimams būtų tyliai
 * ištrintas svetimas widget'as (būtent to, kortelių praradimo, vengiam). Du
 * vienodo pavadinimo widget'ai geriau tegul sugyvena, nei dingsta.
 */
export function mergeSpec(
  base: AiDashboardSpec | null,
  next: AiDashboardSpec,
  mode: RenderMode,
  removeIds: string[] = [],
): AiDashboardSpec {
  if (mode === 'replace' || !base) return next;

  const removeSet = new Set(removeIds);
  const merged: AiWidget[] = base.widgets.filter((w) => !removeSet.has(w.id));

  for (const nw of next.widgets) {
    const byId = merged.findIndex((w) => w.id === nw.id);
    if (byId >= 0) merged[byId] = nw;
    else merged.push(nw);
  }

  // Viršijus limitą — paliekam VĖLIAUSIUS widgetus (ką tik pridėtas/keistas
  // tikrai lieka matomas; nustumiami seniausi), o NE nukerpam ką tik pridėtą.
  const capped =
    merged.length > AI_SPEC_LIMITS.maxWidgets
      ? merged.slice(merged.length - AI_SPEC_LIMITS.maxWidgets)
      : merged;

  return {
    title: base.title ?? next.title,
    subtitle: base.subtitle ?? next.subtitle,
    year: next.year ?? base.year,
    // Institucijos pjūvis persistuoja per redagavimus (handleRenderCall jį
    // perrašo, kai vartotojas keičia/valo pjūvį).
    tenantId: next.tenantId ?? base.tenantId,
    widgets: capped,
  };
}

// ---------- Institucijos (tenant) pjūvis ----------

type Institution = { id: number; code: string; name: string };

/**
 * Institucijos, kurias vartotojas MATO (scope). Naudojama (a) prompt'ui — kad
 * modelis žinotų galimus pjūvius, (b) `institution` string'o validacijai. Saugu:
 * filtruojam per `canAccessTenant`, todėl modelis negali pjauti į svetimą (be to,
 * action'ai dar kartą validuoja intersect — ADR-005 defense-in-depth).
 */
async function getAccessibleInstitutions(
  ctx: Context<unknown, AuthMeta>,
  me: AuthUser,
): Promise<Institution[]> {
  try {
    const all = await ctx.broker.call<
      Array<{ id: number; code: string; name: string }>,
      { withCounts: boolean }
    >('tenants.list', { withCounts: false }, { meta: { ...ctx.meta }, timeout: 10_000 });
    return all
      .filter((t) => canAccessTenant(me, t.id))
      .map((t) => ({ id: t.id, code: t.code, name: t.name }));
  } catch {
    return [];
  }
}

const CLEAR_SLICE_WORDS = new Set(['visos', 'visi', 'visas', 'all', '*', 'bendras', 'visų']);

/**
 * Iš render_dashboard argumentų išsprendžia institucijos pjūvį prieš PASIEKIAMŲ
 * institucijų sąrašą. Grąžina: {clear} — panaikinti; {tenantId} — nustatyti;
 * {note} — nepavyko (modeliui pranešam); {} — nieko nekeisti.
 */
export function resolveSlice(
  args: Record<string, unknown>,
  institutions: Institution[],
): { tenantId?: number; clear?: boolean; note?: string } {
  const institution = typeof args.institution === 'string' ? args.institution.trim() : '';
  const tid = toInt(args.tenantId);
  if (institution) {
    const low = institution.toLowerCase();
    if (CLEAR_SLICE_WORDS.has(low)) return { clear: true };
    const exact = institutions.find(
      (i) => i.code.toLowerCase() === low || i.name.toLowerCase() === low,
    );
    const fuzzy =
      exact ??
      institutions.find(
        (i) => i.name.toLowerCase().includes(low) || low.includes(i.code.toLowerCase()),
      );
    if (fuzzy) return { tenantId: fuzzy.id };
    return { note: `Institucija „${institution}" nerasta tarp pasiekiamų — pjūvis nepakeistas.` };
  }
  if (tid !== undefined) {
    if (institutions.some((i) => i.id === tid)) return { tenantId: tid };
    return { note: `Institucija id=${tid} nepasiekiama — pjūvis nepakeistas.` };
  }
  return {};
}

/**
 * Gelbėjimas: modelis kartais įdeda widget spec'ą į atsakymo TEKSTĄ (```json
 * blokas) vietoj render_dashboard tool call'o. Ištraukiam, validuojam.
 */
function tryRescueSpecFromText(
  text: string,
): { spec: AiDashboardSpec; cleanedText: string; mode: RenderMode } | null {
  if (!text.includes('"widgets"')) return null;
  const candidates: Array<{ raw: string; whole: string }> = [];
  const fenceRe = /```(?:json)?\s*([\s\S]*?)```/gi;
  let m: RegExpExecArray | null;
  while ((m = fenceRe.exec(text)) !== null) {
    candidates.push({ raw: m[1] ?? '', whole: m[0] });
  }
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
    // Pasiimam ir režimą iš to paties JSON — kad „rodyk tik X" (replace),
    // netyčia patekęs į tekstą, neliktų tik papildymu prie esamo vaizdo.
    const { mode } = parseRenderControl(
      typeof parsed === 'object' && parsed !== null ? (parsed as Record<string, unknown>) : {},
    );
    return { spec: result.spec, cleanedText: text.replace(c.whole, '').trim(), mode };
  }
  return null;
}

/**
 * Ar tekstas atrodo kaip widget spec'o „dump'as" (modelis JSON įmetė į tekstą
 * vietoj tool call'o). Naudojam, kai rescue NEPAVYKSTA (pvz. JSON nukirstas dėl
 * max_tokens) — tada NErodom žalio JSON vartotojui, o verčiam modelį perdaryti.
 */
function looksLikeSpecDump(text: string): boolean {
  if (!text.includes('"widgets"')) return false;
  return text.includes('"type"') || text.includes('"dataRef"') || text.includes('```json');
}

/**
 * Galutinė apsauga: pašalina ```json ... ``` blokus ir „plikus" {…"widgets"…}
 * fragmentus iš rodomos žinutės — kad net praslydęs JSON nepasiektų vartotojo.
 * Grąžina išvalytą tekstą (arba tuščią, jei nieko žmogiško neliko).
 */
function stripJsonBlocks(text: string): string {
  let out = text.replace(/```(?:json)?[\s\S]*?```/gi, ' ').trim();
  // Nukirstas (be uždarymo) ```json blokas — viskas nuo jo iki galo.
  out = out.replace(/```(?:json)?[\s\S]*$/i, ' ').trim();
  // Plikas spec fragmentas tekste (nukirstas ar ne).
  if (out.includes('"widgets"')) {
    const i = out.indexOf('{');
    if (i !== -1) out = out.slice(0, i).trim();
  }
  return out;
}

// ---------- System prompt ----------

const WIDGET_DOCS = `WIDGET TIPAI (visi turi privalomus "id" (unikalus, stabilus) ir "type"; "title" — LT antraštė; "span" — plotis 1–4):
- stat — kortelė su vienu skaičiumi (su dataRef šaltiniu "metric").
- bar | line | area — stulpeliai/linijos/plotai (data+xKey+series, arba dataRef).
- pie — skritulinė (data:[{name,value}] arba dataRef).
- radar — radaras (kaip bar: data+xKey+series, arba dataRef). Tinka palyginimams.
- sankey — SRAUTŲ diagrama (šaltinis→kategorija→eilutė). Naudok dataRef "budget_flow_sankey".
- treemap — HIERARCHIJA langeliais (šaltinis→eilutės). Naudok dataRef "budget_hierarchy_treemap".
- table — lentelė (columns+rows, arba dataRef).
- progress — panaudojimo juostos (arba dataRef "budget_lines_usage").
- markdown — trumpos tekstinės įžvalgos (## antraštės, **bold**, - sąrašai).

DATAREF (SVARBIAUSIA): vietoj literalių skaičių naudok "dataRef":{"source":"<id>","params":{...}} —
serveris užpildys ŠVIEŽIUS duomenis iš DB kiekvieno užkrovimo metu (skaičiai neužšals).
Beveik visada naudok dataRef. Literalų data tik kai NĖRA tinkamo katalogo šaltinio.

DUOMENŲ ŠALTINIŲ KATALOGAS (source id → kuriems widget tipams tinka → ką grąžina):
${buildCatalogPromptDoc()}

Spalvų paletė (jei rašai literalų series.color): #0f766e #15803d #b45309 #be123c #0369a1 #7c3aed #475569.`;

function buildSystemPrompt(
  me: AuthUser,
  year: number,
  currentSpec: AiDashboardSpec | null,
  institutions: Institution[],
): string {
  // Institucijos pjūvis siūlomas tik kai vartotojas mato >1 organizaciją.
  const canSlice = institutions.length > 1;
  const instDoc = institutions.map((i) => `  - ${i.code} — ${i.name} (tenantId ${i.id})`).join('\n');
  const currentSlice =
    currentSpec?.tenantId !== undefined
      ? (institutions.find((i) => i.id === currentSpec.tenantId)?.code ??
        `tenantId ${currentSpec.tenantId}`)
      : 'visos';
  const sliceSection = canSlice
    ? `
INSTITUCIJOS (ORGANIZACIJOS) PJŪVIS:
- Galimos institucijos pjūviui:
${instDoc}
- Dabartinis pjūvis: ${currentSlice}.
- Kai vartotojas prašo „rodyk tik <institucija>", „<institucijos> pjūvis", „atskirk <instituciją>" —
  nustatyk render_dashboard TOP-LEVEL "institution":"<kodas arba pavadinimas iš sąrašo>". Serveris
  apribos VISŲ widget'ų duomenis ta institucija (ir tai persistuos + atsinaujins be tavęs).
- Panaikinti pjūvį (rodyti visas) — "institution":"visos".
- Pjūvis taikomas kartu su metais; jei keiti TIK instituciją, widgetų keisti nereikia (widgets: []).
- „rodyk tik AAD" → ${SPEC_TOOL_NAME}({"institution":"AAD","widgets":[]})
`
    : '';

  const roleDesc = me.tenantIsApprover
    ? me.role === 'admin'
      ? 'AM administratorius (mato visų organizacijų duomenis)'
      : 'AM specialistas (mato priskirtų organizacijų duomenis)'
    : me.role === 'admin'
      ? `organizacijos „${me.tenantName}" administratorius`
      : `organizacijos „${me.tenantName}" specialistas`;

  let specJson = 'null (dar nenupieštas)';
  if (currentSpec) {
    // Į prompt'ą — tik layout struktūra (id/type/title/dataRef), be hidruotų
    // skaičių (jie keičiasi; modeliui reikia žinoti tik kas nupiešta).
    specJson = JSON.stringify({
      title: currentSpec.title,
      ...(currentSpec.year ? { year: currentSpec.year } : {}),
      widgets: currentSpec.widgets.map((w) => ({
        id: w.id,
        type: w.type,
        title: w.title,
        ...(w.dataRef ? { dataRef: w.dataRef } : {}),
      })),
    });
  }

  return `Tu esi BIIP „Finansai" sistemos (Aplinkos ministerijos finansavimo prašymų ir finansų valdymo platforma) AI asistentas, valdantis generatyvinį dashboardą.

Šiandien: ${new Date().toISOString().slice(0, 10)}. Numatytieji metai: ${year}.
Vartotojas: ${me.fullName}, ${roleDesc}.

KAIP DIRBI:
1. Vartotojas lietuviškai prašo pakeisti vaizdą arba užduoda klausimą apie finansus.
2. Realius skaičius gauk per ${QUERY_TOOL_NAME} (katalogo šaltinis). NIEKADA neišgalvok skaičių.
3. Kai prašoma keisti/parodyti vaizdą — kviesk ${SPEC_TOOL_NAME}. Kiekvienam widget naudok dataRef
   (kad duomenys liktų švieži).
4. Jei klausimas atsakomas trumpai ir vaizdo keisti neprašoma — atsakyk vien tekstu.
5. Po sėkmingo ${SPEC_TOOL_NAME} atsakyk trumpai (1–2 sakiniai) lietuviškai, ką pakeitei.
6. ⛔ KRITIŠKA: vaizdą keisk TIK per ${SPEC_TOOL_NAME} tool call. Į atsakymo TEKSTĄ NIEKADA
   nerašyk widget JSON (jokių \`\`\`json blokų, jokio {"widgets":...}). Tekste matomas JSON =
   klaida; vartotojas jo nemato gražiai, o jei nukerpamas — vaizdas neperpiešiamas.
   BLOGAI: atsakyme rašai \`\`\`json {"widgets":[...]}\`\`\`.
   GERAI: kvieti ${SPEC_TOOL_NAME}({"widgets":[...]}), o tekste — tik „Atnaujinau vaizdą…".

PRIDĖTI vs PAKEISTI (labai svarbu — vartotojas pyksta, kai pradingsta jo kortelės):
- NUTYLĖTAS režimas yra mode="add": pateik TIK naujus ar keičiamus widgetus — serveris juos
  PRIDEDA prie esamų. NEReikia perrašinėti esamų widgetų — jie lieka automatiškai.
- mode="replace" naudok, kai vartotojas nori VISO naujo vaizdo, o ne papildymo:
  • aiškūs žodžiai: „rodyk TIK…", „pakeisk visą vaizdą", „pradėk iš naujo", „ištrink viską ir palik tik…";
  • pilnos/bendros apžvalgos prašymas: „pilna finansų apžvalga", „bendras vaizdas", „parodyk viską".
  TRUMPA TAISYKLĖ: jei vartotojas NEvartoja „pridėk / dar / taip pat / prie to" ir prašo parodyti
  ar pertvarkyti VISĄ vaizdą — rinkis replace; jei prašo konkretaus papildymo — add.
- Esamą widgetą KEISK (pvz. „paversk tą grafiką skritulinę") naudodamas TĄ PATĮ id (add režimas perrašo).
- Kiekvienam NAUJAM widget duok unikalų prasmingą id (pvz. „islaidos-menesiai"), kad atsitiktinai
  nepataikytum į esamo widget id (kitaip jį perrašysi).
- Konkrečią kortelę PAŠALINTI: removeWidgetIds:["<id>"] (add režimas) — NEsiųsk replace vien tam.
- Tik METŲ pakeitimui („rodyk 2025") — add režimas, top-level "year", widgets gali būti tuščias [].

PAVYZDŽIAI (atkreipk dėmesį į režimą):
- „pridėk išlaidų pagal mėnesius grafiką" → ${SPEC_TOOL_NAME}({"widgets":[{naujas area, unikalus id, su dataRef}]})  (add, esami lieka)
- „rodyk tik biudžeto vykdymą" → ${SPEC_TOOL_NAME}({"mode":"replace","widgets":[{tas vienas}]})
- „pilna finansų apžvalga" → ${SPEC_TOOL_NAME}({"mode":"replace","widgets":[{visas naujas rinkinys}]})
- „ištrink prašymų kortelę" → ${SPEC_TOOL_NAME}({"removeWidgetIds":["<tos kortelės id>"],"widgets":[]})
- „rodyk 2025 metus" → ${SPEC_TOOL_NAME}({"year":2025,"widgets":[]})

DABARTINIS DASHBOARD (layout — naudok šiuos id keisdamas ar šalindamas esamus widgetus):
${specJson}

${WIDGET_DOCS}

METAI (svarbu):
- Kai vartotojas keičia metus (pvz. „rodyk 2025", „tik už 2026") — nustatyk render_dashboard
  TOP-LEVEL "year" lauką. Serveris jį pritaikys VISIEMS widget'ams automatiškai. NEREIKIA
  rašyti year į kiekvieno widget dataRef.params — užtenka vieno top-level "year".
- Jei vartotojas prašo tik metų pakeitimo (UI nesikeičia) — perduok TĄ PATĮ widgetų sąrašą
  (tie patys id/dataRef) + naują top-level "year".
- Jei pasirinktiems metams nėra duomenų — grafikai bus tušti; tai NORMALU, pasakyk tai vartotojui.
${sliceSection}
GEROS PRAKTIKOS:
- Pirmoje eilėje 3–4 stat kortelės (span 1, dataRef "metric"), žemiau span 2 grafikai/lentelės.
- Įdomiems pjūviams naudok sankey (biudžeto srautai) ir treemap (hierarchija).
- Visos etiketės lietuviškai. Iš viso 4–10 widgetų.`;
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
  if (!message) throw new Error('LLM atsakymas be choices[0].message');
  return message;
}

// ---------- Chat ciklas ----------

type ChatParams = {
  messages: AiChatMessage[];
  spec?: AiDashboardSpec | null;
  year?: number;
};

const activeChats = new Map<number, number>();

const TOOL_STATUS = (name: string, args: Record<string, unknown>): string => {
  if (name === SPEC_TOOL_NAME) return 'Piešiamas naujas vaizdas…';
  if (name === QUERY_TOOL_NAME) {
    const src = typeof args.source === 'string' ? args.source : '';
    return src ? `Renkami duomenys: ${src}…` : 'Renkami duomenys…';
  }
  return `Vykdoma: ${name}…`;
};

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
  // Defense-in-depth: jei kliento (localStorage) spec'e pjūvis į NEPASIEKIAMĄ
  // instituciją (sugadintas/pasenęs) — numetam jį (rodom visas pagal scope), kad
  // neliktų fantominio #N pjūvio. Duomenų leak negalimas ir taip (action intersect).
  if (currentSpec?.tenantId !== undefined && !canAccessTenant(me, currentSpec.tenantId)) {
    delete currentSpec.tenantId;
  }
  // „Gyvas" vaizdas šiame turne — render_dashboard add režimu sujungiamas su juo
  // (kad pridėjus widgetą esami nepradingtų). Atnaujinamas po kiekvieno emit.
  let workingSpec = currentSpec;
  const history = (ctx.params.messages ?? []).slice(-MAX_HISTORY_MESSAGES);

  // Institucijos, kurias vartotojas mato — prompt'ui + `institution` pjūvio validacijai.
  const institutions = await getAccessibleInstitutions(ctx, me);

  const llmMessages: LlmMessage[] = [
    { role: 'system', content: buildSystemPrompt(me, year, currentSpec, institutions) },
    ...history.map((mm): LlmMessage => ({ role: mm.role, content: mm.content })),
  ];

  let renderAttempts = 0;
  let renderedThisTurn = false;
  let emptyRetries = 0;
  let specInTextRetries = 0;

  const deadlineReply = (): void => {
    sseWrite(stream, {
      type: 'reply',
      text: 'Užklausa truko per ilgai — pabandykite suformuluoti paprasčiau.',
    });
  };

  /** Hidruoja, įsimena kaip dabartinį (workingSpec) ir emit'ina spec'ą. */
  const emitSpec = async (spec: AiDashboardSpec): Promise<void> => {
    // Hidruojam dataRef'us prieš emit — pirmas paint'as su šviežiais duomenimis.
    let hydrated = spec;
    try {
      hydrated = await hydrateSpec(ctx, spec, year);
    } catch (err) {
      logger.warn(
        'AI: hidracija nepavyko (siunčiam be jos):',
        err instanceof Error ? err.message : err,
      );
    }
    workingSpec = hydrated;
    renderedThisTurn = true;
    sseWrite(stream, { type: 'spec', spec: hydrated });
  };

  /** Validuoja, sujungia su dabartiniu vaizdu (add/replace), hidruoja, emit'ina. */
  const handleRenderCall = async (args: Record<string, unknown>): Promise<string> => {
    renderAttempts += 1;
    const { mode, removeIds } = parseRenderControl(args);
    const slice = resolveSlice(args, institutions);
    const hasWidgets = Array.isArray(args.widgets) && (args.widgets as unknown[]).length > 0;

    // Įrašo/panaikina institucijos pjūvį merged spec'e (intersect su scope
    // garantuoja saugumą; čia tik nustatom/valom tenantId).
    const applySlice = (spec: AiDashboardSpec): void => {
      if (slice.clear) {
        delete spec.tenantId;
        return;
      }
      if (slice.tenantId !== undefined) {
        spec.tenantId = slice.tenantId;
        return;
      }
      // Nieko aiškiai nepakeista — pjūvis LIEKA (sticky) net per replace, kol
      // vartotojas jo nepakeičia/nepanaikina.
      if (spec.tenantId === undefined && workingSpec?.tenantId !== undefined) {
        spec.tenantId = workingSpec.tenantId;
      }
    };

    // Board-lygio tweak'as add režime BE naujų widgetų: metų/institucijos keitimas
    // ir/ar konkrečių kortelių pašalinimas. Validuoti nėra ko (widgetų sąrašas tuščias).
    if (!hasWidgets && mode === 'add' && workingSpec) {
      const yearArg = toInt(args.year);
      const merged: AiDashboardSpec = {
        ...workingSpec,
        ...(yearArg !== undefined ? { year: yearArg } : {}),
        widgets: workingSpec.widgets.filter((w) => !removeIds.includes(w.id)),
      };
      applySlice(merged);
      await emitSpec(merged);
      return JSON.stringify({
        ok: true,
        ...(slice.note ? { pjuvioPastaba: slice.note } : {}),
        pastaba:
          (removeIds.length > 0
            ? 'Kortelės pašalintos. '
            : slice.tenantId !== undefined || slice.clear
              ? 'Pjūvis atnaujintas. '
              : 'Vaizdas atnaujintas. ') +
          'Atsakyk vartotojui trumpai lietuviškai (be tool call).',
      });
    }

    // SAUGUMAS/korektiškumas: pjūvio (tenantId) NEpriimam tiesiai iš validacijos —
    // resolveSlice (applySlice) yra VIENINTELIS autoritetas (jis tikrina prieš
    // pasiekiamas institucijas). Kitaip modelio top-level tenantId apeitų patikrą.
    const result = validateDashboardSpec({ ...args, tenantId: undefined });
    if (!result.ok) {
      if (renderAttempts >= MAX_RENDER_ATTEMPTS) {
        return JSON.stringify({
          ok: false,
          errors: result.errors,
          pastaba: 'Limitas pasiektas — NEBEKVIESK render_dashboard, atsakyk tekstu.',
        });
      }
      return JSON.stringify({
        ok: false,
        errors: result.errors,
        pastaba: 'Pataisyk spec ir bandyk dar kartą.',
      });
    }

    const merged = mergeSpec(workingSpec, result.spec, mode, removeIds);
    applySlice(merged);
    await emitSpec(merged);
    return JSON.stringify({
      ok: true,
      ...(result.errors.length > 0 ? { atmestiWidgetai: result.errors } : {}),
      ...(slice.note ? { pjuvioPastaba: slice.note } : {}),
      pastaba:
        result.errors.length > 0
          ? 'Dashboard atnaujintas, bet dalis widgetų atmesta (žr. atmestiWidgetai). Atsakyk trumpai apie tai, kas RODOMA.'
          : mode === 'replace'
            ? 'Vaizdas pakeistas. Atsakyk vartotojui trumpai lietuviškai (be tool call).'
            : 'Widgetai pridėti prie esamo vaizdo. Atsakyk vartotojui trumpai lietuviškai (be tool call).',
    });
  };

  for (let step = 0; step < MAX_LLM_STEPS; step += 1) {
    if (aborted) return;
    if (Date.now() > deadline) return deadlineReply();

    sseWrite(stream, { type: 'status', label: step === 0 ? 'Galvojama…' : 'Tęsiama…' });
    const assistant = await callLlm(cfg, llmMessages);
    if (aborted) return;

    const toolCalls = assistant.tool_calls ?? [];

    if (toolCalls.length === 0) {
      const text = (assistant.content ?? '').trim();
      if (!text) {
        if (!renderedThisTurn && emptyRetries < MAX_EMPTY_RETRIES) {
          emptyRetries += 1;
          logger.warn(`AI: tuščias LLM atsakymas — retry ${emptyRetries}`);
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
      const rescued = tryRescueSpecFromText(text);
      if (rescued) {
        logger.warn('AI: spec rastas tekste — gelbstim į dashboard');
        // Gerbiam JSON'e nurodytą režimą (replace/add); jo nesant — add (saugus
        // numatytasis: gelbstint NEištrinam esamo vaizdo).
        await emitSpec(mergeSpec(workingSpec, rescued.spec, rescued.mode));
        sseWrite(stream, {
          type: 'reply',
          text: stripJsonBlocks(rescued.cleanedText) || 'Atnaujinau vaizdą pagal prašymą.',
        });
        return;
      }
      // Tekste yra spec'o požymių, bet neišparsinamas (pvz. nukirstas dėl
      // max_tokens) — NErodom žalio JSON. Verčiam modelį perdaryti per tool'ą.
      if (looksLikeSpecDump(text) && specInTextRetries < MAX_RENDER_ATTEMPTS) {
        specInTextRetries += 1;
        logger.warn(
          `AI: spec dump tekste (neparsinamas) — verčiam tool'ą, retry ${specInTextRetries}`,
        );
        // Trumpinam assistant turną (kad nesprogtų kontekstas), bet išlaikom
        // role alternaciją (assistant → user).
        llmMessages.push({ role: 'assistant', content: text.slice(0, 300) });
        llmMessages.push({
          role: 'user',
          content:
            'KLAIDA: įdėjai widget JSON į atsakymo tekstą — tai DRAUDŽIAMA ir vartotojui nematoma. ' +
            'Iškviesk render_dashboard tool su tuo pačiu vaizdu (widgetai su dataRef). Atsakyme JOKIO JSON.',
        });
        continue;
      }
      const cleaned = stripJsonBlocks(text);
      sseWrite(stream, {
        type: 'reply',
        text:
          cleaned ||
          (renderedThisTurn
            ? 'Atnaujinau vaizdą.'
            : 'Atsiprašau — nepavyko paruošti vaizdo. Pabandykite suformuluoti paprasčiau.'),
      });
      return;
    }

    llmMessages.push(assistant);

    for (const tc of toolCalls) {
      if (aborted) return;
      if (Date.now() > deadline) return deadlineReply();
      const name = tc.function?.name ?? '';

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

      sseWrite(stream, { type: 'status', label: TOOL_STATUS(name, args) });

      if (name === SPEC_TOOL_NAME) {
        const content = await handleRenderCall(args);
        llmMessages.push({ role: 'tool', tool_call_id: tc.id, content });
        continue;
      }

      if (name === QUERY_TOOL_NAME) {
        const source = typeof args.source === 'string' ? args.source : '';
        const params =
          typeof args.params === 'object' && args.params !== null
            ? (args.params as Record<string, unknown>)
            : {};
        // Aktyvus pjūvis (workingSpec.tenantId) — kad peržiūra atitiktų atvaizdą.
        const result = await runSourceForTool(ctx, source, params, year, workingSpec?.tenantId);
        llmMessages.push({ role: 'tool', tool_call_id: tc.id, content: compactJson(result) });
        continue;
      }

      llmMessages.push({
        role: 'tool',
        tool_call_id: tc.id,
        content: JSON.stringify({ error: `Nežinomas tool „${name}"` }),
      });
    }
  }

  sseWrite(stream, {
    type: 'reply',
    text: renderedThisTurn
      ? 'Atnaujinau vaizdą pagal jūsų prašymą.'
      : 'Atsiprašau — nepavyko užbaigti užklausos. Pabandykite suformuluoti paprasčiau.',
  });
}

// ---------- Default layout (su dataRef'ais) ----------

function ref(
  source: string,
  params?: Record<string, string | number | boolean>,
): AiWidget['dataRef'] {
  return params ? { source, params } : { source };
}

function buildDefaultLayout(me: AuthUser, year: number): AiDashboardSpec {
  const isApprover = me.tenantIsApprover;
  const widgets: AiWidget[] = [
    {
      id: 'stat-planuota',
      type: 'stat',
      title: 'Planuojamas biudžetas',
      span: 1,
      dataRef: ref('metric', { metric: 'biudzetas_planuota', year }),
    },
    {
      id: 'stat-faktine',
      type: 'stat',
      title: 'Faktinės išlaidos',
      span: 1,
      dataRef: ref('metric', { metric: 'islaidos_faktine', year }),
    },
    {
      id: 'stat-likutis',
      type: 'stat',
      title: 'Likutis',
      span: 1,
      dataRef: ref('metric', { metric: 'biudzeto_likutis', year }),
    },
    {
      id: 'stat-prasymai',
      type: 'stat',
      title: 'Prašymai',
      span: 1,
      dataRef: ref('metric', { metric: 'prasymu_skaicius', year }),
    },

    {
      id: 'sankey-flow',
      type: 'sankey',
      title: 'Biudžeto srautas: šaltinis → kategorija → eilutė',
      span: 2,
      dataRef: ref('budget_flow_sankey', { year }),
    },
    {
      id: 'treemap-hierarchy',
      type: 'treemap',
      title: 'Biudžeto hierarchija',
      span: 2,
      dataRef: ref('budget_hierarchy_treemap', { year, sizeBy: 'planuota' }),
    },

    {
      id: 'area-trend',
      type: 'area',
      title: 'Prašymų srautas per 12 mėn.',
      span: 2,
      dataRef: ref('requests_monthly_trend', { year }),
    },
    {
      id: 'pie-categories',
      type: 'pie',
      title: 'Prašyta pagal lėšų kategorijas',
      span: 2,
      format: 'eur',
      dataRef: ref('cost_categories', { year }),
    },

    {
      id: 'progress-lines',
      type: 'progress',
      title: 'Biudžeto eilutės arti limito',
      span: 2,
      dataRef: ref('budget_lines_usage', { year }),
    },
    isApprover
      ? {
          id: 'table-tenants',
          type: 'table',
          title: 'Organizacijos pagal prašytą sumą',
          span: 2,
          dataRef: ref('tenants_breakdown', { year }),
        }
      : {
          id: 'table-budget',
          type: 'table',
          title: 'Biudžeto eilutės',
          span: 2,
          dataRef: ref('budget_lines_table', { year }),
        },
  ];
  return {
    title: 'Finansų apžvalga',
    // Globalūs metai — serveris pritaiko visiems dataRef (žr. hydrateSpec).
    // Metai NEdedami į title/subtitle — juos rodo metų selektorius (kitaip
    // pakeitus metus liktų senas tekstas).
    year,
    subtitle:
      'Gyvi duomenys. Paprašykite asistento perpiešti vaizdą — pvz. „parodyk biudžeto srautą" arba „išlaidos pagal mėnesius".',
    widgets,
  };
}

// ---------- Servisas ----------

const AiService: ServiceSchema = {
  name: 'ai',

  actions: {
    /** Default dashboardas — layout su dataRef'ais, iškart hidruotas. */
    dashboard: {
      async handler(ctx: Context<unknown, AuthMeta>): Promise<AiDashboardResponse> {
        const me = requireMe(ctx);
        const year = new Date().getFullYear();
        const layout = buildDefaultLayout(me, year);
        const spec = await hydrateSpec(ctx, layout, year);
        return { spec, generatedAt: new Date().toISOString() };
      },
    },

    /** Užpildo išsaugoto spec'o dataRef'us šviežiais DB duomenimis. */
    hydrate: {
      params: {
        spec: { type: 'object' },
        year: {
          type: 'number',
          integer: true,
          optional: true,
          convert: true,
          min: 2000,
          max: 3000,
        },
      },
      async handler(
        ctx: Context<{ spec: unknown; year?: number }, AuthMeta>,
      ): Promise<AiHydrateResponse> {
        const me = requireMe(ctx);
        const year = ctx.params.year ?? new Date().getFullYear();
        const parsed = toSpecOrNull(ctx.params.spec);
        if (!parsed) {
          throw new Errors.MoleculerClientError('Netinkamas spec', 422, 'AI_BAD_SPEC');
        }
        // Defense-in-depth: numetam pjūvį į NEPASIEKIAMĄ instituciją (sugadintas/
        // pasenęs localStorage) — rodom visas pagal scope, ne fantominį #N pjūvį.
        if (parsed.tenantId !== undefined && !canAccessTenant(me, parsed.tenantId)) {
          delete parsed.tenantId;
        }
        const spec = await hydrateSpec(ctx, parsed, year);
        return { spec, generatedAt: new Date().toISOString() };
      },
    },

    /** AI chat — SSE stream'as (text/event-stream). */
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
