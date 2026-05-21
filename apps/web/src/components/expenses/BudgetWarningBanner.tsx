/**
 * `BudgetWarningBanner` — biudžeto suvestinė su progress bar'u ir warning
 * flag'ais (Iter 12, FVM-4).
 *
 * Vienodas wrapper'is gali būti naudojamas tiek `BudgetAllocationSummary`
 * (allocation lygmenyje), tiek `ProjectSummary` (projekto lygmenyje) — pateikiama
 * per props.
 *
 * Spalvos:
 *  - Neutralus (default) — kai percentUsed < 80
 *  - Geltonas (warning) — kai isWarning && !isOver (>= 80 ir <= 100)
 *  - Raudonas (destructive) — kai isOver (> 100)
 *
 * A11y:
 *  - `role="status"` su LT screen reader friendly tekstu
 *  - progress bar'as turi `aria-valuenow/min/max`
 */
import * as React from 'react';
import { AlertTriangle, CheckCircle2, TriangleAlert } from 'lucide-react';
import { cn } from '@/lib/utils';

function formatEur(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return '—';
  const num = typeof value === 'string' ? Number.parseFloat(value) : value;
  if (!Number.isFinite(num)) return '0,00 €';
  return new Intl.NumberFormat('lt-LT', {
    style: 'currency',
    currency: 'EUR',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(num);
}

export interface BudgetWarningBannerProps {
  /** Planuotos / faktinės sumos pavadinimas — pvz., „Biudžetas" arba „Planuota". */
  planuotaLabel?: string;
  /** Faktinės sumos pavadinimas — pvz., „Panaudota" arba „Faktinė". */
  panaudotaLabel?: string;
  planuota: string;
  panaudota: string;
  likutis: string;
  /** Procentas panaudota (0–N). N > 100 — viršyta. */
  percentUsed: number;
  isWarning: boolean;
  isOver: boolean;
  /** Įspėjimo riba (default 80%). Naudojama tekste. */
  thresholdPercent?: number;
  className?: string;
}

export function BudgetWarningBanner({
  planuotaLabel = 'Planuota',
  panaudotaLabel = 'Faktinė',
  planuota,
  panaudota,
  likutis,
  percentUsed,
  isWarning,
  isOver,
  thresholdPercent = 80,
  className,
}: BudgetWarningBannerProps): JSX.Element {
  const tone: 'default' | 'warning' | 'destructive' = isOver
    ? 'destructive'
    : isWarning
      ? 'warning'
      : 'default';

  const likutisNum = Number.parseFloat(likutis) || 0;
  const likutisLabel = likutisNum < -0.005 ? 'Viršyta' : 'Likutis';
  const likutisValue = formatEur(Math.abs(likutisNum));

  // Progress bar'as — apribojam iki 100, bet vizualiai parodom > 100 indikatorių.
  const cappedPercent = Math.min(Math.max(percentUsed, 0), 100);
  const percentLabel = `${percentUsed.toFixed(1)}%`;

  const borderCls = cn(
    'border',
    tone === 'destructive' && 'border-destructive/40 bg-destructive/5',
    tone === 'warning' && 'border-orange-300/60 bg-orange-50',
    tone === 'default' && 'border-border',
  );

  const barCls = cn(
    'h-2 rounded-full transition-all',
    tone === 'destructive' && 'bg-destructive',
    tone === 'warning' && 'bg-orange-500',
    tone === 'default' && 'bg-primary',
  );

  const icon = isOver ? (
    <AlertTriangle className="h-4 w-4 text-destructive" />
  ) : isWarning ? (
    <TriangleAlert className="h-4 w-4 text-orange-600" />
  ) : (
    <CheckCircle2 className="h-4 w-4 text-emerald-600" />
  );

  const message = isOver
    ? `Biudžetas viršytas: panaudota ${percentLabel} (riba ${thresholdPercent}%)`
    : isWarning
      ? `Panaudojimas: ${percentLabel} (riba ${thresholdPercent}%)`
      : `Panaudojimas: ${percentLabel}`;

  return (
    <div
      role="status"
      aria-live="polite"
      data-testid="budget-warning-banner"
      data-tone={tone}
      className={cn('space-y-3 rounded-md px-3 py-3', borderCls, className)}
    >
      <div className="flex items-start gap-2">
        {icon}
        <p
          className={cn(
            'flex-1 text-sm font-medium',
            tone === 'destructive' && 'text-destructive',
            tone === 'warning' && 'text-orange-800',
            tone === 'default' && 'text-foreground',
          )}
        >
          {message}
        </p>
      </div>

      <div className="space-y-1">
        <div className="flex items-center justify-between text-xs text-muted-foreground">
          <span>{planuotaLabel}</span>
          <span className="tabular-nums font-medium text-foreground">
            {formatEur(planuota)}
          </span>
        </div>
        <div className="flex items-center justify-between text-xs text-muted-foreground">
          <span>{panaudotaLabel}</span>
          <span className="tabular-nums font-medium text-foreground">
            {formatEur(panaudota)}
          </span>
        </div>
        <div className="flex items-center justify-between text-xs text-muted-foreground">
          <span>{likutisLabel}</span>
          <span
            className={cn(
              'tabular-nums font-medium',
              likutisNum < -0.005 ? 'text-destructive' : 'text-foreground',
            )}
          >
            {likutisValue}
          </span>
        </div>
      </div>

      <div
        className="h-2 w-full overflow-hidden rounded-full bg-muted"
        role="progressbar"
        aria-valuenow={Math.round(percentUsed)}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label="Biudžeto panaudojimas"
        data-testid="budget-progress-bar"
      >
        <div className={barCls} style={{ width: `${cappedPercent}%` }} />
      </div>
    </div>
  );
}

export default BudgetWarningBanner;
