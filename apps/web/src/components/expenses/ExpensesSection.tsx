/**
 * `ExpensesSection` — projekto detalės sąraše rodomos faktinės išlaidos
 * (Iter 12, FVM-4).
 *
 * Funkcijos:
 *  - Lentelė: data | tipas | suma € | aprašymas | šaltiniai | veiksmai
 *  - Filtrai: tipas, dateFrom, dateTo (vis projekto kontekste)
 *  - „Pridėti išlaidą" mygtukas — AM admin + org_admin
 *  - Empty state
 *  - Edit + delete eilutės veiksmai
 *
 * Tenant scope ribojimas — backend'as (`expenses.service.ts`) atlieka per
 * project.tenant_id.
 *
 * React Query invalidations po create/update/delete:
 *  - `expenses` (list)
 *  - `projects:summary` (panaudota persiskaičiavimas)
 *  - `budgetAllocations:summary` (allocation panaudojimas)
 *  - `budgetWarnings` (warning sąrašas)
 *  - `dashboard` (statistikai)
 */
import * as React from 'react';
import {
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';
import axios from 'axios';
import { Pencil, Plus, Trash2 } from 'lucide-react';
import type {
  Expense,
  ExpenseListQuery,
  ExpenseType,
} from '@biip-finansai/shared';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { useAuth } from '@/lib/auth';
import { canViewPayroll } from '@/lib/roles';
import { expensesApi } from '@/lib/api/fvm';
import { toast } from '@/lib/use-toast';
import { ExpenseDialog } from './ExpenseDialog';
import { EXPENSE_TYPE_LABELS, ExpenseTypeBadge } from './ExpenseTypeBadge';

const ALL_VALUE = '__all__';

const EXPENSE_TYPES: readonly ExpenseType[] = [
  'du',
  'sutartis',
  'saskaita',
  'tiesiogine',
];

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
  try {
    return new Intl.DateTimeFormat('lt-LT', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(new Date(value));
  } catch {
    return value;
  }
}

export interface ExpensesSectionProps {
  projectId: number;
  /** Default'inė allocation (paprastai iš projekto) — naudojama naujos išlaidos formoje. */
  defaultAllocationId: number | null;
  /** Projekto tenant ID — naudojamas permission gating'e. */
  projectTenantId: number;
}

export function ExpensesSection({
  projectId,
  defaultAllocationId,
  projectTenantId,
}: ExpensesSectionProps): JSX.Element {
  const { user } = useAuth();
  const qc = useQueryClient();

  const isAmAdmin =
    user?.tenantIsApprover === true && user.role === 'admin';
  const isOrgAdmin =
    user?.tenantIsApprover === false &&
    user.role === 'admin' &&
    user.tenantId === projectTenantId;
  const canWrite = isAmAdmin || isOrgAdmin;

  const [type, setType] = React.useState<ExpenseType | null>(null);
  const [dateFrom, setDateFrom] = React.useState<string>('');
  const [dateTo, setDateTo] = React.useState<string>('');

  const [dialog, setDialog] = React.useState<{
    mode: 'create' | 'edit';
    expense: Expense | null;
  } | null>(null);

  const listQuery: ExpenseListQuery = React.useMemo(
    () => ({
      projectId,
      type: type ?? undefined,
      dateFrom: dateFrom === '' ? undefined : dateFrom,
      dateTo: dateTo === '' ? undefined : dateTo,
    }),
    [projectId, type, dateFrom, dateTo],
  );

  const listQ = useQuery<Expense[]>({
    queryKey: ['expenses', listQuery],
    queryFn: () => expensesApi.list(listQuery),
  });

  function invalidateAfterMutation(): void {
    void qc.invalidateQueries({ queryKey: ['expenses'] });
    void qc.invalidateQueries({ queryKey: ['projects', projectId, 'summary'] });
    void qc.invalidateQueries({ queryKey: ['budgetAllocations'] });
    void qc.invalidateQueries({ queryKey: ['budgetWarnings'] });
    void qc.invalidateQueries({ queryKey: ['dashboard'] });
  }

  const deleteMutation = useMutation({
    mutationFn: (id: number) => expensesApi.remove(id),
    onSuccess: () => {
      invalidateAfterMutation();
      toast({ title: 'Išlaida ištrinta', variant: 'success' });
    },
    onError: (err: unknown) => {
      let msg = 'Nepavyko ištrinti išlaidos.';
      if (axios.isAxiosError(err)) {
        const data = err.response?.data as { message?: string } | undefined;
        if (data?.message) msg = data.message;
      } else if (err instanceof Error) {
        msg = err.message;
      }
      toast({ title: msg, variant: 'error' });
    },
  });

  function handleDelete(e: Expense): void {
    if (
      !window.confirm(
        `Ar tikrai ištrinti šią išlaidą (${formatDate(e.data)}, ${formatEur(e.suma)})?`,
      )
    ) {
      return;
    }
    deleteMutation.mutate(e.id);
  }

  // SAUGUMO PATCH (Iter 13.x, docx §4.4) — defense-in-depth:
  // Backend'as jau filter'ina DU expense'us per `canViewPayroll` SQL WHERE,
  // bet ir frontend'e papildomai išmetam — jei backend kažkaip pakeičia
  // savo elgseną arba cache'as turi senų DU įrašų, vartotojas vis tiek
  // jų nepamato. Du sluoksniai > vienas sluoksnis.
  const rawExpenses = listQ.data ?? [];
  const expenses = canViewPayroll(user)
    ? rawExpenses
    : rawExpenses.filter((e) => e.tipas !== 'du');
  const total = expenses.reduce(
    (acc, e) => acc + (Number.parseFloat(e.suma) || 0),
    0,
  );

  return (
    <Card data-testid="expenses-section">
      <CardContent className="p-4">
        <div className="mb-3 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <h3 className="text-sm font-semibold">Išlaidos</h3>
          {canWrite && (
            <Button
              size="sm"
              onClick={() => setDialog({ mode: 'create', expense: null })}
              data-testid="open-new-expense"
            >
              <Plus className="h-4 w-4" />
              Pridėti išlaidą
            </Button>
          )}
        </div>

        <div className="mb-3 grid gap-2 sm:grid-cols-3">
          <div className="space-y-1">
            <Label htmlFor="exp-flt-type" className="text-[11px] text-muted-foreground">
              Tipas
            </Label>
            <Select
              value={type === null ? ALL_VALUE : type}
              onValueChange={(v) =>
                setType(v === ALL_VALUE ? null : (v as ExpenseType))
              }
            >
              <SelectTrigger
                id="exp-flt-type"
                data-testid="expenses-filter-type"
              >
                <SelectValue placeholder="Visi tipai" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL_VALUE}>Visi tipai</SelectItem>
                {EXPENSE_TYPES.map((t) => (
                  <SelectItem key={t} value={t}>
                    {EXPENSE_TYPE_LABELS[t]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label
              htmlFor="exp-flt-from"
              className="text-[11px] text-muted-foreground"
            >
              Data nuo
            </Label>
            <Input
              id="exp-flt-from"
              type="date"
              value={dateFrom}
              onChange={(e) => setDateFrom(e.target.value)}
              data-testid="expenses-filter-date-from"
            />
          </div>
          <div className="space-y-1">
            <Label
              htmlFor="exp-flt-to"
              className="text-[11px] text-muted-foreground"
            >
              Data iki
            </Label>
            <Input
              id="exp-flt-to"
              type="date"
              value={dateTo}
              onChange={(e) => setDateTo(e.target.value)}
              data-testid="expenses-filter-date-to"
            />
          </div>
        </div>

        {listQ.isLoading ? (
          <div className="space-y-2" data-testid="expenses-skeleton">
            {Array.from({ length: 3 }).map((_, i) => (
              <Skeleton key={i} className="h-10" />
            ))}
          </div>
        ) : listQ.isError ? (
          <p className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-3 text-sm text-destructive">
            Nepavyko užkrauti išlaidų.
          </p>
        ) : expenses.length === 0 ? (
          <div
            className="rounded-md border border-dashed border-border px-3 py-6 text-center text-sm text-muted-foreground"
            data-testid="expenses-empty"
          >
            {canWrite
              ? 'Išlaidų dar nėra. Paspauskite „Pridėti išlaidą", kad pradėtumėte.'
              : 'Išlaidų pagal pasirinktus filtrus nėra.'}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table
              className="w-full text-sm"
              data-testid="expenses-table"
            >
              <thead className="bg-muted/40">
                <tr className="text-left text-[11px] uppercase tracking-wide text-muted-foreground">
                  <th className="px-3 py-2 font-semibold">Data</th>
                  <th className="px-3 py-2 font-semibold">Tipas</th>
                  <th className="px-3 py-2 text-right font-semibold">Suma</th>
                  <th className="px-3 py-2 font-semibold">Aprašymas</th>
                  <th className="px-3 py-2 font-semibold">Šaltiniai</th>
                  {canWrite && (
                    <th className="px-3 py-2 text-right font-semibold">
                      Veiksmai
                    </th>
                  )}
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {expenses.map((e) => (
                  <tr
                    key={e.id}
                    data-testid={`expense-row-${e.id}`}
                  >
                    <td className="px-3 py-2 tabular-nums">
                      {formatDate(e.data)}
                    </td>
                    <td className="px-3 py-2">
                      <ExpenseTypeBadge type={e.tipas} />
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">
                      {formatEur(e.suma)}
                    </td>
                    <td className="px-3 py-2 text-xs text-muted-foreground">
                      {e.aprasymas ?? '—'}
                    </td>
                    <td className="px-3 py-2">
                      {e.saltinioDalis !== null && e.saltinioDalis.length > 0 ? (
                        <Badge
                          variant="warning"
                          className="text-[10px]"
                          data-testid={`expense-multi-source-${e.id}`}
                        >
                          {e.saltinioDalis.length} šaltiniai
                        </Badge>
                      ) : (
                        <span className="text-xs text-muted-foreground">
                          Vienas
                        </span>
                      )}
                    </td>
                    {canWrite && (
                      <td className="px-3 py-2 text-right">
                        <div className="inline-flex gap-1">
                          <Button
                            type="button"
                            size="sm"
                            variant="ghost"
                            onClick={() =>
                              setDialog({ mode: 'edit', expense: e })
                            }
                            title="Redaguoti"
                            data-testid={`expense-edit-${e.id}`}
                          >
                            <Pencil className="h-3.5 w-3.5" />
                          </Button>
                          <Button
                            type="button"
                            size="sm"
                            variant="ghost"
                            className="text-destructive hover:text-destructive"
                            onClick={() => handleDelete(e)}
                            title="Ištrinti"
                            data-testid={`expense-delete-${e.id}`}
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        </div>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
              <tfoot className="border-t border-border bg-muted/30">
                <tr>
                  <td colSpan={2} className="px-3 py-2 text-right font-semibold">
                    Iš viso:
                  </td>
                  <td className="px-3 py-2 text-right font-semibold tabular-nums">
                    {formatEur(total)}
                  </td>
                  <td colSpan={canWrite ? 3 : 2} />
                </tr>
              </tfoot>
            </table>
          </div>
        )}

        {dialog !== null && (
          <ExpenseDialog
            mode={dialog.mode}
            expense={dialog.expense}
            projectId={projectId}
            defaultAllocationId={defaultAllocationId}
            open
            onOpenChange={(o) => {
              if (!o) setDialog(null);
            }}
            onSuccess={() => {
              invalidateAfterMutation();
              toast({
                title:
                  dialog.mode === 'create'
                    ? 'Išlaida pridėta'
                    : 'Išlaida atnaujinta',
                variant: 'success',
              });
              setDialog(null);
            }}
          />
        )}
      </CardContent>
    </Card>
  );
}

export default ExpensesSection;
