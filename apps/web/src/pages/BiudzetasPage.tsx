/**
 * Biudžeto paskirstymų puslapis (Iter 9, FVM-1 refactor + Iter 12, FVM-4).
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
 * Iter 12: kiekviena eilutė papildyta faktinė / likutis / % panaudota
 * kolonomis su warning badge'ais (≥80% — geltonas; >100% — raudonas).
 * Suvestinė per `expenses.budgetSummary` (bulk endpoint) — vienas užklausimas
 * vietoj N+1 per row. Po sekcijos rodomas „Įspėjimai" sąrašas su visomis
 * warning eilutėmis tiems patiems metams.
 *
 * AM administratoriai mato „Naujas paskirstymas" mygtuką ir edit/delete eilutės
 * veiksmus. Klikinti eilutę — atveria BudgetAllocationDialog edit režime.
 */
import * as React from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import axios from 'axios';
import { AlertTriangle, Pencil, Plus, Trash2, TriangleAlert, Wallet } from 'lucide-react';
import type {
  BudgetAllocation,
  BudgetWarningItem,
  BudgetWarningsResponse,
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
import { BudgetWarningsList } from '@/components/charts/BudgetWarningsList';
import { BudgetAllocationDialog } from '@/components/budget-allocations/BudgetAllocationDialog';
import { useAuth } from '@/lib/auth';
import { canManageBudget } from '@/lib/roles';
import { classifierItemsList } from '@/lib/api';
import { budgetAllocationsApi, expensesApi, fundingSourcesApi } from '@/lib/api/fvm';
import { cn } from '@/lib/utils';

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

  // Iter 12 — biudžeto suvestinė per bulk endpoint'ą. Aktyvi tik kai year
  // pasirinktas (tikslinga konkretiems metams). Jei „Visi metai" — neužkraunam.
  const summaryQ = useQuery<BudgetWarningsResponse>({
    queryKey: ['budgetWarnings', { year }],
    queryFn: () => expensesApi.budgetSummary({ year: year! }),
    enabled: year !== null,
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => budgetAllocationsApi.remove(id),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['budgetAllocations'] });
      void qc.invalidateQueries({ queryKey: ['fundingSources'] });
      void qc.invalidateQueries({ queryKey: ['budgetWarnings'] });
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
    const label = a.categoryName ?? a.pavadinimas;
    if (!window.confirm(`Ar tikrai ištrinti paskirstymą „${label}"?`)) return;
    deleteMutation.mutate(a.id);
  }

  const sources = sourcesQ.data ?? [];
  const categories = (categoriesQ.data ?? []).filter((c) => c.active);
  const items = listQ.data ?? [];

  // Suvestinė per allocationId — Map'as quick lookup'ui.
  const summaryByAllocation = React.useMemo<Map<number, BudgetWarningItem>>(() => {
    const m = new Map<number, BudgetWarningItem>();
    for (const w of summaryQ.data?.items ?? []) {
      m.set(w.allocationId, w);
    }
    return m;
  }, [summaryQ.data]);

  const totalPlanuota = items.reduce((acc, a) => acc + (Number.parseFloat(a.planuotaSuma) || 0), 0);
  const totalFaktine = items.reduce((acc, a) => {
    const s = summaryByAllocation.get(a.id);
    return acc + (s ? Number.parseFloat(s.faktine) || 0 : 0);
  }, 0);
  const totalLikutis = totalPlanuota - totalFaktine;

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
            2 FVM lygis: „Kam skiriama?". Kiekvienas paskirstymas priklauso vienam finansavimo
            šaltiniui.
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
              onValueChange={(v) => setYear(v === ALL_VALUE ? null : Number.parseInt(v, 10))}
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
                    <th className="px-3 py-2 text-right font-semibold">Planuota</th>
                    <th className="px-3 py-2 text-right font-semibold">Faktinė</th>
                    <th className="px-3 py-2 text-right font-semibold">Likutis</th>
                    <th className="px-3 py-2 text-right font-semibold">% panaud.</th>
                    <th className="px-3 py-2 text-right font-semibold">Veiksmai</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {items.map((a) => {
                    const s = summaryByAllocation.get(a.id);
                    const tone = s?.isOver ? 'destructive' : s?.isWarning ? 'warning' : 'default';
                    return (
                      <tr
                        key={a.id}
                        className="cursor-pointer hover:bg-muted/40"
                        data-testid={`budget-allocation-row-${a.id}`}
                        data-tone={tone}
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
                          <div className="flex flex-col gap-1">
                            {a.categoryName ? (
                              <Badge variant="secondary" className="w-fit text-[10px]">
                                {a.categoryName}
                              </Badge>
                            ) : (
                              '—'
                            )}
                            {a.specProgTipas && (
                              <span className="text-[10px] text-muted-foreground">
                                {a.specProgTipas === 'atskiras'
                                  ? 'Atskiras finansavimas'
                                  : 'Biudžeto dalis'}
                              </span>
                            )}
                          </div>
                        </td>
                        <td className="px-3 py-2 text-right tabular-nums">
                          {formatEur(a.planuotaSuma)}
                        </td>
                        <td className="px-3 py-2 text-right tabular-nums">
                          {s ? (
                            formatEur(s.faktine)
                          ) : (
                            <span className="text-xs text-muted-foreground">
                              {year === null ? '—' : '…'}
                            </span>
                          )}
                        </td>
                        <td
                          className={cn(
                            'px-3 py-2 text-right tabular-nums',
                            s?.isOver && 'text-destructive font-medium',
                          )}
                        >
                          {s ? formatEur(s.likutis) : '—'}
                        </td>
                        <td className="px-3 py-2 text-right">
                          {s ? (
                            <div className="flex items-center justify-end gap-1.5">
                              {s.isOver ? (
                                <Badge
                                  variant="destructive"
                                  className="text-[10px]"
                                  data-testid={`budget-warning-badge-${a.id}`}
                                >
                                  <AlertTriangle className="h-3 w-3" />
                                  Viršyta
                                </Badge>
                              ) : s.isWarning ? (
                                <Badge
                                  variant="warning"
                                  className="text-[10px]"
                                  data-testid={`budget-warning-badge-${a.id}`}
                                >
                                  <TriangleAlert className="h-3 w-3" />
                                  {s.percentUsed.toFixed(1)}%
                                </Badge>
                              ) : (
                                <span className="tabular-nums text-xs text-muted-foreground">
                                  {s.percentUsed.toFixed(1)}%
                                </span>
                              )}
                            </div>
                          ) : (
                            <span className="text-xs text-muted-foreground">—</span>
                          )}
                        </td>
                        <td className="px-3 py-2 text-right" onClick={(e) => e.stopPropagation()}>
                          {canEdit ? (
                            <div className="inline-flex gap-1">
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
                          ) : (
                            <span className="text-xs text-muted-foreground">—</span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
                <tfoot className="border-t border-border bg-muted/30">
                  <tr>
                    <td colSpan={2} className="px-3 py-2 text-right font-semibold">
                      Iš viso:
                    </td>
                    <td className="px-3 py-2 text-right font-semibold tabular-nums">
                      {formatEur(totalPlanuota)}
                    </td>
                    <td className="px-3 py-2 text-right font-semibold tabular-nums">
                      {summaryQ.data ? formatEur(totalFaktine) : '—'}
                    </td>
                    <td
                      className={cn(
                        'px-3 py-2 text-right font-semibold tabular-nums',
                        summaryQ.data && totalLikutis < 0 && 'text-destructive',
                      )}
                    >
                      {summaryQ.data ? formatEur(totalLikutis) : '—'}
                    </td>
                    <td colSpan={2} />
                  </tr>
                </tfoot>
              </table>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Įspėjimai — visi allocations su isWarning=true tiems metams. */}
      {year !== null && (
        <Card className="mt-4">
          <CardContent className="p-4">
            <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold">
              <AlertTriangle className="h-4 w-4 text-orange-600" />
              Įspėjimai ({year} m.)
            </h2>
            <p className="mb-3 text-xs text-muted-foreground">
              Biudžeto paskirstymai, kurių panaudojimas siekia 80% arba viršija planuotą sumą.
            </p>
            <BudgetWarningsList year={year} topN={50} onlyWarnings={true} />
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
            void qc.invalidateQueries({ queryKey: ['budgetWarnings'] });
            setDialog(null);
          }}
        />
      )}
    </div>
  );
}
