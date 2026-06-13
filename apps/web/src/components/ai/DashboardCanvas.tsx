/**
 * AI dashboard drobė (Iter 17, eksperimentinis).
 *
 * Atvaizduoja `AiDashboardSpec` 4 stulpelių tinklelyje. `generation` prop'as
 * keičiasi su kiekvienu perpiešimu — naudojamas React key'uose, kad nauji
 * widget'ai gautų įėjimo animaciją (stagger pagal indeksą).
 */
import type { AiDashboardSpec } from '@biip-finansai/shared';
import { isRenderableWidget, WidgetRenderer } from '@/components/ai/widgets';

export interface DashboardCanvasProps {
  spec: AiDashboardSpec;
  generation: number;
}

export function DashboardCanvas({ spec, generation }: DashboardCanvasProps): JSX.Element {
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
