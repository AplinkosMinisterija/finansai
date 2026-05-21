/**
 * `ExpenseDialog` — faktinės išlaidos CRUD modal (Iter 12, FVM-4).
 *
 * Form'os laukai:
 *  - tipas (du | sutartis | saskaita | tiesiogine) — radio kelione (native input)
 *  - suma (decimal, > 0) — palaikom ir taško ir kablelio separator'ių
 *  - data (date input, ISO 8601)
 *  - aprasymas (textarea, optional, max 500 simbolių)
 *  - „Padalinti tarp finansavimo šaltinių" checkbox:
 *      OFF (default) — visa suma iš default'inio funding_source per allocation
 *      ON            — multi-row UI: kiekviena eilutė turi funding_source select +
 *                      suma input. Live validation: SUM === expense.suma (epsilon 1 ct)
 *
 * Backend (`expenses.service.ts`) papildomai tikrina:
 *  - projektas + allocation egzistuoja
 *  - tenant scope (write access)
 *  - kiekvienas funding_source_id egzistuoja
 *  - SUM(saltinio_dalis) === expense.suma su 1 ct epsilon
 *
 * A11y:
 *  - kiekvienas input turi `<Label htmlFor="">`
 *  - klaidos rodomos su `role="alert"`
 */
import * as React from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import axios from 'axios';
import { Loader2, Plus, Trash2 } from 'lucide-react';
import type {
  BudgetAllocation,
  Expense,
  ExpenseCreateDTO,
  ExpenseSourceDistributionItem,
  ExpenseType,
  ExpenseUpdateDTO,
  FundingSource,
} from '@biip-finansai/shared';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { budgetAllocationsApi, expensesApi, fundingSourcesApi } from '@/lib/api/fvm';
import { EXPENSE_TYPE_LABELS } from './ExpenseTypeBadge';

const EXPENSE_TYPES: readonly ExpenseType[] = [
  'du',
  'sutartis',
  'saskaita',
  'tiesiogine',
];

interface SplitRow {
  fundingSourceId: string;
  suma: string;
}

interface FormState {
  budgetAllocationId: string;
  tipas: ExpenseType;
  suma: string;
  data: string;
  aprasymas: string;
  splitEnabled: boolean;
  split: SplitRow[];
}

function todayIso(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function normalizeAmountInput(input: string): string {
  const cleaned = input.replace(/\s/g, '').replace(',', '.');
  const num = Number.parseFloat(cleaned);
  if (!Number.isFinite(num)) return '0.00';
  return num.toFixed(2);
}

function toCentsSafe(input: string): number {
  const normalized = normalizeAmountInput(input);
  const cents = Math.round(Number.parseFloat(normalized) * 100);
  return Number.isFinite(cents) ? cents : 0;
}

function emptyForm(defaults: {
  budgetAllocationId: number | null;
}): FormState {
  return {
    budgetAllocationId:
      defaults.budgetAllocationId !== null
        ? String(defaults.budgetAllocationId)
        : '',
    tipas: 'tiesiogine',
    suma: '',
    data: todayIso(),
    aprasymas: '',
    splitEnabled: false,
    split: [{ fundingSourceId: '', suma: '' }],
  };
}

function fromExpense(e: Expense): FormState {
  const hasSplit = e.saltinioDalis !== null && e.saltinioDalis.length > 0;
  return {
    budgetAllocationId: String(e.budgetAllocationId),
    tipas: e.tipas,
    suma: e.suma,
    data: e.data,
    aprasymas: e.aprasymas ?? '',
    splitEnabled: hasSplit,
    split: hasSplit
      ? (e.saltinioDalis as ExpenseSourceDistributionItem[]).map((d) => ({
          fundingSourceId: String(d.fundingSourceId),
          suma: d.suma,
        }))
      : [{ fundingSourceId: '', suma: '' }],
  };
}

export interface ExpenseDialogProps {
  mode: 'create' | 'edit';
  expense: Expense | null;
  /** Projekto ID — privalomas; visada egzistuoja jei sąraše dialog atvertas iš projekto detalės. */
  projectId: number;
  /** Default'inė allocation (paprastai iš projekto). */
  defaultAllocationId: number | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess: (expense: Expense) => void;
}

export function ExpenseDialog({
  mode,
  expense,
  projectId,
  defaultAllocationId,
  open,
  onOpenChange,
  onSuccess,
}: ExpenseDialogProps): JSX.Element {
  const [state, setState] = React.useState<FormState>(
    expense
      ? fromExpense(expense)
      : emptyForm({ budgetAllocationId: defaultAllocationId }),
  );
  const [validationError, setValidationError] = React.useState<string | null>(null);
  const [serverError, setServerError] = React.useState<string | null>(null);

  React.useEffect(() => {
    setValidationError(null);
    setServerError(null);
    setState(
      expense
        ? fromExpense(expense)
        : emptyForm({ budgetAllocationId: defaultAllocationId }),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [expense, defaultAllocationId, open]);

  const allocationsQ = useQuery<BudgetAllocation[]>({
    queryKey: ['budgetAllocations', { all: true }],
    queryFn: () => budgetAllocationsApi.list({}),
  });

  const sourcesQ = useQuery<FundingSource[]>({
    queryKey: ['fundingSources', { all: true }],
    queryFn: () => fundingSourcesApi.list({}),
  });

  const mutation = useMutation({
    mutationFn: async (): Promise<Expense> => {
      const budgetAllocationId = Number.parseInt(state.budgetAllocationId, 10);
      const sumaNorm = normalizeAmountInput(state.suma);
      const aprasymas =
        state.aprasymas.trim() === '' ? null : state.aprasymas.trim();
      let saltinioDalis: ExpenseSourceDistributionItem[] | null = null;
      if (state.splitEnabled) {
        saltinioDalis = state.split.map((r) => ({
          fundingSourceId: Number.parseInt(r.fundingSourceId, 10),
          suma: normalizeAmountInput(r.suma),
        }));
      }
      if (mode === 'create') {
        const body: ExpenseCreateDTO = {
          projectId,
          budgetAllocationId,
          tipas: state.tipas,
          suma: sumaNorm,
          data: state.data,
          aprasymas,
          saltinioDalis,
        };
        return expensesApi.create(body);
      }
      if (!expense) throw new Error('Nėra išlaidos redagavimui.');
      const patch: ExpenseUpdateDTO = {
        budgetAllocationId,
        tipas: state.tipas,
        suma: sumaNorm,
        data: state.data,
        aprasymas,
        saltinioDalis,
      };
      return expensesApi.update(expense.id, patch);
    },
    onSuccess: (e) => onSuccess(e),
    onError: (err: unknown) => {
      let msg = 'Nepavyko išsaugoti išlaidos.';
      if (axios.isAxiosError(err)) {
        const data = err.response?.data as { message?: string } | undefined;
        if (data?.message) msg = data.message;
      } else if (err instanceof Error) {
        msg = err.message;
      }
      setServerError(msg);
    },
  });

  function validate(): string | null {
    if (state.budgetAllocationId === '') {
      return 'Pasirinkite biudžeto paskirstymą.';
    }
    const sumaCents = toCentsSafe(state.suma);
    if (sumaCents <= 0) {
      return 'Suma turi būti didesnė už 0.';
    }
    if (state.data === '') {
      return 'Įveskite išlaidos datą.';
    }
    if (state.splitEnabled) {
      if (state.split.length === 0) {
        return 'Pridėkite bent vieną finansavimo šaltinio dalį.';
      }
      let totalCents = 0;
      const seenSources = new Set<number>();
      for (const r of state.split) {
        if (r.fundingSourceId === '') {
          return 'Visose padalijimo eilutėse pasirinkite finansavimo šaltinį.';
        }
        const sid = Number.parseInt(r.fundingSourceId, 10);
        if (seenSources.has(sid)) {
          return 'Tas pats finansavimo šaltinis pasirinktas kelis kartus.';
        }
        seenSources.add(sid);
        const rowCents = toCentsSafe(r.suma);
        if (rowCents <= 0) {
          return 'Visose padalijimo eilutėse įveskite teigiamą sumą.';
        }
        totalCents += rowCents;
      }
      // 1 ct epsilon (sutampa su backend EXPENSE_SUM_EPSILON_CENTS).
      if (Math.abs(totalCents - sumaCents) > 1) {
        return 'Finansavimo šaltinių sumų suma turi sutapti su išlaidos suma.';
      }
    }
    return null;
  }

  function onSubmit(e: React.FormEvent): void {
    e.preventDefault();
    setServerError(null);
    const err = validate();
    if (err) {
      setValidationError(err);
      return;
    }
    setValidationError(null);
    mutation.mutate();
  }

  function addSplitRow(): void {
    setState((s) => ({
      ...s,
      split: [...s.split, { fundingSourceId: '', suma: '' }],
    }));
  }

  function removeSplitRow(idx: number): void {
    setState((s) => ({
      ...s,
      split: s.split.filter((_, i) => i !== idx),
    }));
  }

  function updateSplitRow(idx: number, patch: Partial<SplitRow>): void {
    setState((s) => ({
      ...s,
      split: s.split.map((r, i) => (i === idx ? { ...r, ...patch } : r)),
    }));
  }

  const isCreate = mode === 'create';
  const allocations = allocationsQ.data ?? [];
  const sources = sourcesQ.data ?? [];
  const errorMsg = serverError ?? validationError;

  // Grupuojam allocations per funding_source pavadinimą.
  const allocationsBySource: Map<number, BudgetAllocation[]> = new Map();
  for (const a of allocations) {
    const arr = allocationsBySource.get(a.fundingSourceId) ?? [];
    arr.push(a);
    allocationsBySource.set(a.fundingSourceId, arr);
  }
  const sourceLookup = new Map(sources.map((s) => [s.id, s]));

  // Live computed split totals.
  const sumaCents = toCentsSafe(state.suma);
  const splitTotalCents = state.splitEnabled
    ? state.split.reduce((acc, r) => acc + toCentsSafe(r.suma), 0)
    : 0;
  const splitDiffCents = splitTotalCents - sumaCents;
  const splitMatches = state.splitEnabled
    ? Math.abs(splitDiffCents) <= 1 && sumaCents > 0
    : null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto">
        <form onSubmit={onSubmit} noValidate>
          <DialogHeader>
            <DialogTitle>
              {isCreate ? 'Nauja išlaida' : 'Redaguoti išlaidą'}
            </DialogTitle>
            <DialogDescription>
              {isCreate
                ? 'Užpildykite duomenis ir paspauskite „Sukurti".'
                : 'Atnaujinkite išlaidos duomenis. Projekto keisti negalima.'}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label>Tipas</Label>
              <div
                role="radiogroup"
                aria-label="Išlaidos tipas"
                className="grid grid-cols-2 gap-2 sm:grid-cols-4"
                data-testid="expense-tipas-radiogroup"
              >
                {EXPENSE_TYPES.map((t) => (
                  <label
                    key={t}
                    className="flex cursor-pointer items-center gap-2 rounded-md border border-border p-2 text-sm hover:bg-muted/50"
                  >
                    <input
                      type="radio"
                      name="expense-tipas"
                      value={t}
                      checked={state.tipas === t}
                      onChange={() => setState((s) => ({ ...s, tipas: t }))}
                      className="h-4 w-4"
                    />
                    {EXPENSE_TYPE_LABELS[t]}
                  </label>
                ))}
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="e-allocation">Biudžeto paskirstymas</Label>
              <Select
                value={state.budgetAllocationId}
                onValueChange={(v) =>
                  setState((s) => ({ ...s, budgetAllocationId: v }))
                }
              >
                <SelectTrigger
                  id="e-allocation"
                  data-testid="expense-allocation-trigger"
                >
                  <SelectValue placeholder="Pasirinkite biudžeto paskirstymą" />
                </SelectTrigger>
                <SelectContent>
                  {Array.from(allocationsBySource.entries()).map(([sId, arr]) => {
                    const src = sourceLookup.get(sId);
                    const groupLabel = src
                      ? `${src.pavadinimas} (${src.kodas}, ${src.metai})`
                      : `Šaltinis #${sId}`;
                    return (
                      <SelectGroup key={sId}>
                        <SelectLabel>{groupLabel}</SelectLabel>
                        {arr.map((a) => (
                          <SelectItem key={a.id} value={String(a.id)}>
                            {a.pavadinimas}
                            {a.categoryName ? ` · ${a.categoryName}` : ''}
                          </SelectItem>
                        ))}
                      </SelectGroup>
                    );
                  })}
                  {allocations.length === 0 && (
                    <div className="px-2 py-3 text-xs text-muted-foreground">
                      Nėra paskirstymų. Sukurkite biudžeto paskirstymą.
                    </div>
                  )}
                </SelectContent>
              </Select>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label htmlFor="e-suma">Suma (€)</Label>
                <Input
                  id="e-suma"
                  inputMode="decimal"
                  required
                  placeholder="100.00"
                  value={state.suma}
                  onChange={(e) =>
                    setState((s) => ({ ...s, suma: e.target.value }))
                  }
                  data-testid="expense-suma-input"
                />
                <p className="text-[11px] text-muted-foreground">
                  Galima ir kableliu (100,00).
                </p>
              </div>
              <div className="space-y-2">
                <Label htmlFor="e-data">Data</Label>
                <Input
                  id="e-data"
                  type="date"
                  required
                  value={state.data}
                  onChange={(e) =>
                    setState((s) => ({ ...s, data: e.target.value }))
                  }
                  data-testid="expense-data-input"
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="e-aprasymas">Aprašymas</Label>
              <textarea
                id="e-aprasymas"
                rows={2}
                maxLength={500}
                placeholder="Trumpas aprašymas (neprivalomas)"
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                value={state.aprasymas}
                onChange={(e) =>
                  setState((s) => ({ ...s, aprasymas: e.target.value }))
                }
              />
            </div>

            <div className="space-y-3 rounded-md border border-border p-3">
              <label className="flex cursor-pointer items-center gap-2 text-sm font-medium">
                <input
                  type="checkbox"
                  checked={state.splitEnabled}
                  onChange={(e) =>
                    setState((s) => ({
                      ...s,
                      splitEnabled: e.target.checked,
                      split:
                        e.target.checked && s.split.length === 0
                          ? [{ fundingSourceId: '', suma: '' }]
                          : s.split,
                    }))
                  }
                  className="h-4 w-4"
                  data-testid="expense-split-toggle"
                />
                Padalinti tarp finansavimo šaltinių
              </label>
              <p className="text-[11px] text-muted-foreground">
                Neįjungus padalijimo — visa suma įskaitoma per biudžeto eilutės
                numatytąjį finansavimo šaltinį.
              </p>

              {state.splitEnabled && (
                <div className="space-y-2" data-testid="expense-split-rows">
                  {state.split.map((row, idx) => (
                    <div
                      key={idx}
                      className="grid grid-cols-[1fr_140px_auto] items-end gap-2"
                      data-testid={`expense-split-row-${idx}`}
                    >
                      <div className="space-y-1">
                        <Label
                          htmlFor={`e-split-source-${idx}`}
                          className="text-[11px] text-muted-foreground"
                        >
                          Finansavimo šaltinis
                        </Label>
                        <Select
                          value={row.fundingSourceId}
                          onValueChange={(v) =>
                            updateSplitRow(idx, { fundingSourceId: v })
                          }
                        >
                          <SelectTrigger
                            id={`e-split-source-${idx}`}
                            data-testid={`expense-split-source-trigger-${idx}`}
                          >
                            <SelectValue placeholder="Pasirinkite šaltinį" />
                          </SelectTrigger>
                          <SelectContent>
                            {sources.map((s) => (
                              <SelectItem key={s.id} value={String(s.id)}>
                                {s.pavadinimas} ({s.kodas}, {s.metai})
                              </SelectItem>
                            ))}
                            {sources.length === 0 && (
                              <div className="px-2 py-3 text-xs text-muted-foreground">
                                Nėra finansavimo šaltinių.
                              </div>
                            )}
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="space-y-1">
                        <Label
                          htmlFor={`e-split-suma-${idx}`}
                          className="text-[11px] text-muted-foreground"
                        >
                          Suma (€)
                        </Label>
                        <Input
                          id={`e-split-suma-${idx}`}
                          inputMode="decimal"
                          placeholder="0.00"
                          value={row.suma}
                          onChange={(e) =>
                            updateSplitRow(idx, { suma: e.target.value })
                          }
                          data-testid={`expense-split-suma-${idx}`}
                        />
                      </div>
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        className="text-destructive hover:text-destructive"
                        onClick={() => removeSplitRow(idx)}
                        disabled={state.split.length <= 1}
                        title="Pašalinti eilutę"
                        data-testid={`expense-split-remove-${idx}`}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  ))}

                  <div className="flex items-center justify-between gap-2">
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      onClick={addSplitRow}
                      data-testid="expense-split-add"
                    >
                      <Plus className="h-3.5 w-3.5" />
                      Pridėti šaltinį
                    </Button>
                    <div
                      className="text-xs"
                      data-testid="expense-split-total"
                    >
                      Suma:{' '}
                      <span
                        className={
                          splitMatches === true
                            ? 'font-medium text-emerald-700'
                            : 'font-medium text-destructive'
                        }
                      >
                        {(splitTotalCents / 100).toFixed(2)} €
                      </span>{' '}
                      / {(sumaCents / 100).toFixed(2)} €
                      {splitMatches === false && sumaCents > 0 && (
                        <span className="ml-2 text-destructive">
                          (skirtumas {(Math.abs(splitDiffCents) / 100).toFixed(2)} €)
                        </span>
                      )}
                    </div>
                  </div>
                </div>
              )}
            </div>

            {errorMsg && (
              <div
                className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive"
                role="alert"
                data-testid="expense-dialog-error"
              >
                {errorMsg}
              </div>
            )}
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={mutation.isPending}
            >
              Atšaukti
            </Button>
            <Button type="submit" disabled={mutation.isPending}>
              {mutation.isPending ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Saugoma…
                </>
              ) : isCreate ? (
                'Sukurti'
              ) : (
                'Išsaugoti'
              )}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export default ExpenseDialog;
