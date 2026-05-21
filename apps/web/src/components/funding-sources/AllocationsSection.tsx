/**
 * `AllocationsSection` — embedded blokas su šaltinio paskirstymais.
 *
 * Naudojamas kortelėje per šaltinio detalę. Rodo paskirstymų sąrašą su
 * suma + kategorija + spec.prog.tipas. AM admin'as gali pridėti / redaguoti /
 * trinti per `BudgetAllocationDialog`.
 *
 * Permission'us prižiūri kviečiantis komponentas — čia mygtukai paslepiami
 * pagal `canEdit` prop.
 */
import * as React from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import axios from 'axios';
import { Pencil, Plus, Trash2 } from 'lucide-react';
import type { BudgetAllocation, FundingSource } from '@biip-finansai/shared';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { BudgetAllocationDialog } from '@/components/budget-allocations/BudgetAllocationDialog';
import { budgetAllocationsApi } from '@/lib/api/fvm';

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

export interface AllocationsSectionProps {
  source: FundingSource;
  canEdit: boolean;
}

export function AllocationsSection({ source, canEdit }: AllocationsSectionProps): JSX.Element {
  const qc = useQueryClient();
  const [dialog, setDialog] = React.useState<{
    mode: 'create' | 'edit';
    allocation: BudgetAllocation | null;
  } | null>(null);

  const listQ = useQuery<BudgetAllocation[]>({
    queryKey: ['budgetAllocations', { fundingSourceId: source.id }],
    queryFn: () => budgetAllocationsApi.list({ fundingSourceId: source.id }),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => budgetAllocationsApi.remove(id),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['budgetAllocations'] });
      void qc.invalidateQueries({ queryKey: ['fundingSources'] });
    },
    onError: (err: unknown) => {
      let msg = 'Nepavyko ištrinti paskirstymo.';
      if (axios.isAxiosError(err)) {
        const data = err.response?.data as { message?: string } | undefined;
        if (data?.message) msg = data.message;
      } else if (err instanceof Error) {
        msg = err.message;
      }
      window.alert(msg);
    },
  });

  function handleDelete(a: BudgetAllocation): void {
    if (!window.confirm(`Ar tikrai ištrinti paskirstymą „${a.pavadinimas}"?`)) return;
    deleteMutation.mutate(a.id);
  }

  const items = listQ.data ?? [];

  return (
    <section className="space-y-2">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
          Paskirstymai
        </h3>
        {canEdit && (
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() => setDialog({ mode: 'create', allocation: null })}
            data-testid="open-new-allocation"
          >
            <Plus className="h-3.5 w-3.5" />
            Pridėti paskirstymą
          </Button>
        )}
      </div>

      {listQ.isLoading ? (
        <Skeleton className="h-16" />
      ) : items.length === 0 ? (
        <p className="rounded-md border border-dashed border-border px-3 py-4 text-center text-sm text-muted-foreground">
          Šis šaltinis dar neturi paskirstymų.
        </p>
      ) : (
        <ul className="divide-y divide-border rounded-md border border-border">
          {items.map((a) => (
            <li
              key={a.id}
              className="flex flex-col gap-2 px-3 py-2 text-sm sm:flex-row sm:items-center sm:justify-between"
            >
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium">{a.pavadinimas}</span>
                  {a.categoryName && (
                    <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-muted-foreground">
                      {a.categoryName}
                    </span>
                  )}
                  {a.specProgTipas && (
                    <span className="rounded bg-primary/10 px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-primary">
                      {a.specProgTipas === 'atskiras' ? 'Atskiras' : 'Biudžeto dalis'}
                    </span>
                  )}
                </div>
                {a.pastabos && (
                  <p className="mt-0.5 line-clamp-1 text-[11px] text-muted-foreground">
                    {a.pastabos}
                  </p>
                )}
              </div>
              <div className="flex items-center gap-3">
                <span className="font-semibold tabular-nums">
                  {formatEur(a.planuotaSuma)}
                </span>
                {canEdit && (
                  <div className="flex gap-1">
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      onClick={() => setDialog({ mode: 'edit', allocation: a })}
                      title="Redaguoti"
                    >
                      <Pencil className="h-3.5 w-3.5" />
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      className="text-destructive hover:text-destructive"
                      onClick={() => handleDelete(a)}
                      title="Ištrinti"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}

      {dialog !== null && (
        <BudgetAllocationDialog
          mode={dialog.mode}
          allocation={dialog.allocation}
          defaultFundingSourceId={source.id}
          defaultYear={source.metai}
          open
          onOpenChange={(o) => {
            if (!o) setDialog(null);
          }}
          onSuccess={() => {
            void qc.invalidateQueries({ queryKey: ['budgetAllocations'] });
            void qc.invalidateQueries({ queryKey: ['fundingSources'] });
            setDialog(null);
          }}
        />
      )}
    </section>
  );
}
