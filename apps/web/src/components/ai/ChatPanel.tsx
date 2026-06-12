/**
 * AI asistento chat panelė (Iter 17, eksperimentinis).
 *
 * Dešinysis šonas AI pradžios puslapyje — CopilotKit stiliaus pokalbis,
 * per kurį LLM perpiešia dashboard'ą. Pati panelė state'o nelaiko —
 * viskas ateina iš `AiHomePage` (controlled component).
 */
import * as React from 'react';
import { CircleStop, Send, Sparkles } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

export interface AiChatDisplayMessage {
  role: 'user' | 'assistant';
  content: string;
  error?: boolean;
}

export interface ChatPanelProps {
  messages: AiChatDisplayMessage[];
  busy: boolean;
  statusLabel: string | null;
  suggestions: string[];
  onSend: (text: string) => void;
  onStop: () => void;
  className?: string;
}

export function ChatPanel({
  messages,
  busy,
  statusLabel,
  suggestions,
  onSend,
  onStop,
  className,
}: ChatPanelProps): JSX.Element {
  const [input, setInput] = React.useState('');
  const scrollRef = React.useRef<HTMLDivElement>(null);
  const textareaRef = React.useRef<HTMLTextAreaElement>(null);

  // Auto-scroll žemyn atėjus naujai žinutei / statusui.
  React.useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages, statusLabel]);

  const submit = (text: string): void => {
    const trimmed = text.trim();
    if (!trimmed || busy) return;
    setInput('');
    onSend(trimmed);
    // Pasiūlymo chip'ai po pirmo submit'o unmount'inasi — fokusą perkeliam į
    // input'ą, kad klaviatūros vartotojas neliktų ant <body>.
    textareaRef.current?.focus();
  };

  return (
    <div className={cn('flex h-full min-h-0 flex-col bg-card', className)}>
      <div className="flex h-14 shrink-0 items-center gap-2 border-b px-4">
        <div className="flex h-7 w-7 items-center justify-center rounded-md bg-primary/10 text-primary">
          <Sparkles className="h-4 w-4" />
        </div>
        <div className="min-w-0">
          <div className="text-sm font-semibold leading-tight">AI asistentas</div>
          <div className="text-[11px] text-muted-foreground">Perpiešia vaizdą pagal prašymą</div>
        </div>
      </div>

      <div
        ref={scrollRef}
        role="log"
        aria-live="polite"
        aria-busy={busy}
        className="min-h-0 flex-1 space-y-3 overflow-y-auto p-4"
      >
        {messages.length === 0 ? (
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">
              Paprašykite perpiešti pradžios vaizdą — asistentas surinks realius duomenis ir
              sugeneruos naują išdėstymą. Pavyzdžiui:
            </p>
            <div className="flex flex-col items-start gap-2">
              {suggestions.map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => submit(s)}
                  disabled={busy}
                  className="rounded-full border bg-background px-3 py-1.5 text-left text-xs transition-colors hover:border-primary/40 hover:bg-accent disabled:opacity-50"
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
        ) : (
          messages.map((m, i) => (
            <div
              key={i}
              className={cn(
                'max-w-[88%] whitespace-pre-wrap rounded-lg px-3 py-2 text-sm',
                m.role === 'user'
                  ? 'ml-auto bg-primary text-primary-foreground'
                  : m.error
                    ? 'mr-auto border border-destructive/30 bg-destructive/5 text-destructive'
                    : 'mr-auto bg-muted',
              )}
            >
              {m.content}
            </div>
          ))
        )}

        {busy ? (
          <div className="mr-auto flex items-center gap-2 rounded-lg bg-muted px-3 py-2 text-xs text-muted-foreground">
            <span className="relative flex h-2 w-2 shrink-0">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-primary opacity-60" />
              <span className="relative inline-flex h-2 w-2 rounded-full bg-primary" />
            </span>
            {statusLabel ?? 'Galvojama…'}
          </div>
        ) : null}
      </div>

      <div className="shrink-0 border-t p-3">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            submit(input);
          }}
          className="flex items-end gap-2"
        >
          <textarea
            ref={textareaRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                submit(input);
              }
            }}
            rows={2}
            placeholder={'Ko norėtumėte? Pvz.: „rodyk tik biudžeto vykdymą“…'}
            aria-label="Žinutė AI asistentui"
            className="min-h-[40px] flex-1 resize-none rounded-md border border-input bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
          {busy ? (
            <Button
              type="button"
              variant="outline"
              size="icon"
              onClick={onStop}
              aria-label="Stabdyti"
            >
              <CircleStop className="h-4 w-4" />
            </Button>
          ) : (
            <Button type="submit" size="icon" disabled={!input.trim()} aria-label="Siųsti">
              <Send className="h-4 w-4" />
            </Button>
          )}
        </form>
        <p className="mt-1.5 text-[10px] leading-tight text-muted-foreground">
          Eksperimentinis AI — skaičius verta pasitikrinti. Duomenys rodomi pagal jūsų teises.
        </p>
      </div>
    </div>
  );
}
