/**
 * AI pradžios puslapis (Iter 17, eksperimentinis) — generatyvinis dashboard'as.
 *
 * Kairėje — dinaminė drobė (`DashboardCanvas`), kurią perpiešia LLM per
 * `render_dashboard` tool-call'ą. Dešinėje — chat panelė (CopilotKit pattern'as).
 * Pradinis vaizdas — deterministinis spec'as iš GET /ai/dashboard (be LLM).
 *
 * Mobile (<lg): chat'as atsidaro per Sheet'ą mygtuku apačioje dešinėje.
 */
import * as React from 'react';
import { useQuery } from '@tanstack/react-query';
import { MessageSquareText, RotateCcw } from 'lucide-react';
import type { AiChatEvent, AiDashboardSpec } from '@biip-finansai/shared';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Sheet, SheetContent, SheetDescription, SheetTitle } from '@/components/ui/sheet';
import { ChatPanel, type AiChatDisplayMessage } from '@/components/ai/ChatPanel';
import { DashboardCanvas } from '@/components/ai/DashboardCanvas';
import {
  aiChatStream,
  aiGetDashboard,
  aiHydrate,
  specHasDataRefs,
  type AiChatStreamHandle,
} from '@/lib/api/ai';
import {
  aiSpecStorageKey,
  clearSavedAiSpec,
  loadSavedAiSpec,
  saveAiSpec,
} from '@/lib/ai-spec-storage';
import { useAuth } from '@/lib/auth';

/** Kategorizuoti pavyzdžiai — kad vartotojas atrastų galimybes. */
const SUGGESTION_GROUPS = [
  {
    title: 'Apžvalga',
    items: ['Tik svarbiausi skaičiai', 'Pilna finansų apžvalga'],
  },
  {
    title: 'Srautai ir hierarchija',
    items: ['Parodyk biudžeto srautą (Sankey)', 'Biudžeto hierarchija langeliais'],
  },
  {
    title: 'Pjūviai',
    items: [
      'Išlaidos pagal mėnesius',
      'Išlaidos pagal tipą',
      'Prašyta pagal lėšų kategorijas',
      'Biudžeto vykdymas pagal šaltinius',
      'Prašymai pagal statusą (radaras)',
    ],
  },
  {
    title: 'Lentelės',
    items: ['Projektų lentelė', 'Biudžeto eilutės arti limito', 'Artėjantys terminai'],
  },
];

/** Plokščias variantas (fallback + testams). */
const SUGGESTIONS = SUGGESTION_GROUPS.flatMap((g) => g.items).slice(0, 6);

export default function AiHomePage(): JSX.Element {
  const { user } = useAuth();
  const storageKey = aiSpecStorageKey(user?.id);

  const defaultQuery = useQuery({
    queryKey: ['ai-dashboard'],
    queryFn: aiGetDashboard,
    staleTime: 60_000,
  });

  // null = dar nepersirašyta per chat'ą; rodom default'inį iš query.
  // Pradinė reikšmė — paskutinis AI nupieštas vaizdas iš localStorage (jei yra).
  const [overrideSpec, setOverrideSpec] = React.useState<AiDashboardSpec | null>(() =>
    loadSavedAiSpec(storageKey),
  );
  const [generation, setGeneration] = React.useState(0);
  const [messages, setMessages] = React.useState<AiChatDisplayMessage[]>([]);
  const [busy, setBusy] = React.useState(false);
  const [statusLabel, setStatusLabel] = React.useState<string | null>(null);
  const [chatOpen, setChatOpen] = React.useState(false);

  const streamRef = React.useRef<AiChatStreamHandle | null>(null);
  const specRef = React.useRef<AiDashboardSpec | null>(null);
  specRef.current = overrideSpec ?? defaultQuery.data?.spec ?? null;
  const busyRef = React.useRef(false);
  busyRef.current = busy;
  const overrideSpecRef = React.useRef<AiDashboardSpec | null>(null);
  overrideSpecRef.current = overrideSpec;

  // Unmount — nutraukiam aktyvų stream'ą.
  React.useEffect(() => () => streamRef.current?.abort(), []);

  /**
   * Persihidruoja dabartinį (override) vaizdą — užpildo dataRef'us ŠVIEŽIAIS DB
   * duomenimis. Naudojam (a) įkėlus iš localStorage, (b) grįžus į tab'ą. Default
   * vaizdą react-query atnaujina pati; čia rūpi tik AI nupieštas override.
   */
  const refreshOverride = React.useCallback((): void => {
    if (busyRef.current) return;
    const current = overrideSpecRef.current;
    if (!current || !specHasDataRefs(current)) return;
    aiHydrate(current)
      .then((fresh) => {
        setOverrideSpec(fresh);
        setGeneration((g) => g + 1);
        saveAiSpec(storageKey, fresh);
      })
      .catch(() => {
        /* nepavyko — paliekam esamus skaičius */
      });
  }, [storageKey]);

  // (a) Įkėlus iš localStorage — vieną kartą persihidruojam (kad nerodytų senų skaičių).
  const hydratedOnceRef = React.useRef(false);
  React.useEffect(() => {
    if (hydratedOnceRef.current) return;
    hydratedOnceRef.current = true;
    refreshOverride();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // (b) Grįžus į tab'ą (visibilitychange → visible) — atnaujinam skaičius iš DB,
  // kad AI vaizdas neliktų užšalęs, kol vartotojas jį žiūri.
  React.useEffect(() => {
    const onVisible = (): void => {
      if (document.visibilityState === 'visible') refreshOverride();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, [refreshOverride]);

  const handleEvent = React.useCallback(
    (event: AiChatEvent): void => {
      switch (event.type) {
        case 'status':
          setStatusLabel(event.label);
          break;
        case 'spec':
          setOverrideSpec(event.spec);
          setGeneration((g) => g + 1);
          // Persistuojam paskutinį vaizdą — po reload grįš jis, ne default.
          saveAiSpec(storageKey, event.spec);
          break;
        case 'reply':
          setMessages((prev) => [...prev, { role: 'assistant', content: event.text }]);
          break;
        case 'error':
          setMessages((prev) => [
            ...prev,
            { role: 'assistant', content: event.message, error: true },
          ]);
          // Kliento pusės klaidos (HTTP !ok, tinklo nutrūkimas) NEatsiunčia 'done' —
          // error traktuojam kaip terminalinį (serverio done po jo — no-op).
          setBusy(false);
          setStatusLabel(null);
          break;
        case 'done':
          setBusy(false);
          setStatusLabel(null);
          break;
      }
    },
    [storageKey],
  );

  const send = React.useCallback(
    (text: string): void => {
      if (busy) return;
      const nextMessages: AiChatDisplayMessage[] = [...messages, { role: 'user', content: text }];
      setMessages(nextMessages);
      setBusy(true);
      setStatusLabel('Galvojama…');
      streamRef.current = aiChatStream(
        {
          // Istorija be klaidų žinučių — jos ne pokalbio turinys.
          messages: nextMessages
            .filter((m) => !m.error)
            .map((m) => ({ role: m.role, content: m.content })),
          spec: specRef.current,
        },
        handleEvent,
      );
    },
    [busy, messages, handleEvent],
  );

  const stop = React.useCallback((): void => {
    streamRef.current?.abort();
    setBusy(false);
    setStatusLabel(null);
  }, []);

  const reset = React.useCallback((): void => {
    setOverrideSpec(null);
    setGeneration((g) => g + 1);
    clearSavedAiSpec(storageKey);
    void defaultQuery.refetch();
  }, [defaultQuery, storageKey]);

  const spec = overrideSpec ?? defaultQuery.data?.spec ?? null;

  // Metų pasirinkimas — keičia VISŲ widget'ų duomenis (tas pats layout, kiti
  // metai), deterministiškai per /ai/hydrate, be LLM. Sprendžia „noriu tik kitų
  // metų duomenis" be chat'o.
  const currentYear = new Date().getFullYear();
  const selectedYear = spec?.year ?? currentYear;
  const YEAR_OPTIONS = [currentYear - 1, currentYear, currentYear + 1, currentYear + 2];

  const applyYear = React.useCallback(
    (year: number): void => {
      const base = specRef.current;
      if (!base) return;
      const withYear: AiDashboardSpec = { ...base, year };
      setOverrideSpec(withYear);
      setGeneration((g) => g + 1);
      aiHydrate(withYear)
        .then((fresh) => {
          setOverrideSpec(fresh);
          setGeneration((g) => g + 1);
          saveAiSpec(storageKey, fresh);
        })
        .catch(() => {
          /* paliekam optimistinį (su gal senais skaičiais) */
        });
    },
    [storageKey],
  );

  // Per-widget pločio keitimas (¼/½/pilnas). Atnaujina spec'ą vietoje — generation
  // NEbumpinam, kad tinklelis persitvarkytų sklandžiai (be re-animacijos) —
  // ir persistuoja, kad layout tweak'as išliktų po reload. „Pradinis vaizdas" atstato.
  const handleSpanChange = React.useCallback(
    (id: string, nextSpan: number): void => {
      const base = specRef.current;
      if (!base) return;
      const span = nextSpan as 1 | 2 | 3 | 4;
      const next: AiDashboardSpec = {
        ...base,
        widgets: base.widgets.map((w) => (w.id === id ? { ...w, span } : w)),
      };
      setOverrideSpec(next);
      saveAiSpec(storageKey, next);
    },
    [storageKey],
  );

  // Tempimas-rūšiavimas: perkelia tempiamą widget'ą į drop taikinio vietą.
  const handleReorder = React.useCallback(
    (fromId: string, toId: string): void => {
      const base = specRef.current;
      if (!base || fromId === toId) return;
      const widgets = [...base.widgets];
      const from = widgets.findIndex((w) => w.id === fromId);
      const to = widgets.findIndex((w) => w.id === toId);
      if (from < 0 || to < 0) return;
      const [moved] = widgets.splice(from, 1);
      if (!moved) return;
      widgets.splice(to, 0, moved);
      const next: AiDashboardSpec = { ...base, widgets };
      setOverrideSpec(next);
      saveAiSpec(storageKey, next);
    },
    [storageKey],
  );

  return (
    <div className="flex h-full min-h-0">
      {/* --- Drobė --- */}
      <div className="min-w-0 flex-1 overflow-y-auto">
        <div className="mx-auto max-w-6xl p-4 md:p-6">
          <div className="mb-3 flex items-center justify-end gap-2">
            <label className="flex items-center gap-1.5 text-sm text-muted-foreground">
              Metai:
              <select
                value={selectedYear}
                onChange={(e) => applyYear(Number(e.target.value))}
                aria-label="Pasirinkti metus"
                className="rounded-md border border-input bg-background px-2 py-1 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                {YEAR_OPTIONS.map((y) => (
                  <option key={y} value={y}>
                    {y}
                  </option>
                ))}
              </select>
            </label>
            {overrideSpec ? (
              <Button variant="outline" size="sm" onClick={reset}>
                <RotateCcw className="mr-1.5 h-3.5 w-3.5" />
                Pradinis vaizdas
              </Button>
            ) : null}
          </div>

          {spec ? (
            <DashboardCanvas
              spec={spec}
              generation={generation}
              onSpanChange={handleSpanChange}
              onReorder={handleReorder}
            />
          ) : defaultQuery.isError ? (
            <Card className="mx-auto my-12 max-w-md">
              <CardContent className="p-6 text-center text-sm text-destructive">
                Nepavyko užkrauti pradžios duomenų.
              </CardContent>
            </Card>
          ) : (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
                {Array.from({ length: 4 }).map((_, i) => (
                  <Skeleton key={i} className="h-28" />
                ))}
              </div>
              <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
                <Skeleton className="h-72" />
                <Skeleton className="h-72" />
              </div>
            </div>
          )}
        </div>
      </div>

      {/* --- Chat (desktop) --- */}
      <ChatPanel
        className="hidden w-[360px] shrink-0 border-l xl:w-[400px] lg:flex"
        messages={messages}
        busy={busy}
        statusLabel={statusLabel}
        suggestions={SUGGESTIONS}
        suggestionGroups={SUGGESTION_GROUPS}
        onSend={send}
        onStop={stop}
      />

      {/* --- Chat (mobile) --- */}
      <Button
        type="button"
        size="icon"
        onClick={() => setChatOpen(true)}
        className="fixed bottom-5 right-5 z-40 h-12 w-12 rounded-full shadow-lg lg:hidden"
        aria-label="Atidaryti AI asistentą"
      >
        <MessageSquareText className="h-5 w-5" />
      </Button>
      <Sheet open={chatOpen} onOpenChange={setChatOpen}>
        <SheetContent side="right" className="w-full max-w-md p-0 sm:max-w-md">
          <SheetTitle className="sr-only">AI asistentas</SheetTitle>
          <SheetDescription className="sr-only">
            Pokalbis su AI asistentu, kuris perpiešia pradžios vaizdą.
          </SheetDescription>
          <ChatPanel
            className="h-full"
            messages={messages}
            busy={busy}
            statusLabel={statusLabel}
            suggestions={SUGGESTIONS}
            suggestionGroups={SUGGESTION_GROUPS}
            onSend={send}
            onStop={stop}
          />
        </SheetContent>
      </Sheet>
    </div>
  );
}
