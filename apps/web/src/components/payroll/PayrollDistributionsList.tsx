/**
 * `PayrollDistributionsList` — embedded blokas su profile'o paskirstymais.
 *
 * Naudojamas profile detail dialog'e. Rodo sąrašą su:
 *  - finansavimo šaltinio pavadinimas
 *  - paskirstymo tipas + reikšmė (% arba €)
 *  - galiojimo periodas
 *  - veiksmų mygtukai (edit/delete) jei `canEdit`
 *
 * Pateikia bendrą SUM(procentais) viršuje informaciniam vartotojui (validation
 * yra backend'e, bet UI pranešimas naudingas).
 */
import * as React from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import axios from 'axios';
import { Pencil, Plus, Trash2 } from 'lucide-react';
import type { PayrollDistribution, PayrollProfile } from '@biip-finansai/shared';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { payrollApi } from '@/lib/api/fvm';
import { toast } from '@/lib/use-toast';
import { PayrollDistributionDialog } from './PayrollDistributionDialog';

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

function formatDate(value: string | null | undefined): string {
  if (!value) return '—';
  return value.slice(0, 10);
}

export interface PayrollDistributionsListProps {
  profile: PayrollProfile;
  canEdit: boolean;
}

export function PayrollDistributionsList({
  profile,
  canEdit,
}: PayrollDistributionsListProps): JSX.Element {
  const qc = useQueryClient();
  const [dialog, setDialog] = React.useState<{
    mode: 'create' | 'edit';
    distribution: PayrollDistribution | null;
  } | null>(null);

  const listQ = useQuery<PayrollDistribution[]>({
    queryKey: ['payrollDistributions', { profileId: profile.id }],
    queryFn: () => payrollApi.listDistributions({ profileId: profile.id }),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => payrollApi.removeDistribution(id),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['payrollDistributions'] });
      toast({ title: 'Paskirstymas ištrintas', variant: 'success' });
    },
    onError: (err: unknown) => {
      let msg = 'Nepavyko ištrinti paskirstymo.';
      if (axios.isAxiosError(err)) {
        const data = err.response?.data as { message?: string } | undefined;
        if (data?.message) msg = data.message;
      } else if (err instanceof Error) {
        msg = err.message;
      }
      toast({ title: msg, variant: 'error' });
    },
  });

  function handleDelete(d: PayrollDistribution): void {
    if (
      !window.confirm(
        `Ar tikrai ištrinti paskirstymą? (${d.fundingSourceName ?? `Šaltinis #${d.fundingSourceId}`})`,
      )
    ) {
      return;
    }
    deleteMutation.mutate(d.id);
  }

  const items = listQ.data ?? [];
  const percentSum = items
    .filter((d) => d.paskirstymoTipas === 'procentais')
    .reduce((acc, d) => acc + (Number.parseFloat(d.reiksme) || 0), 0);
  const fixedSum = items
    .filter((d) => d.paskirstymoTipas === 'fiksuota')
    .reduce((acc, d) => acc + (Number.parseFloat(d.reiksme) || 0), 0);

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
            onClick={() => setDialog({ mode: 'create', distribution: null })}
            data-testid="open-new-distribution"
          >
            <Plus className="h-3.5 w-3.5" />
            Pridėti paskirstymą
          </Button>
        )}
      </div>

      {listQ.isLoading ? (
        <Skeleton className="h-16" />
      ) : items.length === 0 ? (
        <p
          className="rounded-md border border-dashed border-border px-3 py-4 text-center text-sm text-muted-foreground"
          data-testid="distributions-empty"
        >
          Šis profilis dar neturi paskirstymų.
        </p>
      ) : (
        <>
          <ul
            className="divide-y divide-border rounded-md border border-border"
            data-testid="distributions-list"
          >
            {items.map((d) => (
              <li
                key={d.id}
                data-testid={`distribution-row-${d.id}`}
                className="flex flex-col gap-2 px-3 py-2 text-sm sm:flex-row sm:items-center sm:justify-between"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium">
                      {d.fundingSourceName ?? `Šaltinis #${d.fundingSourceId}`}
                    </span>
                    {d.fundingSourceCode && (
                      <code className="rounded bg-muted px-1.5 py-0.5 text-[10px] font-mono">
                        {d.fundingSourceCode}
                      </code>
                    )}
                    <span className="rounded bg-primary/10 px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-primary">
                      {d.paskirstymoTipas === 'procentais'
                        ? `${Number.parseFloat(d.reiksme).toFixed(2)} %`
                        : formatEur(d.reiksme)}
                    </span>
                  </div>
                  <div className="mt-0.5 text-[11px] text-muted-foreground">
                    {formatDate(d.galiojaNuo)} – {formatDate(d.galiojaIki)}
                  </div>
                </div>
                {canEdit && (
                  <div className="flex gap-1">
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      onClick={() => setDialog({ mode: 'edit', distribution: d })}
                      title="Redaguoti"
                      data-testid={`edit-distribution-${d.id}`}
                    >
                      <Pencil className="h-3.5 w-3.5" />
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      className="text-destructive hover:text-destructive"
                      onClick={() => handleDelete(d)}
                      title="Ištrinti"
                      data-testid={`delete-distribution-${d.id}`}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                )}
              </li>
            ))}
          </ul>

          <div
            className="flex flex-wrap items-center justify-end gap-3 text-[11px] text-muted-foreground"
            data-testid="distributions-totals"
          >
            <span>
              Iš viso procentais:{' '}
              <span
                className={
                  percentSum > 100 ? 'font-medium text-destructive' : 'font-medium'
                }
              >
                {percentSum.toFixed(2)} %
              </span>
            </span>
            {fixedSum > 0 && (
              <span>
                Iš viso fiksuota:{' '}
                <span className="font-medium">{formatEur(fixedSum)}</span>
              </span>
            )}
          </div>
        </>
      )}

      {dialog !== null && (
        <PayrollDistributionDialog
          mode={dialog.mode}
          distribution={dialog.distribution}
          profile={profile}
          open
          onOpenChange={(o) => {
            if (!o) setDialog(null);
          }}
          onSuccess={() => {
            void qc.invalidateQueries({ queryKey: ['payrollDistributions'] });
            toast({
              title: dialog.mode === 'edit' ? 'Paskirstymas atnaujintas' : 'Paskirstymas sukurtas',
              variant: 'success',
            });
            setDialog(null);
          }}
        />
      )}
    </section>
  );
}

export default PayrollDistributionsList;
