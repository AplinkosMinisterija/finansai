/**
 * `BudgetAllocationDialog` — CRUD modal biudžeto paskirstymui (2 FVM lygis).
 *
 * Naudoja shadcn/ui Dialog + Input + Label primitives.
 * Validation:
 *  - fundingSource: privalomas
 *  - kategorija (klasifikatorius `budget_category`): privaloma
 *  - pavadinimas: privalomas
 *  - metai: > 2000
 *  - planuota suma: > 0
 *
 * Spec.programos tipas (`atskiras` / `biudzeto_dalis`) — RODYTI TIK kai
 * pasirinkta kategorija = `spec_programa` (kodas).
 *
 * Backend taip pat validuoja kategoriją + spec_prog_tipas suderinamumą ir
 * grąžina LT klaidos žinutę.
 */
import * as React from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import axios from 'axios';
import { Loader2 } from 'lucide-react';
import type {
  BudgetAllocation,
  BudgetAllocationCreateDTO,
  BudgetAllocationUpdateDTO,
  ClassifierItem,
  FundingSource,
  SpecProgTipas,
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
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { classifierItemsList } from '@/lib/api';
import { budgetAllocationsApi, fundingSourcesApi } from '@/lib/api/fvm';

const SPEC_PROGRAMA_CODE = 'spec_programa';

interface FormState {
  fundingSourceId: string;
  categoryClassifierItemId: string;
  pavadinimas: string;
  specProgTipas: SpecProgTipas | '';
  planuotaSuma: string;
  metai: string;
  pastabos: string;
}

function emptyForm(defaults: { fundingSourceId: number | null; year: number }): FormState {
  return {
    fundingSourceId:
      defaults.fundingSourceId !== null ? String(defaults.fundingSourceId) : '',
    categoryClassifierItemId: '',
    pavadinimas: '',
    specProgTipas: '',
    planuotaSuma: '',
    metai: String(defaults.year),
    pastabos: '',
  };
}

function fromAllocation(a: BudgetAllocation): FormState {
  return {
    fundingSourceId: String(a.fundingSourceId),
    categoryClassifierItemId: String(a.categoryClassifierItemId),
    pavadinimas: a.pavadinimas,
    specProgTipas: a.specProgTipas ?? '',
    planuotaSuma: a.planuotaSuma,
    metai: String(a.metai),
    pastabos: a.pastabos ?? '',
  };
}

function normalizeAmountInput(input: string): string {
  const cleaned = input.replace(/\s/g, '').replace(',', '.');
  const num = Number.parseFloat(cleaned);
  if (!Number.isFinite(num)) return '0.00';
  return num.toFixed(2);
}

export interface BudgetAllocationDialogProps {
  mode: 'create' | 'edit';
  allocation: BudgetAllocation | null;
  /** Numatytasis šaltinis (pvz., jei kuriama iš šaltinio detalės). */
  defaultFundingSourceId: number | null;
  /** Numatytieji metai (iš puslapio filtro). */
  defaultYear: number;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess: () => void;
}

export function BudgetAllocationDialog({
  mode,
  allocation,
  defaultFundingSourceId,
  defaultYear,
  open,
  onOpenChange,
  onSuccess,
}: BudgetAllocationDialogProps): JSX.Element {
  const [state, setState] = React.useState<FormState>(
    allocation
      ? fromAllocation(allocation)
      : emptyForm({ fundingSourceId: defaultFundingSourceId, year: defaultYear }),
  );
  const [validationError, setValidationError] = React.useState<string | null>(null);
  const [serverError, setServerError] = React.useState<string | null>(null);

  React.useEffect(() => {
    setValidationError(null);
    setServerError(null);
    setState(
      allocation
        ? fromAllocation(allocation)
        : emptyForm({ fundingSourceId: defaultFundingSourceId, year: defaultYear }),
    );
  }, [allocation, defaultFundingSourceId, defaultYear, open]);

  const sourcesQ = useQuery<FundingSource[]>({
    queryKey: ['fundingSources', {}],
    queryFn: () => fundingSourcesApi.list({}),
  });

  const categoriesQ = useQuery<ClassifierItem[]>({
    queryKey: ['classifierItems', { groupCode: 'budget_category' }],
    queryFn: () => classifierItemsList({ groupCode: 'budget_category' }),
    staleTime: 5 * 60 * 1000,
  });

  const categories = (categoriesQ.data ?? []).filter((c) => c.active);
  const selectedCategory = React.useMemo<ClassifierItem | undefined>(() => {
    const id = Number.parseInt(state.categoryClassifierItemId, 10);
    if (!Number.isFinite(id)) return undefined;
    return categories.find((c) => c.id === id);
  }, [state.categoryClassifierItemId, categories]);

  const showSpecProg = selectedCategory?.code === SPEC_PROGRAMA_CODE;

  // Jei keičiam į ne-spec_programa — išvalom specProgTipas reikšmę.
  React.useEffect(() => {
    if (!showSpecProg && state.specProgTipas !== '') {
      setState((s) => ({ ...s, specProgTipas: '' }));
    }
  }, [showSpecProg, state.specProgTipas]);

  const mutation = useMutation({
    mutationFn: async (): Promise<BudgetAllocation> => {
      const fundingSourceId = Number.parseInt(state.fundingSourceId, 10);
      const categoryClassifierItemId = Number.parseInt(state.categoryClassifierItemId, 10);
      const metai = Number.parseInt(state.metai, 10);
      const planuotaSuma = normalizeAmountInput(state.planuotaSuma);
      const specProgTipas: SpecProgTipas | null = showSpecProg
        ? state.specProgTipas === ''
          ? null
          : (state.specProgTipas as SpecProgTipas)
        : null;
      if (mode === 'create') {
        const body: BudgetAllocationCreateDTO = {
          fundingSourceId,
          categoryClassifierItemId,
          pavadinimas: state.pavadinimas.trim(),
          specProgTipas,
          planuotaSuma,
          metai,
          pastabos: state.pastabos.trim() || null,
        };
        return budgetAllocationsApi.create(body);
      }
      if (!allocation) throw new Error('No allocation to update');
      const patch: BudgetAllocationUpdateDTO = {
        categoryClassifierItemId,
        pavadinimas: state.pavadinimas.trim(),
        specProgTipas,
        planuotaSuma,
        metai,
        pastabos: state.pastabos.trim() || null,
      };
      return budgetAllocationsApi.update(allocation.id, patch);
    },
    onSuccess: () => onSuccess(),
    onError: (err: unknown) => {
      let msg = 'Nepavyko išsaugoti.';
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
    if (state.fundingSourceId === '') return 'Pasirinkite finansavimo šaltinį.';
    if (state.categoryClassifierItemId === '') return 'Pasirinkite kategoriją.';
    if (state.pavadinimas.trim() === '') return 'Įveskite pavadinimą.';
    const metai = Number.parseInt(state.metai, 10);
    if (!Number.isFinite(metai) || metai <= 2000) {
      return 'Metai turi būti didesni nei 2000.';
    }
    const sumaNum = Number.parseFloat(normalizeAmountInput(state.planuotaSuma));
    if (!Number.isFinite(sumaNum) || sumaNum <= 0) {
      return 'Planuojama suma turi būti didesnė už 0.';
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

  const isCreate = mode === 'create';
  const sources = sourcesQ.data ?? [];
  const errorMsg = serverError ?? validationError;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <form onSubmit={onSubmit} noValidate>
          <DialogHeader>
            <DialogTitle>
              {isCreate
                ? 'Naujas biudžeto paskirstymas'
                : `Redaguoti — ${allocation?.pavadinimas ?? ''}`}
            </DialogTitle>
            <DialogDescription>
              {isCreate
                ? 'Susiekite paskirstymą su finansavimo šaltiniu ir kategorija.'
                : 'Atnaujinkite paskirstymo duomenis.'}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="ba-source">Finansavimo šaltinis</Label>
              <Select
                value={state.fundingSourceId}
                onValueChange={(v) =>
                  setState((s) => ({ ...s, fundingSourceId: v }))
                }
                disabled={mode === 'edit'}
              >
                <SelectTrigger id="ba-source">
                  <SelectValue placeholder="Pasirinkite šaltinį" />
                </SelectTrigger>
                <SelectContent>
                  {sources.map((s) => (
                    <SelectItem key={s.id} value={String(s.id)}>
                      {s.pavadinimas} ({s.kodas}, {s.metai})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {mode === 'edit' && (
                <p className="text-[11px] text-muted-foreground">
                  Šaltinio keisti negalima — sukurkite naują paskirstymą.
                </p>
              )}
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label htmlFor="ba-category">Kategorija</Label>
                <Select
                  value={state.categoryClassifierItemId}
                  onValueChange={(v) =>
                    setState((s) => ({ ...s, categoryClassifierItemId: v }))
                  }
                >
                  <SelectTrigger id="ba-category">
                    <SelectValue placeholder="Pasirinkite kategoriją" />
                  </SelectTrigger>
                  <SelectContent>
                    {categories.map((c) => (
                      <SelectItem key={c.id} value={String(c.id)}>
                        {c.name} ({c.code})
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="ba-metai">Metai</Label>
                <Input
                  id="ba-metai"
                  type="number"
                  min={2001}
                  max={3000}
                  required
                  value={state.metai}
                  onChange={(e) => setState((s) => ({ ...s, metai: e.target.value }))}
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="ba-pavadinimas">Pavadinimas</Label>
              <Input
                id="ba-pavadinimas"
                required
                maxLength={200}
                placeholder="DU darbuotojams"
                value={state.pavadinimas}
                onChange={(e) => setState((s) => ({ ...s, pavadinimas: e.target.value }))}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="ba-suma">Planuota suma (€)</Label>
              <Input
                id="ba-suma"
                inputMode="decimal"
                required
                placeholder="500000.00"
                value={state.planuotaSuma}
                onChange={(e) => setState((s) => ({ ...s, planuotaSuma: e.target.value }))}
              />
              <p className="text-[11px] text-muted-foreground">
                Galima ir kableliu (500000,00).
              </p>
            </div>

            {showSpecProg && (
              <fieldset className="space-y-2 rounded-md border border-border p-3">
                <legend className="px-1 text-sm font-medium">Spec.programos tipas</legend>
                <div className="flex flex-col gap-2 text-sm sm:flex-row sm:gap-4">
                  <label className="flex cursor-pointer items-center gap-2">
                    <input
                      type="radio"
                      name="ba-specprog"
                      value="atskiras"
                      checked={state.specProgTipas === 'atskiras'}
                      onChange={() =>
                        setState((s) => ({ ...s, specProgTipas: 'atskiras' }))
                      }
                    />
                    <span>Atskiras</span>
                  </label>
                  <label className="flex cursor-pointer items-center gap-2">
                    <input
                      type="radio"
                      name="ba-specprog"
                      value="biudzeto_dalis"
                      checked={state.specProgTipas === 'biudzeto_dalis'}
                      onChange={() =>
                        setState((s) => ({ ...s, specProgTipas: 'biudzeto_dalis' }))
                      }
                    />
                    <span>Biudžeto dalis</span>
                  </label>
                  <label className="flex cursor-pointer items-center gap-2">
                    <input
                      type="radio"
                      name="ba-specprog"
                      value=""
                      checked={state.specProgTipas === ''}
                      onChange={() => setState((s) => ({ ...s, specProgTipas: '' }))}
                    />
                    <span className="text-muted-foreground">Nenurodyta</span>
                  </label>
                </div>
                <p className="text-[11px] text-muted-foreground">
                  „Atskiras" — kuriama atskira spec.programa (auto-create projekto įrašas).
                  „Biudžeto dalis" — yra dalis bendro biudžeto.
                </p>
              </fieldset>
            )}

            <div className="space-y-2">
              <Label htmlFor="ba-pastabos">Pastabos</Label>
              <textarea
                id="ba-pastabos"
                rows={2}
                maxLength={4000}
                placeholder="Trumpas paskirstymo paaiškinimas"
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                value={state.pastabos}
                onChange={(e) => setState((s) => ({ ...s, pastabos: e.target.value }))}
              />
            </div>

            {errorMsg && (
              <div
                className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive"
                role="alert"
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
