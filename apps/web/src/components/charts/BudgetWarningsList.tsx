/**
 * `BudgetWarningsList` — top biudžeto eilučių su didžiausiu panaudojimu sąrašas
 * (Iter 12, FVM-4).
 *
 * Naudoja `expensesApi.budgetSummary({ year })` endpoint'ą — grąžinami visi
 * tenant scope leidžiami allocations, surūšiuoti pagal `percentUsed` mažėjančia
 * tvarka. Pirmieji `topN` rodomi su progress bar'u + warning indikatoriais.
 *
 * Tone'as priklauso nuo flag'ų:
 *  - isOver === true     → destructive (raudonas)
 *  - isWarning === true  → warning (geltonas)
 *  - kitaip              → default (mėlynas)
 *
 * Naudojama tiek dedicated /ispejimai page'e, tiek embed'iškai StatistikaPage.
 */
import * as React from 'react';
import { useQuery } from '@tanstack/react-query';
import { AlertTriangle, TriangleAlert } from 'lucide-react';
import type {
  BudgetWarningItem,
  BudgetWarningsResponse,
} from '@biip-finansai/shared';
import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { expensesApi } from '@/lib/api/fvm';
import { cn } from '@/lib/utils';

function formatEur(value: string | number): string {
  const num = typeof value === 'string' ? Number.parseFloat(value) : value;
  if (!Number.isFinite(num)) return '0,00 €';
  return new Intl.NumberFormat('lt-LT', {
    style: 'currency',
    currency: 'EUR',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(num);
}

export interface BudgetWarningsListProps {
  year: number;
  /** Maksimalus rodomų eilučių skaičius (default 5). */
  topN?: number;
  /** Tik warning eilutės (isWarning === true). Default — true. */
  onlyWarnings?: boolean;
}

export function BudgetWarningsList({
  year,
  topN = 5,
  onlyWarnings = true,
}: BudgetWarningsListProps): JSX.Element {
  const q = useQuery<BudgetWarningsResponse>({
    queryKey: ['budgetWarnings', { year }],
    queryFn: () => expensesApi.budgetSummary({ year }),
  });

  if (q.isLoading) {
    return (
      <div className="space-y-2" data-testid="budget-warnings-skeleton">
        {Array.from({ length: 3 }).map((_, i) => (
          <Skeleton key={i} className="h-12" />
        ))}
      </div>
    );
  }

  if (q.isError) {
    return (
      <Card>
        <CardContent className="p-4 text-center text-sm text-destructive">
          Nepavyko užkrauti įspėjimų sąrašo.
        </CardContent>
      </Card>
    );
  }

  const allItems = q.data?.items ?? [];
  // Sort'inam pagal percentUsed desc, kad warning'ai bus pirmi.
  const sorted = [...allItems].sort((a, b) => b.percentUsed - a.percentUsed);
  const filtered = onlyWarnings ? sorted.filter((i) => i.isWarning) : sorted;
  const items = filtered.slice(0, topN);

  if (items.length === 0) {
    return (
      <div
        className="rounded-md border border-dashed border-border px-3 py-6 text-center text-sm text-muted-foreground"
        data-testid="budget-warnings-empty"
      >
        {onlyWarnings
          ? 'Įspėjimų nėra — visi paskirstymai naudoja mažiau nei 80% biudžeto.'
          : 'Paskirstymų sąrašas tuščias.'}
      </div>
    );
  }

  return (
    <ul className="space-y-2" data-testid="budget-warnings-list">
      {items.map((item) => (
        <BudgetWarningRow key={item.allocationId} item={item} />
      ))}
    </ul>
  );
}

function BudgetWarningRow({ item }: { item: BudgetWarningItem }): JSX.Element {
  const tone: 'default' | 'warning' | 'destructive' = item.isOver
    ? 'destructive'
    : item.isWarning
      ? 'warning'
      : 'default';
  const cappedPercent = Math.min(Math.max(item.percentUsed, 0), 100);

  const barCls = cn(
    'h-2 rounded-full transition-all',
    tone === 'destructive' && 'bg-destructive',
    tone === 'warning' && 'bg-orange-500',
    tone === 'default' && 'bg-primary',
  );

  const borderCls = cn(
    'rounded-md border px-3 py-2',
    tone === 'destructive' && 'border-destructive/40 bg-destructive/5',
    tone === 'warning' && 'border-orange-300/60 bg-orange-50',
    tone === 'default' && 'border-border',
  );

  return (
    <li
      className={borderCls}
      data-testid={`budget-warning-row-${item.allocationId}`}
      data-tone={tone}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            {item.isOver ? (
              <AlertTriangle className="h-3.5 w-3.5 shrink-0 text-destructive" />
            ) : item.isWarning ? (
              <TriangleAlert className="h-3.5 w-3.5 shrink-0 text-orange-600" />
            ) : null}
            <p className="truncate text-sm font-medium">
              {item.allocationName}
            </p>
          </div>
          <p className="truncate text-[11px] text-muted-foreground">
            {item.fundingSourceName}
          </p>
        </div>
        <div className="shrink-0 text-right">
          <p
            className={cn(
              'text-sm font-semibold tabular-nums',
              tone === 'destructive' && 'text-destructive',
              tone === 'warning' && 'text-orange-700',
            )}
          >
            {item.percentUsed.toFixed(1)}%
          </p>
          <p className="text-[11px] tabular-nums text-muted-foreground">
            {formatEur(item.faktine)} / {formatEur(item.planuota)}
          </p>
        </div>
      </div>
      <div className="mt-2 h-2 w-full overflow-hidden rounded-full bg-muted">
        <div className={barCls} style={{ width: `${cappedPercent}%` }} />
      </div>
    </li>
  );
}

export default BudgetWarningsList;
