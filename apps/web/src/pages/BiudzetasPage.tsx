/**
 * Biudžeto paskirstymų puslapis (Iter 9, FVM-1 refactor).
 *
 * Pervadintas iš senojo 1-lygio biudžeto modelio į naują 2-lygio FVM modelį
 * (žr. `docs/fvm/01-architecture.md`). Senasis `Budget` + `LegacyBudgetAllocation`
 * tipai yra deprecated ir paliekami tik istorinių duomenų skaitymui (Iter 16).
 *
 * Šis puslapis rodo VISUS paskirstymus per skirtingus šaltinius, su filtrais:
 *  - metai
 *  - šaltinis (dropdown su funding sources)
 *  - kategorija (klasifikatorius `budget_category`)
 *
 * AM administratoriai mato „Naujas paskirstymas" mygtuką ir edit/delete eilutės
 * veiksmus. Klikinti eilutę — atveria BudgetAllocationDialog edit režime.
 */
import * as React from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import axios from 'axios';
import { Pencil, Plus, Trash2, Wallet } from 'lucide-react';
import type {
  BudgetAllocation,
  ClassifierItem,
  FundingSource,
} from '@biip-finansai/shared';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { BudgetAllocationDialog } from '@/components/budget-allocations/BudgetAllocationDialog';
import { useAuth } from '@/lib/auth';
import { canManageBudget } from '@/lib/roles';
import { classifierItemsList } from '@/lib/api';
import { budgetAllocationsApi, fundingSourcesApi } from '@/lib/api/fvm';

const ALL_VALUE = '__all__';

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

export default function BiudzetasPage(): JSX.Element {
  const { user } = useAuth();
  const qc = useQueryClient();
  const canEdit = canManageBudget(user);
  const now = new Date();
  const [year, setYear] = React.useState<number | null>(now.getFullYear());
  const [fundingSourceId, setFundingSourceId] = React.useState<number | null>(null);
  const [categoryItemId, setCategoryItemId] = React.useState<number | null>(null);

  const [dialog, setDialog] = React.useState<{
    mode: 'create' | 'edit';
    allocation: BudgetAllocation | null;
  } | null>(null);

  const sourcesQ = useQuery<FundingSource[]>({
    queryKey: ['fundingSources', {}],
    queryFn: () => fundingSourcesApi.list({}),
  });

  const categoriesQ = useQuery<ClassifierItem[]>({
    queryKey: ['classifierItems', { groupCode: 'budget_category' }],
    queryFn: () => classifierItemsList({ groupCode: 'budget_category' }),
    staleTime: 5 * 60 * 1000,
  });

  const listQ = useQuery<BudgetAllocation[]>({
    queryKey: ['budgetAllocations', { year, fundingSourceId, categoryItemId }],
    queryFn: () =>
      budgetAllocationsApi.list({
        year: year ?? undefined,
        fundingSourceId: fundingSourceId ?? undefined,
        categoryItemId: categoryItemId ?? undefined,
      }),
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

  const sources = sourcesQ.data ?? [];
  const categories = (categoriesQ.data ?? []).filter((c) => c.active);
  const items = listQ.data ?? [];

  const totalPlanuota = items.reduce(
    (acc, a) => acc + (Number.parseFloat(a.planuotaSuma) || 0),
    0,
  );

  const years: number[] = [];
  for (let y = now.getFullYear() - 1; y <= now.getFullYear() + 5; y += 1) {
    years.push(y);
  }

  return (
    <div className="mx-auto max-w-7xl p-4 md:p-6">
      <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-semibold tracking-tight">
            <Wallet className="h-6 w-6 text-muted-foreground" />
            Biudžeto paskirstymai
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            2 FVM lygis: „Kam skiriama?". Kiekvienas paskirstymas priklauso vienam
            finansavimo šaltiniui.
          </p>
        </div>
        <div className="flex flex-wrap items-end gap-2">
          {canEdit && (
            <Button
              onClick={() => setDialog({ mode: 'create', allocation: null })}
              data-testid="open-new-budget-allocation"
            >
              <Plus className="h-4 w-4" />
              Naujas paskirstymas
            </Button>
          )}
        </div>
      </div>

      <Card className="mb-4">
        <CardContent className="grid gap-3 p-4 sm:grid-cols-3">
          <div className="space-y-1">
            <Label htmlFor="ba-flt-year" className="text-xs text-muted-foreground">
              Metai
            </Label>
            <Select
              value={year === null ? ALL_VALUE : String(year)}
              onValueChange={(v) =>
                setYear(v === ALL_VALUE ? null : Number.parseInt(v, 10))
              }
            >
              <SelectTrigger id="ba-flt-year">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL_VALUE}>Visi metai</SelectItem>
                {years.map((y) => (
                  <SelectItem key={y} value={String(y)}>
                    {y}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label htmlFor="ba-flt-source" className="text-xs text-muted-foreground">
              Šaltinis
            </Label>
            <Select
              value={fundingSourceId === null ? ALL_VALUE : String(fundingSourceId)}
              onValueChange={(v) =>
                setFundingSourceId(v === ALL_VALUE ? null : Number.parseInt(v, 10))
              }
            >
              <SelectTrigger id="ba-flt-source">
                <SelectValue placeholder="Visi šaltiniai" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL_VALUE}>Visi šaltiniai</SelectItem>
                {sources.map((s) => (
                  <SelectItem key={s.id} value={String(s.id)}>
                    {s.pavadinimas} ({s.kodas}, {s.metai})
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label htmlFor="ba-flt-category" className="text-xs text-muted-foreground">
              Kategorija
            </Label>
            <Select
              value={categoryItemId === null ? ALL_VALUE : String(categoryItemId)}
              onValueChange={(v) =>
                setCategoryItemId(v === ALL_VALUE ? null : Number.parseInt(v, 10))
              }
            >
              <SelectTrigger id="ba-flt-category">
                <SelectValue placeholder="Visos kategorijos" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL_VALUE}>Visos kategorijos</SelectItem>
                {categories.map((c) => (
                  <SelectItem key={c.id} value={String(c.id)}>
                    {c.name} ({c.code})
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

      {listQ.isLoading ? (
        <div className="space-y-2" data-testid="budget-allocations-skeleton">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-12" />
          ))}
        </div>
      ) : listQ.isError ? (
        <Card>
          <CardContent className="p-6 text-center text-sm text-destructive">
            Nepavyko užkrauti paskirstymų.
          </CardContent>
        </Card>
      ) : items.length === 0 ? (
        <Card>
          <CardContent
            className="p-12 text-center text-sm text-muted-foreground"
            data-testid="budget-allocations-empty"
          >
            {canEdit
              ? 'Nėra paskirstymų. Sukurkite naują.'
              : 'Nėra paskirstymų pasirinktiems filtrams.'}
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full text-sm" data-testid="budget-allocations-table">
                <thead className="bg-muted/40">
                  <tr className="text-left text-[11px] uppercase tracking-wide text-muted-foreground">
                    <th className="px-3 py-2 font-semibold">Šaltinis</th>
                    <th className="px-3 py-2 font-semibold">Kategorija</th>
                    <th className="px-3 py-2 font-semibold">Pavadinimas</th>
                    <th className="px-3 py-2 text-right font-semibold">Planuota</th>
                    <th className="px-3 py-2 font-semibold">Spec.prog. tipas</th>
                    <th className="px-3 py-2 text-right font-semibold">Veiksmai</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {items.map((a) => (
                    <tr
                      key={a.id}
                      className="cursor-pointer hover:bg-muted/40"
                      data-testid={`budget-allocation-row-${a.id}`}
                      onClick={() => {
                        if (canEdit) setDialog({ mode: 'edit', allocation: a });
                      }}
                    >
                      <td className="px-3 py-2">
                        <div className="flex flex-col">
                          <span className="text-xs text-muted-foreground">
                            {a.fundingSourceCode ?? `#${a.fundingSourceId}`}
                          </span>
                          <span>{a.fundingSourceName ?? '—'}</span>
                        </div>
                      </td>
                      <td className="px-3 py-2">
                        {a.categoryName ? (
                          <Badge variant="secondary" className="text-[10px]">
                            {a.categoryName}
                          </Badge>
                        ) : (
                          '—'
                        )}
                      </td>
                      <td className="px-3 py-2 font-medium">{a.pavadinimas}</td>
                      <td className="px-3 py-2 text-right tabular-nums">
                        {formatEur(a.planuotaSuma)}
                      </td>
                      <td className="px-3 py-2 text-xs">
                        {a.specProgTipas === 'atskiras'
                          ? 'Atskiras'
                          : a.specProgTipas === 'biudzeto_dalis'
                            ? 'Biudžeto dalis'
                            : '—'}
                      </td>
                      <td
                        className="px-3 py-2 text-right"
                        onClick={(e) => e.stopPropagation()}
                      >
                        {canEdit ? (
                          <div className="inline-flex gap-1">
                            <Button
                              type="button"
                              size="sm"
                              variant="ghost"
                              onClick={() =>
                                setDialog({ mode: 'edit', allocation: a })
                              }
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
                        ) : (
                          <span className="text-xs text-muted-foreground">—</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot className="border-t border-border bg-muted/30">
                  <tr>
                    <td colSpan={3} className="px-3 py-2 text-right font-semibold">
                      Viso planuojama:
                    </td>
                    <td className="px-3 py-2 text-right font-semibold tabular-nums">
                      {formatEur(totalPlanuota)}
                    </td>
                    <td colSpan={2} />
                  </tr>
                </tfoot>
              </table>
            </div>
          </CardContent>
        </Card>
      )}

      {dialog !== null && (
        <BudgetAllocationDialog
          mode={dialog.mode}
          allocation={dialog.allocation}
          defaultFundingSourceId={fundingSourceId}
          defaultYear={year ?? now.getFullYear()}
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
    </div>
  );
}
