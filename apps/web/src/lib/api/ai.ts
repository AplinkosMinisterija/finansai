/**
 * AI generatyvinio dashboard'o API klientas (Iter 17, eksperimentinis).
 *
 *  - `aiGetDashboard()` — pradinis (deterministinis) spec'as iš GET /ai/dashboard.
 *  - `aiChatStream()` — POST /ai/chat SSE consumer'is. Naudojam fetch + reader
 *    (ne EventSource, nes reikia POST su body + cookies). Event'ai ateina kaip
 *    `data: {...}\n\n` eilutės — parsinam inkrementiškai.
 */
import type {
  AiChatEvent,
  AiChatRequest,
  AiDashboardResponse,
  AiDashboardSpec,
  AiHydrateResponse,
} from '@biip-finansai/shared';
import { api } from '@/lib/api';

export async function aiGetDashboard(): Promise<AiDashboardResponse> {
  const { data } = await api.get<AiDashboardResponse>('/ai/dashboard');
  return data;
}

/**
 * Užpildo išsaugoto (localStorage) spec'o dataRef'us ŠVIEŽIAIS DB duomenimis.
 * Taip grafikai neužšąla — layout'as iš AI, skaičiai visada iš serverio.
 */
export async function aiHydrate(spec: AiDashboardSpec): Promise<AiDashboardSpec> {
  const { data } = await api.post<AiHydrateResponse>('/ai/hydrate', { spec });
  return data.spec;
}

/** Ar spec'e yra bent vienas dataRef widget'as (verta hidruoti). */
export function specHasDataRefs(spec: AiDashboardSpec): boolean {
  return spec.widgets.some((w) => w.dataRef !== undefined);
}

export interface AiChatStreamHandle {
  /** Nutraukia stream'ą (vartotojas paspaudė „Stop" / unmount). */
  abort: () => void;
  /** Resolvinasi kai stream'as baigtas (done/error/abort). */
  finished: Promise<void>;
}

/**
 * Siunčia chat request'ą ir kviečia `onEvent` kiekvienam SSE event'ui.
 * Klaidas (tinklo / HTTP) paverčia į `{type: 'error'}` event'ą — caller'iui
 * nereikia atskiro error path'o.
 */
export function aiChatStream(
  request: AiChatRequest,
  onEvent: (event: AiChatEvent) => void,
): AiChatStreamHandle {
  const controller = new AbortController();

  const finished = (async (): Promise<void> => {
    let gotTerminal = false;
    try {
      const res = await fetch('/api/ai/chat', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(request),
        signal: controller.signal,
      });
      if (!res.ok || !res.body) {
        const message =
          res.status === 503
            ? 'AI asistentas šioje aplinkoje nesukonfigūruotas.'
            : `Serverio klaida (${res.status}). Bandykite dar kartą.`;
        onEvent({ type: 'error', message });
        gotTerminal = true;
        return;
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        // SSE event'ai atskirti dvigubu \n. Paskutinis (galimai nepilnas)
        // gabalas lieka buferyje.
        const chunks = buffer.split('\n\n');
        buffer = chunks.pop() ?? '';
        for (const chunk of chunks) {
          const line = chunk.split('\n').find((l) => l.startsWith('data: '));
          if (!line) continue;
          try {
            const event = JSON.parse(line.slice(6)) as AiChatEvent;
            if (event.type === 'done' || event.type === 'error') gotTerminal = true;
            onEvent(event);
          } catch {
            // Sugadintas event'as — ignoruojam, stream'as tęsiasi.
          }
        }
      }
    } catch (err) {
      if ((err as Error)?.name !== 'AbortError') {
        onEvent({ type: 'error', message: 'Nutrūko ryšys su serveriu.' });
        gotTerminal = true;
      }
    } finally {
      if (!gotTerminal && !controller.signal.aborted) {
        // Stream'as užsidarė be done event'o — laikom baigtu.
        onEvent({ type: 'done' });
      }
    }
  })();

  return { abort: () => controller.abort(), finished };
}
