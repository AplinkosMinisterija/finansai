/**
 * AI dashboard drobė (Iter 17–18, eksperimentinis).
 *
 * Atvaizduoja `AiDashboardSpec` 4 stulpelių tinklelyje. `generation` prop'as
 * keičiasi su kiekvienu PERPIEŠIMU (AI chat) — naudojamas React key'uose, kad
 * nauji widget'ai gautų įėjimo animaciją (stagger pagal indeksą). Pločio/vietos
 * keitimai generation'o NEkeičia — kortelės persitvarko sklandžiai, be re-anim.
 *
 * Iter 18: per-widget plotis (¼/½/pilnas) + tempimas-rūšiavimas (native HTML5
 * drag, be bibliotekos). Idėja perimta ir pritaikyta iš LKPB/OIS.
 */
import * as React from 'react';
import type { AiDashboardSpec } from '@biip-finansai/shared';
import { isRenderableWidget, WidgetRenderer } from '@/components/ai/widgets';

export interface DashboardCanvasProps {
  spec: AiDashboardSpec;
  generation: number;
  /** Per-widget pločio keitimas (id, span). Kai nustatyta — rodomas jungiklis. */
  onSpanChange?: (id: string, span: number) => void;
  /** Perrūšiuoja widget'us (perkelia fromId į toId vietą). Kai nustatyta — rodomos rankenėlės. */
  onReorder?: (fromId: string, toId: string) => void;
  /** Pašalina widgetą (id). Kai nustatyta — rodomas ištrynimo mygtukas. */
  onDelete?: (id: string) => void;
}

export function DashboardCanvas({
  spec,
  generation,
  onSpanChange,
  onReorder,
  onDelete,
}: DashboardCanvasProps): JSX.Element {
  const [dragId, setDragId] = React.useState<string | null>(null);
  const [overId, setOverId] = React.useState<string | null>(null);

  // Kai nė vienas widget'as neturi duomenų (pvz. pasirinkti metai be duomenų) —
  // rodom aiškią žinutę vietoj tuščio tinklelio.
  const anyRenderable = spec.widgets.some(isRenderableWidget);
  return (
    <div data-testid="ai-dashboard-canvas">
      {spec.title || spec.subtitle ? (
        <div className="mb-4">
          {spec.title ? <h1 className="text-xl font-semibold">{spec.title}</h1> : null}
          {spec.subtitle ? (
            <p className="mt-0.5 text-sm text-muted-foreground">{spec.subtitle}</p>
          ) : null}
        </div>
      ) : null}
      {anyRenderable ? (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4 md:gap-4">
          {spec.widgets.map((w, i) => (
            <WidgetRenderer
              key={`${generation}-${w.id}`}
              widget={w}
              style={{ animationDelay: `${i * 45}ms` }}
              onSpanChange={onSpanChange ? (span) => onSpanChange(w.id, span) : undefined}
              onDelete={onDelete ? () => onDelete(w.id) : undefined}
              reorder={
                onReorder
                  ? {
                      onDragStart: () => setDragId(w.id),
                      onDragEnterTarget: () => setOverId(w.id),
                      onDropOn: () => {
                        if (dragId && dragId !== w.id) onReorder(dragId, w.id);
                        setDragId(null);
                        setOverId(null);
                      },
                      onDragEnd: () => {
                        setDragId(null);
                        setOverId(null);
                      },
                      isDropTarget: Boolean(dragId) && dragId !== w.id && overId === w.id,
                    }
                  : undefined
              }
            />
          ))}
        </div>
      ) : (
        <div className="rounded-lg border border-dashed p-10 text-center text-sm text-muted-foreground">
          Pagal pasirinktus filtrus (pvz. metus) duomenų nėra. Pabandykite kitus metus arba
          paspauskite „Pradinis vaizdas".
        </div>
      )}
    </div>
  );
}
