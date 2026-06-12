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
import { aiChatStream, aiGetDashboard, type AiChatStreamHandle } from '@/lib/api/ai';

const SUGGESTIONS = [
  'Rodyk biudžeto vykdymą pagal finansavimo šaltinius',
  'Išlaidos pagal mėnesius — stulpelinė diagrama',
  'Tik svarbiausi skaičiai, be grafikų',
  'Pridėk projektų lentelę su biudžetais',
];

export default function AiHomePage(): JSX.Element {
  const defaultQuery = useQuery({
    queryKey: ['ai-dashboard'],
    queryFn: aiGetDashboard,
    staleTime: 60_000,
  });

  // null = dar nepersirašyta per chat'ą; rodom default'inį iš query.
  const [overrideSpec, setOverrideSpec] = React.useState<AiDashboardSpec | null>(null);
  const [generation, setGeneration] = React.useState(0);
  const [messages, setMessages] = React.useState<AiChatDisplayMessage[]>([]);
  const [busy, setBusy] = React.useState(false);
  const [statusLabel, setStatusLabel] = React.useState<string | null>(null);
  const [chatOpen, setChatOpen] = React.useState(false);

  const streamRef = React.useRef<AiChatStreamHandle | null>(null);
  const specRef = React.useRef<AiDashboardSpec | null>(null);
  specRef.current = overrideSpec ?? defaultQuery.data?.spec ?? null;

  // Unmount — nutraukiam aktyvų stream'ą.
  React.useEffect(() => () => streamRef.current?.abort(), []);

  const handleEvent = React.useCallback((event: AiChatEvent): void => {
    switch (event.type) {
      case 'status':
        setStatusLabel(event.label);
        break;
      case 'spec':
        setOverrideSpec(event.spec);
        setGeneration((g) => g + 1);
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
  }, []);

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
    void defaultQuery.refetch();
  }, [defaultQuery]);

  const spec = overrideSpec ?? defaultQuery.data?.spec ?? null;

  return (
    <div className="flex h-full min-h-0">
      {/* --- Drobė --- */}
      <div className="min-w-0 flex-1 overflow-y-auto">
        <div className="mx-auto max-w-6xl p-4 md:p-6">
          <div className="mb-3 flex items-center justify-end gap-2">
            {overrideSpec ? (
              <Button variant="outline" size="sm" onClick={reset}>
                <RotateCcw className="mr-1.5 h-3.5 w-3.5" />
                Pradinis vaizdas
              </Button>
            ) : null}
          </div>

          {spec ? (
            <DashboardCanvas spec={spec} generation={generation} />
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
            onSend={send}
            onStop={stop}
          />
        </SheetContent>
      </Sheet>
    </div>
  );
}
